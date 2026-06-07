import { useEffect, useRef } from 'react'
import { useRecorder } from './useRecorder'
import { formatTime } from '../../lib/edl'

/** One narration run's voice state + position, for the inline diff-viewer control. */
export type SegmentControl = {
  sceneId: string
  /** Segment index within its scene. */
  index: number
  /** Anchor time (original-video seconds) — places the control on its row. */
  start: number
  text: string
  audioUrl?: string
  audioSeconds?: number
  audioSource?: 'ai' | 'recorded'
  /** This segment is mid-voicing (AI call or record upload). */
  busy: boolean
}

type Props = {
  segment: SegmentControl
  /** Whether a narration voice exists (enables the AI option). */
  canAI: boolean
  onGenerateAI: () => void
  onRecord: (blob: Blob) => void
  onPlay: (url: string) => void
}

const btn =
  'rounded border border-paper-line px-1.5 py-0.5 text-[11px] text-ink transition-colors hover:bg-paper disabled:opacity-50'

/**
 * Inline, per-segment voice control shown in the diff viewer at each narration
 * run's start row. Two ways to voice a run: **record it yourself** (mic, so it's
 * actually you) or **AI-generate** it in the saved voice. Once voiced, a play
 * button + length + source ("you"/"AI") show, with re-record / re-AI. Kept to one
 * row tall so the two diff panes stay aligned.
 */
export function SegmentVoiceControl({ segment, canAI, onGenerateAI, onRecord, onPlay }: Props) {
  const recorder = useRecorder()
  const submitted = useRef(false)

  // A take is a quick one-shot: as soon as it stops, hand the blob up to upload
  // and reset back to idle (no separate "use this take" step).
  useEffect(() => {
    if (recorder.status === 'recorded' && recorder.blob && !submitted.current) {
      submitted.current = true
      onRecord(recorder.blob)
      recorder.reset()
    }
    if (recorder.status === 'idle') submitted.current = false
  }, [recorder.status, recorder.blob, onRecord, recorder])

  const { audioUrl, audioSeconds, audioSource, busy } = segment

  return (
    <div className="flex h-9 items-center gap-2 overflow-hidden border-t border-paper-line/60 bg-paper-deep/40 px-2 text-[11px]">
      <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">voice</span>

      {recorder.status === 'recording' ? (
        <>
          <span className="flex items-center gap-1 font-mono text-terracotta-ink">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-terracotta-ink" />
            {formatTime(recorder.elapsed)}
          </span>
          <button type="button" className={btn} onClick={recorder.stop}>
            ■ Stop
          </button>
        </>
      ) : busy ? (
        <span className="text-ink-mute">Saving…</span>
      ) : (
        <>
          {audioUrl && (
            <>
              <button
                type="button"
                className="flex h-4 w-4 items-center justify-center rounded-full bg-terracotta text-[8px] text-paper hover:bg-terracotta-ink"
                onClick={() => onPlay(audioUrl)}
                title="Play this run"
                aria-label="Play this run"
              >
                ▶
              </button>
              <span className="font-mono text-ink-mute">
                {(audioSeconds ?? 0).toFixed(1)}s · {audioSource === 'recorded' ? 'you' : 'AI'}
              </span>
            </>
          )}
          <button type="button" className={btn} onClick={() => void recorder.start()}>
            ● {audioUrl ? 'Re-record' : 'Record'}
          </button>
          <button
            type="button"
            className={btn}
            disabled={!canAI}
            onClick={onGenerateAI}
            title={canAI ? undefined : 'Choose a narration voice in prep first'}
          >
            ✨ {audioUrl ? 'Re-AI' : 'AI'}
          </button>
        </>
      )}

      {recorder.error && (
        <span className="truncate font-mono text-terracotta-ink">{recorder.error}</span>
      )}
    </div>
  )
}
