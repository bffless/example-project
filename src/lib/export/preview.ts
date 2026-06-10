/**
 * Preview — pure timeline math for the scene preview player (story 03i).
 *
 * The preview SIMULATES an `AssemblePlan` (the same pure plan ffmpeg renders —
 * see ./assemble.ts) with zero rendering: narration clips are scheduled on a
 * Web Audio clock at their output-timeline offsets, and the flipbook maps the
 * output clock back to original-video seconds to pick a contact-sheet frame.
 * This module is pure (no DOM, no Web Audio) and unit-tested; the transport
 * hook and the dialog are thin shells over it.
 */

import type { AssemblePlan } from './assemble'

/** A segment as the preview needs it — just the voiced clip, if any. */
export type PreviewSegment = { audioUrl?: string }

/** One narration clip placed on the output timeline. */
export type AudioEvent = {
  segmentIndex: number
  audioUrl: string
  /** Output-timeline second this clip starts at. */
  offset: number
  /** Seconds of the clip that play (planAssembly already clamped ≤ its slot). */
  duration: number
}

/**
 * Walk `plan.audio` accumulating output time: silence pieces just advance the
 * clock; clip pieces emit an event at the current offset. A clip piece whose
 * segment has no `audioUrl` is skipped (planAssembly never emits those, but a
 * hand-built or stale plan must degrade to silence, not throw — the same
 * "never reference a missing input" rule the assembler follows).
 */
export function audioEvents(plan: AssemblePlan, segments: PreviewSegment[]): AudioEvent[] {
  const events: AudioEvent[] = []
  let t = 0
  for (const piece of plan.audio) {
    if (piece.kind === 'clip') {
      const audioUrl = segments[piece.segmentIndex]?.audioUrl
      if (audioUrl) {
        events.push({ segmentIndex: piece.segmentIndex, audioUrl, offset: t, duration: piece.audioSeconds })
      }
    }
    t += piece.length
  }
  return events
}
