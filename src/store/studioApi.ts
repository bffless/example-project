/**
 * RTK Query data layer for the Studio `/api/*` endpoints. Every network call the
 * producer makes goes through here so caching, in-flight state, and error
 * handling are consistent.
 *
 * - `transcribe` is a plain JSON mutation.
 * - `upload` wraps the three-step presigned flow (prepare → direct bucket PUT →
 *   register) in a custom `queryFn` by delegating to the existing, unit-tested
 *   `presignedUpload` helper — RTK Query can't model a direct-to-bucket PUT with
 *   `fetchBaseQuery`, but `queryFn` lets us run arbitrary async and still expose
 *   it as a normal mutation hook.
 */

import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { presignedUpload } from '../lib/upload'
import type { TranscriptWord } from './studioSlice'
import type { DirectorRequest, DirectorScene } from '../lib/director'
import type { RefineSceneRequest, RefineSceneRaw } from '../lib/refiner'

export type UploadKind = 'source' | 'audio' | 'thumbnails' | 'voice' | 'export'
type TranscribeResponse = { words?: TranscriptWord[]; text?: string }
/** The master director's response: a logline + the raw scene breakdown. */
type ScenesResponse = { synopsis?: string; scenes?: DirectorScene[] }
/** The per-scene refiner's response (story 03c): anchored segments + refined cuts. */
type RefineSceneResponse = RefineSceneRaw
/** Voice clone (story 04): the recorded sample's URL → a reusable `voiceId`
 *  (+ a preview mp3 of the cloned voice from MiniMax). */
type VoiceCloneResponse = { voiceId: string; previewUrl?: string }
/** Voice say (TTS preview): a line spoken in the chosen voice → playable audio. */
type VoiceSayResponse = { audioUrl: string; durationSeconds?: number }
/** Scene narration (story 03c): a run of script → a PERSISTED mp3 serve path. */
type VoiceNarrateResponse = { audioUrl: string }

export const studioApi = createApi({
  reducerPath: 'studioApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/', credentials: 'include' }),
  endpoints: (builder) => ({
    transcribe: builder.mutation<TranscribeResponse, { audioUrl: string | null }>({
      query: (body) => ({
        url: 'api/transcribe',
        method: 'POST',
        body,
      }),
    }),

    // The master director (story 03): timestamped transcript + contact-sheet
    // images + the user's direction → synopsis + scenes (script, span, cuts).
    scenes: builder.mutation<ScenesResponse, DirectorRequest>({
      query: (body) => ({
        url: 'api/scenes',
        method: 'POST',
        body,
      }),
    }),

    // The per-scene refiner (story 03c): the scene's transcript + the director's
    // first-pass script/cuts + the scene's dense contact sheets → anchored
    // segments (where the new text lands) + refined cuts.
    refineScene: builder.mutation<RefineSceneResponse, RefineSceneRequest>({
      query: (body) => ({
        url: 'api/refine-scene',
        method: 'POST',
        body,
      }),
    }),

    // Scene narration (story 03c): speak a run of the refined script in the saved
    // voice and PERSIST the mp3 to the bucket → a durable serve path. Distinct
    // from voiceSay (ephemeral preview); these clips are kept for the diff-viewer
    // players and the eventual ffmpeg assemble (story 05).
    narrate: builder.mutation<VoiceNarrateResponse, { text: string; voiceId: string }>({
      query: (body) => ({
        url: 'api/voice/narrate',
        method: 'POST',
        body,
      }),
    }),

    // Voice clone (story 04): POST the uploaded recording's URL → a reusable
    // voiceId. The real $3 Replicate clone is DISABLED server-side for now — the
    // pipeline returns a real preset id as a stub, so the rest of the flow (and
    // the TTS preview below) works end to end without the spend.
    voiceClone: builder.mutation<VoiceCloneResponse, { sampleUrl: string }>({
      query: (body) => ({
        url: 'api/voice/clone',
        method: 'POST',
        body,
      }),
    }),

    // Voice say (TTS preview): speak a short canned line in the chosen voice
    // (minimax/speech-2.8-turbo, live + cheap) so the producer can hear it right
    // after selecting. Per-scene narration is a later (Build) story.
    voiceSay: builder.mutation<VoiceSayResponse, { text: string; voiceId: string }>({
      query: (body) => ({
        url: 'api/voice/say',
        method: 'POST',
        body,
      }),
    }),

    upload: builder.mutation<{ url: string }, { file: File; kind: UploadKind }>({
      async queryFn({ file, kind }) {
        try {
          const url = await presignedUpload(file, `/api/uploads/${kind}`)
          return { data: { url } }
        } catch (e) {
          return {
            error: {
              status: 'CUSTOM_ERROR' as const,
              error: e instanceof Error ? e.message : String(e),
            },
          }
        }
      },
    }),
  }),
})

export const {
  useTranscribeMutation,
  useScenesMutation,
  useRefineSceneMutation,
  useNarrateMutation,
  useUploadMutation,
  useVoiceCloneMutation,
  useVoiceSayMutation,
} = studioApi
