/**
 * Prep produces a handful of artifacts as it runs — the source clip and audio
 * land in storage buckets, the transcript and director thumbnails are generated
 * in the browser. It's easy to lose track of *what you've actually created* and,
 * crucially, **where it lives**: a bucket object that survives, or ephemeral
 * React state that vanishes on reload. This derives a clear, ordered checklist
 * of those artifacts from the current pipeline state, so the UI can show it.
 *
 * Pure + unit-tested; the `PrepArtifacts` component just renders the result.
 */

/** Where an artifact actually lives. */
export type ArtifactStorage = 'bucket' | 'browser'

export type Artifact = {
  id: string
  label: string
  /** Has it been produced yet? */
  ready: boolean
  /** One-line status, e.g. "2,431 words" or "Not transcribed yet". */
  detail: string
  storage: ArtifactStorage
  /** For bucket artifacts: persisted yet? (Always true once `ready` for uploads;
   * false flags thumbnails that are generated but not yet saved.) */
  saved: boolean
}

export type PrepArtifactsInput = {
  /** Source clip uploaded to its bucket. */
  hasSource: boolean
  /** Extracted WAV uploaded to its bucket. */
  hasAudio: boolean
  /** Transcript words returned (browser state). */
  wordCount: number
  /** Composed contact sheets. */
  sheetCount: number
  /** Frames across all sheets. */
  frameCount: number
  /** How many sheets have a bucket URL. */
  sheetsSaved: number
}

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`

/** Build the ordered artifact checklist from the current prep state. */
export function buildPrepArtifacts(s: PrepArtifactsInput): Artifact[] {
  const thumbsReady = s.sheetCount > 0
  const thumbsSaved = thumbsReady && s.sheetsSaved >= s.sheetCount

  return [
    {
      id: 'source',
      label: 'Source clip',
      ready: s.hasSource,
      detail: s.hasSource ? 'Saved to bucket' : 'Not uploaded yet',
      storage: 'bucket',
      saved: s.hasSource,
    },
    {
      id: 'audio',
      label: 'Audio track',
      ready: s.hasAudio,
      detail: s.hasAudio ? '16 kHz WAV · saved to bucket' : 'Not extracted yet',
      storage: 'bucket',
      saved: s.hasAudio,
    },
    {
      id: 'transcript',
      label: 'Transcript',
      ready: s.wordCount > 0,
      detail: s.wordCount > 0 ? plural(s.wordCount, 'word') : 'Not transcribed yet',
      storage: 'browser',
      saved: false,
    },
    {
      id: 'thumbnails',
      label: 'Director thumbnails',
      ready: thumbsReady,
      detail: thumbsReady
        ? `${plural(s.sheetCount, 'sheet')} · ${plural(s.frameCount, 'frame')}${
            thumbsSaved ? ' · saved to bucket' : ' · in browser only'
          }`
        : 'Not generated yet',
      storage: 'bucket',
      saved: thumbsSaved,
    },
  ]
}
