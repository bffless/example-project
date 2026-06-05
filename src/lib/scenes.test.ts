import { describe, it, expect } from 'vitest'
import {
  buildScenes,
  wordCount,
  narrationSeconds,
  alignment,
  sceneVideoSeconds,
  WORDS_PER_SECOND,
  type Scene,
} from './scenes'

describe('wordCount / narrationSeconds', () => {
  it('counts words and estimates speaking time', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount('  one   two three ')).toBe(3)
    expect(narrationSeconds('a b c d e')).toBeCloseTo(5 / WORDS_PER_SECOND, 5)
  })
})

describe('buildScenes', () => {
  it('returns one scene for a short clip', () => {
    const scenes = buildScenes(30)
    expect(scenes).toHaveLength(1)
    expect(scenes[0]).toMatchObject({ start: 0, end: 30, status: 'pending', narrationSeconds: null })
  })

  it('breaks a long talk into several ~3.5 min scenes covering the whole clip', () => {
    const duration = 45 * 60
    const scenes = buildScenes(duration)
    expect(scenes.length).toBeGreaterThan(1)
    expect(scenes[0].start).toBe(0)
    expect(scenes[scenes.length - 1].end).toBeCloseTo(duration, 5)
    // contiguous, no gaps
    for (let i = 1; i < scenes.length; i++) {
      expect(scenes[i].start).toBeCloseTo(scenes[i - 1].end, 5)
    }
  })

  it('opens each scene with an AI-shortened draft shorter than the footage', () => {
    const [scene] = buildScenes(120)
    // full-span transcript ≈ footage length; draft is condensed below it
    expect(narrationSeconds(scene.transcript)).toBeCloseTo(sceneVideoSeconds(scene), 0)
    expect(narrationSeconds(scene.draftText)).toBeLessThan(sceneVideoSeconds(scene))
    expect(narrationSeconds(scene.draftText)).toBeGreaterThan(0)
  })
})

describe('alignment', () => {
  const base: Scene = {
    id: 's', index: 0, title: 't', start: 0, end: 20,
    transcript: '', draftText: '', status: 'pending', narrationSeconds: null,
  }

  it('is null until the scene is voiced', () => {
    expect(alignment(base)).toBeNull()
  })

  it('flags short, long, and aligned narration', () => {
    expect(alignment({ ...base, narrationSeconds: 10 })?.status).toBe('short')
    expect(alignment({ ...base, narrationSeconds: 30 })?.status).toBe('long')
    expect(alignment({ ...base, narrationSeconds: 20.5 })?.status).toBe('aligned')
  })
})
