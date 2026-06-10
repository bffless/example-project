import { useMemo } from 'react'
import { formatClock } from '../../lib/transcriptGrid'
import type { TranscriptWord } from '../../store/studioSlice'

type Props = {
  words: TranscriptWord[]
  /** Seconds per timestamped paragraph. Keep it coarse — this is a "yes, I have
   *  the transcript" read, not the time grid. */
  chunkSeconds?: number
}

/** Bucket words into coarse, timestamped paragraphs so the transcript reads. */
function paragraphs(words: TranscriptWord[], chunkSeconds: number) {
  const rows: { start: number; text: string }[] = []
  for (const w of words) {
    const bucket = Math.floor(w.start / chunkSeconds)
    const last = rows[rows.length - 1]
    if (last && Math.floor(last.start / chunkSeconds) === bucket) {
      last.text += ` ${w.text}`
    } else {
      rows.push({ start: bucket * chunkSeconds, text: w.text })
    }
  }
  return rows
}

/**
 * A plain, scrollable read of the transcript — light timestamps down the left,
 * the words flowing on the right. Just enough to confirm "yes, it's
 * transcribed" without the full time-grid machinery (that lives in the build
 * step now).
 */
export function TranscriptText({ words, chunkSeconds = 15 }: Props) {
  const rows = useMemo(() => paragraphs(words, chunkSeconds), [words, chunkSeconds])

  return (
    <div className="border rule bg-paper">
      <div className="flex items-baseline justify-between border-b rule px-5 py-3">
        <p className="meta-label">Transcript</p>
        <p className="font-mono text-[12px] text-ink-mute">
          {words.length.toLocaleString()} words
        </p>
      </div>

      <div className="max-h-[20rem] overflow-y-auto px-5 py-4">
        {rows.length === 0 ? (
          <p className="text-[13px] text-ink-mute">No words yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <p key={r.start} className="flex gap-3 text-[14px] leading-relaxed text-ink">
                <span className="select-none pt-0.5 font-mono text-[11px] text-ink-faint">
                  {formatClock(r.start)}
                </span>
                <span>{r.text}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
