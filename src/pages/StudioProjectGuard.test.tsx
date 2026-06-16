import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'
import studioReducer, { createProject } from '../store/studioSlice'
import { StudioProjectGuard } from './StudioProjectGuard'

function makeStore() {
  return configureStore({ reducer: { studio: studioReducer } })
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
  it('unknown project id → back to the list', () => {
    renderAt('/studio/project/nope/build')
    expect(screen.getByText('LIST')).toBeInTheDocument()
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
