import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore, type Middleware, type Action } from '@reduxjs/toolkit'
import studioReducer, { createProject } from '../../store/studioSlice'
import { studioApi } from '../../store/studioApi'
import { useProjectAutosave } from './useProjectAutosave'

// RTK Query's fetchBaseQuery throws on the relative URL under jsdom/undici (it
// can't parse `/api/projects/save` into a Request) before `fetch` is even
// called, so we don't assert on `fetch`. Instead a tiny recording middleware
// captures every dispatched action; a `saveProject` mutation surfaces as an
// `executeMutation/pending` action whose `meta.arg.endpointName` is 'saveProject'
// — dispatched synchronously the moment `.initiate()` runs.
function makeStore() {
  const actions: Action[] = []
  const recorder: Middleware = () => (next) => (action) => {
    actions.push(action as Action)
    return next(action)
  }
  const store = configureStore({
    reducer: { studio: studioReducer, [studioApi.reducerPath]: studioApi.reducer },
    middleware: (g) => g().concat(studioApi.middleware, recorder),
  })
  store.dispatch(createProject({ id: 'p1', now: 1 }))
  const savedProject = () =>
    actions.some(
      (a) =>
        typeof a.type === 'string' &&
        a.type.includes('executeMutation/pending') &&
        (a as { meta?: { arg?: { endpointName?: string } } }).meta?.arg?.endpointName === 'saveProject',
    )
  return { store, savedProject }
}

function Harness({ id }: { id: string }) {
  useProjectAutosave(id)
  return null
}

describe('useProjectAutosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('debounce-saves after the active working state changes', () => {
    const { store, savedProject } = makeStore()
    render(
      <Provider store={store}>
        <Harness id="p1" />
      </Provider>,
    )
    act(() => {
      store.dispatch({ type: 'studio/setDirection', payload: 'x' })
    })
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(savedProject()).toBe(true)
  })

  it('does not save on the initial (hydrate) render', () => {
    const { store, savedProject } = makeStore()
    render(
      <Provider store={store}>
        <Harness id="p1" />
      </Provider>,
    )
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(savedProject()).toBe(false)
  })

  it('flushes a save and evicts the working state on unmount', () => {
    const { store, savedProject } = makeStore()
    const { unmount } = render(
      <Provider store={store}>
        <Harness id="p1" />
      </Provider>,
    )
    expect(store.getState().studio.working.p1).toBeDefined()
    act(() => {
      unmount()
    })
    expect(savedProject()).toBe(true)
    expect(store.getState().studio.working.p1).toBeUndefined()
  })
})
