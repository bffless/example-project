import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import {
  buildTranscriptGrid,
  formatClock,
  gridPosition,
  segmentsPerLine,
  DEFAULT_SECONDS_PER_LINE,
  DEFAULT_SEGMENT_SECONDS,
  type TWord,
  type GridLine,
} from '../../lib/transcriptGrid'

type Props = {
  /** The transcript from `/api/transcribe` — shown on the left ("original"). */
  words: TWord[]
  /** The working/shortened transcript — shown on the right. Defaults to a copy
   *  of `words` until shorten+segment (story 03) produces a tightened version. */
  editedWords?: TWord[]
  /** Video playhead, in seconds — highlights the cell currently being spoken. */
  currentTime?: number
}

const LINE_OPTIONS = [2, 3, 5, 10]
const SEGMENT_OPTIONS = [
  { label: '1s', value: 1 },
  { label: '0.5s', value: 0.5 },
  { label: '0.25s', value: 0.25 },
  { label: '0.1s', value: 0.1 },
]

/**
 * A GitHub-diff-style view of the transcript on a time grid. Two panes side by
 * side — original (left) vs the new/shortened transcript (right). In each pane
 * the "line numbers" are timestamps and every row is `secondsPerLine` seconds
 * sliced into `segmentSeconds` cells (quarter-seconds by default, so the 2–3
 * words/second of real speech each land in their own slot). Words sit in the
 * slice they're spoken; reading left→right then down follows the audio. As the
 * video plays, the cell under the playhead lights up.
 */
export function TranscriptDiff({ words, editedWords, currentTime = 0 }: Props) {
  const [secondsPerLine, setSecondsPerLine] = useState(DEFAULT_SECONDS_PER_LINE)
  const [segmentSeconds, setSegmentSeconds] = useState(DEFAULT_SEGMENT_SECONDS)
  const right = editedWords ?? words

  return (
    <div className="border rule bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b rule px-5 py-3">
        <div>
          <p className="meta-label">Transcript · time grid</p>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            Line numbers are timestamps · rows are {secondsPerLine}s, one cell per{' '}
            {segmentSeconds === 1 ? 'second' : `${segmentSeconds}s`}
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

      <div className="grid gap-px bg-paper-line lg:grid-cols-2">
        <Pane
          label="Original"
          sublabel="from transcription"
          words={words}
          secondsPerLine={secondsPerLine}
          segmentSeconds={segmentSeconds}
          currentTime={currentTime}
        />
        <Pane
          label="New"
          sublabel={editedWords ? 'shortened' : 'copy — shorten in prep'}
          words={right}
          secondsPerLine={secondsPerLine}
          segmentSeconds={segmentSeconds}
          currentTime={currentTime}
        />
      </div>
    </div>
  )
}

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

type PaneProps = {
  label: string
  sublabel: string
  words: TWord[]
  secondsPerLine: number
  segmentSeconds: number
  currentTime: number
}

function Pane({ label, sublabel, words, secondsPerLine, segmentSeconds, currentTime }: PaneProps) {
  const lines = useMemo(
    () => buildTranscriptGrid(words, secondsPerLine, segmentSeconds),
    [words, secondsPerLine, segmentSeconds],
  )
  const pos = gridPosition(currentTime, secondsPerLine, segmentSeconds)
  const cols = segmentsPerLine(secondsPerLine, segmentSeconds)
  // cells per whole second — used to draw separators only on second boundaries
  const perSecond = Math.max(1, Math.round(1 / segmentSeconds))
  const activeLine = pos ? pos.line : null

  // gutter (timestamp) + one equal column per time slice
  const template = `3.5rem repeat(${cols}, minmax(0, 1fr))`

  // Follow the playhead: keep the active row in view, scrolling only this pane's
  // container (never the page) and only when the row has drifted out of sight.
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const cont = scrollRef.current
    const el = activeRowRef.current
    if (!cont || !el) return
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (top < cont.scrollTop || bottom > cont.scrollTop + cont.clientHeight) {
      cont.scrollTop = top - cont.clientHeight / 2 + el.offsetHeight / 2
    }
  }, [activeLine])

  return (
    <div className="bg-paper">
      <div className="flex items-baseline gap-2 px-4 py-2.5">
        <span className="font-serif text-[15px] text-ink">{label}</span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
          {sublabel}
        </span>
      </div>

      {/* single-line rows; clip horizontally so bleeding words never spill into
          the other pane, and scroll vertically to follow playback. */}
      <div
        ref={scrollRef}
        className="relative max-h-[26rem] overflow-y-auto overflow-x-hidden pb-2 font-mono text-[12px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <p className="px-4 py-3 text-ink-mute">No words yet.</p>
        ) : (
          lines.map((line) => (
            <Row
              key={line.index}
              ref={line.index === activeLine ? activeRowRef : undefined}
              line={line}
              template={template}
              perSecond={perSecond}
              activeCol={pos && pos.line === line.index ? pos.col : null}
            />
          ))
        )}
      </div>
    </div>
  )
}

function Row({
  ref,
  line,
  template,
  perSecond,
  activeCol,
}: {
  ref?: Ref<HTMLDivElement>
  line: GridLine
  template: string
  perSecond: number
  activeCol: number | null
}) {
  return (
    <div
      ref={ref}
      className={[
        'grid border-t border-paper-line/60',
        activeCol !== null ? 'bg-terracotta/5' : '',
      ].join(' ')}
      style={{ gridTemplateColumns: template }}
    >
      {/* line "number" = the row's start timestamp */}
      <div className="flex select-none items-center justify-end border-r border-paper-line/60 px-2 text-[11px] text-ink-faint">
        {formatClock(line.startSec)}
      </div>

      {line.cells.map((cell, col) => (
        <div
          key={col}
          className={[
            'flex min-h-[2rem] items-center px-1',
            // separators only on whole-second boundaries, so quarter-slices stay quiet
            col > 0 && col % perSecond === 0 ? 'border-l border-paper-line/50' : '',
            activeCol === col ? 'bg-terracotta/15' : '',
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
      ))}
    </div>
  )
}
