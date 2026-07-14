import { http, HttpResponse, passthrough } from 'msw'
import { readMockAuth, writeMockAuth } from './mockAuthStore'

/**
 * Dev-only MSW handlers for BFFless auth, so the demo's auth-aware UI works
 * offline and in tests without a real backend. The mock auth state is driven by
 * the DevAuthPanel via `mockAuthStore`; when mocking is disabled the requests
 * pass through to the Vite proxy. Only active in dev — MSW isn't started in prod
 * (see `main.tsx`). Any other `/api/*` / `/_bffless/*` request is unhandled and
 * falls through to the proxy.
 *
 * Both auth paths are mocked, because the app uses both (see `lib/useSession.ts`):
 * the reverse-proxied SuperTokens endpoints (`/api/auth/*` — the primary path on
 * this domain, via the proxy rule) and the built-in relay (`/_bffless/auth/*` —
 * the fallback for cross-origin custom domains).
 *
 * Note the two response shapes differ, and that's faithful to the real backend:
 * SuperTokens' `/api/auth/session` returns `{ user }` (null when guest), while
 * the relay returns `{ authenticated, user }`.
 */
export const handlers = [
  // --- Primary: reverse-proxied SuperTokens ---------------------------------
  http.get('/api/auth/session', () => {
    const state = readMockAuth()
    if (!state.enabled) return passthrough()
    if (!state.authenticated) {
      return HttpResponse.json({ user: null })
    }
    return HttpResponse.json({ user: state.user })
  }),

  http.post('/api/auth/session/refresh', () => {
    const state = readMockAuth()
    if (!state.enabled) return passthrough()
    return new HttpResponse(null, { status: state.authenticated ? 200 : 401 })
  }),

  http.post('/api/auth/signout', () => {
    const state = readMockAuth()
    if (!state.enabled) return passthrough()
    writeMockAuth({ ...state, authenticated: false })
    return new HttpResponse(null, { status: 204 })
  }),

  // --- Fallback: the built-in relay ------------------------------------------
  http.get('/_bffless/auth/session', () => {
    const state = readMockAuth()
    if (!state.enabled) return passthrough()
    if (!state.authenticated) {
      return HttpResponse.json({ authenticated: false, user: null })
    }
    return HttpResponse.json({ authenticated: true, user: state.user })
  }),

  http.post('/_bffless/auth/refresh', () => {
    const state = readMockAuth()
    if (!state.enabled) return passthrough()
    return new HttpResponse(null, { status: state.authenticated ? 200 : 401 })
  }),

  http.post('/_bffless/auth/logout', () => {
    const state = readMockAuth()
    if (!state.enabled) return passthrough()
    writeMockAuth({ ...state, authenticated: false })
    return new HttpResponse(null, { status: 204 })
  }),
]
