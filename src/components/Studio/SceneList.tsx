import { formatTime } from '../../lib/edl'
import type { Scene } from '../../lib/scenes'

type Props = {
  scenes: Scene[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * The scene queue — also the YouTube chapter list. Each scene is a unit you
 * build one at a time; built ones are checked off.
 */
export function SceneList({ scenes, selectedId, onSelect }: Props) {
  const built = scenes.filter((s) => s.status === 'built').length

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="meta-label">Scenes · chapters</p>
        <p className="font-mono text-[12px] text-ink-mute">
          {built}/{scenes.length} built
        </p>
      </div>
      <ol className="flex flex-col gap-2">
        {scenes.map((scene) => {
          const active = scene.id === selectedId
          const done = scene.status === 'built'
          return (
            <li key={scene.id}>
              <button
                type="button"
                onClick={() => onSelect(scene.id)}
                className={[
                  'flex w-full items-center gap-3 border-l-2 bg-paper px-3 py-2.5 text-left transition-colors',
                  active
                    ? 'border-terracotta bg-terracotta/5'
                    : done
                      ? 'border-paper-line opacity-70 hover:opacity-100'
                      : 'border-paper-line hover:bg-paper-deep/40',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                    done
                      ? 'bg-terracotta text-paper'
                      : 'border border-paper-line text-ink-faint',
                  ].join(' ')}
                >
                  {done ? '✓' : scene.index + 1}
                </span>
                {scene.thumb ? (
                  <img
                    src={scene.thumb}
                    alt=""
                    className="h-8 w-14 flex-shrink-0 rounded object-cover"
                    draggable={false}
                  />
                ) : (
                  <span className="h-8 w-14 flex-shrink-0 rounded bg-ink/10" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-ink">{scene.title}</span>
                  <span className="block font-mono text-[11px] text-ink-mute">
                    {formatTime(scene.start)}–{formatTime(scene.end)}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
