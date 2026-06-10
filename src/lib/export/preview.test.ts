import { describe, it, expect } from 'vitest'
import { planScene, type AssemblePlan } from './assemble'
import { audioEvents } from './preview'

/** A voiced segment (has an audio clip) over `[start, end]`, original-video seconds. */
function seg(start: number, end: number, audioSeconds = end - start) {
  return { start, end, audioUrl: `clip-${start}-${end}.wav`, audioSeconds }
}

describe('audioEvents — clip offsets on the output timeline', () => {
  it('a clip after leading dead space starts at the dead-space length', () => {
    // Scene [0,10]: dead 0–4, segment 4–8 (4s clip), dead 8–10.
    const segments = [seg(4, 8)]
    const plan = planScene({ segments, cuts: [], start: 0, end: 10 })
    expect(audioEvents(plan, segments)).toEqual([
      { segmentIndex: 0, audioUrl: 'clip-4-8.wav', offset: 4, duration: 4 },
    ])
  })

  it('a cut before a clip pulls its offset earlier (cut footage is dropped)', () => {
    // Cut 0–3, segment 4–8 → output: dead 3–4 (1s), then the clip at offset 1.
    const segments = [seg(4, 8)]
    const plan = planScene({ segments, cuts: [{ start: 0, end: 3 }], start: 0, end: 10 })
    expect(audioEvents(plan, segments)).toEqual([
      { segmentIndex: 0, audioUrl: 'clip-4-8.wav', offset: 1, duration: 4 },
    ])
  })

  it('clip duration is the plan audioSeconds (already clamped to the slot)', () => {
    // 6s slot but only a 2.5s clip → plays 2.5s, the rest of the slot is silent padding.
    const segments = [seg(0, 6, 2.5)]
    const plan = planScene({ segments, cuts: [], start: 0, end: 6 })
    expect(audioEvents(plan, segments)).toEqual([
      { segmentIndex: 0, audioUrl: 'clip-0-6.wav', offset: 0, duration: 2.5 },
    ])
  })

  it('unvoiced segments produce no event (planAssembly already made them silence)', () => {
    const segments = [{ start: 0, end: 4 }, seg(6, 10)]
    const plan = planScene({ segments, cuts: [], start: 0, end: 10 })
    expect(audioEvents(plan, segments)).toEqual([
      { segmentIndex: 1, audioUrl: 'clip-6-10.wav', offset: 6, duration: 4 },
    ])
  })

  it('defensive: a clip piece whose segment lost its url is skipped, offsets intact', () => {
    // Hand-built plan (not via planScene) — the url lookup must not throw.
    const plan: AssemblePlan = {
      slices: [],
      video: [{ start: 0, end: 10 }],
      audio: [
        { kind: 'clip', segmentIndex: 0, length: 4, audioSeconds: 4 },
        { kind: 'clip', segmentIndex: 1, length: 6, audioSeconds: 6 },
      ],
      duration: 10,
    }
    const segments = [{ start: 0, end: 4 }, seg(4, 10)]
    expect(audioEvents(plan, segments)).toEqual([
      { segmentIndex: 1, audioUrl: 'clip-4-10.wav', offset: 4, duration: 6 },
    ])
  })

  it('scene-rebased plans keep working (planScene shifts to clip-local time)', () => {
    // Scene [100,110], segment 102–106 → clip-local: dead 0–2, clip at offset 2.
    const segments = [seg(102, 106)]
    const plan = planScene({ segments, cuts: [], start: 100, end: 110 })
    expect(audioEvents(plan, segments)).toEqual([
      { segmentIndex: 0, audioUrl: 'clip-102-106.wav', offset: 2, duration: 4 },
    ])
  })
})
