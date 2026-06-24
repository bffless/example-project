import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

// Mock every backend-touching hook so routing can be exercised offline.
vi.mock('./lib/useSession', () => ({
  useSession: () => ({ session: { authenticated: false }, loading: false, refetch: vi.fn() }),
}))
vi.mock('@bffless/use-bff-state', () => ({
  useBffState: () => ({
    data: { comments: [] },
    update: vi.fn(),
    error: null,
    isUninitialized: false,
    isFetching: false,
    isUpdating: false,
  }),
}))
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    setMessages: vi.fn(),
    status: 'ready',
    stop: vi.fn(),
    sendMessage: vi.fn(),
    id: undefined,
    error: undefined,
  }),
}))
vi.mock('ai', () => ({
  DefaultChatTransport: class {},
}))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App routing', () => {
  it('renders the shared layout chrome (header + footer + chat launcher)', () => {
    renderAt('/')
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Docs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open chat' })).toBeInTheDocument()
  })

  it('renders the Home page at /', () => {
    renderAt('/')
    expect(screen.getByText(/No backend to run\./)).toBeInTheDocument()
  })

  it('renders the Forms page at /forms', () => {
    renderAt('/forms')
    expect(screen.getByText('EP 05 · 07 — Forms & uploads')).toBeInTheDocument()
  })

  it('renders the Comments page at /comments', () => {
    renderAt('/comments')
    expect(screen.getByText('EP 08 — Comments')).toBeInTheDocument()
  })

  it('renders the Chat page at /chat', () => {
    renderAt('/chat')
    expect(screen.getByText('Walkthrough — AI chat')).toBeInTheDocument()
  })

  it('renders the Auth page at /auth', () => {
    renderAt('/auth')
    expect(screen.getByText('EP 14 · 15 · 17 — Auth & roles')).toBeInTheDocument()
  })

  it('falls back to Home for unknown routes', () => {
    renderAt('/does-not-exist')
    expect(screen.getByText(/No backend to run\./)).toBeInTheDocument()
  })
})
