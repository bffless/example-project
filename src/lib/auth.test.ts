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
    it('posts to the logout endpoint then bounces to the admin logout url', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
      vi.stubGlobal('fetch', fetchMock)

      await logout('/auth')

      expect(fetchMock).toHaveBeenCalledWith(
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
