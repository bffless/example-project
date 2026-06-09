import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  buildTranscriptGrid,
  cutColumns,
  formatClock,
  segmentsPerLine,
  windowLines,
  DEFAULT_SECONDS_PER_LINE,
  DEFAULT_SEGMENT_SECONDS,
  type TWord,
  type CutSpan,
  type GridLine,
} from '../../lib/transcriptGrid'
import { SegmentVoiceControl, type SegmentControl } from './SegmentVoiceControl'
import { frameForRow, spriteStyle, type FilmFrame } from '../../lib/filmstrip'

type Props = {
  /** The transcript from `/api/transcribe` — shown on the left ("original"). */
  words: TWord[]
  /** The working/shortened transcript — shown on the right. Defaults to a copy
   *  of `words` until the director/refiner produces a tightened version. */
  editedWords?: TWord[]
  /** Footage spans being dropped (refiner's `cuts`, else the director's), in
   *  original-video seconds. Rendered as red cells on the New pane only — the
   *  Original is an untouched reference; the deletion is from the working
   *  timeline, not the source. */
  cuts?: CutSpan[]
  /** Narration runs — an inline voice control (record / AI / play) renders on the
   *  New pane at each run's start row. */
  segments?: SegmentControl[]
  /** Whether a narration voice has been chosen (enables the AI option). */
  canGenerateAI?: boolean
  onGenerateAI?: (sceneId: string, index: number) => void
  onRecord?: (sceneId: string, index: number, blob: Blob) => void
  /** Hand-edit the cuts by dragging on the grid. The drag's start cell decides
   *  the op: starting on kept footage **adds** a cut (drag to size / extend an
   *  adjacent one); starting on a red cell **removes** (contract or split). The
   *  span is in original-video seconds, snapped to whole cells. Omit to make the
   *  grid read-only (the prep previews). */
  onEditCut?: (span: CutSpan, op: 'add' | 'remove') => void
  /** Adopt a span of the ORIGINAL audio as a New-pane run (story 03d): drag-select
   *  a range on the Original pane to grab it, then click a glowing gap on the New
   *  pane to drop it. `dropTargets` are the empty gaps it may land in. */
  dropTargets?: CutSpan[]
  onAdoptOriginal?: (origStart: number, origEnd: number, dropStart: number) => void
  /** Delete a New-pane run (reopens its gap to make room). */
  onDeleteSegment?: (sceneId: string, index: number) => void
  /** Contact-sheet frames (story 03e) for the time-aligned filmstrip gutter down
   *  the left of the viewer. Empty ⇒ no gutter (e.g. before thumbnails exist). */
  frames?: FilmFrame[]
  /** The source clip's real length, in seconds. The grid is floored to this so
   *  trailing footage with no speech (e.g. the talk ends at 0:50 on a 0:53 clip)
   *  still renders editable rows — otherwise the grid stops at the last word and
   *  that footage can't be seen or cut. */
  duration?: number
  /** Restrict the viewer to one scene's window on the absolute timeline (story
   *  03c "per-scene scope"): rows before `windowStart` (floored to the line) and
   *  at/after `windowEnd` aren't rendered, so the diff shows only the selected
   *  `SceneTabs` tab and switching tabs re-scopes it. Timestamps stay absolute —
   *  scene 2 reads from 1:44, matching its footage span. Omit (0 / Infinity) to
   *  show the whole talk. */
  windowStart?: number
  windowEnd?: number
}

/** An in-progress cut drag: the cell it began on, the cell under the pointer
 *  now, and the op fixed at pointer-down. */
type Drag = { start: number; end: number; op: 'add' | 'remove' }

/** A range being selected on the Original pane (or the grabbed clip). */
type Span = { start: number; end: number }

// One clip plays at a time: stop the previous before starting the next.
let currentAudio: HTMLAudioElement | null = null
function playClip(url: string) {
  if (currentAudio) currentAudio.pause()
  const audio = new Audio(url)
  currentAudio = audio
  void audio.play().catch(() => {})
}

// Resizable split: the Original pane's width as a % of the row, clamped so
// neither pane can collapse. Persisted to localStorage so the panes come back
// the same size after a reload (a view preference, like seconds-per-line).
const SPLIT_KEY = 'studio.diff.leftPct'
const SPLIT_MIN = 20
const SPLIT_MAX = 80
const DEFAULT_SPLIT = 50

function readSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY))
    return Number.isFinite(v) && v >= SPLIT_MIN && v <= SPLIT_MAX ? v : DEFAULT_SPLIT
  } catch {
    return DEFAULT_SPLIT
  }
}

function writeSplit(pct: number) {
  try {
    localStorage.setItem(SPLIT_KEY, String(Math.round(pct)))
  } catch {
    /* private mode / disabled storage — just don't persist */
  }
}

/** Last second any of these words occupies (0 if none / untimed). */
function lastSecond(words: TWord[]): number {
  let max = 0
  for (const w of words) {
    const t = typeof w.end === 'number' ? w.end : typeof w.start === 'number' ? w.start : 0
    if (t > max) max = t
  }
  return max
}

/** Per-pane voice controls — the New pane gets the real controls; the Original
 *  pane gets matching spacers so both stay row-aligned. */
type Controls = {
  canAI: boolean
  onGenerateAI: (sceneId: string, index: number) => void
  onRecord: (sceneId: string, index: number, blob: Blob) => void
  onPlay: (url: string) => void
  onDelete: (sceneId: string, index: number) => void
}

/**
 * A GitHub-diff-style view of the transcript on a time grid. Two panes side by
 * side — original (left) vs the new/shortened transcript (right). Line numbers
 * are timestamps; each row is `secondsPerLine` seconds sliced into
 * `segmentSeconds` cells. Both panes are pinned to the same height so timestamps
 * line up; dropped footage (`cuts`) is filled red on the New pane only (the
 * Original is an untouched reference). Each narration run gets an inline voice
 * control (record / AI / play) on the New pane.
 */
export function TranscriptDiff({
  words,
  editedWords,
  cuts = [],
  segments = [],
  canGenerateAI = false,
  onGenerateAI,
  onRecord,
  onEditCut,
  dropTargets = [],
  onAdoptOriginal,
  onDeleteSegment,
  frames = [],
  duration = 0,
  windowStart = 0,
  windowEnd = Infinity,
}: Props) {
  const [secondsPerLine, setSecondsPerLine] = useState(DEFAULT_SECONDS_PER_LINE)
  const [segmentSeconds, setSegmentSeconds] = useState(DEFAULT_SEGMENT_SECONDS)
  // Tall-rows mode: grow EVERY row to a full frame's height so the filmstrip
  // shows whole frames (not just the centred band) while staying aligned to the
  // words. Default on; toggle off for compact rows + hover-to-peek.
  const [tallRows, setTallRows] = useState(true)
  const right = editedWords ?? words

  // Resizable panes: drag the divider to give the New pane more room. `leftPct`
  // is the Original pane's width; the New pane takes the rest. Lazy-initialised
  // from (and persisted back to) localStorage so it survives a reload.
  const containerRef = useRef<HTMLDivElement>(null)
  const [leftPct, setLeftPct] = useState(readSplit)
  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    if (!resizing) return
    const onMove = (e: PointerEvent) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, pct)))
    }
    const stop = () => setResizing(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
    }
  }, [resizing])

  // Persist only once the drag settles (not on every move), and the no-op write
  // on mount is harmless.
  useEffect(() => {
    if (!resizing) writeSplit(leftPct)
  }, [resizing, leftPct])

  // Cut hand-editing: a pointer-drag across cells (story 03d). The op is fixed at
  // pointer-down by the start cell's state, so the whole gesture either adds or
  // removes. Commit on pointer-up anywhere (window listener) so releasing off the
  // grid still lands the edit. `pending` previews the affected span as you drag.
  const editable = !!onEditCut
  const [drag, setDrag] = useState<Drag | null>(null)

  const onCellDown = useCallback(
    (time: number, isCut: boolean) => {
      if (!editable) return
      setDrag({ start: time, end: time, op: isCut ? 'remove' : 'add' })
    },
    [editable],
  )
  const onCellEnter = useCallback((time: number) => {
    setDrag((d) => (d ? { ...d, end: time } : d))
  }, [])

  useEffect(() => {
    if (!drag || !onEditCut) return
    const commit = () => {
      setDrag((d) => {
        if (d) {
          const start = Math.min(d.start, d.end)
          const end = Math.max(d.start, d.end) + segmentSeconds // include the end cell's slot
          onEditCut({ start, end }, d.op)
        }
        return null
      })
    }
    window.addEventListener('pointerup', commit)
    return () => window.removeEventListener('pointerup', commit)
  }, [drag, onEditCut, segmentSeconds])

  const cutPending: CutSpan | null = drag
    ? { start: Math.min(drag.start, drag.end), end: Math.max(drag.start, drag.end) + segmentSeconds }
    : null

  // Adopt-original (story 03d): a two-step grab-then-place. Step 1 — drag-select a
  // range on the Original pane → `clipSel`, finalised on pointer-up into the
  // grabbed `pendingClip`. Step 2 — the New pane enters "place" mode, glows the
  // gaps, and a click on a gap the clip fits into drops it there.
  const canAdopt = !!onAdoptOriginal
  const [clipSel, setClipSel] = useState<Span | null>(null)
  const [pendingClip, setPendingClip] = useState<Span | null>(null)
  // The New-pane cell the cursor is over while placing — anchors the footprint
  // preview so it shows exactly where (and how many cells) the clip will land.
  const [hoverTime, setHoverTime] = useState<number | null>(null)

  const onSelDown = useCallback(
    (time: number) => {
      if (canAdopt) setClipSel({ start: time, end: time })
    },
    [canAdopt],
  )
  const onSelEnter = useCallback((time: number) => {
    setClipSel((s) => (s ? { ...s, end: time } : s))
  }, [])

  useEffect(() => {
    if (!clipSel) return
    const commit = () => {
      setClipSel((s) => {
        if (s) {
          const start = Math.min(s.start, s.end)
          const end = Math.max(s.start, s.end) + segmentSeconds
          setHoverTime(null) // no stale footprint until the cursor moves onto a gap
          setPendingClip({ start, end })
        }
        return null
      })
    }
    window.addEventListener('pointerup', commit)
    return () => window.removeEventListener('pointerup', commit)
  }, [clipSel, segmentSeconds])

  // Esc cancels a grabbed-but-unplaced clip.
  useEffect(() => {
    if (!pendingClip) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingClip(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingClip])

  const clipDuration = pendingClip ? pendingClip.end - pendingClip.start : 0
  const fitsAt = useCallback(
    (time: number) => dropTargets.some((g) => time >= g.start - 0.05 && time + clipDuration <= g.end + 0.05),
    [dropTargets, clipDuration],
  )
  const onDrop = useCallback(
    (time: number) => {
      if (!pendingClip || !onAdoptOriginal || !fitsAt(time)) return
      onAdoptOriginal(pendingClip.start, pendingClip.end, time)
      setPendingClip(null)
    },
    [pendingClip, onAdoptOriginal, fitsAt],
  )

  // The footprint the clip would occupy at the hovered cell — same cell count as
  // the Original-pane selection — green when it fits the gap, red when it doesn't.
  const placePreview: CutSpan | null =
    pendingClip && hoverTime != null ? { start: hoverTime, end: hoverTime + clipDuration } : null
  const placeFits = hoverTime != null && fitsAt(hoverTime)

  // The grabbed/selecting span to outline on the Original pane.
  const selPreview: CutSpan | null = pendingClip
    ? pendingClip
    : clipSel
      ? { start: Math.min(clipSel.start, clipSel.end), end: Math.max(clipSel.start, clipSel.end) + segmentSeconds }
      : null

  // LEFT pane: drag to grab a clip (disabled once one is grabbed — it just stays
  // outlined until placed or cancelled).
  const leftEdit: CellEdit | null = canAdopt
    ? {
        mode: 'select',
        onCellDown: pendingClip ? () => {} : onSelDown,
        onCellEnter: pendingClip ? () => {} : onSelEnter,
        preview: selPreview,
        previewKind: 'select',
        glow: [],
      }
    : null

  // RIGHT pane: place mode while a clip is grabbed, else cut-paint. In place mode
  // the gaps are faintly tinted (glow) and a footprint preview tracks the cursor.
  const rightEdit: CellEdit | null = pendingClip
    ? {
        mode: 'place',
        onCellEnter: setHoverTime,
        onCellClick: onDrop,
        isValidDrop: fitsAt,
        glow: dropTargets,
        preview: placePreview,
        previewKind: placePreview ? (placeFits ? 'place-ok' : 'place-bad') : null,
      }
    : editable
      ? { mode: 'cut', onCellDown, onCellEnter, preview: cutPending, previewKind: drag?.op ?? null, glow: [] }
      : null

  // Pin both panes to the same span: the latest of either transcript, any cut, or
  // the clip's real `duration`, so they're equal height and trailing footage with
  // no words/cuts (the talk ends before the clip does) still renders editable rows.
  // When scoped to a scene, the floor is the scene's `windowEnd` (its footage runs
  // there even past the last word), not the whole-clip `duration`.
  const span = useMemo(() => {
    const cutEnd = cuts.reduce((m, c) => Math.max(m, c.end), 0)
    const words_ = Math.max(lastSecond(words), lastSecond(right), cutEnd)
    return Number.isFinite(windowEnd) ? Math.max(words_, windowEnd) : Math.max(words_, duration)
  }, [words, right, cuts, duration, windowEnd])

  const controls: Controls | null = onGenerateAI && onRecord
    ? {
        canAI: canGenerateAI,
        onGenerateAI,
        onRecord,
        onPlay: playClip,
        onDelete: onDeleteSegment ?? (() => {}),
      }
    : null

  // A full frame's display height at the gutter width (its real aspect, so it's
  // not letterboxed). The tall-rows toggle grows every row to this; otherwise
  // rows stay at the compact band height.
  const fullRowHeight = useMemo(() => {
    const f = frames[0]
    if (!f?.sheet.cellWidth) return FILMSTRIP_ROW
    return Math.round(f.sheet.cellHeight * (FILMSTRIP_WIDTH / f.sheet.cellWidth))
  }, [frames])
  const rowHeight = tallRows ? fullRowHeight : FILMSTRIP_ROW

  return (
    <div className="border rule bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b rule px-5 py-3">
        <div>
          <p className="meta-label">Transcript · time grid</p>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            Line numbers are timestamps · rows are {secondsPerLine}s, one cell per{' '}
            {segmentSeconds === 1 ? 'second' : `${segmentSeconds}s`} ·{' '}
            <span className="text-terracotta-ink">red</span> = cut ·{' '}
            <span className="text-voice-ink">green</span> = voiced
            {editable && ' · drag empty cells to cut, drag red cells to un-cut'}
            {canAdopt && !pendingClip && ' · drag the Original to reuse its audio'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 font-mono text-[12px] text-ink-mute">
          <label className="flex items-center gap-2">
            seconds / line
            <Select
              value={secondsPerLine}
              onChange={setSecondsPerLine}
              options={LINE_OPTIONS.map((n) => ({ label: String(n), value: n }))}
            />
          </label>
          <label className="flex items-center gap-2">
            segment
            <Select value={segmentSeconds} onChange={setSegmentSeconds} options={SEGMENT_OPTIONS} />
          </label>
          {frames.length > 0 && (
            <button
              type="button"
              aria-pressed={tallRows}
              onClick={() => setTallRows((v) => !v)}
              className={[
                'border rule px-2 py-1 text-ink transition-colors',
                tallRows ? 'bg-ink text-paper' : 'bg-paper hover:bg-paper-deep/40',
              ].join(' ')}
            >
              {tallRows ? 'compact rows' : 'tall frames'}
            </button>
          )}
        </div>
      </div>

      {pendingClip && (
        <div className="flex flex-wrap items-center gap-3 border-b rule bg-voice/10 px-5 py-2 text-[12.5px] text-ink-soft">
          <span>
            Placing <span className="font-mono text-voice-ink">{clipDuration.toFixed(1)}s</span> of
            original audio — click a <span className="text-voice-ink">green</span> gap on the New
            pane to drop it.
          </span>
          <button
            type="button"
            className="ml-auto rounded border border-paper-line px-2 py-0.5 text-[11px] text-ink hover:bg-paper"
            onClick={() => setPendingClip(null)}
          >
            Cancel (Esc)
          </button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row">
        {/* story 03e: a time-aligned frame gutter, left of the Original pane. It
            mirrors the Original pane's row structure (same grid + segment
            spacers) so it stays in lockstep at any zoom. Only meaningful in the
            lg side-by-side layout. */}
        {frames.length > 0 && (
          <div className="hidden shrink-0 border-r rule lg:block" style={{ width: FILMSTRIP_WIDTH }}>
            <Filmstrip
              words={words}
              secondsPerLine={secondsPerLine}
              segmentSeconds={segmentSeconds}
              minSeconds={span}
              windowStart={windowStart}
              windowEnd={windowEnd}
              segments={segments}
              frames={frames}
              rowHeight={rowHeight}
            />
          </div>
        )}
        <div
          ref={containerRef}
          className={['flex min-w-0 flex-1 flex-col lg:flex-row', resizing ? 'select-none' : ''].join(' ')}
          style={{ '--lw': `${leftPct}%` } as CSSProperties}
        >
          <div className="min-w-0 border-b rule lg:basis-[var(--lw)] lg:shrink-0 lg:grow-0 lg:border-b-0">
          <Pane
            label="Original"
            sublabel="from transcription"
            words={words}
            secondsPerLine={secondsPerLine}
            segmentSeconds={segmentSeconds}
            cuts={[]}
            minSeconds={span}
            windowStart={windowStart}
            windowEnd={windowEnd}
            segments={segments}
            controls={null}
            edit={leftEdit}
            rowHeight={rowHeight}
          />
        </div>
        {/* drag handle — only meaningful in the lg side-by-side layout */}
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={(e) => {
            e.preventDefault()
            setResizing(true)
          }}
          className="hidden shrink-0 cursor-col-resize bg-paper-line transition-colors hover:bg-terracotta/50 lg:block lg:w-1.5"
        />
        <div className="min-w-0 lg:flex-1">
          <Pane
            label="New"
            sublabel={editedWords ? 'shortened' : 'copy — shorten in prep'}
            words={right}
            secondsPerLine={secondsPerLine}
            segmentSeconds={segmentSeconds}
            cuts={cuts}
            minSeconds={span}
            windowStart={windowStart}
            windowEnd={windowEnd}
            segments={segments}
            controls={controls}
            edit={rightEdit}
            rowHeight={rowHeight}
          />
        </div>
        </div>
      </div>
    </div>
  )
}

/** Gutter width (px) for the 03e filmstrip — wide enough that a flat row crop is
 *  still legible; only shown in the lg side-by-side layout. */
const FILMSTRIP_WIDTH = 150
/** Gutter row height (px) — matches the grid Row's `min-h-[2rem]` so the frames
 *  stay aligned to the timestamps row-for-row. */
const FILMSTRIP_ROW = 32

const LINE_OPTIONS = [2, 3, 5, 10]
const SEGMENT_OPTIONS = [
  { label: '1s', value: 1 },
  { label: '0.5s', value: 0.5 },
  { label: '0.25s', value: 0.25 },
  { label: '0.1s', value: 0.1 },
]

function Select<T extends number>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { label: string; value: T }[]
}) {
  return (
    <select
      className="border rule bg-paper px-2 py-1 text-ink"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/**
 * Per-cell interaction handed to a pane — three modes:
 * - `cut`    (New pane): pointer-drag to add/remove cuts; `preview` outlines it.
 * - `select` (Original pane): pointer-drag to grab an original-audio span.
 * - `place`  (New pane, while a clip is grabbed): `glow` gaps; click a cell the
 *   clip fits (`isValidDrop`) to drop it (`onCellClick`).
 */
type CellEdit = {
  mode: 'cut' | 'select' | 'place'
  onCellDown?: (time: number, isCut: boolean) => void
  onCellEnter?: (time: number) => void
  onCellClick?: (time: number) => void
  /** A span to outline: the cut being painted, the original span being grabbed,
   *  or — in place mode — the clip's footprint under the cursor. */
  preview: CutSpan | null
  previewKind: 'add' | 'remove' | 'select' | 'place-ok' | 'place-bad' | null
  /** Gaps to faintly tint so the droppable space is visible before hovering. */
  glow: CutSpan[]
  isValidDrop?: (time: number) => boolean
}

type PaneProps = {
  label: string
  sublabel: string
  words: TWord[]
  secondsPerLine: number
  segmentSeconds: number
  cuts: CutSpan[]
  minSeconds: number
  /** Scene window on the absolute timeline — rows outside it are cropped so the
   *  pane shows only the selected scene (story 03c). 0 / Infinity ⇒ whole talk. */
  windowStart: number
  windowEnd: number
  segments: SegmentControl[]
  controls: Controls | null
  edit: CellEdit | null
  /** Minimum height (px) for each grid row — the tall-rows toggle drives this so
   *  the panes grow in lockstep with the filmstrip's full-frame cells. */
  rowHeight: number
}

/**
 * The 03e filmstrip gutter — a frame for each grid row, down the left of the
 * viewer. It runs the SAME `buildTranscriptGrid` + segment-row mapping as the
 * Original pane (and emits the same per-segment spacer), so it stays aligned to
 * the timestamps row-for-row at any zoom — no time→pixel ruler that would drift
 * past the voice-control spacers. Each row shows the contact-sheet frame nearest
 * its start second, sprite-cropped from its sheet (no new image generation).
 */
function Filmstrip({
  words,
  secondsPerLine,
  segmentSeconds,
  minSeconds,
  windowStart,
  windowEnd,
  segments,
  frames,
  rowHeight,
}: {
  words: TWord[]
  secondsPerLine: number
  segmentSeconds: number
  minSeconds: number
  windowStart: number
  windowEnd: number
  segments: SegmentControl[]
  frames: FilmFrame[]
  rowHeight: number
}) {
  const lines = useMemo(
    () =>
      windowLines(
        buildTranscriptGrid(words, secondsPerLine, segmentSeconds, minSeconds),
        windowStart,
        windowEnd,
        secondsPerLine,
      ),
    [words, secondsPerLine, segmentSeconds, minSeconds, windowStart, windowEnd],
  )
  // Same row→segment mapping as a Pane, so the spacers land on the same rows.
  const segRows = useMemo(() => {
    const rows = new Set<number>()
    for (const s of segments) rows.add(Math.floor(Math.max(0, s.start) / secondsPerLine))
    return rows
  }, [segments, secondsPerLine])

  return (
    <div className="bg-paper">
      {/* header height matches a Pane header so row 0 aligns across the columns */}
      <div className="flex items-baseline gap-2 px-4 py-2.5">
        <span className="font-serif text-[15px] text-ink">Frames</span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">video</span>
      </div>
      <div className="pb-2">
        {lines.map((line) => {
          const frame = frameForRow(frames, line.startSec)
          return (
            <div key={line.index}>
              {segRows.has(line.index) && (
                <div className="h-9 border-t border-paper-line/60 bg-paper-deep/20" />
              )}
              {/* Divider on the wrapper (outside the sized box) mirrors the Pane
                  Row's border placement, so the gutter and the panes stay exactly
                  row-aligned (no 1px-per-row drift). Compact rows clip the taller
                  frame to its centred band so it fills the cell, and hover pops
                  the WHOLE frame — the cut-off top and bottom — over its
                  neighbours, with a slight border. In tall-rows mode the cell is
                  already the full frame height, so the whole frame just shows. */}
              <div className="border-t border-paper-line/60">
                <div
                  className="group relative overflow-hidden bg-paper-deep hover:z-10 hover:overflow-visible"
                  style={{ width: FILMSTRIP_WIDTH, height: rowHeight }}
                >
                  {frame && frame.sheet.width > 0 ? (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 bg-paper-deep ring-ink-faint transition-shadow group-hover:ring-1 group-hover:shadow-lg group-hover:shadow-ink/30"
                      style={spriteStyle(frame, FILMSTRIP_WIDTH)}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Pane({
  label,
  sublabel,
  words,
  secondsPerLine,
  segmentSeconds,
  cuts,
  minSeconds,
  windowStart,
  windowEnd,
  segments,
  controls,
  edit,
  rowHeight,
}: PaneProps) {
  const lines = useMemo(
    () =>
      windowLines(
        buildTranscriptGrid(words, secondsPerLine, segmentSeconds, minSeconds),
        windowStart,
        windowEnd,
        secondsPerLine,
      ),
    [words, secondsPerLine, segmentSeconds, minSeconds, windowStart, windowEnd],
  )
  const cols = segmentsPerLine(secondsPerLine, segmentSeconds)
  // cells per whole second — used to draw separators only on second boundaries
  const perSecond = Math.max(1, Math.round(1 / segmentSeconds))

  // Which row each narration run's control lands on (its segment start).
  const segByRow = useMemo(() => {
    const m = new Map<number, SegmentControl>()
    for (const s of segments) m.set(Math.floor(Math.max(0, s.start) / secondsPerLine), s)
    return m
  }, [segments, secondsPerLine])

  // The New pane paints a green span for each VOICED run — from its start across
  // the clip's real measured length — so you can see where the audio ends.
  const voiced = useMemo<CutSpan[]>(
    () =>
      controls
        ? segments
            .filter((s) => s.audioSeconds && s.audioSeconds > 0)
            .map((s) => ({ start: s.start, end: s.start + (s.audioSeconds as number) }))
        : [],
    [controls, segments],
  )

  // gutter (timestamp) + one equal column per time slice
  const template = `3.5rem repeat(${cols}, minmax(0, 1fr))`

  return (
    <div className="bg-paper">
      <div className="flex items-baseline gap-2 px-4 py-2.5">
        <span className="font-serif text-[15px] text-ink">{label}</span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
          {sublabel}
        </span>
      </div>

      {/* single-line rows; clip horizontally so bleeding words never spill into
          the other pane. The pane flexes to its full height — the page scrolls. */}
      <div className="overflow-x-hidden pb-2 font-mono text-[12px] leading-relaxed">
        {lines.length === 0 ? (
          <p className="px-4 py-3 text-ink-mute">No words yet.</p>
        ) : (
          lines.map((line) => {
            const seg = segByRow.get(line.index)
            return (
              <div key={line.index}>
                {seg &&
                  (controls ? (
                    <SegmentVoiceControl
                      segment={seg}
                      canAI={controls.canAI}
                      onGenerateAI={() => controls.onGenerateAI(seg.sceneId, seg.index)}
                      onRecord={(blob) => controls.onRecord(seg.sceneId, seg.index, blob)}
                      onPlay={controls.onPlay}
                      onDelete={() => controls.onDelete(seg.sceneId, seg.index)}
                    />
                  ) : (
                    // Spacer on the Original pane so both panes stay row-aligned.
                    <div className="h-9 border-t border-paper-line/60 bg-paper-deep/20" />
                  ))}
                <Row
                  line={line}
                  template={template}
                  perSecond={perSecond}
                  segmentSeconds={segmentSeconds}
                  cuts={cuts}
                  voiced={voiced}
                  edit={edit}
                  rowHeight={rowHeight}
                />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function Row({
  line,
  template,
  perSecond,
  segmentSeconds,
  cuts,
  voiced,
  edit,
  rowHeight,
}: {
  line: GridLine
  template: string
  perSecond: number
  segmentSeconds: number
  cuts: CutSpan[]
  voiced: CutSpan[]
  edit: CellEdit | null
  rowHeight: number
}) {
  const cutCols = cutColumns(line.startSec, line.cells.length, segmentSeconds, cuts)
  const voicedCols = cutColumns(line.startSec, line.cells.length, segmentSeconds, voiced)
  const previewCols =
    edit?.preview ? cutColumns(line.startSec, line.cells.length, segmentSeconds, [edit.preview]) : []
  const glowCols =
    edit?.glow?.length ? cutColumns(line.startSec, line.cells.length, segmentSeconds, edit.glow) : []

  const mode = edit?.mode
  const draggable = mode === 'cut' || mode === 'select'

  // The footprint preview's fill + outline (place mode); the cut/select previews
  // are outline-only. Keyed off `previewKind` so each gesture reads distinctly.
  const previewClass: Record<NonNullable<CellEdit['previewKind']>, string> = {
    add: 'ring-2 ring-inset ring-terracotta',
    remove: 'ring-2 ring-inset ring-ink-faint',
    select: 'ring-2 ring-inset ring-voice-ink',
    'place-ok': 'bg-voice/40 ring-2 ring-inset ring-voice',
    'place-bad': 'bg-terracotta/30 ring-2 ring-inset ring-terracotta',
  }

  return (
    <div
      className="grid border-t border-paper-line/60"
      // The row track grows to `rowHeight` (tall-rows mode) and the cells stretch
      // to it; their `items-center` keeps the single line of text centred.
      style={{ gridTemplateColumns: template, gridAutoRows: `minmax(${rowHeight}px, auto)` }}
    >
      {/* line "number" = the row's start timestamp */}
      <div className="flex select-none items-center justify-end border-r border-paper-line/60 px-2 text-[11px] text-ink-faint">
        {formatClock(line.startSec)}
      </div>

      {line.cells.map((cell, col) => {
        const time = line.startSec + col * segmentSeconds
        const canDrop = mode === 'place' && (edit?.isValidDrop?.(time) ?? false)
        return (
          <div
            key={col}
            onPointerDown={
              draggable
                ? (e) => {
                    e.preventDefault() // don't start a text selection while dragging
                    edit?.onCellDown?.(time, cutCols[col])
                  }
                : undefined
            }
            onPointerEnter={edit?.onCellEnter ? () => edit.onCellEnter?.(time) : undefined}
            onClick={canDrop ? () => edit?.onCellClick?.(time) : undefined}
            className={[
              'flex min-h-[2rem] items-center px-1',
              draggable ? 'cursor-pointer select-none' : '',
              mode === 'place' ? `select-none ${canDrop ? 'cursor-pointer' : 'cursor-not-allowed'}` : '',
              // separators only on whole-second boundaries, so quarter-slices stay quiet
              col > 0 && col % perSecond === 0 ? 'border-l border-paper-line/50' : '',
              // dropped footage red; else the voiced span green (cut wins on overlap)
              cutCols[col] ? 'bg-terracotta/30' : voicedCols[col] ? 'bg-voice/25' : '',
              // place mode: faintly tint the gaps the clip may land in
              mode === 'place' && glowCols[col] && !cutCols[col] && !voicedCols[col] ? 'bg-voice/10' : '',
              // the active preview (cut paint / clip grab / drop footprint)
              previewCols[col] && edit?.previewKind ? previewClass[edit.previewKind] : '',
            ].join(' ')}
          >
            {/* nowrap + visible overflow: a word sits at its slot and bleeds right
                over the (usually empty) neighbouring slices instead of wrapping. */}
            <span className="whitespace-nowrap text-ink">
              {cell.map((word, i) => (
                <span key={i}>{i > 0 ? ' ' : ''}{word.text}</span>
              ))}
            </span>
          </div>
        )
      })}
    </div>
  )
}
