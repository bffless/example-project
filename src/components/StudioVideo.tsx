import { useState } from 'react'

/**
 * The Studio walkthrough video.
 *
 * The video isn't published yet — set `STUDIO_VIDEO_ID` to the YouTube id once
 * it's live and this renders a click-to-play embed (same UX as VideoEmbed).
 * Until then it shows a "coming soon" placeholder in the matching frame.
 */
const STUDIO_VIDEO_ID: string | null = null

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="ml-1 h-8 w-8">
    <path d="M8 5v14l11-7z" />
  </svg>
)

export function StudioVideo() {
  const [playing, setPlaying] = useState(false)

  return (
    <div className="relative corner-marks border border-ink/10 bg-paper-deep/40 p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="meta-label">Walkthrough</span>
        <span className="meta-label">YouTube · @bffless</span>
      </div>

      <div className="relative aspect-video w-full overflow-hidden border border-ink bg-ink">
        {STUDIO_VIDEO_ID && playing ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${STUDIO_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1`}
            title="Studio walkthrough"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : STUDIO_VIDEO_ID ? (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 h-full w-full"
            aria-label="Play the Studio walkthrough"
          >
            <img
              src={`https://i.ytimg.com/vi/${STUDIO_VIDEO_ID}/maxresdefault.jpg`}
              alt="Studio walkthrough"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span className="absolute inset-0 bg-ink/20 transition-colors group-hover:bg-ink/10" aria-hidden="true" />
            <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-terracotta text-paper shadow-2xl transition-colors group-hover:bg-terracotta-hover">
                <PlayIcon />
              </span>
            </span>
          </button>
        ) : (
          // Unpublished placeholder
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <span
              className="flex h-20 w-20 items-center justify-center rounded-full border border-paper/30 text-paper/60"
              aria-hidden="true"
            >
              <PlayIcon />
            </span>
            <p className="font-serif text-[22px] leading-tight text-paper md:text-[26px]">
              Demo dropping soon
            </p>
            <p className="max-w-md text-[14px] leading-relaxed text-paper/60">
              The full Studio walkthrough is in the cut. Check back — or watch the build series on the{' '}
              <span className="text-paper/80">@bffless</span> channel.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
