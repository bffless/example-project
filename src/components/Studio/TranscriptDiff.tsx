import { useMemo, useState } from 'react'
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
   *  original-video seconds. Rendered as red cells on both panes. */
  cuts?: CutSpan[]
  /** Narration runs — an inline voice control (record / AI / play) renders on the
   *  New pane at each run's start row. */
  segments?: SegmentControl[]
  /** Whether a narration voice has been chosen (enables the AI option). */
  canGenerateAI?: boolean
  onGenerateAI?: (sceneId: string, index: number) => void
  onRecord?: (sceneId: string, index: number, blob: Blob) => void
}

// One clip plays at a time: stop the previous before starting the next.
let currentAudio: HTMLAudioElement | null = null
function playClip(url: string) {
  if (currentAudio) currentAudio.pause()
  const audio = new Audio(url)
  currentAudio = audio
  void audio.play().catch(() => {})
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
}

/**
 * A GitHub-diff-style view of the transcript on a time grid. Two panes side by
 * side — original (left) vs the new/shortened transcript (right). Line numbers
 * are timestamps; each row is `secondsPerLine` seconds sliced into
 * `segmentSeconds` cells. Both panes are pinned to the same height so timestamps
 * line up; dropped footage (`cuts`) is filled red on both. Each narration run
 * gets an inline voice control (record / AI / play) on the New pane.
 */
export function TranscriptDiff({
  words,
  editedWords,
  cuts = [],
  segments = [],
  canGenerateAI = false,
  onGenerateAI,
  onRecord,
}: Props) {
  const [secondsPerLine, setSecondsPerLine] = useState(DEFAULT_SECONDS_PER_LINE)
  const [segmentSeconds, setSegmentSeconds] = useState(DEFAULT_SEGMENT_SECONDS)
  const right = editedWords ?? words

  // Pin both panes to the same span: the latest of either transcript or any cut,
  // so they're equal height and a trailing cut with no words still shows.
  const span = useMemo(() => {
    const cutEnd = cuts.reduce((m, c) => Math.max(m, c.end), 0)
    return Math.max(lastSecond(words), lastSecond(right), cutEnd)
  }, [words, right, cuts])

  const controls: Controls | null = onGenerateAI && onRecord
    ? { canAI: canGenerateAI, onGenerateAI, onRecord, onPlay: playClip }
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
          cuts={cuts}
          minSeconds={span}
          segments={segments}
          controls={null}
        />
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
        />
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
}: {
  line: GridLine
  template: string
  perSecond: number
  segmentSeconds: number
  cuts: CutSpan[]
  voiced: CutSpan[]
}) {
  const cutCols = cutColumns(line.startSec, line.cells.length, segmentSeconds, cuts)
  const voicedCols = cutColumns(line.startSec, line.cells.length, segmentSeconds, voiced)

  return (
    <div className="grid border-t border-paper-line/60" style={{ gridTemplateColumns: template }}>
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
            // dropped footage red; else the voiced span green (cut wins on overlap)
            cutCols[col] ? 'bg-terracotta/30' : voicedCols[col] ? 'bg-voice/25' : '',
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
