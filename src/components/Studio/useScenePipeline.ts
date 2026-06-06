import { useCallback, useMemo, useState } from 'react'
import { STAGE_DEFS, type Stage, type StageId } from '../../lib/pipeline'
import { narrationSeconds, type Scene } from '../../lib/scenes'
import { timedTranscript, toScenes } from '../../lib/director'
import { extractAudio } from '../../lib/audio'
import { captureFramesAt, captureContactSheet, type ContactSheet } from '../../lib/frames'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { useTranscribeMutation, useScenesMutation, useUploadMutation } from '../../store/studioApi'
import {
  patchStage,
  failActiveStage,
  setScenes,
  patchScene as patchSceneAction,
  setSourceUrl,
  setAudioUrl,
  setAudioPeaks,
  setContactSheets,
  setWords,
  setSynopsis,
  setSelected,
  resetStudio,
  type TranscriptWord,
} from '../../store/studioSlice'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`

/**
 * Module-level in-flight guard for the prep step runner. Deliberately NOT a
 * per-instance `useRef`: in React StrictMode (dev) the tree mounts twice, so two
 * hook instances briefly coexist, each with its own ref — letting a step fire on
 * both and double-hit a paid `/api/*` call (e.g. two `/api/transcribe`). A shared
 * module flag flips synchronously before any work, so the second caller bails
 * regardless of which instance it came from. Same singleton pattern as
 * `useSession.ts`'s `inFlight` dedupe.
 */
let stepInFlight = false

/**
 * Turn whatever a failed step threw into a readable message. RTK Query's
 * `unwrap()` rejects with a *serialized* error object (`{ status, error }` or
 * `{ status, data }`), not an `Error` — so `String(e)` would give the useless
 * "[object Object]". Pull the real message out of those shapes.
 */
function stageError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    if (typeof o.error === 'string') return o.error // FETCH_ERROR / our queryFn CUSTOM_ERROR
    if (typeof o.message === 'string') return o.message
    if (typeof o.data === 'string') return o.data
    const data = o.data as { message?: unknown } | undefined
    if (data && typeof data.message === 'string') return data.message
    if ('status' in o) return `Request failed (${String(o.status)})`
  }
  return 'Unknown error'
}

export type { TranscriptWord }

/**
 * What each step needs: the source file, its object URL, and its duration.
 * `direction` is the optional free-text note the user types for the master
 * director step; ignored by every other step.
 */
export type StepContext = { file: File; src: string; duration: number; direction?: string }

/**
 * Owns the one-time prep pipeline and the scene queue you build afterwards.
 *
 * Business state (stages, scenes, transcript, bucket serve URLs, contact sheets,
 * selection) lives in the persisted Redux `studio` slice, so a hard reload
 * resumes where you left off. Only transient UI flags (`running`, `voicingId`)
 * are local React state — losing those on reload is fine. Network calls go
 * through RTK Query (`/store/studioApi`).
 *
 * Prep runs **step by step** — the user triggers each step deliberately via
 * `next(ctx)`, which advances `currentStageId`. Swap a mocked step for its real
 * `/api/*` call here without touching the UI.
 */
export function useScenePipeline() {
  const dispatch = useAppDispatch()
  // The board is the static step content (STAGE_DEFS) recombined with the only
  // persisted, dynamic part — per-step progress. Keeping just the progress in
  // state means editing STAGE_DEFS reshapes the board on the next load, no
  // migration needed (see studioSlice `StageProgress`).
  const stageProgress = useAppSelector((s) => s.studio.stageProgress)
  const stages = useMemo<Stage[]>(
    () =>
      STAGE_DEFS.map((def) => ({
        ...def,
        status: stageProgress[def.id]?.status ?? 'pending',
        detail: stageProgress[def.id]?.detail,
      })),
    [stageProgress],
  )
  const scenes = useAppSelector((s) => s.studio.scenes)
  const sourceUrl = useAppSelector((s) => s.studio.sourceUrl)
  const audioUrl = useAppSelector((s) => s.studio.audioUrl)
  const audioPeaks = useAppSelector((s) => s.studio.audioPeaks)
  const persistedSheets = useAppSelector((s) => s.studio.contactSheets)
  const words = useAppSelector((s) => s.studio.words)
  const synopsis = useAppSelector((s) => s.studio.synopsis)
  const selectedId = useAppSelector((s) => s.studio.selectedId)

  const [transcribeReq] = useTranscribeMutation()
  const [scenesReq] = useScenesMutation()
  const [uploadReq] = useUploadMutation()

  // Transient UI state — not persisted.
  const [voicingId, setVoicingId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  // The just-captured contact sheets, shown immediately while they upload. They
  // carry the heavy base64 `dataUrl`, so they live here (transient) and NEVER in
  // Redux/localStorage — only the uploaded sheets (bucket URL, empty dataUrl) are
  // committed to the persisted slice.
  const [pendingSheets, setPendingSheets] = useState<ContactSheet[]>([])

  // Once uploaded, the persisted bucket-URL sheets win; until then show the
  // local previews. Never both — the upload swap clears the pending set.
  const contactSheets = persistedSheets.length ? persistedSheets : pendingSheets

  const patch = useCallback(
    (id: StageId, p: Parameters<typeof patchStage>[0]['patch']) =>
      dispatch(patchStage({ id, patch: p })),
    [dispatch],
  )

  const patchScene = useCallback(
    (id: string, p: Partial<Scene>) => dispatch(patchSceneAction({ id, patch: p })),
    [dispatch],
  )

  const reset = useCallback(() => {
    setPendingSheets([])
    dispatch(resetStudio())
  }, [dispatch])

  // The next prep step to run: the first stage that isn't done. Null once ready.
  const currentStageId = useMemo<StageId | null>(
    () => stages.find((s) => s.status !== 'done')?.id ?? null,
    [stages],
  )

  // ---- Individual steps -----------------------------------------------------

  // Stage ① — upload the source clip directly to the storage bucket via the
  // presigned flow (the video is far over the 1 MB proxy body cap).
  const uploadClip = useCallback(
    async ({ file }: StepContext) => {
      patch('upload', { status: 'active' })
      const { url } = await uploadReq({ file, kind: 'source' }).unwrap()
      dispatch(setSourceUrl(url))
      patch('upload', { status: 'done', detail: `${mb(file.size)} → storage bucket` })
    },
    [patch, dispatch, uploadReq],
  )

  // Stage ② — extract the audio in-browser, then upload that WAV to the bucket
  // on its own so the transcription step can hand Replicate an audio URL.
  const extractAndUploadAudio = useCallback(
    async ({ file }: StepContext) => {
      patch('extract', { status: 'active' })
      // One decode yields both the uploadable WAV and a compact waveform summary
      // — so the resource card can show a stenograph of the extracted audio
      // without re-decoding the whole clip just to draw it.
      const { wav, peaks } = await extractAudio(file) // real, browser-side
      const wavFile = new File([wav], `${file.name.replace(/\.[^.]+$/, '')}.wav`, {
        type: 'audio/wav',
      })
      const { url } = await uploadReq({ file: wavFile, kind: 'audio' }).unwrap()
      dispatch(setAudioUrl(url))
      dispatch(setAudioPeaks(peaks))
      patch('extract', {
        status: 'done',
        detail: `16 kHz mono WAV · ${mb(wav.size)} → bucket`,
      })
    },
    [patch, dispatch, uploadReq],
  )

  // Stage ③ — transcribe the uploaded audio. POSTs the bucketed `audioUrl` to
  // the real `/api/transcribe` pipeline (presigned audio URL → Replicate
  // WhisperX with word-level alignment, story 02). Keeps the word-level
  // timestamps for shorten + segment (story 03).
  const transcribe = useCallback(
    async ({ duration }: StepContext) => {
      patch('transcribe', { status: 'active' })
      const data = await transcribeReq({ audioUrl }).unwrap()
      const got = data.words ?? []
      dispatch(setWords(got))
      const count = got.length || Math.round((duration / 60) * 150)
      patch('transcribe', {
        status: 'done',
        detail: `${count.toLocaleString()} words · ${Math.ceil(duration / 60)} min`,
      })
    },
    [patch, dispatch, transcribeReq, audioUrl],
  )

  // Stage ④ — sample interval thumbnails across the whole clip, compose them into
  // timestamped contact sheets (real, browser-side), then upload each to its
  // bucket so the master director (story 03) can be handed real image URLs — not
  // just in-browser blobs. The local `dataUrl` stays for the preview; `url` is
  // the persisted object.
  const generateThumbnails = useCallback(
    async ({ src, duration }: StepContext) => {
      patch('thumbnails', { status: 'active' })
      const sheets = await captureContactSheet(src, duration) // real, tiled ≤10
      // Show the freshly-captured blobs immediately, but keep them out of Redux
      // (and therefore out of localStorage) — they're base64-heavy. If the upload
      // below throws, these stay visible while the stage shows the error.
      setPendingSheets(sheets)
      // Upload sheets one at a time, not in parallel: concurrent registers were
      // racing the dev proxy's keep-alive socket pool into ECONNRESET 502s (see
      // the proxy `agent` note in vite.config.ts). Sequential is plenty fast for
      // the handful of sheets and keeps a single in-flight request to the edge.
      const uploaded: ContactSheet[] = []
      for (const sheet of sheets) {
        const blob = await (await fetch(sheet.dataUrl)).blob()
        const ext = blob.type === 'image/png' ? 'png' : 'jpg'
        const name = `contact-${String(sheet.index + 1).padStart(2, '0')}.${ext}`
        const file = new File([blob], name, { type: blob.type })
        const { url } = await uploadReq({ file, kind: 'thumbnails' }).unwrap()
        // The bucket URL is now the canonical state — drop the base64 blob so what
        // we persist is just a small URL, and the preview loads through the serve
        // route (the reverse-proxy-to-bucket path).
        uploaded.push({ ...sheet, url, dataUrl: '' })
      }
      // Only the uploaded, URL-only sheets are committed to the persisted slice.
      dispatch(setContactSheets(uploaded))
      setPendingSheets([])
      const frames = uploaded.reduce((n, s) => n + s.count, 0)
      patch('thumbnails', {
        status: 'done',
        detail: frames
          ? `${frames} frames · ${uploaded.length} sheet${uploaded.length === 1 ? '' : 's'} → bucket`
          : 'no frames sampled',
      })
    },
    [patch, dispatch, uploadReq],
  )

  // Stages ⑤⑥ — the master director (story 03). One multimodal Gemini call gets
  // the timestamped transcript, the director contact sheets, and the user's
  // optional direction, and returns the synopsis + scenes (tightened script,
  // original-video span, and cut spans). Marks BOTH the shorten and segment
  // notes done (one call does both), then captures a midpoint thumb per scene
  // for the scene-card art. Replaces the old mocked `buildScenes`.
  const runDirector = useCallback(
    async ({ src, duration, direction }: StepContext) => {
      patch('director', { status: 'active' })
      const transcript = timedTranscript(words)
      const sheetUrls = persistedSheets.map((s) => s.url).filter((u): u is string => !!u)
      const data = await scenesReq({
        transcript,
        sheetUrls,
        direction: direction ?? '',
        duration,
      }).unwrap()

      const built = toScenes(data.scenes ?? [], duration)
      dispatch(setSynopsis(data.synopsis ?? null))

      // Grab one midpoint frame per scene for the scene-card art (real, browser).
      const thumbs = await captureFramesAt(
        src,
        built.map((s) => (s.start + s.end) / 2),
        64,
      )
      const withThumbs = built.map((s, i) => ({ ...s, thumb: thumbs[i] }))
      dispatch(setScenes(withThumbs))
      dispatch(setSelected(withThumbs[0]?.id ?? null))

      const cutCount = withThumbs.reduce((n, s) => n + (s.cuts?.length ?? 0), 0)
      patch('director', {
        status: 'done',
        detail: `${withThumbs.length} scene${withThumbs.length === 1 ? '' : 's'} · ${cutCount} cut${cutCount === 1 ? '' : 's'} · script tightened`,
      })
    },
    [patch, dispatch, words, persistedSheets, scenesReq],
  )

  // Stage ⑦ — clone the voice (still mocked; real Replicate clone is story 04).
  const cloneVoice = useCallback(async () => {
    patch('clone', { status: 'active' })
    await delay(900)
    patch('clone', { status: 'done', detail: 'voice model ready' })
  }, [patch])

  /** Run the current prep step. Marks the active stage `error` if it throws. */
  const next = useCallback(
    async (ctx: StepContext) => {
      const id = currentStageId
      if (!id || stepInFlight) return
      stepInFlight = true
      setRunning(true)
      try {
        if (id === 'upload') await uploadClip(ctx)
        else if (id === 'extract') await extractAndUploadAudio(ctx)
        else if (id === 'transcribe') await transcribe(ctx)
        else if (id === 'thumbnails') await generateThumbnails(ctx)
        else if (id === 'clone') await cloneVoice()
        else await runDirector(ctx) // shorten + segment, one Gemini call
      } catch (e) {
        dispatch(failActiveStage(stageError(e)))
      } finally {
        stepInFlight = false
        setRunning(false)
      }
    },
    [
      currentStageId,
      dispatch,
      uploadClip,
      extractAndUploadAudio,
      transcribe,
      generateThumbnails,
      runDirector,
      cloneVoice,
    ],
  )

  // ---- Scene build loop -----------------------------------------------------

  const updateDraft = useCallback(
    (id: string, draftText: string) => {
      // Editing the text invalidates any previously generated voice.
      patchScene(id, { draftText, narrationSeconds: null, status: 'pending' })
    },
    [patchScene],
  )

  // Mock TTS: estimate narration length from the text. Real version calls
  // `/api/voice/say` with the cloned voice.
  const generateVoice = useCallback(
    async (id: string) => {
      setVoicingId(id)
      await delay(800)
      const scene = scenes.find((s) => s.id === id)
      if (scene) patchScene(id, { narrationSeconds: narrationSeconds(scene.draftText) })
      setVoicingId(null)
    },
    [scenes, patchScene],
  )

  const markBuilt = useCallback(
    (id: string) => {
      const next = scenes.map((s) =>
        s.id === id ? { ...s, status: 'built' as const } : s,
      )
      dispatch(setScenes(next))
      const stillPending = next.find((s) => s.status === 'pending')
      if (stillPending) dispatch(setSelected(stillPending.id))
    },
    [scenes, dispatch],
  )

  const select = useCallback((id: string | null) => dispatch(setSelected(id)), [dispatch])

  const allBuilt = useMemo(
    () => scenes.length > 0 && scenes.every((s) => s.status === 'built'),
    [scenes],
  )
  const ready = useMemo(() => stages.every((s) => s.status === 'done'), [stages])

  return {
    stages,
    scenes,
    sourceUrl,
    audioUrl,
    audioPeaks,
    contactSheets,
    words,
    synopsis,
    selectedId,
    voicingId,
    running,
    ready,
    allBuilt,
    currentStageId,
    next,
    reset,
    select,
    updateDraft,
    generateVoice,
    markBuilt,
  }
}
