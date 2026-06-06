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

  // Master director: canned synopsis + scenes (with tightened script + cut
  // spans) so the scene workspace has realistic data without a paid Gemini call.
  // Scenes are derived from the posted `duration` so they fit any clip. Mirrors
  // the real `/api/scenes` shape: { synopsis, scenes: [{ title, start, end,
  // transcript, draftText, cuts }] }.
  http.post('/api/scenes', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { duration?: number; direction?: string }
    return HttpResponse.json(mockDirector(body.duration ?? 0, body.direction ?? ''))
  }),
]

/** A deterministic canned director response sized to the clip's duration. */
function mockDirector(duration: number, direction: string) {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 600
  const count = Math.max(1, Math.round(total / 210)) // ~3.5 min scenes
  const each = total / count
  const beats = [
    { title: 'Cold open — the problem', draft: 'Here is the problem we kept running into, and why the usual fix falls apart at scale.' },
    { title: 'The turn — what changed', draft: 'So we tried something different. The key insight was to let the pipeline do the rewriting up front.' },
    { title: 'The demo', draft: 'Let me show you. You upload one clip, and it preps everything — transcript, scenes, your cloned voice.' },
    { title: 'How it works', draft: 'Under the hood it is a chain of small steps, each one handed off to the next, no server code.' },
    { title: 'Where it goes next', draft: 'Next we tighten each scene, line the footage up to the voice, and ship the cut.' },
  ]
  const scenes = Array.from({ length: count }, (_, i) => {
    const start = i * each
    const end = i === count - 1 ? total : (i + 1) * each
    const beat = beats[i % beats.length]
    // Drop a chunk of dead air in the middle third of each scene.
    const cutStart = start + each * 0.45
    const cutEnd = start + each * 0.62
    return {
      title: beat.title,
      start,
      end,
      transcript: `(${Math.round(end - start)}s of original footage for this scene)`,
      draftText: direction ? `${beat.draft} (${direction})` : beat.draft,
      cuts: [{ start: cutStart, end: cutEnd }],
    }
  })
  return {
    synopsis:
      'A builder turns one long, rambly screen recording into a tight, scene-by-scene short — the AI cuts the dead weight, groups the rest into chapters, and re-voices it in the maker’s own cloned voice.',
    scenes,
  }
}

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
