import { describe, it, expect } from 'vitest'
import reducer, {
  freshProgress,
  patchStage,
  failActiveStage,
  setScenes,
  patchScene,
  setSourceUrl,
  setWords,
  setSelected,
  setDirection,
  setDirectorPromptJobId,
  resetStudio,
  addSource, patchSource, removeSource, reorderSources, patchSourceStage,
  type StudioState,
} from './studioSlice'
import type { Scene } from '../lib/scenes'

const scene = (id: string, over: Partial<Scene> = {}): Scene => ({
  id,
  index: 0,
  sourceId: 'source-1',
  title: id,
  start: 0,
  end: 10,
  transcript: 't',
  status: 'pending',
  narrationSeconds: null,
  ...over,
})

describe('studioSlice', () => {
  it('starts with every prep stage pending', () => {
    const s = reducer(undefined, { type: '@@init' })
    const ids = Object.keys(s.stageProgress)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => s.stageProgress[id as keyof typeof s.stageProgress]?.status === 'pending')).toBe(true)
    expect(s.scenes).toEqual([])
    expect(s.sourceUrl).toBeNull()
  })

  it('patchStage merges into the matching stage only', () => {
    const s = reducer(undefined, patchStage({ id: 'upload', patch: { status: 'done', detail: 'ok' } }))
    expect(s.stageProgress.upload).toMatchObject({ status: 'done', detail: 'ok' })
    expect(s.stageProgress.extract?.status).toBe('pending')
  })

  it('failActiveStage marks the active stage errored with the message', () => {
    let s = reducer(undefined, patchStage({ id: 'transcribe', patch: { status: 'active' } }))
    s = reducer(s, failActiveStage('boom'))
    expect(s.stageProgress.transcribe).toMatchObject({
      status: 'error',
      detail: 'boom',
    })
  })

  it('setScenes then patchScene updates one scene in place', () => {
    let s = reducer(undefined, setScenes([scene('scene-1'), scene('scene-2')]))
    s = reducer(s, patchScene({ id: 'scene-2', patch: { status: 'built' } }))
    expect(s.scenes.find((sc) => sc.id === 'scene-2')?.status).toBe('built')
    expect(s.scenes.find((sc) => sc.id === 'scene-1')?.status).toBe('pending')
  })

  it('setDirection stores the director prompt; resetStudio clears it', () => {
    let s = reducer(undefined, setDirection('keep the demo at 12:30'))
    expect(s.direction).toBe('keep the demo at 12:30')
    s = reducer(s, resetStudio())
    expect(s.direction).toBe('')
  })

  it('setDirectorPromptJobId stores the pointer; resetStudio clears it', () => {
    let s = reducer(undefined, setDirectorPromptJobId('job-42'))
    expect(s.directorPromptJobId).toBe('job-42')
    s = reducer(s, resetStudio())
    expect(s.directorPromptJobId).toBeNull()
  })

  it('resetStudio clears persisted state back to fresh', () => {
    let s: StudioState = reducer(undefined, setSourceUrl('/api/uploads/source/x'))
    s = reducer(s, setWords([{ text: 'hi', start: 0, end: 1 }]))
    s = reducer(s, setScenes([scene('scene-1')]))
    s = reducer(s, setSelected('scene-1'))
    s = reducer(s, resetStudio())
    expect(s.sourceUrl).toBeNull()
    expect(s.words).toEqual([])
    expect(s.scenes).toEqual([])
    expect(s.selectedId).toBeNull()
    expect(s.stageProgress).toEqual(freshProgress())
  })
})

const initialSourcesState = reducer(undefined, { type: '@@INIT' })

describe('sources reducers', () => {
  it('addSource appends a fresh source with pending per-video progress', () => {
    const s = reducer(initialSourcesState, addSource({ id: 'v1', fileName: 'a.mp4', duration: 100 }))
    expect(s.sources).toHaveLength(1)
    expect(s.sources[0]).toMatchObject({ id: 'v1', fileName: 'a.mp4', duration: 100, order: 0 })
    expect(s.sources[0].stageProgress.upload?.status).toBe('pending')
  })

  it('patchSource updates one source by id', () => {
    let s = reducer(initialSourcesState, addSource({ id: 'v1', fileName: 'a.mp4', duration: 100 }))
    s = reducer(s, patchSource({ id: 'v1', patch: { sourceUrl: '/api/uploads/source/x' } }))
    expect(s.sources[0].sourceUrl).toBe('/api/uploads/source/x')
  })

  it('patchSourceStage updates one source-stage status', () => {
    let s = reducer(initialSourcesState, addSource({ id: 'v1', fileName: 'a.mp4', duration: 100 }))
    s = reducer(s, patchSourceStage({ id: 'v1', stage: 'upload', patch: { status: 'done' } }))
    expect(s.sources[0].stageProgress.upload?.status).toBe('done')
  })

  it('reorderSources moves and renumbers order', () => {
    let s = reducer(initialSourcesState, addSource({ id: 'v1', fileName: 'a', duration: 1 }))
    s = reducer(s, addSource({ id: 'v2', fileName: 'b', duration: 1 }))
    s = reducer(s, reorderSources({ from: 1, to: 0 }))
    expect(s.sources.map((x) => x.id)).toEqual(['v2', 'v1'])
    expect(s.sources.map((x) => x.order)).toEqual([0, 1])
  })

  it('removeSource drops it and renumbers', () => {
    let s = reducer(initialSourcesState, addSource({ id: 'v1', fileName: 'a', duration: 1 }))
    s = reducer(s, addSource({ id: 'v2', fileName: 'b', duration: 1 }))
    s = reducer(s, removeSource('v1'))
    expect(s.sources.map((x) => x.id)).toEqual(['v2'])
    expect(s.sources[0].order).toBe(0)
  })
})
