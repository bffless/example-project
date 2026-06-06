import { describe, it, expect } from 'vitest'
import { STAGE_DEFS, studioPhase } from './pipeline'

describe('STAGE_DEFS', () => {
  it('runs the prep steps in order and tags where each runs', () => {
    expect(STAGE_DEFS.map((s) => s.id)).toEqual([
      'upload',
      'extract',
      'transcribe',
      'thumbnails',
      'shorten',
      'segment',
      'clone',
    ])
    for (const s of STAGE_DEFS) {
      expect(['browser', 'pipeline', 'browser+pipeline']).toContain(s.where)
    }
  })

  it('gives the manual prep steps an action label and groups the rest', () => {
    const labelled = STAGE_DEFS.filter((s) => s.actionLabel).map((s) => s.id)
    // upload, extract+audio, transcribe, thumbnails each trigger a step; shorten
    // owns the grouped "finish prep" action; segment + clone ride along with it.
    expect(labelled).toEqual(['upload', 'extract', 'transcribe', 'thumbnails', 'shorten'])
  })
})

describe('studioPhase', () => {
  it('walks import → prep → build → export from state', () => {
    expect(studioPhase({ hasFile: false, ready: false, allBuilt: false })).toBe('import')
    expect(studioPhase({ hasFile: true, ready: false, allBuilt: false })).toBe('prep')
    expect(studioPhase({ hasFile: true, ready: true, allBuilt: false })).toBe('build')
    expect(studioPhase({ hasFile: true, ready: true, allBuilt: true })).toBe('export')
  })
})
