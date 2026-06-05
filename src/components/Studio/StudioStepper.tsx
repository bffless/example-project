import { PHASES, type StudioPhase } from '../../lib/pipeline'

type Props = { phase: StudioPhase }

/**
 * The top-level "where am I" stepper for the whole producer journey:
 * Import → Prep → Build → Export. Orientation only — the deliberate per-step
 * actions live in the prep board below it. Mirrors `StageCard`'s glyph language:
 * terracotta fill = done, ringed = current, faint = upcoming.
 */
export function StudioStepper({ phase }: Props) {
  const activeIndex = PHASES.findIndex((p) => p.id === phase)

  return (
    <ol className="flex items-center gap-2">
      {PHASES.map((p, i) => {
        const done = i < activeIndex
        const current = i === activeIndex
        return (
          <li key={p.id} className="flex flex-1 items-center gap-2 last:flex-none">
            <div className="flex items-center gap-2.5">
              <span
                className={[
                  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-colors',
                  done
                    ? 'bg-terracotta text-paper'
                    : current
                      ? 'border-2 border-terracotta text-terracotta-ink'
                      : 'border border-paper-line text-ink-faint',
                ].join(' ')}
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                className={[
                  'font-serif text-[15px] leading-none whitespace-nowrap',
                  current ? 'text-ink' : done ? 'text-ink-soft' : 'text-ink-faint',
                ].join(' ')}
              >
                {p.label}
              </span>
            </div>
            {i < PHASES.length - 1 && (
              <span
                className={[
                  'h-px flex-1 transition-colors',
                  done ? 'bg-terracotta/50' : 'bg-paper-line',
                ].join(' ')}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
