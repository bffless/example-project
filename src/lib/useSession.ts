import { useEffect, useState, useCallback } from 'react'

export type SessionUser = {
  id: string
  email?: string
  role?: string
  [key: string]: unknown
}

export type Session =
  | { authenticated: true; user: SessionUser }
  | { authenticated: false }

let inFlight: Promise<Session> | null = null

async function fetchSessionOnce(): Promise<Session> {
  const tryGet = async (): Promise<Response> =>
    fetch('/_bffless/auth/session', { credentials: 'include' })

  let res = await tryGet()
  if (res.status === 401) {
    const refresh = await fetch('/_bffless/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
    if (refresh.ok) res = await tryGet()
  }

  if (!res.ok) return { authenticated: false }

  const body = (await res.json()) as { user?: SessionUser } & SessionUser
  const user = (body.user ?? body) as SessionUser
  return { authenticated: true, user }
}

function getSession(): Promise<Session> {
  if (!inFlight) {
    inFlight = fetchSessionOnce().catch(() => ({ authenticated: false }))
  }
  return inFlight
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => {
    inFlight = null
    setLoading(true)
    setSession(null)
    setTick((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    getSession().then((s) => {
      if (!cancelled) {
        setSession(s)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [tick])

  return { session, loading, refetch }
}
