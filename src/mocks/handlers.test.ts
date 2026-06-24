import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { handlers } from './handlers'
import { STORAGE_KEY, readMockAuth, writeMockAuth } from './mockAuthStore'

// The handler array is [session(GET), refresh(POST), logout(POST)]. Each entry is
// an MSW RequestHandler; we drive its resolver directly via `.run()` so we can
// assert the response without standing up a worker.
const [sessionHandler, refreshHandler, logoutHandler] = handlers

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

describe('MSW auth handlers', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('session returns a guest body when not authenticated', async () => {
    const res = await runHandler(sessionHandler, '/_bffless/auth/session')
    expect(res?.status).toBe(200)
    expect(await res?.json()).toEqual({ authenticated: false, user: null })
  })

  it('session returns the mock user when authenticated', async () => {
    writeMockAuth({
      enabled: true,
      authenticated: true,
      user: { id: 'u-1', email: 'a@b.co', role: 'admin' },
    })
    const res = await runHandler(sessionHandler, '/_bffless/auth/session')
    const body = await res?.json()
    expect(body.authenticated).toBe(true)
    expect(body.user.id).toBe('u-1')
  })

  it('session passes through when mocking is disabled', async () => {
    writeMockAuth({
      enabled: false,
      authenticated: false,
      user: { id: 'x', role: 'user' },
    })
    // passthrough() resolves to a sentinel response that lets the request hit
    // the network rather than a mocked body.
    const res = await runHandler(sessionHandler, '/_bffless/auth/session')
    expect(res?.statusText).toBe('Passthrough')
  })

  it('refresh returns 200 when authenticated, 401 otherwise', async () => {
    writeMockAuth({
      enabled: true,
      authenticated: true,
      user: { id: 'u-1', role: 'user' },
    })
    let res = await runHandler(refreshHandler, '/_bffless/auth/refresh', {
      method: 'POST',
    })
    expect(res?.status).toBe(200)

    writeMockAuth({
      enabled: true,
      authenticated: false,
      user: { id: 'u-1', role: 'user' },
    })
    res = await runHandler(refreshHandler, '/_bffless/auth/refresh', {
      method: 'POST',
    })
    expect(res?.status).toBe(401)
  })

  it('logout flips authenticated to false and returns 204', async () => {
    writeMockAuth({
      enabled: true,
      authenticated: true,
      user: { id: 'u-1', role: 'user' },
    })
    const res = await runHandler(logoutHandler, '/_bffless/auth/logout', {
      method: 'POST',
    })
    expect(res?.status).toBe(204)
    expect(readMockAuth().authenticated).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy()
  })
})
