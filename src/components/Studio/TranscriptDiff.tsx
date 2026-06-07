import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  buildTranscriptGrid,
  cutColumns,
  formatClock,
  segmentsPerLine,
  DEFAULT_SECONDS_PER_LINE,
  DEFAULT_SEGMENT_SECONDS,
  type TWord,
  type CutSpan,
  type GridLine,
} from '../../lib/transcriptGrid'
import { SegmentVoiceControl, type SegmentControl } from './SegmentVoiceControl'

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
}: Props) {
  const [secondsPerLine, setSecondsPerLine] = useState(DEFAULT_SECONDS_PER_LINE)
  const [segmentSeconds, setSegmentSeconds] = useState(DEFAULT_SEGMENT_SECONDS)
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

  // Pin both panes to the same span: the latest of either transcript or any cut,
  // so they're equal height and a trailing cut with no words still shows.
  const span = useMemo(() => {
    const cutEnd = cuts.reduce((m, c) => Math.max(m, c.end), 0)
    return Math.max(lastSecond(words), lastSecond(right), cutEnd)
  }, [words, right, cuts])

  const controls: Controls | null = onGenerateAI && onRecord
    ? {
        canAI: canGenerateAI,
        onGenerateAI,
        onRecord,
        onPlay: playClip,
        onDelete: onDeleteSegment ?? (() => {}),
      }
    : null

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

      <div
        ref={containerRef}
        className={['flex flex-col lg:flex-row', resizing ? 'select-none' : ''].join(' ')}
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
            segments={segments}
            controls={null}
            edit={leftEdit}
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
            segments={segments}
            controls={controls}
            edit={rightEdit}
          />
        </div>
      </div>
    </div>
  )
}

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
  segments: SegmentControl[]
  controls: Controls | null
  edit: CellEdit | null
}

function Pane({
  label,
  sublabel,
  words,
  secondsPerLine,
  segmentSeconds,
  cuts,
  minSeconds,
  segments,
  controls,
  edit,
}: PaneProps) {
  const lines = useMemo(
    () => buildTranscriptGrid(words, secondsPerLine, segmentSeconds, minSeconds),
    [words, secondsPerLine, segmentSeconds, minSeconds],
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
}: {
  line: GridLine
  template: string
  perSecond: number
  segmentSeconds: number
  cuts: CutSpan[]
  voiced: CutSpan[]
  edit: CellEdit | null
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
    <div className="grid border-t border-paper-line/60" style={{ gridTemplateColumns: template }}>
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
