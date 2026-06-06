/**
 * The prep pipeline: the steps that run once on import to get the clip ready
 * for scene-by-scene production. These stage definitions ARE the "notes in the
 * browser" — shown up front, checked off as each completes. `where` marks
 * whether a step runs in the browser or in a BFFless pipeline.
 *
 * After prep, the producer builds each scene one at a time (see `scenes.ts`);
 * the final assemble/render is a separate action, not a prep stage.
 */

export type StageId =
  | 'upload'
  | 'extract'
  | 'transcribe'
  | 'thumbnails'
  | 'shorten'
  | 'segment'
  | 'clone'

export type StageStatus = 'pending' | 'active' | 'done' | 'error'
export type Where = 'browser' | 'pipeline' | 'browser+pipeline'

export type StageDef = {
  id: StageId
  title: string
  /** What we're going to do — the note shown before it runs. */
  note: string
  where: Where
  /**
   * Label for this step's manual action button. Prep runs step by step now —
   * the user triggers each real step deliberately. Steps without their own
   * label are completed as part of an earlier step's grouped action.
   */
  actionLabel?: string
}

export type Stage = StageDef & { status: StageStatus; detail?: string }

/**
 * The macro phases of the whole producer journey, shown as the top-level
 * stepper so you always know where you are. Derived purely from existing state —
 * see `studioPhase`.
 */
export type StudioPhase = 'import' | 'prep' | 'build' | 'export'

export const PHASES: { id: StudioPhase; label: string }[] = [
  { id: 'import', label: 'Import' },
  { id: 'prep', label: 'Prep' },
  { id: 'build', label: 'Build' },
  { id: 'export', label: 'Export' },
]

/** Which macro phase the producer is in, from the current pipeline state. */
export function studioPhase(s: {
  hasFile: boolean
  ready: boolean
  allBuilt: boolean
}): StudioPhase {
  if (!s.hasFile) return 'import'
  if (!s.ready) return 'prep'
  if (!s.allBuilt) return 'build'
  return 'export'
}

export const STAGE_DEFS: StageDef[] = [
  {
    id: 'upload',
    title: 'Save the clip to a bucket',
    note: 'Upload the source video to BFFless storage so the rest of the pipeline can work from it.',
    where: 'pipeline',
    actionLabel: 'Save to bucket',
  },
  {
    id: 'extract',
    title: 'Extract & upload audio',
    note: 'Pull a 16 kHz mono WAV out of the video right here in the browser, then upload that WAV to the bucket on its own — Replicate transcribes the audio, not the video.',
    where: 'browser+pipeline',
    actionLabel: 'Extract & upload audio',
  },
  {
    id: 'transcribe',
    title: 'Transcribe with timestamps',
    note: 'Send the uploaded audio to a Replicate speech-to-text model; get the words back with time markers.',
    where: 'pipeline',
    actionLabel: 'Transcribe audio',
  },
  {
    id: 'thumbnails',
    title: 'Sample thumbnails for the director',
    note: 'Grab frames across the whole clip on an interval that scales with its length, and compose them into one contact sheet with a timestamp burned on each — the visual context the AI director reads alongside the transcript.',
    where: 'browser',
    actionLabel: 'Generate thumbnails',
  },
  {
    id: 'shorten',
    title: 'Shorten the transcript',
    note: 'Ask the AI to condense the whole transcript first — cut the rambling and dead weight while keeping your points and your phrasing.',
    where: 'pipeline',
    // Grouped with segment + clone behind one "Finish prep" action for now.
    actionLabel: 'Finish prep',
  },
  {
    id: 'segment',
    title: 'Group into scenes with timestamps',
    note: 'Break the shortened transcript into logical 2–5 min scenes where it makes sense. Each comes back with its narration text and the original-video timestamps it maps to — these are your chapters.',
    where: 'pipeline',
  },
  {
    id: 'clone',
    title: 'Clone your voice',
    note: 'Build a reusable voice model from your extracted audio via a Replicate voice-clone pipeline, ready to re-voice each scene.',
    where: 'pipeline',
  },
]
