import { useCallback, useMemo, useState } from 'react'
import { STAGE_DEFS, type Stage, type StageId } from '../../lib/pipeline'
import { buildScenes, narrationSeconds, type Scene } from '../../lib/scenes'
import { extractAudioWav } from '../../lib/audio'
import { captureFramesAt } from '../../lib/frames'
import { presignedUpload } from '../../lib/upload'

const freshStages = (): Stage[] => STAGE_DEFS.map((s) => ({ ...s, status: 'pending' }))
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`

/** A word with its time markers, as transcription returns them. */
export type TranscriptWord = { text: string; start: number; end: number }

/** What each step needs: the source file, its object URL, and its duration. */
export type StepContext = { file: File; src: string; duration: number }

/**
 * Owns the one-time prep pipeline and the scene queue you build afterwards.
 *
 * Prep now runs **step by step** — the user triggers each step deliberately via
 * `next(ctx)`, which advances `currentStageId`. The real steps (upload, extract
 * + audio upload, transcribe via the real `/api/transcribe` WhisperX pipeline)
 * do real work; shorten/segment/clone are still mocked and grouped behind a
 * single "Finish prep" action. Swap a mocked step for its real `/api/*` call
 * here without touching the UI.
 */
export function useScenePipeline() {
  const [stages, setStages] = useState<Stage[]>(freshStages)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [words, setWords] = useState<TranscriptWord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [voicingId, setVoicingId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const patch = useCallback((id: StageId, p: Partial<Stage>) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)))
  }, [])

  const patchScene = useCallback((id: string, p: Partial<Scene>) => {
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)))
  }, [])

  const reset = useCallback(() => {
    setStages(freshStages())
    setScenes([])
    setSourceUrl(null)
    setAudioUrl(null)
    setWords([])
    setSelectedId(null)
  }, [])

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
      const url = await presignedUpload(file, '/api/uploads/source')
      setSourceUrl(url)
      patch('upload', { status: 'done', detail: `${mb(file.size)} → storage bucket` })
    },
    [patch],
  )

  // Stage ② — extract the audio in-browser, then upload that WAV to the bucket
  // on its own so the transcription step can hand Replicate an audio URL.
  const extractAndUploadAudio = useCallback(
    async ({ file }: StepContext) => {
      patch('extract', { status: 'active' })
      const wav = await extractAudioWav(file) // real, browser-side
      const wavFile = new File([wav], `${file.name.replace(/\.[^.]+$/, '')}.wav`, {
        type: 'audio/wav',
      })
      const url = await presignedUpload(wavFile, '/api/uploads/audio')
      setAudioUrl(url)
      patch('extract', {
        status: 'done',
        detail: `16 kHz mono WAV · ${mb(wav.size)} → bucket`,
      })
    },
    [patch],
  )

  // Stage ③ — transcribe the uploaded audio. POSTs the bucketed `audioUrl` to
  // the real `/api/transcribe` pipeline (presigned audio URL → Replicate
  // WhisperX with word-level alignment, story 02). Keeps the word-level
  // timestamps for shorten + segment (story 03).
  const transcribe = useCallback(
    async ({ duration }: StepContext) => {
      patch('transcribe', { status: 'active' })
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl }),
      })
      if (!res.ok) throw new Error(`Transcribe failed (${res.status})`)
      const data = (await res.json()) as { words?: TranscriptWord[]; text?: string }
      const got = data.words ?? []
      setWords(got)
      const count = got.length || Math.round((duration / 60) * 150)
      patch('transcribe', {
        status: 'done',
        detail: `${count.toLocaleString()} words · ${Math.ceil(duration / 60)} min`,
      })
    },
    [patch, audioUrl],
  )

  // Stages ④⑤⑥ — shorten + segment + clone, still mocked, run together. Segment
  // captures real thumbnails. Replace each with its real `/api/*` call later.
  const finishPrep = useCallback(
    async ({ src, duration }: StepContext) => {
      patch('shorten', { status: 'active' })
      await delay(1100)
      const total = words.length || Math.round((duration / 60) * 150)
      const kept = Math.round(total * 0.6)
      patch('shorten', {
        status: 'done',
        detail: `${kept.toLocaleString()} words kept · ~40% trimmed`,
      })

      patch('segment', { status: 'active' })
      const built = buildScenes(duration)
      const thumbs = await captureFramesAt(
        src,
        built.map((s) => (s.start + s.end) / 2),
        64,
      ) // real
      const withThumbs = built.map((s, i) => ({ ...s, thumb: thumbs[i] }))
      setScenes(withThumbs)
      setSelectedId(withThumbs[0]?.id ?? null)
      patch('segment', {
        status: 'done',
        detail: `${withThumbs.length} scene${withThumbs.length === 1 ? '' : 's'} · text + timestamps`,
      })

      patch('clone', { status: 'active' })
      await delay(900)
      patch('clone', { status: 'done', detail: 'voice model ready' })
    },
    [patch, words],
  )

  /** Run the current prep step. Marks the active stage `error` if it throws. */
  const next = useCallback(
    async (ctx: StepContext) => {
      const id = currentStageId
      if (!id || running) return
      setRunning(true)
      try {
        if (id === 'upload') await uploadClip(ctx)
        else if (id === 'extract') await extractAndUploadAudio(ctx)
        else if (id === 'transcribe') await transcribe(ctx)
        else await finishPrep(ctx) // shorten/segment/clone grouped
      } catch (e) {
        setStages((prev) =>
          prev.map((s) =>
            s.status === 'active'
              ? { ...s, status: 'error', detail: e instanceof Error ? e.message : String(e) }
              : s,
          ),
        )
      } finally {
        setRunning(false)
      }
    },
    [currentStageId, running, uploadClip, extractAndUploadAudio, transcribe, finishPrep],
  )

  // ---- Scene build loop (unchanged) ----------------------------------------

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
      setScenes((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, narrationSeconds: narrationSeconds(s.draftText) } : s,
        ),
      )
      setVoicingId(null)
    },
    [],
  )

  const markBuilt = useCallback((id: string) => {
    setScenes((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, status: 'built' as const } : s))
      const stillPending = next.find((s) => s.status === 'pending')
      if (stillPending) setSelectedId(stillPending.id)
      return next
    })
  }, [])

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
    words,
    selectedId,
    voicingId,
    running,
    ready,
    allBuilt,
    currentStageId,
    next,
    reset,
    select: setSelectedId,
    updateDraft,
    generateVoice,
    markBuilt,
  }
}
