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
import { STAGE_DEFS, type StageId, type StageStatus } from '../lib/pipeline'
import type { Scene } from '../lib/scenes'
import type { ContactSheet } from '../lib/frames'

/** A word with its time markers, as transcription returns them. */
export type TranscriptWord = { text: string; start: number; end: number }

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
   * In-flight master-director job id (story 03f Part 0). The director call is now
   * async fire-and-poll: `/api/scenes` enqueues a job and returns an id we poll on.
   * Persisted so a hard reload resumes polling instead of stranding a running job;
   * cleared (null) once the job reaches a terminal status. (Per-scene refine jobs
   * track their own id on `Scene.refineJobId`.)
   */
  scenesJobId: string | null
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
}

const initialState: StudioState = {
  stageProgress: freshProgress(),
  revisitPrep: false,
  scenes: [],
  sourceUrl: null,
  audioUrl: null,
  audioPeaks: [],
  contactSheets: [],
  words: [],
  synopsis: null,
  scenesJobId: null,
  voice: null,
  savedVoices: [],
  selectedId: null,
  duration: 0,
  fileName: null,
  finalCutUrl: null,
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
    /** The in-flight director job id (story 03f). Null clears it on terminal status. */
    setScenesJobId(state, action: PayloadAction<string | null>) {
      state.scenesJobId = action.payload
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
  setScenes,
  patchScene,
  setSourceUrl,
  setAudioUrl,
  setAudioPeaks,
  setContactSheets,
  setWords,
  setSynopsis,
  setScenesJobId,
  setVoice,
  addSavedVoice,
  removeSavedVoice,
  setSelected,
  setDuration,
  setFileName,
  setFinalCutUrl,
  resetStudio,
} = studioSlice.actions

export default studioSlice.reducer
