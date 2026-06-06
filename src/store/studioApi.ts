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

export type UploadKind = 'source' | 'audio' | 'thumbnails'
type TranscribeResponse = { words?: TranscriptWord[]; text?: string }
/** The master director's response: a logline + the raw scene breakdown. */
type ScenesResponse = { synopsis?: string; scenes?: DirectorScene[] }

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

export const { useTranscribeMutation, useScenesMutation, useUploadMutation } = studioApi
