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
import { STAGE_DEFS, type Stage, type StageId } from '../lib/pipeline'
import type { Scene } from '../lib/scenes'
import type { ContactSheet } from '../lib/frames'

/** A word with its time markers, as transcription returns them. */
export type TranscriptWord = { text: string; start: number; end: number }

/** Fresh prep board: every stage pending. */
export const freshStages = (): Stage[] =>
  STAGE_DEFS.map((s) => ({ ...s, status: 'pending' }))

export type StudioState = {
  stages: Stage[]
  scenes: Scene[]
  /** Relative `/api/uploads/source/...` serve path once uploaded (proxies to bucket). */
  sourceUrl: string | null
  /** Relative `/api/uploads/audio/...` serve path once uploaded. */
  audioUrl: string | null
  contactSheets: ContactSheet[]
  words: TranscriptWord[]
  selectedId: string | null
  /** Source clip duration in seconds (from the <video> metadata). */
  duration: number
  /** Original filename, so a restored session can prompt to re-attach the clip. */
  fileName: string | null
}

const initialState: StudioState = {
  stages: freshStages(),
  scenes: [],
  sourceUrl: null,
  audioUrl: null,
  contactSheets: [],
  words: [],
  selectedId: null,
  duration: 0,
  fileName: null,
}

const studioSlice = createSlice({
  name: 'studio',
  initialState,
  reducers: {
    patchStage(state, action: PayloadAction<{ id: StageId; patch: Partial<Stage> }>) {
      const stage = state.stages.find((s) => s.id === action.payload.id)
      if (stage) Object.assign(stage, action.payload.patch)
    },
    /** Mark whichever stage is currently `active` as errored (used on a thrown step). */
    failActiveStage(state, action: PayloadAction<string>) {
      const stage = state.stages.find((s) => s.status === 'active')
      if (stage) {
        stage.status = 'error'
        stage.detail = action.payload
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
    setContactSheets(state, action: PayloadAction<ContactSheet[]>) {
      state.contactSheets = action.payload
    },
    setWords(state, action: PayloadAction<TranscriptWord[]>) {
      state.words = action.payload
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
      return { ...initialState, stages: freshStages() }
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
  setContactSheets,
  setWords,
  setSelected,
  setDuration,
  setFileName,
  resetStudio,
} = studioSlice.actions

export default studioSlice.reducer
