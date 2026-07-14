import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Auth } from './Auth'

const useSessionMock = vi.fn()
vi.mock('../lib/useSession', () => ({
  useSession: () => useSessionMock(),
}))

const getLoginUrlMock = vi.fn<(path?: string) => string>(() => 'https://admin.test/login')
const logoutMock = vi.fn()
vi.mock('../lib/auth', () => ({
  getLoginUrl: (path?: string) => getLoginUrlMock(path),
  logout: () => logoutMock(),
}))

describe('Auth page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the pieces grid', () => {
    useSessionMock.mockReturnValue({ session: null, loading: true, refetch: vi.fn() })
    render(<Auth />)
    // "Authentication"/"Authorization" also appear as VideoEmbed episode titles,
    // so match on the unique per-piece descriptions instead.
    expect(screen.getByText(/A built-in admin login relay handles/)).toBeInTheDocument()
    expect(screen.getByText(/Two levels of roles/)).toBeInTheDocument()
    expect(screen.getByText(/A Pipeline can run on signup/)).toBeInTheDocument()
  })

  it('shows a checking state while loading', () => {
    useSessionMock.mockReturnValue({ session: null, loading: true, refetch: vi.fn() })
    render(<Auth />)
    expect(screen.getByText('Checking…')).toBeInTheDocument()
    // No login/logout button while loading.
    expect(screen.queryByRole('button', { name: 'Log in to try it' })).toBeNull()
  })

  it('shows a login CTA for guests and navigates on click', () => {
    useSessionMock.mockReturnValue({ session: { authenticated: false }, loading: false, refetch: vi.fn() })
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '' },
    })
    render(<Auth />)
    expect(screen.getByText('Not signed in')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Log in to try it' }))
    expect(getLoginUrlMock).toHaveBeenCalledWith('/auth')
    expect(window.location.href).toBe('https://admin.test/login')
  })

  it('shows authenticated state and a logout button', () => {
    useSessionMock.mockReturnValue({
      session: { authenticated: true, user: { id: 'u-1', email: 'a@b.co' } },
      loading: false,
      refetch: vi.fn(),
    })
    render(<Auth />)
    expect(screen.getByText('Authenticated')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(logoutMock).toHaveBeenCalled()
  })

  it('refetches the session when Refetch is clicked', () => {
    const refetch = vi.fn()
    useSessionMock.mockReturnValue({ session: { authenticated: false }, loading: false, refetch })
    render(<Auth />)
    fireEvent.click(screen.getByRole('button', { name: 'Refetch' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('renders the raw session JSON', () => {
    useSessionMock.mockReturnValue({
      session: { authenticated: true, user: { id: 'u-1' } },
      loading: false,
      refetch: vi.fn(),
    })
    render(<Auth />)
    expect(screen.getByText(/"authenticated": true/)).toBeInTheDocument()
  })
})
