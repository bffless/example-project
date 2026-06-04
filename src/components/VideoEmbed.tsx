import { useState } from 'react'
import { type Episode, thumbHi, thumbLo, watchUrl } from '../lib/episodes'

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="ml-1 h-8 w-8">
    <path d="M8 5v14l11-7z" />
  </svg>
)

const YouTubeIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M23.498 6.186a2.999 2.999 0 0 0-2.115-2.122C19.505 3.55 12 3.55 12 3.55s-7.505 0-9.383.514A2.999 2.999 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a2.999 2.999 0 0 0 2.115 2.122C4.495 20.45 12 20.45 12 20.45s7.505 0 9.383-.514a2.999 2.999 0 0 0 2.115-2.122C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.546 15.568V8.432L15.818 12l-6.272 3.568z" />
  </svg>
)

type Props = {
  /** One or more episodes; when more than one, a selector list is shown. */
  episodes: Episode | Episode[]
  /** Small label above the player, e.g. "Watch" */
  label?: string
}

export function VideoEmbed({ episodes, label = 'Watch' }: Props) {
  const list = Array.isArray(episodes) ? episodes : [episodes]
  const [activeId, setActiveId] = useState(list[0].id)
  const [playing, setPlaying] = useState(false)
  const active = list.find((e) => e.id === activeId) ?? list[0]
  const multi = list.length > 1

  const select = (id: string) => {
    setActiveId(id)
    setPlaying(false)
  }

  return (
    <div className="relative corner-marks border border-ink/10 bg-paper-deep/40 p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="meta-label">
          {label}
          {active.ep ? ` · Episode ${active.ep}` : ''}
        </span>
        <span className="meta-label">YouTube · @bffless</span>
      </div>

      <div className={multi ? 'grid gap-4 md:gap-6 lg:grid-cols-12' : ''}>
        {multi && (
          <ol className="order-2 space-y-2 lg:order-1 lg:col-span-4" aria-label="Episodes">
            {list.map((v) => {
              const isActive = v.id === active.id
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => select(v.id)}
                    aria-current={isActive ? 'true' : undefined}
                    className={[
                      'group flex w-full items-center gap-3 border p-2 text-left transition-colors',
                      isActive
                        ? 'border-ink bg-paper'
                        : 'border-transparent hover:border-ink/30 hover:bg-paper/70',
                    ].join(' ')}
                  >
                    <span className="relative aspect-video w-[88px] flex-shrink-0 overflow-hidden bg-ink/10">
                      <img
                        src={thumbLo(v.id)}
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      {isActive && (
                        <span
                          className="absolute inset-0 ring-2 ring-inset ring-terracotta"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="mb-1 block meta-label">
                        {v.ep ? `EP ${v.ep}` : 'Walkthrough'}
                        {isActive ? ' · Now playing' : ''}
                      </span>
                      <span
                        className={[
                          'block font-serif text-[15px] leading-[1.2] tracking-[-0.005em]',
                          isActive ? 'text-ink' : 'text-ink-soft group-hover:text-ink',
                        ].join(' ')}
                      >
                        {v.title}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}

        <div className={multi ? 'order-1 lg:order-2 lg:col-span-8' : ''}>
          <div className="relative aspect-video w-full overflow-hidden border border-ink bg-ink">
            {playing ? (
              <iframe
                key={active.id}
                className="absolute inset-0 h-full w-full"
                src={`https://www.youtube-nocookie.com/embed/${active.id}?autoplay=1&rel=0&modestbranding=1`}
                title={active.title}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                className="group absolute inset-0 h-full w-full"
                aria-label={`Play ${active.title}`}
              >
                <img
                  src={thumbHi(active.id)}
                  onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).src = thumbLo(active.id)
                  }}
                  alt={active.title}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <span
                  className="absolute inset-0 bg-ink/20 transition-colors group-hover:bg-ink/10"
                  aria-hidden="true"
                />
                <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                  <span className="flex h-20 w-20 items-center justify-center rounded-full bg-terracotta text-paper shadow-2xl transition-colors group-hover:bg-terracotta-hover">
                    <PlayIcon />
                  </span>
                </span>
              </button>
            )}
          </div>

          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="mb-2 meta-label">
                {active.ep ? `Episode ${active.ep}` : 'Walkthrough'}
              </p>
              <h3 className="font-serif text-[22px] leading-tight tracking-[-0.01em] text-ink md:text-[26px]">
                {active.title}
              </h3>
            </div>
            <a
              href={watchUrl(active.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="pill-ghost flex-shrink-0 self-start sm:self-end"
            >
              <YouTubeIcon />
              Watch on YouTube
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
