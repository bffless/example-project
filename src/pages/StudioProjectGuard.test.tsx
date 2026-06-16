import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'
import studioReducer, { createProject, openProject } from '../store/studioSlice'
import { studioApi } from '../store/studioApi'
import { StudioProjectGuard } from './StudioProjectGuard'

vi.mock('./Studio', () => ({
  Studio: ({ projectId, phase }: { projectId: string; phase: string }) => (
    <div>WORKSPACE {projectId} {phase}</div>
  ),
}))

function makeStore() {
  return configureStore({
    reducer: { studio: studioReducer, [studioApi.reducerPath]: studioApi.reducer },
    middleware: (gdm) => gdm().concat(studioApi.middleware),
  })
}
function renderAt(path: string, seed?: (dispatch: ReturnType<typeof makeStore>['dispatch']) => void) {
  const store = makeStore()
  if (seed) seed(store.dispatch)
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/studio" element={<div>LIST</div>} />
          <Route path="/studio/project/:projectId/prep" element={<div>PREP-STUB</div>} />
          <Route path="/studio/project/:projectId/:phase" element={<StudioProjectGuard />} />
          <Route path="/studio/project/:projectId" element={<StudioProjectGuard />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
}

describe('StudioProjectGuard redirects', () => {
  it('unknown project id → hydrate-or-redirect: server fetch fails, falls back to the list', async () => {
    // No MSW under Vitest, so the lazy getProject query rejects on the relative
    // URL → fetchFailed → redirect. It only lands after an async tick, so await.
    renderAt('/studio/project/nope/build')
    expect(screen.getByText('Loading project…')).toBeInTheDocument()
    expect(await screen.findByText('LIST')).toBeInTheDocument()
  })
  it('bare project url → resume (prep for a fresh project)', () => {
    renderAt('/studio/project/p1', (d) => d(createProject({ id: 'p1', now: 1 })))
    expect(screen.getByText('PREP-STUB')).toBeInTheDocument()
  })
  it('phase ahead of readiness clamps down to prep', () => {
    renderAt('/studio/project/p1/build', (d) => d(createProject({ id: 'p1', now: 1 })))
    expect(screen.getByText('PREP-STUB')).toBeInTheDocument()
  })
})

describe('StudioProjectGuard active-sync gate', () => {
  it('switching from one existing project to another syncs active then mounts the workspace', async () => {
    const store = makeStore()
    store.dispatch(createProject({ id: 'p1', now: 1 }))
    store.dispatch(createProject({ id: 'p2', now: 2 }))
    store.dispatch(openProject('p1'))
    expect(store.getState().studio.activeProjectId).toBe('p1')

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/studio/project/p2/prep']}>
          <Routes>
            <Route path="/studio" element={<div>LIST</div>} />
            <Route path="/studio/project/:projectId/:phase" element={<StudioProjectGuard />} />
            <Route path="/studio/project/:projectId" element={<StudioProjectGuard />} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    )

    expect(await screen.findByText(/WORKSPACE p2 prep/)).toBeInTheDocument()
    expect(store.getState().studio.activeProjectId).toBe('p2')
  })
})
