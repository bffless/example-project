import { describe, it, expect } from 'vitest'
import {
  buildSlices,
  planAssembly,
  buildFfmpegCommand,
  type AssembleInput,
  type AssembleSegment,
} from './assemble'

/** A voiced segment (has an audio clip) over `[start, end]`. */
function seg(start: number, end: number, audioSeconds = end - start): AssembleSegment {
  return { start, end, audioUrl: `clip-${start}-${end}.wav`, audioSeconds }
}

const kinds = (input: AssembleInput) => buildSlices(input).map((s) => s.kind)

describe('buildSlices — the three-state walk', () => {
  it('single segment, no cuts: the whole span is one segment slice', () => {
    const slices = buildSlices({ segments: [seg(0, 10)], cuts: [], duration: 10 })
    expect(slices).toEqual([{ kind: 'segment', start: 0, end: 10, segmentIndex: 0 }])
  })

  it('dead space between two segments becomes a dead slice', () => {
    const slices = buildSlices({ segments: [seg(0, 4), seg(6, 10)], cuts: [], duration: 10 })
    expect(slices).toEqual([
      { kind: 'segment', start: 0, end: 4, segmentIndex: 0 },
      { kind: 'dead', start: 4, end: 6 },
      { kind: 'segment', start: 6, end: 10, segmentIndex: 1 },
    ])
  })

  it('cut wins on overlap: a cut inside a segment splits its kept video', () => {
    // segment 0–10, cut 5–8 → kept 0–5 and 8–10, both segment 0.
    const slices = buildSlices({ segments: [seg(0, 10)], cuts: [{ start: 5, end: 8 }], duration: 10 })
    expect(slices).toEqual([
      { kind: 'segment', start: 0, end: 5, segmentIndex: 0 },
      { kind: 'cut', start: 5, end: 8 },
      { kind: 'segment', start: 8, end: 10, segmentIndex: 0 },
    ])
  })

  it('a segment butting a cut: cut truncates the segment tail', () => {
    // segment 0–10, cut 8–12 (clamped to 10) → kept 0–8.
    const slices = buildSlices({ segments: [seg(0, 10)], cuts: [{ start: 8, end: 12 }], duration: 10 })
    expect(slices).toEqual([
      { kind: 'segment', start: 0, end: 8, segmentIndex: 0 },
      { kind: 'cut', start: 8, end: 10 },
    ])
  })

  it('trailing dead space past the last segment is kept (honored, not trimmed)', () => {
    // talk stops at 8 on a 10s clip → 8–10 is dead, not dropped.
    const slices = buildSlices({ segments: [seg(0, 8)], cuts: [], duration: 10 })
    expect(slices).toEqual([
      { kind: 'segment', start: 0, end: 8, segmentIndex: 0 },
      { kind: 'dead', start: 8, end: 10 },
    ])
  })

  it('N segments tile in order', () => {
    const input = { segments: [seg(0, 3), seg(3, 6), seg(6, 9)], cuts: [], duration: 9 }
    expect(kinds(input)).toEqual(['segment', 'segment', 'segment'])
    expect(buildSlices(input).map((s) => (s.kind === 'segment' ? s.segmentIndex : -1))).toEqual([0, 1, 2])
  })

  it('returns nothing for a non-positive duration', () => {
    expect(buildSlices({ segments: [seg(0, 5)], cuts: [], duration: 0 })).toEqual([])
  })
})

describe('planAssembly — video + audio pieces', () => {
  it('cut-split segment: two video trims but one audio clip covering both', () => {
    const plan = planAssembly({ segments: [seg(0, 10)], cuts: [{ start: 5, end: 8 }], duration: 10 })
    expect(plan.video).toEqual([
      { start: 0, end: 5 },
      { start: 8, end: 10 },
    ])
    // One clip for segment 0, length = kept video = 5 + 2 = 7. audioSeconds is
    // clamped to the slot (the 10s clip can't exceed its 7s of kept video).
    expect(plan.audio).toEqual([{ kind: 'clip', segmentIndex: 0, length: 7, audioSeconds: 7 }])
    expect(plan.duration).toBe(7)
  })

  it('dead space → a silence piece of its own length', () => {
    const plan = planAssembly({ segments: [seg(0, 4), seg(6, 10)], cuts: [], duration: 10 })
    expect(plan.audio).toEqual([
      { kind: 'clip', segmentIndex: 0, length: 4, audioSeconds: 4 },
      { kind: 'silence', length: 2 },
      { kind: 'clip', segmentIndex: 1, length: 4, audioSeconds: 4 },
    ])
    // Video keeps everything (nothing cut), so duration == source duration.
    expect(plan.duration).toBe(10)
  })

  it('trailing dead space becomes trailing silence (kept video, no audio)', () => {
    const plan = planAssembly({ segments: [seg(0, 8)], cuts: [], duration: 10 })
    expect(plan.audio).toEqual([
      { kind: 'clip', segmentIndex: 0, length: 8, audioSeconds: 8 },
      { kind: 'silence', length: 2 },
    ])
  })

  it('an un-voiced segment (no audioUrl) plays as silence — no missing input', () => {
    const segments: AssembleSegment[] = [{ start: 0, end: 5 }] // no audioUrl
    const plan = planAssembly({ segments, cuts: [], duration: 5 })
    expect(plan.audio).toEqual([{ kind: 'silence', length: 5 }])
  })

  it('video and audio tracks are always equal total length', () => {
    const plan = planAssembly({
      segments: [seg(2.3, 5.8), seg(9, 13), seg(24, 43)],
      cuts: [
        { start: 0, end: 2.3 },
        { start: 5.8, end: 8.6 },
        { start: 13.5, end: 23.75 },
        { start: 37.1, end: 50 },
      ],
      duration: 53,
    })
    const vTotal = plan.video.reduce((n, v) => n + (v.end - v.start), 0)
    const aTotal = plan.audio.reduce((n, a) => n + a.length, 0)
    expect(aTotal).toBeCloseTo(vTotal, 6)
    expect(plan.duration).toBeCloseTo(vTotal, 6)
  })

  it("matches the story's worked example (source = 53s)", () => {
    // segments: [2.3–5.8] [9–13] [24–43] ; cuts: [0–2.3] [5.8–8.6] [13.5–23.75] [37.1–50]
    const plan = planAssembly({
      segments: [seg(2.3, 5.8), seg(9, 13), seg(24, 43)],
      cuts: [
        { start: 0, end: 2.3 },
        { start: 5.8, end: 8.6 },
        { start: 13.5, end: 23.75 },
        { start: 37.1, end: 50 },
      ],
      duration: 53,
    })
    // Kept footage, in order: seg0, dead 8.6–9, seg1, dead 13–13.5, dead 23.75–24,
    // seg2 (24–37.1, cut wins past 37.1), dead 50–53.
    expect(plan.video).toEqual([
      { start: 2.3, end: 5.8 },
      { start: 8.6, end: 9 },
      { start: 9, end: 13 },
      { start: 13, end: 13.5 },
      { start: 23.75, end: 24 },
      { start: 24, end: 37.1 },
      { start: 50, end: 53 },
    ])
    // Compare shape exactly but lengths with tolerance (float seconds arithmetic).
    const expected = [
      { kind: 'clip', segmentIndex: 0, length: 3.5 },
      { kind: 'silence', length: 0.4 },
      { kind: 'clip', segmentIndex: 1, length: 4 },
      { kind: 'silence', length: 0.5 },
      { kind: 'silence', length: 0.25 },
      { kind: 'clip', segmentIndex: 2, length: 37.1 - 24 },
      { kind: 'silence', length: 3 },
    ] as const
    expect(plan.audio).toHaveLength(expected.length)
    plan.audio.forEach((a, i) => {
      expect(a.kind).toBe(expected[i].kind)
      if (a.kind === 'clip') expect(a.segmentIndex).toBe((expected[i] as { segmentIndex: number }).segmentIndex)
      expect(a.length).toBeCloseTo(expected[i].length, 6)
    })
    expect(plan.duration).toBeCloseTo(53 - 2.3 - 2.8 - 10.25 - 12.9, 6) // source minus the four cuts
  })
})

describe('buildFfmpegCommand', () => {
  it('orders extra audio inputs by clip piece and references them in the graph', () => {
    const plan = planAssembly({ segments: [seg(0, 4), seg(6, 10)], cuts: [], duration: 10 })
    const cmd = buildFfmpegCommand(plan)
    // Two voiced segments → two extra inputs (a0.wav, a1.wav) after the source.
    expect(cmd.audioInputs).toEqual([0, 1])
    expect(cmd.args.slice(0, 6)).toEqual(['-i', 'source.mp4', '-i', 'a0.wav', '-i', 'a1.wav'])
    // The silence piece is generated, clips reference inputs 1 and 2 and are
    // polished (loudnorm + fades) by default.
    expect(cmd.filterComplex).toContain('anullsrc=r=48000:cl=mono,atrim=0:2')
    expect(cmd.filterComplex).toContain('[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000')
    expect(cmd.filterComplex).toContain('[2:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000')
    expect(cmd.filterComplex).toContain('afade=t=in:st=0:d=0.01')
    expect(cmd.filterComplex).toContain('afade=t=out:st=')
    // Concats both tracks and maps them out.
    expect(cmd.filterComplex).toContain('concat=n=3:v=1:a=0[vout]')
    expect(cmd.filterComplex).toContain('concat=n=3:v=0:a=1[aout]')
    expect(cmd.args).toEqual(expect.arrayContaining(['-map', '[vout]', '-map', '[aout]']))
  })

  it('audioPolish:false drops loudnorm + fades (raw concat)', () => {
    const plan = planAssembly({ segments: [seg(0, 4), seg(6, 10)], cuts: [], duration: 10 })
    const cmd = buildFfmpegCommand(plan, { audioPolish: false })
    expect(cmd.filterComplex).toContain('[1:a]aresample=48000')
    expect(cmd.filterComplex).not.toContain('loudnorm')
    expect(cmd.filterComplex).not.toContain('afade')
  })

  it('emits no extra audio inputs when nothing is voiced', () => {
    const plan = planAssembly({ segments: [{ start: 0, end: 5 }], cuts: [], duration: 5 })
    const cmd = buildFfmpegCommand(plan)
    expect(cmd.audioInputs).toEqual([])
    expect(cmd.args.filter((a) => a === '-i')).toHaveLength(1) // just the source
  })
})
