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
        hostname: 'demo.j5s.dev',
        host: 'demo.j5s.dev',
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

    it('relays through the admin when off the primary domain (localhost)', () => {
      // sAccessToken is scoped to `.j5s.dev` and can't reach localhost, so the
      // login has to relay a per-domain cookie in via the custom-domain flow.
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: {
          origin: 'http://localhost:5173',
          hostname: 'localhost',
          host: 'localhost:5173',
          pathname: '/auth',
          href: 'http://localhost:5173/auth',
        },
      })

      // targetDomain is the bare host (CE rejects a `:port`); the port rides in
      // targetOrigin, which CE honours only for localhost/127.0.0.1. redirect is
      // a bare path, not an absolute URL.
      expect(getLoginUrl()).toBe(
        'https://admin.j5s.dev/login?customDomainRelay=true&targetDomain=localhost&redirect=%2Fauth&targetOrigin=http%3A%2F%2Flocalhost%3A5173',
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
