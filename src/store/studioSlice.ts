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
  selectedId: string | null
  /** Source clip duration in seconds (from the <video> metadata). */
  duration: number
  /** Original filename, so a restored session can prompt to re-attach the clip. */
  fileName: string | null
}

const initialState: StudioState = {
  stageProgress: freshProgress(),
  scenes: [],
  sourceUrl: null,
  audioUrl: null,
  audioPeaks: [],
  contactSheets: [],
  words: [],
  synopsis: null,
  selectedId: null,
  duration: 0,
  fileName: null,
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
    setSelected(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload
    },
    setDuration(state, action: PayloadAction<number>) {
      state.duration = action.payload
    },
    setFileName(state, action: PayloadAction<string | null>) {
      state.fileName = action.payload
    },
    /** Wipe everything back to a clean import — used by "Start over". */
    resetStudio() {
      return { ...initialState, stageProgress: freshProgress() }
    },
  },
})

export const {
  patchStage,
  failActiveStage,
  setScenes,
  patchScene,
  setSourceUrl,
  setAudioUrl,
  setAudioPeaks,
  setContactSheets,
  setWords,
  setSynopsis,
  setSelected,
  setDuration,
  setFileName,
  resetStudio,
} = studioSlice.actions

export default studioSlice.reducer
