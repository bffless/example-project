import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSession } from './useSession'

type FetchMock = ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('useSession', () => {
  let fetchMock: FetchMock

  beforeEach(async () => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // Reset the module-scoped inFlight promise between tests
    vi.resetModules()
  })

  it('returns an authenticated session when /session responds 200', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ user: { id: 'u-1', email: 'a@b.co' } })
    )

    const { useSession: freshUseSession } = await import('./useSession')
    const { result } = renderHook(() => freshUseSession())

    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.session).toEqual({
      authenticated: true,
      user: { id: 'u-1', email: 'a@b.co' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/_bffless/auth/session',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('refreshes and retries when /session returns 401', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 })) // refresh ok
      .mockResolvedValueOnce(jsonResponse({ id: 'u-2' }))

    const { useSession: freshUseSession } = await import('./useSession')
    const { result } = renderHook(() => freshUseSession())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.session).toEqual({
      authenticated: true,
      user: { id: 'u-2' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/_bffless/auth/refresh',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('returns unauthenticated when refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 })) // refresh fails

    const { useSession: freshUseSession } = await import('./useSession')
    const { result } = renderHook(() => freshUseSession())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.session).toEqual({ authenticated: false })
  })

  it('refetch clears the cached session and re-fetches', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'first' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'second' }))

    const { useSession: freshUseSession } = await import('./useSession')
    const { result } = renderHook(() => freshUseSession())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.session).toEqual({
      authenticated: true,
      user: { id: 'first' },
    })

    act(() => {
      result.current.refetch()
    })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.session).toEqual({
      authenticated: true,
      user: { id: 'second' },
    })
  })
})
