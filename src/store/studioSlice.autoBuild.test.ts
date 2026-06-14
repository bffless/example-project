import { describe, it, expect } from 'vitest'
import reducer, {
  startAutoBuild,
  pauseAutoBuild,
  resumeAutoBuild,
  stopAutoBuild,
  haltAutoBuild,
  completeAutoBuild,
  setAutoPointer,
} from './studioSlice'

const initial = reducer(undefined, { type: '@@INIT' })

describe('autoBuild reducers', () => {
  it('defaults to idle', () => {
    expect(initial.autoBuild).toEqual({ status: 'idle', currentSceneId: null, currentStepId: null, error: null })
  })

  it('start → running and clears any prior error', () => {
    const halted = reducer(initial, haltAutoBuild('boom'))
    const s = reducer(halted, startAutoBuild())
    expect(s.autoBuild.status).toBe('running')
    expect(s.autoBuild.error).toBeNull()
  })

  it('pause only from running', () => {
    const running = reducer(initial, startAutoBuild())
    expect(reducer(running, pauseAutoBuild()).autoBuild.status).toBe('paused')
    expect(reducer(initial, pauseAutoBuild()).autoBuild.status).toBe('idle')
  })

  it('resume from paused or halted → running, error cleared', () => {
    const halted = reducer(initial, haltAutoBuild('boom'))
    const r = reducer(halted, resumeAutoBuild())
    expect(r.autoBuild.status).toBe('running')
    expect(r.autoBuild.error).toBeNull()
  })

  it('halt records the message', () => {
    const s = reducer(reducer(initial, startAutoBuild()), haltAutoBuild('REPLICATE_NOT_CONFIGURED'))
    expect(s.autoBuild).toMatchObject({ status: 'halted', error: 'REPLICATE_NOT_CONFIGURED' })
  })

  it('stop resets the pointer', () => {
    const moved = reducer(initial, setAutoPointer({ sceneId: 's1', stepId: 'refine' }))
    const s = reducer(moved, stopAutoBuild())
    expect(s.autoBuild).toEqual({ status: 'idle', currentSceneId: null, currentStepId: null, error: null })
  })

  it('setAutoPointer moves the pointer', () => {
    const s = reducer(initial, setAutoPointer({ sceneId: 's2', stepId: 'voice' }))
    expect(s.autoBuild).toMatchObject({ currentSceneId: 's2', currentStepId: 'voice' })
  })

  it('complete → done', () => {
    const s = reducer(reducer(initial, startAutoBuild()), completeAutoBuild())
    expect(s.autoBuild.status).toBe('done')
  })
})
