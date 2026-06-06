import { describe, it, expect } from 'vitest'
import { buildPrepArtifacts, type PrepArtifactsInput } from './prepArtifacts'

const empty: PrepArtifactsInput = {
  hasSource: false,
  hasAudio: false,
  wordCount: 0,
  sheetCount: 0,
  frameCount: 0,
  sheetsSaved: 0,
}

const byId = (s: PrepArtifactsInput) =>
  Object.fromEntries(buildPrepArtifacts(s).map((a) => [a.id, a]))

describe('buildPrepArtifacts', () => {
  it('lists the four prep artifacts in order', () => {
    expect(buildPrepArtifacts(empty).map((a) => a.id)).toEqual([
      'source',
      'audio',
      'transcript',
      'thumbnails',
    ])
  })

  it('marks everything not-ready at the start', () => {
    for (const a of buildPrepArtifacts(empty)) {
      expect(a.ready).toBe(false)
      expect(a.saved).toBe(false)
      expect(a.detail).toMatch(/not/i)
    }
  })

  it('tags storage location: buckets vs browser-only transcript', () => {
    const a = byId(empty)
    expect(a.source.storage).toBe('bucket')
    expect(a.audio.storage).toBe('bucket')
    expect(a.thumbnails.storage).toBe('bucket')
    expect(a.transcript.storage).toBe('browser')
  })

  it('reports source/audio as saved once uploaded', () => {
    const a = byId({ ...empty, hasSource: true, hasAudio: true })
    expect(a.source).toMatchObject({ ready: true, saved: true })
    expect(a.audio).toMatchObject({ ready: true, saved: true })
  })

  it('counts transcript words (browser state, never "saved")', () => {
    const a = byId({ ...empty, wordCount: 2431 })
    expect(a.transcript.ready).toBe(true)
    expect(a.transcript.detail).toContain('2,431 words')
    expect(a.transcript.saved).toBe(false)
  })

  it('shows thumbnails as in-browser until every sheet is uploaded', () => {
    const generated = byId({ ...empty, sheetCount: 10, frameCount: 90, sheetsSaved: 0 })
    expect(generated.thumbnails.ready).toBe(true)
    expect(generated.thumbnails.saved).toBe(false)
    expect(generated.thumbnails.detail).toContain('in browser only')

    const partial = byId({ ...empty, sheetCount: 10, frameCount: 90, sheetsSaved: 4 })
    expect(partial.thumbnails.saved).toBe(false)
  })

  it('marks thumbnails saved once all sheets have a bucket URL', () => {
    const a = byId({ ...empty, sheetCount: 10, frameCount: 90, sheetsSaved: 10 })
    expect(a.thumbnails).toMatchObject({ ready: true, saved: true })
    expect(a.thumbnails.detail).toContain('10 sheets · 90 frames · saved to bucket')
  })

  it('singularizes counts of one', () => {
    const a = byId({ ...empty, wordCount: 1, sheetCount: 1, frameCount: 1, sheetsSaved: 1 })
    expect(a.transcript.detail).toContain('1 word')
    expect(a.thumbnails.detail).toContain('1 sheet · 1 frame')
  })
})
