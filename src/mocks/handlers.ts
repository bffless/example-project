import { http, HttpResponse, passthrough } from 'msw'
import { readMockAuth, writeMockAuth } from './mockAuthStore'
import { TRANSCRIBE_FIXTURE } from './transcribeFixture'

/**
 * Mock the Studio bucket-upload + transcription pipelines in dev so iterating on
 * the UI never hits real storage or the **paid** Replicate WhisperX call. Flip
 * to `false` to exercise the live pipelines (`/api/*` then bypasses to the Vite
 * proxy). Only active in dev — MSW isn't started in prod (see `main.tsx`).
 */
const MOCK_STUDIO = true

/** A fake bucket host for the presigned PUT — intercepted below so no bytes leave. */
const MOCK_BUCKET = 'https://mock-bucket.studio.local'

const studioHandlers = [
  // Presigned prepare (source + audio): hand back a fake bucket PUT URL (which we
  // also intercept) plus the storageKey/originalName the register step echoes.
  http.post('/api/uploads/:kind/prepare', async ({ params, request }) => {
    const { filename } = (await request.json().catch(() => ({}))) as { filename?: string }
    const name = filename ?? 'clip'
    return HttpResponse.json({
      uploadUrl: `${MOCK_BUCKET}/${params.kind}/${encodeURIComponent(name)}`,
      storageKey: `mock/${params.kind}/${name}`,
      originalName: name,
    })
  }),

  // The browser PUTs the bytes straight to the "bucket" — swallow it (200, no-op).
  http.put(`${MOCK_BUCKET}/*`, () => new HttpResponse(null, { status: 200 })),

  // Register (source + audio): return the flat `{ url }` the FE reads as the
  // stored object URL. Mirrors the real serve path so it looks/behaves the same.
  http.post('/api/uploads/:kind/register', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { originalName?: string }
    const name = body.originalName ?? 'clip'
    return HttpResponse.json({
      url: `/api/uploads/${params.kind}/mock/${encodeURIComponent(name)}`,
    })
  }),

  // Transcription: return the real captured WhisperX response (82 words with
  // word-level timestamps) so the editor has realistic data, free of charge.
  http.post('/api/transcribe', () => HttpResponse.json(TRANSCRIBE_FIXTURE)),
]

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

  // Studio upload + transcription mocks (dev only, paid-call savings). The real
  // pipelines are wired (stories 01/01b/02); these return the same shapes so the
  // FE is unchanged. Set `MOCK_STUDIO = false` above to use the live endpoints.
  ...(MOCK_STUDIO ? studioHandlers : []),
]
