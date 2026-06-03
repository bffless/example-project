import { http, HttpResponse, passthrough } from 'msw'
import { readMockAuth, writeMockAuth } from './authState'

function sessionHandler() {
  const state = readMockAuth()
  if (!state.enabled) return passthrough()
  if (!state.authenticated) {
    return HttpResponse.json(
      { message: 'try refresh token' },
      { status: 401 },
    )
  }
  return HttpResponse.json({ authenticated: true, user: state.user })
}

export const handlers = [
  http.get('/_bffless/auth/session', () => sessionHandler()),

  http.post('/_bffless/auth/refresh', () => {
    const state = readMockAuth()
    if (!state.enabled) return passthrough()
    if (!state.authenticated) {
      return new HttpResponse(null, { status: 401 })
    }
    return new HttpResponse(null, { status: 200 })
  }),

  http.post('/_bffless/auth/logout', () => {
    const state = readMockAuth()
    if (!state.enabled) return passthrough()
    writeMockAuth({ ...state, authenticated: false })
    return new HttpResponse(null, { status: 204 })
  }),
]
