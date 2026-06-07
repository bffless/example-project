import { type ReactNode } from 'react'
import { formatTime } from '../../lib/edl'
import {
  alignment,
  narrationSeconds,
  sceneVideoSeconds,
  wordCount,
  type Alignment,
  type Scene,
} from '../../lib/scenes'

type Props = {
  scene: Scene
  className?: string
}

/**
 * At-a-glance facts about the selected scene, shown beside the (capped) video so
 * the space to its right isn't wasted. Everything here is derived from the Scene
 * — footage span, the director's cuts, how hard the script was condensed, and
 * (once voiced) whether the narration fits the footage.
 */
export function SceneMeta({ scene, className = '' }: Props) {
  const span = sceneVideoSeconds(scene)
  const cuts = scene.cuts ?? []
  const dropped = cuts.reduce((sum, c) => sum + Math.max(0, c.end - c.start), 0)
  const net = Math.max(0, span - dropped)

  const origWords = wordCount(scene.transcript)
  const draftWords = wordCount(scene.draftText)
  const reduction = origWords > 0 ? Math.round((1 - draftWords / origWords) * 100) : 0

  const estNarration = narrationSeconds(scene.draftText)
  const align = alignment(scene)
  const done = scene.status === 'built'

  return (
    <div className={['border rule bg-paper-deep/30 p-5', className].join(' ')}>
      <div className="flex items-center justify-between gap-3">
        <p className="meta-label">Scene {scene.index + 1}</p>
        <span
          className={[
            'rounded-full px-2.5 py-0.5 font-mono text-[11px]',
            done ? 'bg-terracotta text-paper' : 'border border-paper-line text-ink-mute',
          ].join(' ')}
        >
          {done ? 'built' : 'pending'}
        </span>
      </div>
      <h3 className="mt-1 font-serif text-[20px] leading-tight text-ink">{scene.title}</h3>

      <dl className="mt-4 flex flex-col divide-y divide-paper-line/60 text-[13px]">
        <Stat label="Footage span">
          <span className="font-mono">
            {formatTime(scene.start)}–{formatTime(scene.end)}
          </span>
        </Stat>
        <Stat label="Duration">
          <span className="font-mono">{formatTime(span)}</span>
        </Stat>
        <Stat label="Cuts">
          {cuts.length === 0 ? (
            <span className="text-ink-mute">none</span>
          ) : (
            <span className="font-mono">
              {cuts.length} · <span className="text-terracotta-ink">−{formatTime(dropped)}</span>
            </span>
          )}
        </Stat>
        {cuts.length > 0 && (
          <Stat label="Net runtime">
            <span className="font-mono">{formatTime(net)}</span>
          </Stat>
        )}
        <Stat label="Script">
          <span className="font-mono">
            {origWords.toLocaleString()} → {draftWords.toLocaleString()} words
            {origWords > 0 && draftWords < origWords && (
              <span className="text-terracotta-ink"> −{reduction}%</span>
            )}
          </span>
        </Stat>
        <Stat label="Est. narration">
          <span className="font-mono">{formatTime(estNarration)}</span>
        </Stat>
        <Stat label="Voice">
          {scene.narrationSeconds == null ? (
            <span className="text-ink-mute">not voiced</span>
          ) : (
            <span className="font-mono">
              {formatTime(scene.narrationSeconds)}
              {align && (
                <span
                  className={align.status === 'aligned' ? 'text-ink-mute' : 'text-terracotta-ink'}
                >
                  {' · '}
                  {alignLabel(align)}
                </span>
              )}
            </span>
          )}
        </Stat>
      </dl>
    </div>
  )
}

/** "aligned", or e.g. "long +0:03" / "short −0:05" relative to the footage. */
function alignLabel(a: Alignment): string {
  if (a.status === 'aligned') return 'aligned'
  const sign = a.deltaSeconds < 0 ? '−' : '+'
  return `${a.status} ${sign}${formatTime(Math.abs(a.deltaSeconds))}`
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  )
}
