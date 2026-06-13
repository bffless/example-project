import { useCallback, useEffect, useMemo, useState } from 'react'
import { STAGE_DEFS, type Stage, type StageId } from '../../lib/pipeline'
import { narrationSeconds, type Cut, type NarrationSegment, type Scene } from '../../lib/scenes'
import { timedTranscript, toScenes, type DirectorScene } from '../../lib/director'
import {
  toRefinement,
  refineDirections,
  sceneWordTimings,
  sceneTail,
  effectiveSegments,
  addCut,
  removeCut,
  clampDropStart,
  moveRun as moveRunSegments,
  insertSegment,
  removeSegment,
  suggestedOriginalIndices,
  applyOriginalClips,
  type RefineSceneRaw,
} from '../../lib/refiner'
import { extractAudio, extractAudioWav, sliceAudioWav, sliceManyAudioWav } from '../../lib/audio'
import { buildSliceCommand } from '../../lib/export/slice'
import { slice as ffmpegSlice } from '../../lib/export/ffmpeg'
import {
  captureFramesAt,
  captureContactSheet,
  captureSceneContactSheet,
  type ContactSheet,
} from '../../lib/frames'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  studioApi,
  useTranscribeMutation,
  useScenesMutation,
  useRefineSceneMutation,
  useNarrateMutation,
  useUploadMutation,
  useLazySignDownloadQuery,
  useVoiceCloneMutation,
  useVoiceSayMutation,
} from '../../store/studioApi'
import { presetLabel } from '../../lib/voices'
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
  setScenesJobId,
  setDirectorPromptJobId,
  setVoice,
  addSavedVoice,
  removeSavedVoice,
  setSelected,
  setFinalCutUrl,
  resetStudio,
  type TranscriptWord,
} from '../../store/studioSlice'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`

// Async fire-and-poll tuning (story 03f Part 0). The director/refiner jobs run
// off the response path now, so we poll a status endpoint until the row is done.
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 5 * 60 * 1000 // give up on a wedged job rather than poll forever

/**
 * Job ids currently being polled, shared across hook instances (same rationale as
 * `stepInFlight`). Both the live action AND the resume-on-mount effect can race to
 * poll the same job — and React StrictMode double-invokes effects in dev — so this
 * module-level guard ensures exactly one poll loop per job id.
 */
const pollsInFlight = new Set<string>()

/**
 * Measure an audio clip's real length by loading just its metadata — the TTS
 * pipeline doesn't report a duration, so we read it off the served file (works
 * for both bucket serve paths and the mock's data-URL tone). Resolves 0 on error.
 */
function measureAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio()
    audio.preload = 'metadata'
    const done = (v: number) => resolve(Number.isFinite(v) && v > 0 ? v : 0)
    audio.addEventListener('loadedmetadata', () => done(audio.duration))
    audio.addEventListener('error', () => done(0))
    audio.src = url
  })
}

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

/** What each step needs: the source file, its object URL, and its duration.
 *  (The director's free-text direction now comes from the persisted slice —
 *  story 03l — not the step context.) */
export type StepContext = { file: File; src: string; duration: number }

/**
 * Owns the one-time prep pipeline and the scene queue you build afterwards.
 *
 * Business state (stages, scenes, transcript, bucket serve URLs, contact sheets,
 * selection) lives in the persisted Redux `studio` slice, so a hard reload
 * resumes where you left off. Only transient UI flags (`running`)
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
  const direction = useAppSelector((s) => s.studio.direction)
  const directorPromptJobId = useAppSelector((s) => s.studio.directorPromptJobId)
  const scenesJobId = useAppSelector((s) => s.studio.scenesJobId)
  const duration = useAppSelector((s) => s.studio.duration)
  const voice = useAppSelector((s) => s.studio.voice)
  const savedVoices = useAppSelector((s) => s.studio.savedVoices)
  const selectedId = useAppSelector((s) => s.studio.selectedId)
  const finalCutUrl = useAppSelector((s) => s.studio.finalCutUrl)

  const [transcribeReq] = useTranscribeMutation()
  const [scenesReq] = useScenesMutation()
  const [refineSceneReq] = useRefineSceneMutation()
  const [narrateReq] = useNarrateMutation()
  const [uploadReq] = useUploadMutation()
  const [voiceCloneReq] = useVoiceCloneMutation()
  const [voiceSayReq] = useVoiceSayMutation()
  const [signReq] = useLazySignDownloadQuery()

  // The raw source (~hundreds of MB) must never stream through the file_serve
  // pipeline — it 504s/OOMs the backend. Every read of `sourceUrl` swaps it for
  // a time-limited direct bucket URL first (`preferCacheValue` reuses the cached
  // signature across sheet capture, slicing, and the preview within its 1 h life).
  const signedSourceUrl = useCallback(async () => {
    if (!sourceUrl) throw new Error('No source clip available.')
    const { url } = await signReq(sourceUrl, true).unwrap()
    return url
  }, [signReq, sourceUrl])

  // Transient UI state — not persisted.
  const [running, setRunning] = useState(false)
  // The export step (story 05): true while the assembled MP4 is uploading to the
  // bucket. The finished blob lives transiently in the AssembleBar (which also
  // owns the save error); only the saved serve URL (finalCutUrl) is persisted.
  const [savingFinalCut, setSavingFinalCut] = useState(false)
  // The scene whose assembled cut is currently uploading to the bucket (story 03g
  // phase 2 — per-scene assemble & save). Transient.
  const [savingSceneCutId, setSavingSceneCutId] = useState<string | null>(null)
  // Per-scene refiner (story 03c) busy flags + last error. Transient: the scene
  // being captured-for, the scene being refined, and any error from either.
  const [sheetingId, setSheetingId] = useState<string | null>(null)
  const [refiningId, setRefiningId] = useState<string | null>(null)
  // The scene currently slicing+uploading an original-audio clip (story 03d).
  const [adoptingId, setAdoptingId] = useState<string | null>(null)
  // The scene currently being cut into its own video clip (story 03g). Transient.
  const [slicingId, setSlicingId] = useState<string | null>(null)
  // Which segment is currently being voiced (AI or record-upload), as
  // `${sceneId}:${segmentIndex}` — so only that one row shows a spinner.
  const [voicingSegKey, setVoicingSegKey] = useState<string | null>(null)
  const [sceneError, setSceneError] = useState<string | null>(null)
  // The clone prep step's two busy flags: cloning a recording, and synthesizing
  // the post-selection preview sample. Transient — fine to lose on reload.
  const [cloning, setCloning] = useState(false)
  const [samplingVoice, setSamplingVoice] = useState(false)
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

  // ---- Async fire-and-poll (story 03f Part 0) -------------------------------

  /**
   * Poll a studio job until it reaches a terminal status. The director/refiner
   * Replicate calls run off the response path now (in the pipeline's postSteps),
   * so the start endpoint just hands back a job id and we poll `getStudioJob`
   * here: `done` → return the `result` blob; `error` → throw the job's message;
   * otherwise sleep and re-poll, giving up after `POLL_TIMEOUT_MS` so a wedged
   * job surfaces as an error instead of polling forever. Each poll uses
   * `initiate(..., { forceRefetch: true, subscribe: false })` so it always hits
   * the network (never a stale cached `pending`) and leaves no cache subscription.
   */
  const pollJob = useCallback(
    async (jobId: string): Promise<{ kind: 'scenes' | 'refine'; result: unknown }> => {
      const deadline = Date.now() + POLL_TIMEOUT_MS
      for (;;) {
        const job = await dispatch(
          studioApi.endpoints.getStudioJob.initiate(jobId, { forceRefetch: true, subscribe: false }),
        ).unwrap()
        if (job.status === 'done') return { kind: job.kind, result: job.result ?? null }
        if (job.status === 'error') throw new Error(job.error || 'The job failed.')
        if (Date.now() > deadline) throw new Error('Timed out waiting for the job to finish.')
        await delay(POLL_INTERVAL_MS)
      }
    },
    [dispatch],
  )

  /**
   * Voice a list of spans with the clip's OWN audio (story 03j): decode the
   * whole-clip WAV once, slice every span from the same PCM, then upload the
   * slices SEQUENTIALLY (parallel registers reset the dev proxy's keep-alive
   * sockets — same lesson as the contact-sheet uploads). One entry per span:
   * the uploaded clip + its measured length, or null if that span failed (the
   * caller leaves that segment unvoiced).
   */
  const sliceAndUploadSpans = useCallback(
    async (
      spans: { start: number; end: number }[],
    ): Promise<({ url: string; seconds: number } | null)[]> => {
      if (!audioUrl) throw new Error('No extracted audio to slice from.')
      const blobs = await sliceManyAudioWav(audioUrl, spans)
      const out: ({ url: string; seconds: number } | null)[] = []
      for (let i = 0; i < blobs.length; i++) {
        try {
          const { start, end } = spans[i]
          const file = new File(
            [blobs[i]],
            `original-${Math.round(start)}-${Math.round(end)}.wav`,
            { type: 'audio/wav' },
          )
          const { url } = await uploadReq({ file, kind: 'voice' }).unwrap()
          const measured = await measureAudioDuration(url)
          out.push({ url, seconds: measured > 0 ? measured : end - start })
        } catch {
          out.push(null)
        }
      }
      return out
    },
    [audioUrl, uploadReq],
  )

  /**
   * Drive a master-director job to completion, then commit it — shared by the
   * live action (`runDirector`) and resume-on-reload. `videoSrc` is the in-memory
   * object URL when we have it (live) or the persisted source serve URL (resume);
   * the per-scene card thumbs are captured off it best-effort, so a cold reload
   * with no seekable source still commits the scenes (just without card art).
   * The `pollsInFlight` guard makes the live path and the resume effect idempotent.
   */
  const completeDirectorJob = useCallback(
    async (jobId: string, videoSrc: string | null, clipDuration: number) => {
      if (pollsInFlight.has(jobId)) return
      pollsInFlight.add(jobId)
      setRunning(true)
      patch('director', { status: 'active' })
      try {
        const { result } = await pollJob(jobId)
        const data = (result ?? {}) as { synopsis?: string; scenes?: DirectorScene[] }
        const built = toScenes(data.scenes ?? [], clipDuration)
        dispatch(setSynopsis(data.synopsis ?? null))

        // Scene-card art: capture one midpoint frame per scene if we can seek the
        // source; never let a failed/absent source fail the whole job.
        let thumbs: string[] = []
        if (videoSrc) {
          try {
            thumbs = await captureFramesAt(videoSrc, built.map((s) => (s.start + s.end) / 2), 64)
          } catch {
            thumbs = []
          }
        }
        const withThumbs = built.map((s, i) => ({ ...s, thumb: thumbs[i] }))
        dispatch(setScenes(withThumbs))
        dispatch(setSelected(withThumbs[0]?.id ?? null))

        const cutCount = withThumbs.reduce((n, s) => n + (s.cuts?.length ?? 0), 0)
        patch('director', {
          status: 'done',
          detail: `${withThumbs.length} scene${withThumbs.length === 1 ? '' : 's'} · ${cutCount} cut${cutCount === 1 ? '' : 's'} · script tightened`,
        })
        // Remember the job row so the prompt disclosure can fetch what was sent
        // to Gemini (story 03m). Separate from the in-flight id cleared below.
        dispatch(setDirectorPromptJobId(jobId))
        dispatch(setScenesJobId(null))
      } catch (e) {
        // Terminal: drop the persisted job id (so we don't resume a dead job) and
        // surface the failure on the director stage's existing error UI.
        dispatch(setScenesJobId(null))
        patch('director', { status: 'error', detail: stageError(e) })
      } finally {
        pollsInFlight.delete(jobId)
        setRunning(false)
      }
    },
    [pollJob, dispatch, patch],
  )

  /**
   * Drive a per-scene refiner job to completion and write it into `scene.refined`
   * (non-destructive). Shared by the live `refineScene` and resume-on-reload;
   * `pollsInFlight` keeps the two from double-polling one job. Clears the scene's
   * `refineJobId` on any terminal status.
   *
   * Auto-adopt (story 03j): segments the refiner tagged `original` (and the
   * verbatim guard upheld) are voiced from the clip's own audio BEFORE the
   * refinement is committed — one decode, sequential uploads, per-segment
   * failures non-fatal (each keeps its one-click "Use original" chip).
   * Committing ONCE, after the audio work, means no second patch racing the
   * producer's hand-edits.
   */
  const completeRefineJob = useCallback(
    async (sceneId: string, jobId: string) => {
      if (pollsInFlight.has(jobId)) return
      pollsInFlight.add(jobId)
      setRefiningId(sceneId)
      setSceneError(null)
      try {
        const { result } = await pollJob(jobId)
        const scene = scenes.find((s) => s.id === sceneId)
        if (!scene) {
          patchScene(sceneId, { refineJobId: null })
          return
        }
        const refinement = toRefinement(result as RefineSceneRaw, scene)

        const idx = suggestedOriginalIndices(refinement.segments)
        let segments = refinement.segments
        let failed = 0
        if (idx.length) {
          let clips: ({ url: string; seconds: number } | null)[] = idx.map(() => null)
          try {
            clips = await sliceAndUploadSpans(
              idx.map((i) => ({ start: segments[i].start, end: segments[i].end })),
            )
          } catch {
            // No extracted audio / decode failed — every tagged segment falls
            // back to its chip.
          }
          ;({ segments, failed } = applyOriginalClips(segments, idx, clips))
        }
        const total = segments.reduce((n, s) => n + (s.audioSeconds ?? 0), 0)
        patchScene(sceneId, {
          refined: { ...refinement, segments },
          refineJobId: null,
          promptJobId: jobId,
          // null (not stale) when the new refinement has no voiced audio yet.
          narrationSeconds: total > 0 ? total : null,
        })
        if (failed > 0) {
          setSceneError(
            `Couldn't reuse the original audio for ${failed} segment${failed === 1 ? '' : 's'} — use the run's "Use original" button to retry.`,
          )
        }
      } catch (e) {
        setSceneError(stageError(e))
        patchScene(sceneId, { refineJobId: null })
      } finally {
        pollsInFlight.delete(jobId)
        setRefiningId(null)
      }
    },
    [pollJob, scenes, patchScene, sliceAndUploadSpans],
  )

  // Resume any in-flight job after a hard reload (redux-persist brings back the
  // persisted job ids). The `pollsInFlight` guard inside the `complete*` helpers
  // makes this safe to re-run and safe to race with a live action — only one poll
  // loop runs per job id. Cold reloads have no in-memory clip, so the director
  // resume captures thumbs off the persisted source serve URL.
  useEffect(() => {
    // Kick the resume off in a microtask: the `complete*` helpers flip transient
    // spinner state synchronously (fine in the live event-handler path), so we
    // defer them out of the effect body to avoid a synchronous setState-in-effect.
    queueMicrotask(() => {
      if (scenesJobId) void completeDirectorJob(scenesJobId, sourceUrl, duration)
      for (const scene of scenes) {
        if (scene.refineJobId) void completeRefineJob(scene.id, scene.refineJobId)
      }
    })
  }, [scenesJobId, sourceUrl, duration, scenes, completeDirectorJob, completeRefineJob])

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
  // optional direction, and returns the synopsis + scenes (per-scene refine
  // prompt, original-video span, and cut spans). Marks BOTH the shorten and segment
  // notes done (one call does both), then captures a midpoint thumb per scene
  // for the scene-card art. Replaces the old mocked `buildScenes`.
  const runDirector = useCallback(
    async ({ src, duration: clipDuration }: StepContext) => {
      patch('director', { status: 'active' })
      const transcript = timedTranscript(words)
      const sheetUrls = persistedSheets.map((s) => s.url).filter((u): u is string => !!u)
      // Enqueue-only: the start endpoint records a job and returns its id; the
      // Gemini call runs in the pipeline's postSteps (story 03f Part 0). Persist
      // the id so a hard reload resumes polling, then drive it to completion.
      const { jobId } = await scenesReq({
        transcript,
        sheetUrls,
        direction,
        duration: clipDuration,
      }).unwrap()
      dispatch(setScenesJobId(jobId))
      await completeDirectorJob(jobId, src, clipDuration)
    },
    [patch, dispatch, words, persistedSheets, direction, scenesReq, completeDirectorJob],
  )

  // Re-run the master director after it's already done (story 03m). `next()`
  // runs the CURRENT stage — wrong here, it would run clone — so this drives the
  // director step directly. The UI confirm has already happened by now; the
  // scene queue is replaced wholesale by `completeDirectorJob` (which also
  // resets the selection). Same enqueue+poll as a first run, so `scenesJobId`
  // persists and a mid-redo reload resumes polling.
  const rerunDirector = useCallback(
    async (ctx: StepContext) => {
      try {
        await runDirector(ctx)
      } catch (e) {
        patch('director', { status: 'error', detail: stageError(e) })
      }
    },
    [runDirector, patch],
  )

  // Stage ⑥ — the voice step (story 04). Not run through `next()`: it's owned by
  // the VoiceStudio resource at the bottom of prep, which calls one of these two
  // actions. Either produces the one durable `voice` (cloned or preset) that
  // Build re-voices each scene with.

  // Clone path: upload the recorded sample, then mint a voice id. The real $3
  // `minimax/voice-cloning` call is DISABLED server-side — the pipeline returns a
  // real preset id as a stub, so the recording is uploaded but the clone itself
  // costs nothing for now. The returned id still drives the live TTS preview.
  const cloneFromRecording = useCallback(
    async (blob: Blob) => {
      if (cloning) return
      setCloning(true)
      patch('clone', { status: 'active' })
      try {
        // MediaRecorder gives us webm/opus (Chrome) or mp4 (Safari), but MiniMax
        // voice-cloning only accepts mp3/m4a/wav. Decode the take and re-encode it
        // to a 24 kHz mono WAV before upload so the clone never rejects the format
        // (reuses the same WebAudio path as audio extraction).
        const recorded = new File([blob], 'voice-sample', { type: blob.type || 'audio/webm' })
        const wav = await extractAudioWav(recorded, 24000)
        const file = new File([wav], 'voice-sample.wav', { type: 'audio/wav' })
        const { url: sampleUrl } = await uploadReq({ file, kind: 'voice' }).unwrap()
        const { voiceId } = await voiceCloneReq({ sampleUrl }).unwrap()
        const label = 'Your cloned voice'
        dispatch(setVoice({ voiceId, source: 'clone', label, sampleUrl }))
        // Remember the id so it's reusable next session without re-paying the $3.
        dispatch(addSavedVoice({ voiceId, label }))
        patch('clone', { status: 'done', detail: `cloned voice ready · ${voiceId}` })
      } catch (e) {
        patch('clone', { status: 'error', detail: stageError(e) })
      } finally {
        setCloning(false)
      }
    },
    [cloning, patch, dispatch, uploadReq, voiceCloneReq],
  )

  // Preset path: no recording, no upload, no cost — just store the picked id.
  const pickPresetVoice = useCallback(
    (voiceId: string) => {
      const label = presetLabel(voiceId)
      dispatch(setVoice({ voiceId, source: 'preset', label }))
      patch('clone', { status: 'done', detail: `preset · ${label}` })
    },
    [dispatch, patch],
  )

  // Reuse a previously-cloned voice id (pasted or picked from the saved list) —
  // no clone call, no $3. MiniMax keeps cloned voices server-side by id.
  const reuseVoiceId = useCallback(
    (rawId: string, rawLabel?: string) => {
      const voiceId = rawId.trim()
      if (!voiceId) return
      const label = (rawLabel ?? '').trim() || voiceId
      dispatch(setVoice({ voiceId, source: 'saved', label }))
      dispatch(addSavedVoice({ voiceId, label }))
      patch('clone', { status: 'done', detail: `saved voice · ${voiceId}` })
    },
    [dispatch, patch],
  )

  const forgetVoice = useCallback(
    (voiceId: string) => dispatch(removeSavedVoice(voiceId)),
    [dispatch],
  )

  // Re-do the voice step: clear the choice and reset the stage to pending.
  const clearVoice = useCallback(() => {
    dispatch(setVoice(null))
    patch('clone', { status: 'pending', detail: undefined })
  }, [dispatch, patch])

  // Preview: speak a short canned line in the chosen voice so the producer can
  // hear it (live, cheap TTS). Returns the audio URL for the resource to play.
  const generateSample = useCallback(async (): Promise<string | null> => {
    if (!voice || samplingVoice) return null
    setSamplingVoice(true)
    try {
      const text =
        'Here is a quick sample of how your narration will sound across the scenes.'
      const { audioUrl } = await voiceSayReq({ text, voiceId: voice.voiceId }).unwrap()
      return audioUrl
    } finally {
      setSamplingVoice(false)
    }
  }, [voice, samplingVoice, voiceSayReq])

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
        else if (id === 'director') await runDirector(ctx) // shorten + segment, one Gemini call
        // 'clone' isn't run here — the VoiceStudio resource owns it (record/clone
        // or pick a preset), so reaching it via the board is a no-op.
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
    ],
  )

  // ---- Per-scene refiner (story 03c) ----------------------------------------

  // Button 1: capture DENSE contact sheets for just this scene's window and
  // upload them (url-only persisted, like the prep sheets). Captures off the
  // persisted source serve URL so it works after a reload without the in-memory
  // clip. Separate from the whole-clip prep sheets.
  const generateSceneSheets = useCallback(
    async (id: string, file: File | null) => {
      if (sheetingId || refiningId) return
      const scene = scenes.find((s) => s.id === id)
      if (!scene || !sourceUrl) return
      setSheetingId(id)
      setSceneError(null)
      // Capture frames off a SAME-ORIGIN blob: URL, never the cross-origin signed
      // bucket URL directly. A `<video crossOrigin>` media read against the GCS
      // object fails CORS (the element's range/preflight isn't satisfied even
      // though GET from this origin is allowed), whereas a plain `fetch` of the
      // bytes is fine. Prefer the in-memory upload (no refetch); after a hard
      // reload there's no `file`, so pull the source bytes back through the signed
      // URL — the same fetch `sliceScene`'s fallback uses — and wrap them in a
      // blob URL so capture stays same-origin either way.
      let objectUrl: string | null = null
      try {
        const source = file ?? (await (await fetch(await signedSourceUrl())).blob())
        objectUrl = URL.createObjectURL(source)
        const sheets = await captureSceneContactSheet(objectUrl, scene.start, scene.end)
        const uploaded: ContactSheet[] = []
        for (const sheet of sheets) {
          const blob = await (await fetch(sheet.dataUrl)).blob()
          const ext = blob.type === 'image/png' ? 'png' : 'jpg'
          const name = `scene-${scene.index + 1}-sheet-${String(sheet.index + 1).padStart(2, '0')}.${ext}`
          const sheetFile = new File([blob], name, { type: blob.type })
          const { url } = await uploadReq({ file: sheetFile, kind: 'thumbnails' }).unwrap()
          // Persist URL-only — drop the base64 blob so localStorage stays small.
          uploaded.push({ ...sheet, url, dataUrl: '' })
        }
        patchScene(id, { sheets: uploaded })
      } catch (e) {
        setSceneError(stageError(e))
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        setSheetingId(null)
      }
    },
    [sheetingId, refiningId, scenes, sourceUrl, signedSourceUrl, uploadReq, patchScene],
  )

  // Button 2: hand the scene's word timings + the director's refinePrompt +
  // the dense sheets to /api/refine-scene, store the result in
  // `scene.refined` (NON-destructive — the director's baseline cuts are untouched).
  const refineScene = useCallback(
    async (id: string) => {
      if (sheetingId || refiningId) return
      const scene = scenes.find((s) => s.id === id)
      if (!scene) return
      setRefiningId(id)
      setSceneError(null)
      try {
        // Belt-and-braces with the SceneRefinePanel gate (story 03k): the refiner
        // is required to listen, so refining an un-cut scene is an error, not a
        // silent fall-back to the old deaf behavior.
        if (!scene.clipAudioUrl) throw new Error('Cut this scene first — the refiner needs its audio.')
        const scoped = words.filter((w) => w.start >= scene.start && w.start < scene.end)
        const sheetUrls = (scene.sheets ?? []).map((s) => s.url).filter((u): u is string => !!u)
        // Seam-aware context (story 03r): hand the refiner the tail of the
        // PREVIOUS scene's effective narration so this scene opens in flow with
        // it, instead of being written blind. Snapshot at refine time — re-refine
        // a neighbor and this goes stale until you re-refine here.
        const sceneIndex = scenes.findIndex((s) => s.id === id)
        const prevScene = sceneIndex > 0 ? scenes[sceneIndex - 1] : null
        // Enqueue-only (story 03f Part 0): returns a job id; the Gemini refine runs
        // in the pipeline's postSteps. Persist the id on the scene so a reload
        // resumes polling, then drive it to completion (writes `scene.refined`).
        const { jobId } = await refineSceneReq({
          start: scene.start,
          end: scene.end,
          wordTimings: sceneWordTimings(scoped),
          sheetUrls,
          audioUrl: scene.clipAudioUrl,
          // Creator steering (story 03l): the scene's own prompt + the global
          // director prompt (subject to the scene's include-checkbox).
          ...refineDirections(scene, direction),
          // Where this scene sits in the arc + the prior scene's lead-in (03r).
          sceneNumber: sceneIndex + 1,
          sceneCount: scenes.length,
          previousContext: prevScene ? sceneTail(prevScene) : '',
        }).unwrap()
        patchScene(id, { refineJobId: jobId })
        await completeRefineJob(id, jobId)
      } catch (e) {
        setSceneError(stageError(e))
        setRefiningId(null)
      }
    },
    [sheetingId, refiningId, scenes, words, direction, refineSceneReq, patchScene, completeRefineJob],
  )

  // Creator steering for the refine call (story 03l). Both are INPUT-layer scene
  // fields — they survive revert (`clearRefinement` never touches them) and seed
  // the next re-refine.
  const setRefinePrompt = useCallback(
    (sceneId: string, text: string) => patchScene(sceneId, { refinePrompt: text }),
    [patchScene],
  )
  const setIncludeDirection = useCallback(
    (sceneId: string, on: boolean) => patchScene(sceneId, { includeDirection: on }),
    [patchScene],
  )

  // Hand-edit a scene's cuts directly on the diff grid (story 03d). `add` paints
  // a new/extended cut over the span; `remove` contracts/splits an existing one.
  // Materializes `refined` from the director baseline on the first edit (same
  // merge as `setSegmentAudio`), tags it `manual`, and NEVER touches `scene.cuts`
  // — so `clearRefinement` still reverts to the AI's first pass cleanly.
  const editSceneCut = useCallback(
    (sceneId: string, span: Cut, op: 'add' | 'remove') => {
      const scene = scenes.find((s) => s.id === sceneId)
      if (!scene) return
      const base =
        scene.refined ?? { segments: effectiveSegments(scene), cuts: scene.cuts ?? [], source: 'ai' as const }
      const cuts = op === 'add' ? addCut(base.cuts, span, scene) : removeCut(base.cuts, span)
      patchScene(sceneId, { refined: { ...base, cuts, source: 'manual' } })
    },
    [scenes, patchScene],
  )

  // Adopt a span of the source clip's ORIGINAL audio as a New-pane run (story
  // 03d): slice `[origStart, origEnd]` out of the whole-clip audio, upload it as
  // a real clip, and drop it into the scene at `dropStart`. Since story 03h the
  // drop lands ANYWHERE in the scene (clamped so it never passes `scene.end`) —
  // overlap with existing runs is a legal, flagged state the producer resolves
  // by moving a run. Writes `scene.refined` (`source: 'manual'`), never the
  // director baseline.
  const adoptOriginalAudio = useCallback(
    async (sceneId: string, origStart: number, origEnd: number, dropStart: number) => {
      if (adoptingId) return
      const scene = scenes.find((s) => s.id === sceneId)
      if (!scene || !audioUrl) return
      const duration = origEnd - origStart
      const segs = effectiveSegments(scene)
      setAdoptingId(sceneId)
      setSceneError(null)
      try {
        const wav = await sliceAudioWav(audioUrl, origStart, origEnd)
        const file = new File([wav], `original-${Math.round(origStart)}-${Math.round(origEnd)}.wav`, {
          type: 'audio/wav',
        })
        const { url } = await uploadReq({ file, kind: 'voice' }).unwrap()
        const measured = await measureAudioDuration(url)
        const len = measured > 0 ? measured : duration
        const start = clampDropStart(scene, dropStart, len)
        const text = words
          .filter((w) => w.start >= origStart && w.start < origEnd)
          .map((w) => w.text)
          .join(' ')
        const seg: NarrationSegment = {
          text,
          start,
          end: start + len,
          audioUrl: url,
          audioSeconds: len,
          audioSource: 'original',
        }
        const base =
          scene.refined ?? { segments: segs, cuts: scene.cuts ?? [], source: 'ai' as const }
        const segments = insertSegment(base.segments, seg)
        // Keeping original audio here contradicts a cut over the same span — so
        // un-cut it, otherwise the run would render red (cut wins over voiced).
        const cuts = removeCut(base.cuts, { start: seg.start, end: seg.end })
        const total = segments.reduce((n, s) => n + (s.audioSeconds ?? 0), 0)
        patchScene(sceneId, {
          refined: { ...base, segments, cuts, source: 'manual' },
          narrationSeconds: total,
        })
      } catch (e) {
        setSceneError(stageError(e))
      } finally {
        setAdoptingId(null)
      }
    },
    [adoptingId, scenes, audioUrl, words, uploadReq, patchScene],
  )

  // Cut this scene into its own video clip + soundtrack (story 03g + 03k, build
  // step 0). The raw source is the immutable source of truth — every scene
  // re-reads it: prefer the in-memory `file` (no refetch), else pull the persisted
  // source serve URL back. We trim `[start, end]` frame-accurately in ffmpeg.wasm
  // and slice the same span from the talk WAV, upload both (kind `scene-clip` /
  // `audio`, SEQUENTIALLY — the keep-alive 502 lesson), and persist both serve
  // paths in ONE patch, so the scene gets both resources or neither and a reload
  // resumes with the cut done. Re-cutting overwrites both.
  const sliceScene = useCallback(
    async (sceneId: string, file: File | null) => {
      if (slicingId) return
      const scene = scenes.find((s) => s.id === sceneId)
      if (!scene) return
      setSlicingId(sceneId)
      setSceneError(null)
      try {
        if (!audioUrl) throw new Error('No extracted audio to cut the scene soundtrack from.')
        const source = file
          ? new Uint8Array(await file.arrayBuffer())
          : sourceUrl
            ? // Direct bucket read — no `credentials`, it's a presigned URL, and
              // sending cookies cross-origin would fail the CORS check.
              new Uint8Array(await (await fetch(await signedSourceUrl())).arrayBuffer())
            : null
        if (!source) throw new Error('No source clip available to cut from.')

        const command = buildSliceCommand({
          start: scene.start,
          end: scene.end,
          output: `scene-${scene.index}.mp4`,
        })
        const blob = await ffmpegSlice({ source, command })
        const clip = new File([blob], `scene-${scene.index}.mp4`, { type: 'video/mp4' })
        const { url } = await uploadReq({ file: clip, kind: 'scene-clip' }).unwrap()
        const wav = await sliceAudioWav(audioUrl, scene.start, scene.end)
        const audioFile = new File([wav], `scene-${scene.index}-audio.wav`, { type: 'audio/wav' })
        const { url: clipAudioUrl } = await uploadReq({ file: audioFile, kind: 'audio' }).unwrap()
        patchScene(sceneId, { clipUrl: url, clipAudioUrl })
      } catch (e) {
        setSceneError(stageError(e))
      } finally {
        setSlicingId(null)
      }
    },
    [slicingId, scenes, audioUrl, sourceUrl, signedSourceUrl, uploadReq, patchScene],
  )

  // Delete one New-pane run, reopening its gap (story 03d) — e.g. to clear room
  // for an original-audio clip. Materializes `refined` from the baseline so it's
  // revertible, recomputes the scene's narration length, tags it `manual`.
  const deleteSegment = useCallback(
    (sceneId: string, segIndex: number) => {
      const scene = scenes.find((s) => s.id === sceneId)
      if (!scene) return
      const base =
        scene.refined ?? { segments: effectiveSegments(scene), cuts: scene.cuts ?? [], source: 'ai' as const }
      const segments = removeSegment(base.segments, segIndex)
      const total = segments.reduce((n, s) => n + (s.audioSeconds ?? 0), 0)
      patchScene(sceneId, { refined: { ...base, segments, source: 'manual' }, narrationSeconds: total })
    },
    [scenes, patchScene],
  )

  // Re-time one New-pane run (story 03h): drag its voice-control row to a new
  // start, keeping its duration — clamped so its end never passes the scene.
  // Materializes `refined` from the baseline like the other hand-edits, tags it
  // `manual`. The expected way to resolve a flagged overlap.
  const moveRun = useCallback(
    (sceneId: string, segIndex: number, newStart: number) => {
      const scene = scenes.find((s) => s.id === sceneId)
      if (!scene) return
      const base =
        scene.refined ?? { segments: effectiveSegments(scene), cuts: scene.cuts ?? [], source: 'ai' as const }
      const run = base.segments[segIndex]
      if (!run) return
      const segments = moveRunSegments(base.segments, segIndex, newStart, scene)
      // Landing a run on cut footage means you want that footage kept — un-cut
      // beneath its new span (same contradiction rule as adopt), otherwise the
      // moved run renders red and you'd have to hand-un-cut it. Dropping a run
      // you don't want is what delete (✕) is for. The clamp here mirrors the one
      // inside moveRunSegments so the un-cut span is exactly where it landed.
      const duration = run.end - run.start
      const start = clampDropStart(scene, newStart, duration)
      const cuts = removeCut(base.cuts, { start, end: start + duration })
      const total = segments.reduce((n, s) => n + (s.audioSeconds ?? 0), 0)
      patchScene(sceneId, { refined: { ...base, segments, cuts, source: 'manual' }, narrationSeconds: total })
    },
    [scenes, patchScene],
  )

  // Throw out the refinement and revert to the director's first pass.
  const clearRefinement = useCallback(
    (id: string) => {
      setSceneError(null)
      patchScene(id, { refined: null, narrationSeconds: null, promptJobId: undefined })
    },
    [patchScene],
  )

  // Write one segment's audio back into `scene.refined` (creating a refinement
  // from the baseline if the scene wasn't refined yet), and recompute the scene's
  // total narration length from the voiced segments. Shared by AI + record.
  // The run's `end` snaps to the measured clip length so the footprint shows
  // what will actually play (not the refiner anchor / word-count estimate).
  const setSegmentAudio = useCallback(
    (sceneId: string, segIndex: number, audio: Partial<NarrationSegment>) => {
      const scene = scenes.find((s) => s.id === sceneId)
      if (!scene) return
      const base =
        scene.refined ?? { segments: effectiveSegments(scene), cuts: scene.cuts ?? [], source: 'ai' as const }
      const segments = base.segments.map((seg, i) =>
        i === segIndex
          ? {
              ...seg,
              ...audio,
              ...(audio.audioSeconds != null && audio.audioSeconds > 0
                ? { end: seg.start + audio.audioSeconds }
                : {}),
            }
          : seg,
      )
      const total = segments.reduce((n, s) => n + (s.audioSeconds ?? 0), 0)
      patchScene(sceneId, { refined: { ...base, segments }, narrationSeconds: total })
    },
    [scenes, patchScene],
  )

  // Add a hand-typed narration run (the "typed snippet" spec): an unvoiced
  // segment sized by the word-count estimate, dropped anywhere in the scene and
  // voiced later via its Record / AI controls. Same non-destructive layering as
  // adopt-original; cuts are untouched (no audio contradicts a cut).
  const addSnippet = useCallback(
    (sceneId: string, text: string, dropStart: number) => {
      const scene = scenes.find((s) => s.id === sceneId)
      const trimmed = text.trim()
      if (!scene || !trimmed) return
      const len = narrationSeconds(trimmed)
      const start = clampDropStart(scene, dropStart, len)
      const base =
        scene.refined ?? { segments: effectiveSegments(scene), cuts: scene.cuts ?? [], source: 'ai' as const }
      const segments = insertSegment(base.segments, { text: trimmed, start, end: start + len })
      patchScene(sceneId, { refined: { ...base, segments, source: 'manual' } })
    },
    [scenes, patchScene],
  )

  // Voice ONE segment with the saved voice via the persisted-TTS pipeline. The
  // robot/AI option, now per-segment (not the whole scene at once).
  const generateSegmentNarration = useCallback(
    async (sceneId: string, segIndex: number) => {
      if (voicingSegKey || !voice) return
      const scene = scenes.find((s) => s.id === sceneId)
      const seg = scene && effectiveSegments(scene)[segIndex]
      if (!seg) return
      setVoicingSegKey(`${sceneId}:${segIndex}`)
      setSceneError(null)
      try {
        const { audioUrl } = await narrateReq({ text: seg.text, voiceId: voice.voiceId }).unwrap()
        const audioSeconds = await measureAudioDuration(audioUrl)
        setSegmentAudio(sceneId, segIndex, { audioUrl, audioSeconds, audioSource: 'ai' })
      } catch (e) {
        setSceneError(stageError(e))
      } finally {
        setVoicingSegKey(null)
      }
    },
    [voicingSegKey, voice, scenes, narrateReq, setSegmentAudio],
  )

  // Voice ONE segment with the user's OWN recording: re-encode the take to WAV,
  // upload it (reusing the voice/ bucket), measure it, store it on the segment.
  // This is the "record it myself, it's actually me" path.
  const recordSegmentNarration = useCallback(
    async (sceneId: string, segIndex: number, blob: Blob) => {
      if (voicingSegKey) return
      setVoicingSegKey(`${sceneId}:${segIndex}`)
      setSceneError(null)
      try {
        const recorded = new File([blob], 'segment', { type: blob.type || 'audio/webm' })
        const wav = await extractAudioWav(recorded, 24000)
        const file = new File([wav], `segment-${segIndex + 1}.wav`, { type: 'audio/wav' })
        const { url } = await uploadReq({ file, kind: 'voice' }).unwrap()
        const audioSeconds = await measureAudioDuration(url)
        setSegmentAudio(sceneId, segIndex, { audioUrl: url, audioSeconds, audioSource: 'recorded' })
      } catch (e) {
        setSceneError(stageError(e))
      } finally {
        setVoicingSegKey(null)
      }
    },
    [voicingSegKey, uploadReq, setSegmentAudio],
  )

  // One-click "Use original" (story 03j): voice THIS run with the slice of the
  // clip's own audio under its span — the manual completion of an AI 'original'
  // suggestion auto-adopt couldn't finish (or whose audio was later cleared).
  // Same per-segment busy key as the other voicing actions.
  const adoptSegmentOriginal = useCallback(
    async (sceneId: string, segIndex: number) => {
      if (voicingSegKey) return
      const scene = scenes.find((s) => s.id === sceneId)
      const seg = scene && effectiveSegments(scene)[segIndex]
      if (!seg) return
      setVoicingSegKey(`${sceneId}:${segIndex}`)
      setSceneError(null)
      try {
        const [clip] = await sliceAndUploadSpans([{ start: seg.start, end: seg.end }])
        if (!clip) throw new Error("Couldn't slice the original audio for this run.")
        setSegmentAudio(sceneId, segIndex, {
          audioUrl: clip.url,
          audioSeconds: clip.seconds,
          audioSource: 'original',
        })
      } catch (e) {
        setSceneError(stageError(e))
      } finally {
        setVoicingSegKey(null)
      }
    },
    [voicingSegKey, scenes, sliceAndUploadSpans, setSegmentAudio],
  )

  // ---- Scene build loop -----------------------------------------------------

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

  // Flip a scene's built flag both ways — the producer's own "this one's good to
  // go" tracker. Marking built auto-advances to the next pending scene (so you
  // walk the queue); un-marking just sets it back to pending, no jump. Independent
  // of voicing or assembling — purely a status the export readiness reads.
  const toggleBuilt = useCallback(
    (id: string) => {
      const scene = scenes.find((s) => s.id === id)
      if (!scene) return
      if (scene.status === 'built') {
        patchScene(id, { status: 'pending' })
      } else {
        markBuilt(id)
      }
    },
    [scenes, patchScene, markBuilt],
  )

  const select = useCallback((id: string | null) => dispatch(setSelected(id)), [dispatch])

  // ---- Export: save the assembled cut (story 05) ----------------------------

  // Persist the assembled MP4 the same way every other resource is saved: upload
  // the blob to the bucket via the presigned `export` flow, then keep only the
  // returned serve URL in Redux (persisted to localStorage) so a hard reload
  // brings the cut back. Re-saving a freshly re-assembled blob OVERWRITES the URL
  // — the producer can refine, re-assemble, and save again. The heavy blob never
  // touches Redux; "Download" stays separate (a local file, not a saved artifact).
  const saveFinalCut = useCallback(
    async (blob: Blob): Promise<string> => {
      setSavingFinalCut(true)
      try {
        const file = new File([blob], 'studio-final-cut.mp4', { type: blob.type || 'video/mp4' })
        const { url } = await uploadReq({ file, kind: 'export' }).unwrap()
        dispatch(setFinalCutUrl(url))
        return url
      } finally {
        setSavingFinalCut(false)
      }
    },
    [uploadReq, dispatch],
  )

  // Save one scene's assembled cut (story 03g phase 2). Uploads the rendered scene
  // MP4 (reusing the `export` presigned flow) and persists its serve path on the
  // scene as `assembledUrl`, so a reload keeps it and the final master concat can
  // stitch every scene's saved cut. Re-assembling + saving overwrites it.
  const saveSceneCut = useCallback(
    async (sceneId: string, blob: Blob): Promise<string> => {
      setSavingSceneCutId(sceneId)
      try {
        const file = new File([blob], `scene-${sceneId}.mp4`, { type: blob.type || 'video/mp4' })
        const { url } = await uploadReq({ file, kind: 'export' }).unwrap()
        patchScene(sceneId, { assembledUrl: url })
        return url
      } finally {
        setSavingSceneCutId(null)
      }
    },
    [uploadReq, patchScene],
  )

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
    voice,
    savedVoices,
    selectedId,
    finalCutUrl,
    savingFinalCut,
    savingSceneCutId,
    running,
    cloning,
    samplingVoice,
    sheetingId,
    refiningId,
    adoptingId,
    slicingId,
    voicingSegKey,
    sceneError,
    ready,
    allBuilt,
    currentStageId,
    next,
    reset,
    select,
    saveFinalCut,
    saveSceneCut,
    generateSceneSheets,
    refineScene,
    direction,
    setRefinePrompt,
    setIncludeDirection,
    directorPromptJobId,
    rerunDirector,
    editSceneCut,
    adoptOriginalAudio,
    adoptSegmentOriginal,
    addSnippet,
    sliceScene,
    deleteSegment,
    moveRun,
    clearRefinement,
    generateSegmentNarration,
    recordSegmentNarration,
    cloneFromRecording,
    pickPresetVoice,
    reuseVoiceId,
    forgetVoice,
    clearVoice,
    generateSample,
    toggleBuilt,
  }
}
