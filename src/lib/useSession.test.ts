import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

type FetchMock = ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const PROXIED = '/api/auth/session'
const PROXIED_REFRESH = '/api/auth/session/refresh'
const RELAY = '/_bffless/auth/session'
const RELAY_REFRESH = '/_bffless/auth/refresh'

/**
 * Route the fetch mock by URL rather than by call order: the session layer tries
 * the proxied SuperTokens endpoints first and the relay only as a fallback, so
 * the *number* of calls varies with the scenario. Anything not routed 401s,
 * which is what an endpoint that isn't wired up would really do.
 */
function routedFetch(routes: Record<string, () => Response>): FetchMock {
  return vi.fn((url: string) => {
    const handler = routes[url]
    return Promise.resolve(handler ? handler() : new Response(null, { status: 401 }))
  })
}

describe('useSession', () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    vi.resetModules() // reset the module-scoped inFlight / refreshInFlight singletons
  })

  function stub(routes: Record<string, () => Response>) {
    fetchMock = routedFetch(routes)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('reads the session from the proxied SuperTokens endpoint, not the relay', async () => {
    stub({ [PROXIED]: () => jsonResponse({ user: { id: 'u-1', email: 'a@b.co' } }) })

    const { useSession } = await import('./useSession')
    const { result } = renderHook(() => useSession())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.session).toEqual({
      authenticated: true,
      user: { id: 'u-1', email: 'a@b.co' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      PROXIED,
      expect.objectContaining({ credentials: 'include' }),
    )
    // The relay is the fallback — an authenticated proxied read must not reach it,
    // because on this domain the relay would under-hydrate the user (no role).
    expect(fetchMock).not.toHaveBeenCalledWith(RELAY, expect.anything())
  })

  it('refreshes via SuperTokens and retries when the session is expired', async () => {
    let refreshed = false
    stub({
      [PROXIED]: () =>
        refreshed ? jsonResponse({ user: { id: 'u-2' } }) : new Response(null, { status: 401 }),
      [PROXIED_REFRESH]: () => {
        refreshed = true
        return new Response(null, { status: 200 })
      },
    })

    const { useSession } = await import('./useSession')
    const { result } = renderHook(() => useSession())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.session).toEqual({ authenticated: true, user: { id: 'u-2' } })
    // `rid: session` is what SuperTokens' own SDK sends on the refresh call.
    expect(fetchMock).toHaveBeenCalledWith(
      PROXIED_REFRESH,
      expect.objectContaining({ method: 'POST', headers: { rid: 'session' } }),
    )
    // The relay refresh can't renew a SuperTokens session — it must not be needed.
    expect(fetchMock).not.toHaveBeenCalledWith(RELAY_REFRESH, expect.anything())
  })

  it('falls back to the relay when the proxied endpoint reads as guest', async () => {
    // The cross-origin custom-domain case: no SuperTokens cookie reaches the
    // origin, so the proxied endpoint sees a guest and only the relay authenticates.
    stub({
      [PROXIED]: () => jsonResponse({ user: null }),
      [RELAY]: () => jsonResponse({ authenticated: true, user: { id: 'u-3', role: 'admin' } }),
    })

    const { useSession } = await import('./useSession')
    const { result } = renderHook(() => useSession())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.session).toEqual({
      authenticated: true,
      user: { id: 'u-3', role: 'admin' },
    })
  })

  it('settles on guest when neither endpoint authenticates', async () => {
    stub({
      [PROXIED]: () => jsonResponse({ user: null }),
      [RELAY]: () => jsonResponse({ authenticated: false, user: null }),
    })

    const { useSession } = await import('./useSession')
    const { result } = renderHook(() => useSession())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.session).toEqual({ authenticated: false })
  })

  it('does not re-attempt a refresh it already knows has failed', async () => {
    // A guest resolves two endpoints in turn. Without a memo of the failure,
    // each one pays for the whole refresh dance — the visitor's console fills
    // with 401s for a session they never had.
    stub({
      [PROXIED]: () => jsonResponse({ user: null }),
      [RELAY]: () => jsonResponse({ authenticated: false, user: null }),
    })

    const { useSession } = await import('./useSession')
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const refreshCalls = fetchMock.mock.calls.filter(
      ([url]) => url === PROXIED_REFRESH || url === RELAY_REFRESH,
    )
    expect(refreshCalls).toHaveLength(2) // one proxied + one relay attempt, once
  })

  it('runs only one refresh for concurrent callers', async () => {
    // SuperTokens rotates the refresh token on every refresh, so two concurrent
    // refreshes race on the same cookie and the loser can trip token-theft
    // detection. attemptRefresh is a 1-permit mutex; prove it.
    stub({ [PROXIED_REFRESH]: () => new Response(null, { status: 200 }) })

    const { attemptRefresh } = await import('./useSession')
    const results = await Promise.all([attemptRefresh(), attemptRefresh(), attemptRefresh()])

    expect(results).toEqual([true, true, true])
    expect(fetchMock.mock.calls.filter(([url]) => url === PROXIED_REFRESH)).toHaveLength(1)
  })

  it('refetch clears the cached session and re-fetches', async () => {
    let call = 0
    stub({ [PROXIED]: () => jsonResponse({ user: { id: call++ === 0 ? 'first' : 'second' } }) })

    const { useSession } = await import('./useSession')
    const { result } = renderHook(() => useSession())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.session).toEqual({ authenticated: true, user: { id: 'first' } })

    act(() => {
      result.current.refetch()
    })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.session).toEqual({ authenticated: true, user: { id: 'second' } })
  })
})
