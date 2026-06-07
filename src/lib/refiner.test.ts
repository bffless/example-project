import { describe, it, expect } from 'vitest'
import {
  toRefinement,
  effectiveSegments,
  effectiveCuts,
  segmentsToTimedWords,
  normalizeCuts,
  addCut,
  removeCut,
  gaps,
  fitsGap,
  insertSegment,
  removeSegment,
  type RefineSceneRaw,
} from './refiner'
import type { NarrationSegment } from './scenes'
import type { Scene } from './scenes'

/** A minimal scene spanning [start, end] with a director first-pass draft/cuts. */
function scene(partial: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    index: 0,
    title: 'Scene 1',
    start: 0,
    end: 100,
    transcript: '',
    draftText: 'the director first pass script',
    status: 'pending',
    narrationSeconds: null,
    cuts: [{ start: 40, end: 50 }],
    ...partial,
  }
}

describe('toRefinement', () => {
  it('coerces segments + cuts and tags the source ai', () => {
    const raw: RefineSceneRaw = {
      segments: [
        { text: 'first run of new narration', start: 0, end: 30 },
        { text: 'second run after a pause', start: 55, end: 90 },
      ],
      cuts: [{ start: 35, end: 52 }],
    }
    const r = toRefinement(raw, scene())
    expect(r.source).toBe('ai')
    expect(r.segments).toEqual([
      { text: 'first run of new narration', start: 0, end: 30 },
      { text: 'second run after a pause', start: 55, end: 90 },
    ])
    expect(r.cuts).toEqual([{ start: 35, end: 52 }])
  })

  it('clamps segments + cuts into the scene span', () => {
    const raw: RefineSceneRaw = {
      segments: [{ text: 'spills past the end', start: 90, end: 200 }],
      cuts: [{ start: -10, end: 30 }],
    }
    const r = toRefinement(raw, scene({ start: 0, end: 100 }))
    expect(r.segments[0]).toMatchObject({ start: 90, end: 100 })
    expect(r.cuts[0]).toEqual({ start: 0, end: 30 })
  })

  it('sorts segments ascending and forces them non-overlapping', () => {
    const raw: RefineSceneRaw = {
      segments: [
        { text: 'later', start: 40, end: 80 },
        { text: 'earlier', start: 0, end: 50 }, // overlaps the later one
      ],
    }
    const r = toRefinement(raw, scene())
    expect(r.segments.map((s) => s.text)).toEqual(['earlier', 'later'])
    // 'later' start snapped up to 'earlier' end so they don't overlap
    expect(r.segments[1].start).toBe(50)
  })

  it('drops empty-text and zero-length segments', () => {
    const raw: RefineSceneRaw = {
      segments: [
        { text: '   ', start: 0, end: 10 },
        { text: 'real', start: 10, end: 10.02 }, // collapses (<0.05)
        { text: 'kept', start: 20, end: 40 },
      ],
    }
    const r = toRefinement(raw, scene())
    expect(r.segments).toEqual([{ text: 'kept', start: 20, end: 40 }])
  })

  it('defaults to empty arrays for a junk response', () => {
    const r = toRefinement({} as RefineSceneRaw, scene())
    expect(r).toEqual({ segments: [], cuts: [], source: 'ai' })
  })
})

describe('effectiveSegments / effectiveCuts', () => {
  it('uses the refinement when present', () => {
    const refined = { segments: [{ text: 'new', start: 5, end: 9 }], cuts: [{ start: 1, end: 2 }], source: 'ai' as const }
    const s = scene({ refined })
    expect(effectiveSegments(s)).toBe(refined.segments)
    expect(effectiveCuts(s)).toBe(refined.cuts)
  })

  it('falls back to one draftText segment + director cuts when not refined', () => {
    const s = scene({ start: 0, end: 100, draftText: 'fallback', cuts: [{ start: 40, end: 50 }] })
    expect(effectiveSegments(s)).toEqual([{ text: 'fallback', start: 0, end: 100 }])
    expect(effectiveCuts(s)).toEqual([{ start: 40, end: 50 }])
  })

  it('reverting to refined=null restores the director baseline', () => {
    const s = scene({ refined: null })
    expect(effectiveSegments(s)).toEqual([{ text: 'the director first pass script', start: 0, end: 100 }])
    expect(effectiveCuts(s)).toEqual([{ start: 40, end: 50 }])
  })
})

describe('segmentsToTimedWords', () => {
  it('flows words at the rate from each segment start, leaving gaps between', () => {
    const words = segmentsToTimedWords(
      [
        { text: 'a b', start: 0, end: 10 },
        { text: 'c d', start: 50, end: 60 },
      ],
      2, // 2 words/sec → 0.5s step
    )
    expect(words).toHaveLength(4)
    expect(words[0]).toMatchObject({ text: 'a', start: 0 })
    expect(words[1].start).toBeCloseTo(0.5, 5)
    // second segment starts at its own anchor, not continuing from the first
    expect(words[2]).toMatchObject({ text: 'c', start: 50 })
    expect(words[3].start).toBeCloseTo(50.5, 5)
  })

  it('fits a voiced segment to its real audio length', () => {
    // 4 words across a measured 8s clip → 2s per word, ending at the clip end.
    const words = segmentsToTimedWords([
      { text: 'one two three four', start: 10, end: 30, audioSeconds: 8 },
    ])
    expect(words).toHaveLength(4)
    expect(words[0]).toMatchObject({ text: 'one', start: 10 })
    expect(words[3].start).toBeCloseTo(16, 5) // 10 + 3*(8/4)
    expect(words[3].end).toBeCloseTo(18, 5) // ends at start + audioSeconds
  })

  it('returns [] for no segments', () => {
    expect(segmentsToTimedWords([])).toEqual([])
  })
})

describe('normalizeCuts', () => {
  it('sorts, drops slivers, and coalesces touching/overlapping spans', () => {
    expect(
      normalizeCuts([
        { start: 13, end: 24 },
        { start: 0, end: 9 },
        { start: 9, end: 13 }, // bridges the first two → all three merge
        { start: 60, end: 60.02 }, // sub-cell sliver → dropped
        { start: 43, end: 53 },
      ]),
    ).toEqual([
      { start: 0, end: 24 },
      { start: 43, end: 53 },
    ])
  })
})

describe('addCut', () => {
  const sc = { start: 0, end: 100 }

  it('adds a brand-new cut over kept footage', () => {
    expect(addCut([{ start: 0, end: 9 }], { start: 30, end: 40 }, sc)).toEqual([
      { start: 0, end: 9 },
      { start: 30, end: 40 },
    ])
  })

  it('extends an existing cut when the new span is adjacent', () => {
    // the 9–13 dead air between two cuts, added → the three collapse to one
    expect(
      addCut([{ start: 0, end: 9 }, { start: 13, end: 24 }], { start: 9, end: 13 }, sc),
    ).toEqual([{ start: 0, end: 24 }])
  })

  it('clamps the added span to the scene span', () => {
    expect(addCut([], { start: 90, end: 200 }, sc)).toEqual([{ start: 90, end: 100 }])
  })

  it('ignores a span that clamps to nothing', () => {
    expect(addCut([{ start: 0, end: 9 }], { start: 200, end: 300 }, sc)).toEqual([
      { start: 0, end: 9 },
    ])
  })
})

describe('removeCut', () => {
  it('contracts a cut from its edge', () => {
    expect(removeCut([{ start: 0, end: 9 }], { start: 5, end: 9 })).toEqual([
      { start: 0, end: 5 },
    ])
  })

  it('splits a cut when the removal carves out the middle', () => {
    expect(removeCut([{ start: 0, end: 20 }], { start: 8, end: 12 })).toEqual([
      { start: 0, end: 8 },
      { start: 12, end: 20 },
    ])
  })

  it('drops a fully-covered cut and leaves others untouched', () => {
    expect(
      removeCut([{ start: 13, end: 24 }, { start: 43, end: 53 }], { start: 10, end: 30 }),
    ).toEqual([{ start: 43, end: 53 }])
  })
})

describe('gaps', () => {
  const sc = { start: 0, end: 100 }
  const seg = (start: number, end: number): NarrationSegment => ({ text: 'x', start, end })

  it('returns the empty spans around the segments', () => {
    expect(gaps([seg(10, 30), seg(60, 80)], sc)).toEqual([
      { start: 0, end: 10 },
      { start: 30, end: 60 },
      { start: 80, end: 100 },
    ])
  })

  it('is the whole scene when there are no segments', () => {
    expect(gaps([], sc)).toEqual([{ start: 0, end: 100 }])
  })

  it('ignores overlapping/touching segments when carving gaps', () => {
    expect(gaps([seg(0, 40), seg(20, 60)], sc)).toEqual([{ start: 60, end: 100 }])
  })
})

describe('fitsGap', () => {
  const sc = { start: 0, end: 100 }
  const seg = (start: number, end: number): NarrationSegment => ({ text: 'x', start, end })
  const segs = [seg(10, 30), seg(60, 80)] // gaps: 0–10, 30–60, 80–100

  it('accepts a clip that fits inside a single gap', () => {
    expect(fitsGap(segs, sc, 35, 20)).toBe(true) // 35–55 ⊂ 30–60
  })

  it('rejects a clip that overlaps a run', () => {
    expect(fitsGap(segs, sc, 55, 20)).toBe(false) // 55–75 hits the 60–80 run
  })

  it('rejects a clip that spills past the scene', () => {
    expect(fitsGap(segs, sc, 90, 20)).toBe(false) // 90–110 > scene end
  })

  it('rejects a zero/negative duration', () => {
    expect(fitsGap(segs, sc, 35, 0)).toBe(false)
  })
})

describe('insertSegment / removeSegment', () => {
  const seg = (start: number, end: number): NarrationSegment => ({ text: `${start}`, start, end })

  it('inserts keeping ascending order', () => {
    expect(insertSegment([seg(0, 10), seg(60, 80)], seg(30, 50))).toEqual([
      seg(0, 10),
      seg(30, 50),
      seg(60, 80),
    ])
  })

  it('removes by index', () => {
    expect(removeSegment([seg(0, 10), seg(30, 50), seg(60, 80)], 1)).toEqual([
      seg(0, 10),
      seg(60, 80),
    ])
  })
})
