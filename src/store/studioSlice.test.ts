import { describe, it, expect } from 'vitest'
import reducer, { setScenes, setDirection, addSavedVoice, freshWorkingState, type StudioState } from './studioSlice'

const withOneProject = (): StudioState => ({
  index: { p1: { id: 'p1', name: 'A', createdAt: 1, updatedAt: 1, phase: 'import', thumbnailUrl: null } },
  working: { p1: freshWorkingState() },
  activeProjectId: 'p1',
  savedVoices: [],
})

describe('project-scoped reducers route to the active project', () => {
  it('setScenes mutates the active project only', () => {
    const next = reducer(withOneProject(), setScenes([{ id: 'sc1', status: 'pending' } as never]))
    expect(next.working.p1.scenes).toHaveLength(1)
  })
  it('is a no-op when no project is active', () => {
    const empty: StudioState = { index: {}, working: {}, activeProjectId: null, savedVoices: [] }
    const next = reducer(empty, setDirection('hi'))
    expect(next).toEqual(empty)
  })
})

describe('savedVoices live at the root, shared across projects', () => {
  it('addSavedVoice writes to root state, not a project', () => {
    const next = reducer(withOneProject(), addSavedVoice({ voiceId: 'v1', label: 'Mine' }))
    expect(next.savedVoices).toEqual([{ voiceId: 'v1', label: 'Mine' }])
    expect('savedVoices' in next.working.p1).toBe(false)
  })
})
