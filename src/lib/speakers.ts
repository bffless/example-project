/**
 * Pure resolution between diarization speaker labels and the project cast
 * (story 10b). Labels are per-video (WhisperX diarizes each file on its own), so
 * everything here is keyed by `(videoId, speakerLabel)`. Shared by the cast UI,
 * the director transcript shaping (10c), and per-segment voicing (10d).
 */
import type { TWord } from './transcriptGrid'
import type { Person, VoiceChoice } from '../store/studioSlice'

export type SpeakerAssignments = Record<string, Record<string, string>>

/** Distinct speaker labels in `words`, in first-seen order; undefined dropped. */
export function uniqueSpeakers(words: TWord[]): string[] {
  const seen: string[] = []
  for (const w of words) {
    const s = w.speaker
    if (s && !seen.includes(s)) seen.push(s)
  }
  return seen
}

/**
 * The cast person a `(videoId, label)` resolves to: an explicit assignment wins;
 * otherwise a single-person cast is the implicit answer (the common "just me"
 * case needs no per-video work); otherwise null (ambiguous + unassigned).
 */
export function resolvePerson(
  videoId: string,
  label: string,
  cast: Person[],
  assignments: SpeakerAssignments,
): Person | null {
  const id = assignments[videoId]?.[label]
  if (id) return cast.find((p) => p.id === id) ?? null
  if (cast.length === 1) return cast[0]
  return null
}

/** Voice for a `(videoId, label)`, via `resolvePerson`. Null if unresolved/unvoiced. */
export function resolveSpeakerVoice(
  videoId: string,
  label: string,
  cast: Person[],
  assignments: SpeakerAssignments,
): VoiceChoice | null {
  return resolvePerson(videoId, label, cast, assignments)?.voice ?? null
}

/**
 * Pre-seed a video's assignments by ordinal: the Nth detected label → the Nth
 * cast person. Existing assignments for the video are preserved (only fills gaps).
 */
export function seedAssignmentsByLabel(
  videoId: string,
  labels: string[],
  cast: Person[],
  assignments: SpeakerAssignments,
): Record<string, string> {
  const out = { ...(assignments[videoId] ?? {}) }
  labels.forEach((label, i) => {
    if (!out[label] && cast[i]) out[label] = cast[i].id
  })
  return out
}

/**
 * The dominant speaker over a local time window `[start, end)` of a source's
 * words — the label whose words cover the most time in the window (story 10d).
 * Null if no word overlaps. Ties break to the first-seen label.
 */
export function dominantSpeaker(words: TWord[], start: number, end: number): string | null {
  const totals = new Map<string, number>()
  for (const w of words) {
    if (!w.speaker) continue
    const o = Math.min(end, w.end) - Math.max(start, w.start)
    if (o > 0) totals.set(w.speaker, (totals.get(w.speaker) ?? 0) + o)
  }
  let best: string | null = null
  let bestO = 0
  for (const [label, o] of totals) if (o > bestO) { bestO = o; best = label }
  return best
}
