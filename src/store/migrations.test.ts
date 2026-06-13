import { describe, it, expect } from 'vitest'
import { migrations } from './index'

describe('migration v3 — single video → sources[]', () => {
  it('wraps the flat single-video fields into one source and stamps scenes', () => {
    const v2 = {
      sourceUrl: '/api/uploads/source/x', audioUrl: '/api/uploads/audio/y',
      audioPeaks: [0.1, 0.2], words: [{ text: 'hi', start: 0, end: 1 }],
      duration: 120, fileName: 'talk.mp4',
      stageProgress: { upload: { status: 'done' }, extract: { status: 'done' }, transcribe: { status: 'done' } },
      scenes: [{ id: 'scene-1', index: 0, start: 0, end: 120, title: 'S', transcript: '', status: 'pending', narrationSeconds: null }],
    }
    const out = migrations[3](v2) as Record<string, unknown>
    const sources = out.sources as Record<string, unknown>[]
    const scenes = out.scenes as Record<string, unknown>[]
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      sourceUrl: '/api/uploads/source/x', audioUrl: '/api/uploads/audio/y',
      duration: 120, fileName: 'talk.mp4', order: 0,
    })
    expect(sources[0].words).toEqual([{ text: 'hi', start: 0, end: 1 }])
    expect(scenes[0].sourceId).toBe(sources[0].id)
  })

  it('leaves a session that already has sources[] untouched', () => {
    const v3 = { sources: [{ id: 'v1', order: 0, fileName: 'a', duration: 1, sourceUrl: null, audioUrl: null, audioPeaks: [], words: [], stageProgress: {} }], scenes: [] }
    const out3 = migrations[3](v3) as Record<string, unknown>
    expect((out3.sources as unknown[]).length).toBe(1)
  })

  it('handles a never-imported session (no source) by giving it an empty sources[]', () => {
    const out = migrations[3]({ scenes: [] }) as Record<string, unknown>
    expect(out.sources).toEqual([])
  })
})
