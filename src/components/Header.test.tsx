import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Header } from './Header'

const useSessionMock = vi.fn()
vi.mock('../lib/useSession', () => ({
  useSession: () => useSessionMock(),
}))

const getLoginUrlMock = vi.fn(() => 'https://admin.test/login?redirect=x')
const logoutMock = vi.fn()
vi.mock('../lib/auth', () => ({
  getLoginUrl: () => getLoginUrlMock(),
  logout: () => logoutMock(),
}))

function renderHeader() {
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>,
  )
}

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders all nav links', () => {
    useSessionMock.mockReturnValue({ session: null, loading: false, refetch: vi.fn() })
    renderHeader()
    for (const label of ['Home', 'Forms', 'Comments', 'Chat', 'Auth']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('shows a loading placeholder while the session resolves', () => {
    useSessionMock.mockReturnValue({ session: null, loading: true, refetch: vi.fn() })
    renderHeader()
    expect(screen.queryByRole('button', { name: 'Log in' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  })

  it('shows a Log in button for guests and navigates on click', () => {
    useSessionMock.mockReturnValue({ session: { authenticated: false }, loading: false, refetch: vi.fn() })
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '' },
    })
    renderHeader()
    const btn = screen.getByRole('button', { name: 'Log in' })
    fireEvent.click(btn)
    expect(getLoginUrlMock).toHaveBeenCalled()
    expect(window.location.href).toBe('https://admin.test/login?redirect=x')
  })

  it('shows the user email and a Log out button when authenticated', () => {
    useSessionMock.mockReturnValue({
      session: { authenticated: true, user: { id: 'u-1', email: 'ada@example.com' } },
      loading: false,
      refetch: vi.fn(),
    })
    renderHeader()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    const out = screen.getByRole('button', { name: 'Log out' })
    fireEvent.click(out)
    expect(logoutMock).toHaveBeenCalled()
  })

  it('falls back to the user id when no email is present', () => {
    useSessionMock.mockReturnValue({
      session: { authenticated: true, user: { id: 'just-an-id' } },
      loading: false,
      refetch: vi.fn(),
    })
    renderHeader()
    expect(screen.getByText('just-an-id')).toBeInTheDocument()
  })
})
