import { http, HttpResponse, passthrough } from 'msw'
import { readMockAuth, writeMockAuth } from './mockAuthStore'
import { TRANSCRIBE_FIXTURE } from './transcribeFixture'

/**
 * Mock the Studio bucket-upload + transcription pipelines in dev so iterating on
 * the UI never hits real storage or the **paid** Replicate WhisperX call. Flip
 * to `false` to exercise the live pipelines (`/api/*` then bypasses to the Vite
 * proxy). Only active in dev — MSW isn't started in prod (see `main.tsx`).
 */
const MOCK_STUDIO = false

/** A fake bucket host for the presigned PUT — intercepted below so no bytes leave. */
const MOCK_BUCKET = 'https://mock-bucket.studio.local'

/**
 * Bytes "uploaded" this session, so the serve route can hand them back the way
 * the real `file_serve` pipeline serves from the bucket — without this, the
 * `<img>`/`<video>` GETs to `/api/uploads/...` fall through to the live proxy and
 * 404 (the broken contact sheets + "Failed to fetch" SW errors). Only small
 * objects (contact sheets) are kept; the source video/audio are skipped to avoid
 * holding hundreds of MB in the worker. The Map lives in the service worker, so a
 * hard reload clears it — served objects 404 afterward and the UI re-attaches.
 */
const objectStore = new Map<string, { body: ArrayBuffer; type: string }>()
const MOCK_SERVE_MAX = 25_000_000
const lastSegment = (url: string) =>
  decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')

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

  // The browser PUTs the bytes straight to the "bucket". Keep small objects so the
  // serve route below can return them; skip large ones (source video/audio).
  http.put(`${MOCK_BUCKET}/*`, async ({ request }) => {
    const body = await request.arrayBuffer()
    if (body.byteLength <= MOCK_SERVE_MAX) {
      objectStore.set(lastSegment(request.url), {
        body,
        type: request.headers.get('content-type') ?? 'application/octet-stream',
      })
    }
    return new HttpResponse(null, { status: 200 })
  }),

  // Register (source + audio): return the flat `{ url }` the FE reads as the
  // stored object URL. Mirrors the real serve path so it looks/behaves the same.
  http.post('/api/uploads/:kind/register', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { originalName?: string }
    const name = body.originalName ?? 'clip'
    return HttpResponse.json({
      url: `/api/uploads/${params.kind}/mock/${encodeURIComponent(name)}`,
    })
  }),

  // Serve an uploaded object back (mirrors the real `file_serve` route). Returns
  // the stored bytes, or 404 if they weren't kept / the worker restarted.
  http.get('/api/uploads/:kind/*', ({ request }) => {
    const obj = objectStore.get(lastSegment(request.url))
    if (!obj) return new HttpResponse(null, { status: 404 })
    return new HttpResponse(obj.body, { status: 200, headers: { 'Content-Type': obj.type } })
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
