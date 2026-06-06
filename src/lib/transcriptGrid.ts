/**
 * Lay a word-level transcript out on a time grid, the way the transcript editor
 * renders it. Each row ("line") spans `secondsPerLine` seconds; within a row,
 * time is sliced into `segmentSeconds`-wide cells (columns) — quarter-seconds by
 * default, since people speak 2–3 words a second and one-second cells pile them
 * up. A word is dropped into the cell for the slice its `start` falls in, so
 * reading left→right then top→bottom walks the audio forward in time.
 *
 * Pure + deterministic so it's trivial to unit-test; the React component is just
 * a renderer over `buildTranscriptGrid`.
 */

export type TWord = { text: string; start: number; end: number }

/** One time-slice column in a row: the words that begin during that slice. */
export type GridCell = TWord[]

export type GridLine = {
  /** Row index, 0-based. */
  index: number
  /** Absolute second this row starts at (`index * secondsPerLine`). */
  startSec: number
  /** `secondsPerLine / segmentSeconds` cells, one per slice, left→right. */
  cells: GridCell[]
}

/** Lines default to 5 seconds; the editor lets you change it. */
export const DEFAULT_SECONDS_PER_LINE = 5

/** Cells default to a quarter-second slice; the editor lets you change it. */
export const DEFAULT_SEGMENT_SECONDS = 0.25

const emptyCells = (n: number): GridCell[] => Array.from({ length: n }, () => [])

/** How many cells a row has at the given line/segment sizes (>= 1). */
export function segmentsPerLine(
  secondsPerLine: number = DEFAULT_SECONDS_PER_LINE,
  segmentSeconds: number = DEFAULT_SEGMENT_SECONDS,
): number {
  const perLine = Math.max(1, secondsPerLine)
  const seg = segmentSeconds > 0 ? segmentSeconds : DEFAULT_SEGMENT_SECONDS
  return Math.max(1, Math.round(perLine / seg))
}

/**
 * Bucket `words` into rows of `secondsPerLine` seconds, each sliced into
 * `segmentSeconds`-wide cells. Rows with no words are still emitted (empty) so
 * the grid stays continuous from 0 up to the last word — gaps in speech read as
 * blank space, like silence.
 *
 * Words keep their input order within a cell, so a transcript already sorted by
 * `start` reads naturally. Negative starts clamp to 0; a word landing exactly on
 * the row boundary clamps into the last cell of its row.
 */
export function buildTranscriptGrid(
  words: TWord[],
  secondsPerLine: number = DEFAULT_SECONDS_PER_LINE,
  segmentSeconds: number = DEFAULT_SEGMENT_SECONDS,
): GridLine[] {
  const perLine = Math.max(1, secondsPerLine)
  const seg = segmentSeconds > 0 ? segmentSeconds : DEFAULT_SEGMENT_SECONDS
  const cols = segmentsPerLine(perLine, seg)

  const byLine = new Map<number, GridCell[]>()
  let maxLine = -1

  for (const w of words) {
    const at = Math.max(0, w.start)
    const line = Math.floor(at / perLine)
    const within = at - line * perLine
    const col = Math.min(cols - 1, Math.floor(within / seg))
    if (line > maxLine) maxLine = line

    let cells = byLine.get(line)
    if (!cells) {
      cells = emptyCells(cols)
      byLine.set(line, cells)
    }
    cells[col].push(w)
  }

  const lines: GridLine[] = []
  for (let i = 0; i <= maxLine; i++) {
    lines.push({
      index: i,
      startSec: i * perLine,
      cells: byLine.get(i) ?? emptyCells(cols),
    })
  }
  return lines
}

/** `m:ss` clock label for a row's start second (line "numbers" are timestamps). */
export function formatClock(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}:${rem.toString().padStart(2, '0')}`
}

/**
 * Which row + column the playhead is in, given the line/segment sizes. Returns
 * null before 0. Used to highlight the current cell as the video plays.
 */
export function gridPosition(
  time: number,
  secondsPerLine: number = DEFAULT_SECONDS_PER_LINE,
  segmentSeconds: number = DEFAULT_SEGMENT_SECONDS,
): { line: number; col: number } | null {
  if (!Number.isFinite(time) || time < 0) return null
  const perLine = Math.max(1, secondsPerLine)
  const seg = segmentSeconds > 0 ? segmentSeconds : DEFAULT_SEGMENT_SECONDS
  const cols = segmentsPerLine(perLine, seg)
  const line = Math.floor(time / perLine)
  const within = time - line * perLine
  const col = Math.min(cols - 1, Math.floor(within / seg))
  return { line, col }
}
