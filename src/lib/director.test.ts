import { describe, it, expect } from 'vitest'
import {
  timedTranscript,
  toScenes,
  combinedTimedTranscript,
  type DirectorScene,
} from './director'

describe('timedTranscript', () => {
  it('groups words into wall-clock windows', () => {
    const words = [
      { text: 'hello', start: 0.2, end: 0.5 },
      { text: 'there', start: 1.0, end: 1.4 },
      { text: 'friend', start: 9.0, end: 9.5 }, // next 8s window
    ]
    const out = timedTranscript(words, 8)
    expect(out).toBe('[0:00] hello there\n[0:08] friend')
  })

  it('keeps null-timestamp words on the current line', () => {
    const words = [
      { text: 'a', start: 0.1, end: 0.3 },
      { text: 'b', start: null as unknown as number, end: null as unknown as number },
    ]
    expect(timedTranscript(words, 8)).toBe('[0:00] a b')
  })

  it('returns empty for no words', () => {
    expect(timedTranscript([], 8)).toBe('')
  })
})

describe('toScenes', () => {
  const raw: DirectorScene[] = [
    { title: 'Intro', start: 0, end: 60, transcript: 'Welcome to the talk', refinePrompt: 'Tighten the intro to a 15s hook.', cuts: [{ start: 10, end: 20 }] },
    { title: 'Demo', start: 60, end: 130, transcript: 'Here is the demo', refinePrompt: 'Cut the dead air; keep the screen-share.', cuts: [] },
  ]

  it('coerces to the Scene shape with ids, index, and defaults', () => {
    const scenes = toScenes(raw, 130)
    expect(scenes).toHaveLength(2)
    expect(scenes[0]).toMatchObject({
      id: 'scene-1',
      index: 0,
      title: 'Intro',
      start: 0,
      end: 60,
      status: 'pending',
      narrationSeconds: null,
      transcript: 'Welcome to the talk',
      refinePrompt: 'Tighten the intro to a 15s hook.',
    })
    expect(scenes[0].cuts).toEqual([{ start: 10, end: 20 }])
  })

  it('clamps spans into [0, duration] and forces them ascending + non-overlapping', () => {
    const messy: DirectorScene[] = [
      { start: -5, end: 40, transcript: 'one' },
      { start: 30, end: 200, transcript: 'two' }, // overlaps prev, runs past clip
    ]
    const scenes = toScenes(messy, 120)
    expect(scenes[0].start).toBe(0)
    expect(scenes[1].start).toBe(40) // snapped to prev end
    expect(scenes[1].end).toBe(120) // clamped to duration
  })

  it('drops cuts outside their scene span and clamps the rest', () => {
    const s: DirectorScene[] = [
      { start: 0, end: 100, transcript: 'x', cuts: [{ start: 50, end: 200 }, { start: 5, end: 5 }] },
    ]
    const [scene] = toScenes(s, 100)
    // 50–200 clamped to 50–100; the 5–5 zero-length cut dropped
    expect(scene.cuts).toEqual([{ start: 50, end: 100 }])
  })

  it('falls back to a title derived from the transcript', () => {
    const [scene] = toScenes([{ start: 0, end: 10, transcript: 'the quick brown fox jumps over' }], 10)
    expect(scene.title).toBe('the quick brown fox jumps…')
  })

  it('returns [] for non-array input', () => {
    expect(toScenes(undefined as unknown as DirectorScene[], 10)).toEqual([])
  })

  it('keeps a valid voicing plan and drops junk values (story 03j)', () => {
    const scenes = toScenes(
      [
        { start: 0, end: 30, transcript: 'a', voicing: 'original' },
        { start: 30, end: 60, transcript: 'b', voicing: 'mixed' },
        { start: 60, end: 90, transcript: 'c', voicing: 'shout it' as unknown as DirectorScene['voicing'] },
        { start: 90, end: 120, transcript: 'd' },
      ],
      120,
    )
    expect(scenes.map((s) => s.voicing)).toEqual(['original', 'mixed', undefined, undefined])
  })
})

it('combinedTimedTranscript offsets each source to global time with boundary markers', () => {
  const out = combinedTimedTranscript([
    { id: 'a', fileName: 'one.mp4', duration: 16, words: [{ text: 'hello', start: 0, end: 1 }] },
    { id: 'b', fileName: 'two.mp4', duration: 16, words: [{ text: 'world', start: 0, end: 1 }] },
  ])
  expect(out).toMatch(/\[0:00\] hello/)
  expect(out).toMatch(/--- VIDEO 2: two\.mp4 \(starts 0:16\) ---/)
  expect(out).toMatch(/\[0:16\] world/)
})
