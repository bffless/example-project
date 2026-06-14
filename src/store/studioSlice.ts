/**
 * The Studio's durable business state. Everything here is persisted to
 * localStorage (redux-persist, see `./index.ts`) so a hard reload doesn't lose
 * where you are: the stepper/board progress, the scenes you've built, the
 * transcript, the bucket serve references, and the contact sheets all survive.
 *
 * What is deliberately NOT here (kept as transient React state in the hook/page,
 * fine to lose on reload): the in-memory source `File`/object URL, the scrub
 * `currentTime`, and the `running`/`voicingId` spinners.
 *
 * The raw video blob is never stored — only the relative `/api/uploads/...`
 * serve path (which proxies to the bucket) once the clip has been uploaded.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { STAGE_DEFS, PER_VIDEO_STAGES, type StageId, type StageStatus } from '../lib/pipeline'
import type { Scene } from '../lib/scenes'
import type { ContactSheet } from '../lib/frames'

/** A word with its time markers, as transcription returns them. `speaker` is the
 *  diarization label (story 10a), e.g. `SPEAKER_00`; absent on old transcripts. */
export type TranscriptWord = { text: string; start: number; end: number; speaker?: string }

/**
 * The narration voice the producer settled on in the clone prep step — either
 * their own **cloned** voice (recorded → MiniMax voice-cloning → `voiceId`) or a
 * picked **preset** voice. Durable: it's reused to voice every scene in Build and
 * across runs, so it's persisted. `sampleUrl` is the uploaded recording the clone
 * was made from (clone path only), kept for reference.
 */
export type VoiceChoice = {
  voiceId: string
  /** How we got it: a fresh clone, a reused saved id, or a MiniMax preset. */
  source: 'clone' | 'saved' | 'preset'
  label: string
  sampleUrl?: string | null
}

/**
 * A cloned voice id worth keeping. MiniMax stores cloned voices server-side by
 * id, so once you've paid the $3 to clone, you can reuse that id forever without
 * re-cloning. We remember every id you mint (and any you paste in) here, persisted
 * to localStorage, so they're one click away next session.
 */
export type SavedVoice = { voiceId: string; label: string }

/**
 * Per-step progress — the ONLY dynamic part of the prep board, and all we keep
 * in state (and persist). The step *content* (title, note, where, action label)
 * is static `STAGE_DEFS` and is recombined with this in the hook, so editing the
 * board's shape in `STAGE_DEFS` takes effect immediately without a migration and
 * without bloating localStorage. Keyed by `StageId`; a missing id reads pending.
 */
export type StageProgress = { status: StageStatus; detail?: string }
export type StageProgressMap = Partial<Record<StageId, StageProgress>>

/** Fresh prep board progress: every stage pending. */
export const freshProgress = (): StageProgressMap => {
  const out: StageProgressMap = {}
  for (const s of STAGE_DEFS) out[s.id] = { status: 'pending' }
  return out
}

/**
 * One source video in a multi-video project (story 09a). Everything that used to
 * be a single top-level field (the bucket serve paths, the waveform, the
 * transcript words, the clip duration, the per-video prep progress) now lives
 * here, one per uploaded clip. Whole-project state (global contact sheets,
 * synopsis, direction, scenes, voice, final cut) stays top-level.
 */
export type VideoSource = {
  id: string
  /** Sequence in the final cut + the global-timeline offset. Drag reorders it. */
  order: number
  fileName: string
  duration: number
  sourceUrl: string | null
  audioUrl: string | null
  audioPeaks: number[]
  words: TranscriptWord[]
  /** Per-video prep progress: only the per-video stages (upload/extract/transcribe). */
  stageProgress: StageProgressMap
}

/** Fresh per-video progress: every per-video stage pending. */
export const freshSourceProgress = (): StageProgressMap => {
  const out: StageProgressMap = {}
  for (const id of PER_VIDEO_STAGES) out[id] = { status: 'pending' }
  return out
}

const makeSource = (p: { id: string; fileName: string; duration: number; order: number }): VideoSource => ({
  id: p.id,
  order: p.order,
  fileName: p.fileName,
  duration: p.duration,
  sourceUrl: null,
  audioUrl: null,
  audioPeaks: [],
  words: [],
  stageProgress: freshSourceProgress(),
})

export type StudioState = {
  stageProgress: StageProgressMap
  /**
   * Whether the producer has hopped back to Prep after finishing it. Persisted
   * (not transient React state) so a hard reload keeps you on Prep instead of
   * snapping forward to Build: `ready` alone can't tell "prep is done, show
   * Build" from "prep is done but I'm currently revisiting it". Reset by
   * resetStudio (Start over / fresh import).
   */
  revisitPrep: boolean
  /**
   * Whether the producer has clicked "Continue" to reveal the global plan
   * (thumbnails → voice → director) after their source videos finished
   * processing. Until then the prep view shows only the source queue — the plan
   * stays hidden so it doesn't get ahead of the first job (find & process your
   * clips). Persisted so the reveal survives a reload; reset by resetStudio.
   * (A plan that's already underway shows regardless — see `planStarted` in the
   * page — so this only gates the not-yet-started case.)
   */
  planRevealed: boolean
  scenes: Scene[]
  /** Relative `/api/uploads/source/...` serve path once uploaded (proxies to bucket). */
  sourceUrl: string | null
  /** Relative `/api/uploads/audio/...` serve path once uploaded. */
  audioUrl: string | null
  /** Compact waveform summary (normalized 0–1 peaks) of the extracted audio. */
  audioPeaks: number[]
  contactSheets: ContactSheet[]
  words: TranscriptWord[]
  /** One-line logline of the whole talk, from the master director (story 03). */
  synopsis: string | null
  /**
   * The creator's free-text direction to the master director (story 03l).
   * Persisted — it's sent with `/api/scenes` at prep time AND forwarded to every
   * per-scene refine in Build (each scene has an include-checkbox), so it must
   * outlive the prep step and survive reloads. Old persisted sessions rehydrate
   * without the key and fall back to '' (top-level persist merge) — no migration.
   */
  direction: string
  /**
   * In-flight master-director job id (story 03f Part 0). The director call is now
   * async fire-and-poll: `/api/scenes` enqueues a job and returns an id we poll on.
   * Persisted so a hard reload resumes polling instead of stranding a running job;
   * cleared (null) once the job reaches a terminal status. (Per-scene refine jobs
   * track their own id on `Scene.refineJobId`.)
   */
  scenesJobId: string | null
  /**
   * Job id of the last SUCCESSFUL master-director run (story 03m) — the prompt
   * disclosure lazy-fetches the job row to show what was sent to Gemini.
   * Separate from `scenesJobId` (in-flight resume pointer, cleared on terminal
   * status so the resume poller never re-runs a finished job).
   */
  directorPromptJobId: string | null
  /** The narration voice (cloned, reused, or preset), set in the clone prep step. */
  voice: VoiceChoice | null
  /** Cloned voice ids the user has minted/saved, reusable without re-cloning. */
  savedVoices: SavedVoice[]
  selectedId: string | null
  /** Source clip duration in seconds (from the <video> metadata). */
  duration: number
  /** Original filename, so a restored session can prompt to re-attach the clip. */
  fileName: string | null
  /**
   * The assembled final cut's `/api/uploads/export/...` serve path once the
   * producer has SAVED it to the bucket (story 05). URL-only, like every other
   * resource — the heavy MP4 blob is never persisted — so a hard reload brings
   * the saved cut back to play/download. Null until saved; re-saving overwrites it.
   */
  finalCutUrl: string | null
  /**
   * All source videos in the project (story 09a). Each holds its own per-video
   * prep state (sourceUrl, audioUrl, words, stageProgress, etc.). The single
   * top-level fields (sourceUrl, audioUrl, etc.) remain for backward compat
   * and are retired in a later task.
   */
  sources: VideoSource[]
}

const initialState: StudioState = {
  stageProgress: freshProgress(),
  revisitPrep: false,
  planRevealed: false,
  scenes: [],
  sourceUrl: null,
  audioUrl: null,
  audioPeaks: [],
  contactSheets: [],
  words: [],
  synopsis: null,
  direction: '',
  scenesJobId: null,
  directorPromptJobId: null,
  voice: null,
  savedVoices: [],
  selectedId: null,
  duration: 0,
  fileName: null,
  finalCutUrl: null,
  sources: [],
}

const studioSlice = createSlice({
  name: 'studio',
  initialState,
  reducers: {
    patchStage(state, action: PayloadAction<{ id: StageId; patch: Partial<StageProgress> }>) {
      const prev = state.stageProgress[action.payload.id] ?? { status: 'pending' }
      state.stageProgress[action.payload.id] = { ...prev, ...action.payload.patch }
    },
    /** Mark whichever stage is currently `active` as errored (used on a thrown step). */
    failActiveStage(state, action: PayloadAction<string>) {
      for (const def of STAGE_DEFS) {
        if (state.stageProgress[def.id]?.status === 'active') {
          state.stageProgress[def.id] = { status: 'error', detail: action.payload }
          break
        }
      }
    },
    /** Toggle the Prep⇄Build view after prep is complete (persisted, see above). */
    setRevisitPrep(state, action: PayloadAction<boolean>) {
      state.revisitPrep = action.payload
    },
    /** Reveal the global plan once sources are processed (see `planRevealed`). */
    setPlanRevealed(state, action: PayloadAction<boolean>) {
      state.planRevealed = action.payload
    },
    setScenes(state, action: PayloadAction<Scene[]>) {
      state.scenes = action.payload
    },
    patchScene(state, action: PayloadAction<{ id: string; patch: Partial<Scene> }>) {
      const scene = state.scenes.find((s) => s.id === action.payload.id)
      if (scene) Object.assign(scene, action.payload.patch)
    },
    setSourceUrl(state, action: PayloadAction<string | null>) {
      state.sourceUrl = action.payload
    },
    setAudioUrl(state, action: PayloadAction<string | null>) {
      state.audioUrl = action.payload
    },
    setAudioPeaks(state, action: PayloadAction<number[]>) {
      state.audioPeaks = action.payload
    },
    setContactSheets(state, action: PayloadAction<ContactSheet[]>) {
      state.contactSheets = action.payload
    },
    setWords(state, action: PayloadAction<TranscriptWord[]>) {
      state.words = action.payload
    },
    setSynopsis(state, action: PayloadAction<string | null>) {
      state.synopsis = action.payload
    },
    /** The creator's master-director prompt (story 03l) — see `direction` above. */
    setDirection(state, action: PayloadAction<string>) {
      state.direction = action.payload
    },
    /** The in-flight director job id (story 03f). Null clears it on terminal status. */
    setScenesJobId(state, action: PayloadAction<string | null>) {
      state.scenesJobId = action.payload
    },
    /** Pointer to the last successful director job's row (story 03m). */
    setDirectorPromptJobId(state, action: PayloadAction<string | null>) {
      state.directorPromptJobId = action.payload
    },
    setVoice(state, action: PayloadAction<VoiceChoice | null>) {
      state.voice = action.payload
    },
    /** Remember a cloned/known voice id (newest first, deduped by id). */
    addSavedVoice(state, action: PayloadAction<SavedVoice>) {
      const id = action.payload.voiceId.trim()
      if (!id) return
      state.savedVoices = [
        { voiceId: id, label: action.payload.label || id },
        ...state.savedVoices.filter((v) => v.voiceId !== id),
      ]
    },
    removeSavedVoice(state, action: PayloadAction<string>) {
      state.savedVoices = state.savedVoices.filter((v) => v.voiceId !== action.payload)
    },
    setSelected(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload
    },
    setDuration(state, action: PayloadAction<number>) {
      state.duration = action.payload
    },
    setFileName(state, action: PayloadAction<string | null>) {
      state.fileName = action.payload
    },
    /** The saved final cut's serve path (story 05). Re-saving overwrites it;
     *  clearing (null) drops the saved reference without touching anything else. */
    setFinalCutUrl(state, action: PayloadAction<string | null>) {
      state.finalCutUrl = action.payload
    },
    /** Append a new source video with fresh per-video prep progress (story 09a). */
    addSource(state, action: PayloadAction<{ id: string; fileName: string; duration: number }>) {
      state.sources.push(makeSource({ ...action.payload, order: state.sources.length }))
    },
    /** Shallow-merge `patch` into the source identified by `id`. */
    patchSource(state, action: PayloadAction<{ id: string; patch: Partial<VideoSource> }>) {
      const src = state.sources.find((s) => s.id === action.payload.id)
      if (src) Object.assign(src, action.payload.patch)
    },
    /** Merge `patch` into one prep stage on a specific source. */
    patchSourceStage(state, action: PayloadAction<{ id: string; stage: StageId; patch: Partial<StageProgress> }>) {
      const src = state.sources.find((s) => s.id === action.payload.id)
      if (!src) return
      const prev = src.stageProgress[action.payload.stage] ?? { status: 'pending' }
      src.stageProgress[action.payload.stage] = { ...prev, ...action.payload.patch }
    },
    /** Remove a source by id and renumber `order` on the remaining entries. */
    removeSource(state, action: PayloadAction<string>) {
      state.sources = state.sources.filter((s) => s.id !== action.payload).map((s, i) => ({ ...s, order: i }))
    },
    /** Move a source from index `from` to index `to` and renumber `order`. */
    reorderSources(state, action: PayloadAction<{ from: number; to: number }>) {
      const { from, to } = action.payload
      if (from < 0 || to < 0 || from >= state.sources.length || to >= state.sources.length) return
      const [moved] = state.sources.splice(from, 1)
      state.sources.splice(to, 0, moved)
      state.sources = state.sources.map((s, i) => ({ ...s, order: i }))
    },
    /**
     * Wipe everything back to a clean import — used by "Start over". Keeps the
     * `savedVoices` library: those cloned ids cost real money and are reusable
     * across clips/sessions, so starting a new project shouldn't lose them.
     */
    resetStudio(state) {
      return { ...initialState, stageProgress: freshProgress(), savedVoices: state.savedVoices }
    },
  },
})

export const {
  patchStage,
  failActiveStage,
  setRevisitPrep,
  setPlanRevealed,
  setScenes,
  patchScene,
  setSourceUrl,
  setAudioUrl,
  setAudioPeaks,
  setContactSheets,
  setWords,
  setSynopsis,
  setDirection,
  setScenesJobId,
  setDirectorPromptJobId,
  setVoice,
  addSavedVoice,
  removeSavedVoice,
  setSelected,
  setDuration,
  setFileName,
  setFinalCutUrl,
  addSource,
  patchSource,
  patchSourceStage,
  removeSource,
  reorderSources,
  resetStudio,
} = studioSlice.actions

export default studioSlice.reducer
