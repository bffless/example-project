/**
 * Session for the demo site.
 *
 * Reads the session from the **reverse-proxied SuperTokens endpoint**
 * (`/api/auth/session`) first, falling back to the built-in relay
 * (`/_bffless/auth/session`) only where the proxied one can't work. The
 * `/api/auth/*` proxy rule (see `.bffless/proxy-rules/api-backend/`) is what
 * makes those endpoints same-origin here.
 *
 * Why that order, and not the relay first:
 *
 * - On the primary domain the relay resolves via a shared `sAccessToken`
 *   fallback and returns an *under-hydrated* user — a non-BFFless `id`, no
 *   `role` — so it can't be the source of truth for anything role-gated.
 * - `/_bffless/auth/refresh` refreshes the *relay's* JWT, not `sAccessToken`.
 *   It can never refresh the real session on this domain.
 *
 * The relay is the correct path on a **cross-origin custom domain**, where
 * SuperTokens' cookies can't reach the origin at all. Hence: proxied first,
 * relay second.
 */
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

/** Primary: the reverse-proxied SuperTokens session (canonical id + role). */
const PROXIED_SESSION_URL = '/api/auth/session'

/** Fallback: the built-in relay, for cross-origin custom domains. */
const RELAY_SESSION_URL = '/_bffless/auth/session'

/** Module-level singleton — dedupes concurrent session checks. */
let inFlight: Promise<Session> | null = null

/**
 * Module-level singleton — dedupes concurrent refreshes. SuperTokens *rotates*
 * the refresh token on every refresh, so two concurrent
 * `/api/auth/session/refresh` calls race on the same `sRefreshToken`: the first
 * rotation invalidates the token the others are using, failing them and risking
 * a token-theft trip. Every 401 path awaits this one promise, so only a single
 * refresh is ever in flight — a 1-permit async mutex.
 */
let refreshInFlight: Promise<boolean> | null = null

/**
 * Once a refresh has failed, it will keep failing until something changes (a
 * login, a `refetch()`), so don't ask twice. Without this a plain guest visit
 * pays for the whole refresh dance *twice* — once resolving the proxied
 * endpoint, once resolving the relay — and fills their console with 401s.
 * Cleared by `refetch()`, and by any successful refresh.
 */
let refreshFailed = false

async function doRefresh(): Promise<boolean> {
  // Primary: SuperTokens' own refresh. The `sRefreshToken` cookie is
  // path-scoped to exactly /api/auth/session/refresh, which is why the proxy
  // rule has to be mounted at /api/auth/* — the browser would not send the
  // cookie to any other path.
  try {
    const st = await fetch('/api/auth/session/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { rid: 'session' },
    })
    if (st.ok) return true
  } catch {
    // ignore — fall through to the relay
  }

  // Fallback: the relay's own refresh (cross-origin custom domains).
  try {
    const relay = await fetch('/_bffless/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
    if (relay.ok) return true
  } catch {
    // ignore
  }

  return false
}

/** Refresh an expired session. Single-flight: concurrent callers share one. */
export function attemptRefresh(): Promise<boolean> {
  if (refreshFailed) return Promise.resolve(false)
  if (!refreshInFlight) {
    refreshInFlight = doRefresh()
      .then((ok) => {
        refreshFailed = !ok
        return ok
      })
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

type Evaluated = Session | 'needs-refresh'

async function evaluate(res: Response): Promise<Evaluated> {
  // 401 is the explicit "try refresh token" signal.
  if (res.status === 401) return 'needs-refresh'
  if (!res.ok) return { authenticated: false }

  const body = (await res.json()) as {
    authenticated?: boolean
    user?: SessionUser | null
  } & Partial<SessionUser>

  // An *expired* session comes back as a 200 with `user: null` /
  // `authenticated: false` — indistinguishable from a genuine guest. Treat both
  // as refresh-worthy: a real guest's refresh just 401s and we settle on guest.
  if (body?.authenticated === false || body?.user === null) {
    return 'needs-refresh'
  }

  const user = (body.user ?? (body as SessionUser)) as SessionUser
  if (!user || typeof user !== 'object' || !('id' in user)) {
    return { authenticated: false }
  }

  return { authenticated: true, user }
}

/**
 * Resolve the session from one endpoint, refreshing once if the token is
 * expired. Always settles (never returns `'needs-refresh'`): a second
 * `'needs-refresh'` collapses to guest so we can't loop.
 */
async function resolveSession(url: string): Promise<Session> {
  const tryGet = async (): Promise<Response> => fetch(url, { credentials: 'include' })

  let result = await evaluate(await tryGet())

  if (result === 'needs-refresh') {
    const refreshed = await attemptRefresh()
    result = refreshed ? await evaluate(await tryGet()) : { authenticated: false }
  }

  return result === 'needs-refresh' ? { authenticated: false } : result
}

export async function fetchSessionOnce(): Promise<Session> {
  // Proxied first: on this domain it carries the canonical user (id + role).
  const proxied = await resolveSession(PROXIED_SESSION_URL)
  if (proxied.authenticated) return proxied

  // Relay second: authenticates cross-origin custom domains, where the proxied
  // endpoint reads as guest. On the primary domain this just stays a guest.
  return resolveSession(RELAY_SESSION_URL)
}

function getSession(): Promise<Session> {
  if (!inFlight) {
    inFlight = fetchSessionOnce().catch(() => ({ authenticated: false }) as Session)
  }
  return inFlight
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => {
    inFlight = null
    refreshFailed = false // a login may have happened since — re-arm the refresh
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

  useEffect(() => {
    const onChange = () => refetch()
    window.addEventListener('bffless:auth:refetch', onChange)
    return () => window.removeEventListener('bffless:auth:refetch', onChange)
  }, [refetch])

  return { session, loading, refetch }
}
