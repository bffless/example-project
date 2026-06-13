import { describe, it, expect } from 'vitest'
import { STAGE_DEFS, studioPhase } from './pipeline'

describe('STAGE_DEFS', () => {
  it('runs the prep steps in order and tags where each runs', () => {
    expect(STAGE_DEFS.map((s) => s.id)).toEqual([
      'upload',
      'extract',
      'transcribe',
      'thumbnails',
      'director',
      'clone',
    ])
    for (const s of STAGE_DEFS) {
      expect(['browser', 'pipeline', 'browser+pipeline']).toContain(s.where)
    }
  })

  it('gives each prep step its own action label', () => {
    const labelled = STAGE_DEFS.filter((s) => s.actionLabel).map((s) => s.id)
    // Every step is now a single deliberate action: upload, extract+audio,
    // transcribe, thumbnails, the merged AI director (shorten + segment in one
    // Gemini call), then clone.
    expect(labelled).toEqual([
      'upload',
      'extract',
      'transcribe',
      'thumbnails',
      'director',
      'clone',
    ])
  })
})

describe('studioPhase', () => {
  it('walks import → prep → build → export from state', () => {
    expect(studioPhase({ hasSource: false, ready: false, allBuilt: false })).toBe('import')
    expect(studioPhase({ hasSource: true, ready: false, allBuilt: false })).toBe('prep')
    expect(studioPhase({ hasSource: true, ready: true, allBuilt: false })).toBe('build')
    expect(studioPhase({ hasSource: true, ready: true, allBuilt: true })).toBe('export')
  })
})
