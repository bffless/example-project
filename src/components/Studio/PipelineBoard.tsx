import type { Stage, StageId } from '../../lib/pipeline'
import { StageCard } from './StageCard'

type Props = {
  stages: Stage[]
  /** The next step to run — its card shows the action button. */
  currentStageId?: StageId | null
  /** A step is in flight. */
  busy?: boolean
  /** Run the current step. */
  onAction?: () => void
}

/**
 * The board of "notes" — every prep step, visible up front and checking off as
 * it goes. Prep is step by step now: the current step shows its action button;
 * earlier steps are checked off, later ones wait their turn.
 */
export function PipelineBoard({ stages, currentStageId, busy, onAction }: Props) {
  const done = stages.filter((s) => s.status === 'done').length

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="meta-label">The plan · {stages.length} steps</p>
        <p className="font-mono text-[12px] text-ink-mute">
          {done}/{stages.length} done
        </p>
      </div>
      <ol className="overflow-hidden border rule">
        {stages.map((stage, i) => (
          <StageCard
            key={stage.id}
            stage={stage}
            index={i}
            current={stage.id === currentStageId}
            busy={busy}
            onAction={onAction}
          />
        ))}
      </ol>
    </div>
  )
}
