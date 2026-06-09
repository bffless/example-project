import type { Ref } from 'react'
import type { Scene } from '../../lib/scenes'

type Props = {
  scenes: Scene[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Ref + classes applied to the tab strip ROW only (the page makes it sticky
   *  and measures it). The "Scenes · chapters" label above stays in normal flow
   *  so it scrolls away — only the tabs pin under the header. */
  tablistRef?: Ref<HTMLDivElement>
  tablistClassName?: string
}

/**
 * The scene queue as a horizontal tab strip — one tab per scene, so the work
 * area below (video + transcript diff) can run the full width of the page. Built
 * scenes are checked off; the active tab carries the terracotta underline. The
 * strip scrolls horizontally when the scenes outrun the page width.
 *
 * The "Scenes · chapters" label and the tab strip are emitted as siblings (no
 * wrapping box) so the page can make ONLY the strip `sticky` — a sticky child is
 * bounded by its parent, so the strip must sit directly in the tall Build column
 * to pin across the whole scroll while the label scrolls away above it.
 */
export function SceneTabs({ scenes, selectedId, onSelect, tablistRef, tablistClassName }: Props) {
  const built = scenes.filter((s) => s.status === 'built').length

  return (
    <>
      {/* -mb-4 trims the Build column's gap-6 back to the original ~8px so the
          label still reads as attached to the tabs below it. */}
      <div className="-mb-4 flex items-baseline justify-between">
        <p className="meta-label">Scenes · chapters</p>
        <p className="font-mono text-[12px] text-ink-mute">
          {built}/{scenes.length} built
        </p>
      </div>
      <div
        ref={tablistRef}
        role="tablist"
        className={['flex gap-1 overflow-x-auto border-b rule', tablistClassName].filter(Boolean).join(' ')}
      >
        {scenes.map((scene) => {
          const active = scene.id === selectedId
          const done = scene.status === 'built'
          return (
            <button
              key={scene.id}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => onSelect(scene.id)}
              className={[
                '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-[13.5px] transition-colors',
                active
                  ? 'border-terracotta text-ink'
                  : 'border-transparent text-ink-soft hover:border-paper-line hover:text-ink',
              ].join(' ')}
            >
              <span
                className={[
                  'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  done
                    ? 'bg-terracotta text-paper'
                    : active
                      ? 'border border-terracotta text-terracotta-ink'
                      : 'border border-paper-line text-ink-faint',
                ].join(' ')}
              >
                {done ? '✓' : scene.index + 1}
              </span>
              <span className="max-w-[14rem] truncate">{scene.title}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}
