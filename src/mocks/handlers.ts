import { http, HttpResponse, passthrough } from 'msw'
import { readMockAuth, writeMockAuth } from './mockAuthStore'

/**
 * Dev-only MSW handlers for the BFFless cookie-auth relay, so the demo's
 * auth-aware UI works offline and in tests without a real backend. The mock auth
 * state is driven by the DevAuthPanel via `mockAuthStore`; when mocking is
 * disabled the relay requests pass through to the Vite proxy. Only active in dev
 * — MSW isn't started in prod (see `main.tsx`). Any other `/api/*` / `/_bffless/*`
 * request is unhandled and falls through to the proxy.
 */
export const handlers = [
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
