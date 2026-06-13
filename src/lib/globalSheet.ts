import { planContactSheet } from './contactSheet'
import { globalToLocal, totalDuration, type SourceLike } from './sources'

export type GlobalCapture = { globalTime: number; sourceId: string; localTime: number }

/**
 * Plan the whole-talk director contact sheet across many sources (story 09c).
 * Reuse the clip-wide spacing on the COMBINED duration (so total length sets the
 * interval and the ≤10-image budget holds), then route each global timestamp to
 * the source + local time it should be captured from. The burned-in label uses
 * the GLOBAL time so the director reads one continuous timeline.
 */
export function planGlobalSheetCaptures(sources: SourceLike[]): GlobalCapture[] {
  const total = totalDuration(sources)
  const plan = planContactSheet(total)
  const out: GlobalCapture[] = []
  for (const globalTime of plan.times) {
    const local = globalToLocal(sources, globalTime)
    if (local) out.push({ globalTime, sourceId: local.sourceId, localTime: local.localTime })
  }
  return out
}
