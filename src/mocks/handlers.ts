import { http, HttpResponse, passthrough } from 'msw'
import { readMockAuth, writeMockAuth } from './mockAuthStore'

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

  // Studio stage ③ — transcription is now a real BFFless pipeline
  // (`/api/transcribe`: presigned audio URL → Replicate WhisperX, story 02).
  // No MSW handler: unhandled `/api/*` falls through to the Vite proxy, same as
  // the upload routes. The real pipeline returns the same `{ words, text }` shape
  // the mock used, so the FE is unchanged.
]
