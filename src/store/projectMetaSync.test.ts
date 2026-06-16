import { describe, it, expect, vi } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import studioReducer, { createProject, setContactSheets } from './studioSlice'
import { projectMetaSync } from './projectMetaSync'

function makeStore() {
  return configureStore({
    reducer: { studio: studioReducer },
    middleware: (gdm) => gdm().concat(projectMetaSync),
  })
}

describe('projectMetaSync', () => {
  it('refreshes the active project meta after a working-state change', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    const store = makeStore()
    store.dispatch(createProject({ id: 'p1', now: 1 }))
    store.dispatch(setContactSheets([{ url: '/api/uploads/thumbnails/x.png' } as never]))
    const meta = store.getState().studio.index.p1
    expect(meta.thumbnailUrl).toBe('/api/uploads/thumbnails/x.png')
    expect(meta.updatedAt).toBe(100)
    vi.restoreAllMocks()
  })

  it('ignores non-studio actions and the create/open/rename/delete actions themselves', () => {
    const store = makeStore()
    store.dispatch(createProject({ id: 'p1', now: 1 }))
    const before = store.getState().studio.index.p1.updatedAt
    store.dispatch({ type: 'other/thing' })
    expect(store.getState().studio.index.p1.updatedAt).toBe(before)
  })
})
