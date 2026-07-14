import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getLoginUrl, logout } from './auth'

describe('auth', () => {
  const originalLocation = window.location

  beforeEach(() => {
    // jsdom location is read-only-ish; replace with a writable stub.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        origin: 'https://demo.j5s.dev',
        pathname: '/forms',
        href: 'https://demo.j5s.dev/forms',
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    })
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  describe('getLoginUrl', () => {
    it('defaults the redirect to the current pathname', () => {
      const url = getLoginUrl()
      expect(url).toBe(
        'https://admin.j5s.dev/login?redirect=https%3A%2F%2Fdemo.j5s.dev%2Fforms',
      )
    })

    it('honours an explicit redirect path', () => {
      const url = getLoginUrl('/auth')
      expect(url).toBe(
        'https://admin.j5s.dev/login?redirect=https%3A%2F%2Fdemo.j5s.dev%2Fauth',
      )
    })

    it('uses the configured admin url and strips a trailing slash', () => {
      vi.stubEnv('VITE_BFFLESS_ADMIN_URL', 'https://custom-admin.test/')
      expect(getLoginUrl('/x')).toBe(
        'https://custom-admin.test/login?redirect=https%3A%2F%2Fdemo.j5s.dev%2Fx',
      )
    })
  })

  describe('logout', () => {
    it('revokes the SuperTokens session, clears the relay, then bounces to admin', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
      vi.stubGlobal('fetch', fetchMock)

      await logout('/auth')

      // SuperTokens' signout is what actually revokes the session. The relay's
      // logout only clears the relay's own cookies, which don't exist on the
      // primary domain — calling it alone would leave the real session alive.
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        '/api/auth/signout',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      )
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/_bffless/auth/logout',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      )
      expect(window.location.href).toBe(
        'https://admin.j5s.dev/logout?redirect=https%3A%2F%2Fdemo.j5s.dev%2Fauth',
      )
    })

    it('still bounces when the logout POST throws', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('network'))
      vi.stubGlobal('fetch', fetchMock)

      await logout()

      expect(window.location.href).toBe(
        'https://admin.j5s.dev/logout?redirect=https%3A%2F%2Fdemo.j5s.dev%2Fforms',
      )
    })
  })
})
