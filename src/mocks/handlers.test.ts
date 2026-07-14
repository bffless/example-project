import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { handlers } from './handlers'
import { STORAGE_KEY, readMockAuth, writeMockAuth, type MockAuthState } from './mockAuthStore'

// Look handlers up by method+path rather than by array position: the array holds
// both the proxied SuperTokens endpoints and the relay fallbacks, and a lookup
// keeps these tests honest if the order ever changes.
function handlerFor(method: string, path: string) {
  const found = handlers.find(
    (h) =>
      h.info.method === method &&
      String((h.info as { path: unknown }).path) === path,
  )
  if (!found) throw new Error(`no MSW handler for ${method} ${path}`)
  return found
}

async function runHandler(
  handler: (typeof handlers)[number],
  path: string,
  init?: RequestInit,
) {
  // Resolve against the jsdom origin so MSW's relative-path predicate matches.
  const request = new Request(new URL(path, window.location.origin), init)
  const result = await handler.run({ request, requestId: 'test' })
  return result?.response as Response | undefined
}

const authed: MockAuthState = {
  enabled: true,
  authenticated: true,
  user: { id: 'u-1', role: 'user' },
}

describe('MSW auth handlers', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  describe('proxied SuperTokens endpoints (the primary path)', () => {
    const session = () => handlerFor('GET', '/api/auth/session')
    const refresh = () => handlerFor('POST', '/api/auth/session/refresh')
    const signout = () => handlerFor('POST', '/api/auth/signout')

    it('session returns SuperTokens’ shape: a null user when guest', async () => {
      writeMockAuth({ ...authed, authenticated: false })
      const res = await runHandler(session(), '/api/auth/session')
      expect(res?.status).toBe(200)
      // Note: `{ user: null }`, not `{ authenticated: false }` — the real
      // SuperTokens endpoint and the relay genuinely differ here.
      expect(await res?.json()).toEqual({ user: null })
    })

    it('session returns the mock user when authenticated', async () => {
      writeMockAuth({
        enabled: true,
        authenticated: true,
        user: { id: 'u-1', email: 'a@b.co', role: 'admin' },
      })
      const body = await (await runHandler(session(), '/api/auth/session'))?.json()
      expect(body.user.id).toBe('u-1')
      expect(body.user.role).toBe('admin')
    })

    it('session passes through when mocking is disabled', async () => {
      writeMockAuth({ ...authed, enabled: false })
      const res = await runHandler(session(), '/api/auth/session')
      expect(res?.statusText).toBe('Passthrough')
    })

    it('refresh returns 200 when authenticated, 401 otherwise', async () => {
      writeMockAuth(authed)
      let res = await runHandler(refresh(), '/api/auth/session/refresh', { method: 'POST' })
      expect(res?.status).toBe(200)

      writeMockAuth({ ...authed, authenticated: false })
      res = await runHandler(refresh(), '/api/auth/session/refresh', { method: 'POST' })
      expect(res?.status).toBe(401)
    })

    it('signout flips authenticated to false and returns 204', async () => {
      writeMockAuth(authed)
      const res = await runHandler(signout(), '/api/auth/signout', { method: 'POST' })
      expect(res?.status).toBe(204)
      expect(readMockAuth().authenticated).toBe(false)
      expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy()
    })
  })

  describe('relay endpoints (the custom-domain fallback)', () => {
    const session = () => handlerFor('GET', '/_bffless/auth/session')
    const refresh = () => handlerFor('POST', '/_bffless/auth/refresh')
    const logout = () => handlerFor('POST', '/_bffless/auth/logout')

    it('session returns a guest body when not authenticated', async () => {
      const res = await runHandler(session(), '/_bffless/auth/session')
      expect(res?.status).toBe(200)
      expect(await res?.json()).toEqual({ authenticated: false, user: null })
    })

    it('session returns the mock user when authenticated', async () => {
      writeMockAuth({
        enabled: true,
        authenticated: true,
        user: { id: 'u-1', email: 'a@b.co', role: 'admin' },
      })
      const body = await (await runHandler(session(), '/_bffless/auth/session'))?.json()
      expect(body.authenticated).toBe(true)
      expect(body.user.id).toBe('u-1')
    })

    it('session passes through when mocking is disabled', async () => {
      writeMockAuth({ ...authed, enabled: false })
      const res = await runHandler(session(), '/_bffless/auth/session')
      expect(res?.statusText).toBe('Passthrough')
    })

    it('refresh returns 200 when authenticated, 401 otherwise', async () => {
      writeMockAuth(authed)
      let res = await runHandler(refresh(), '/_bffless/auth/refresh', { method: 'POST' })
      expect(res?.status).toBe(200)

      writeMockAuth({ ...authed, authenticated: false })
      res = await runHandler(refresh(), '/_bffless/auth/refresh', { method: 'POST' })
      expect(res?.status).toBe(401)
    })

    it('logout flips authenticated to false and returns 204', async () => {
      writeMockAuth(authed)
      const res = await runHandler(logout(), '/_bffless/auth/logout', { method: 'POST' })
      expect(res?.status).toBe(204)
      expect(readMockAuth().authenticated).toBe(false)
    })
  })
})
