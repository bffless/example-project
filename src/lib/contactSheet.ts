/**
 * Contact-sheet planning — the pure half of the "director thumbnails" (prep
 * stage 4). We interval-sample frames across the clip and compose them into
 * timestamped grid images handed to the master director (story 03) as visual
 * context, so it can decide what footage to cut, not just rewrite the words.
 *
 * Four constraints have to be balanced; `planContactSheet` optimizes across all
 * of them:
 *
 * 1. **Coverage** — frames should be ≤ `MAX_INTERVAL_SECONDS` apart so nothing
 *    important is skipped.
 * 2. **Per-frame detail** — a multimodal model downsamples each image it gets to
 *    a fixed budget (~1 MP), so a few large cells beat many tiny ones. We prefer
 *    `PREFERRED_CELLS_PER_SHEET`, allowing up to `MAX_CELLS_PER_SHEET`.
 * 3. **Image count** — at most `MAX_SHEETS` images per director call.
 * 4. **Upload size** — ≤ 7 MB per image (enforced in `frames.ts` at encode time).
 *
 * These conflict only for long clips. The ladder: keep 30s spacing and 9 cells
 * while it fits in 10 sheets (≤ 45 min); then pack more cells per sheet, 9 → 12,
 * to stay ≤ 10 sheets (45–60 min); past that the frame budget is maxed (10 × 12
 * = 120) and spacing relaxes beyond 30s. The capture and canvas compositing live
 * in `frames.ts`; this file only decides WHICH timestamps to grab and HOW to
 * tile/lay them out (pure + unit-tested).
 */

/** Frames should be no more than this far apart — until the image cap forces it. */
export const MAX_INTERVAL_SECONDS = 30

/** Hard cap on images sent to the director in one call. */
export const MAX_SHEETS = 10

/** Columns per sheet. Few columns ⇒ wide cells ⇒ legible after the model resize. */
export const TILE_COLUMNS = 3

/** Cells per sheet we aim for — a 3×3 grid sits just under the model's ~1 MP. */
export const PREFERRED_CELLS_PER_SHEET = 9

/** Most cells we'll pack before per-frame detail suffers (3×4). */
export const MAX_CELLS_PER_SHEET = 12

/** The largest frame budget the constraints allow: every sheet packed full. */
export const MAX_FRAMES = MAX_SHEETS * MAX_CELLS_PER_SHEET // 120

export type ContactSheetPlan = {
  /** Actual seconds between sampled frames — `MAX_INTERVAL_SECONDS` until the cap forces more. */
  interval: number
  /** All capture timestamps in seconds, evenly spread and bucket-centred. */
  times: number[]
  /** Cells per composed sheet; `times` is chunked by this into ≤ `MAX_SHEETS` tiles. */
  perSheet: number
}

/**
 * Ideal frame count for full `MAX_INTERVAL_SECONDS` coverage — uncapped, scales
 * with length. The plan caps the *sampled* count at `MAX_FRAMES`; this is the
 * count we'd want if image/size limits didn't exist.
 */
export function frameCount(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.max(1, Math.ceil(duration / MAX_INTERVAL_SECONDS))
}

/**
 * Cells per sheet for `total` frames: the fewest that still fit within
 * `MAX_SHEETS` sheets, but never below `PREFERRED_CELLS_PER_SHEET` (so short
 * clips don't fan out into many near-empty images) nor above
 * `MAX_CELLS_PER_SHEET`. Guarantees `ceil(total / result) ≤ MAX_SHEETS`.
 */
export function cellsPerSheet(total: number): number {
  if (total <= 0) return 0
  const toFit = Math.ceil(total / MAX_SHEETS)
  return Math.min(MAX_CELLS_PER_SHEET, total, Math.max(PREFERRED_CELLS_PER_SHEET, toFit))
}

/**
 * `count` capture timestamps spread evenly across the clip, each centred in its
 * bucket (so the first/last frames aren't dead on 0:00 / the final frozen
 * frame). Kept just shy of `duration` so the seek always lands on real footage.
 */
export function sampleTimes(duration: number, count: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || count <= 0) return []
  return Array.from({ length: count }, (_, i) =>
    Math.min(duration - 0.05, (i + 0.5) * (duration / count)),
  )
}

/** Split `items` into chunks of at most `size` (the per-sheet tiling). */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return items.length ? [items] : []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Grid for one tile: up to `TILE_COLUMNS` columns, rows grow to fit its frames.
 */
export function gridDimensions(count: number): { cols: number; rows: number } {
  if (count <= 0) return { cols: 0, rows: 0 }
  const cols = Math.min(count, TILE_COLUMNS)
  const rows = Math.ceil(count / cols)
  return { cols, rows }
}

/**
 * The clip-wide plan: how many frames to sample, their timestamps, and how many
 * cells per sheet — balancing coverage, detail, and the image cap.
 */
export function planContactSheet(duration: number): ContactSheetPlan {
  const ideal = frameCount(duration)
  if (ideal === 0) return { interval: 0, times: [], perSheet: 0 }
  const total = Math.min(ideal, MAX_FRAMES)
  return {
    interval: duration / total,
    times: sampleTimes(duration, total),
    perSheet: cellsPerSheet(total),
  }
}

/**
 * Clock label burned onto each frame: `m:ss`, promoting to `h:mm:ss` once the
 * clip passes an hour. Plain wall-clock (no tenths) so the director can read it
 * at thumbnail size and map a scene back to an original-video timestamp.
 */
export function clockLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = s.toString().padStart(2, '0')
  if (h) return `${h}:${m.toString().padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}
