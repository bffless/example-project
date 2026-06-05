import { useEffect, useRef, type RefObject } from 'react'
import { cutAt, type Cut } from '../../lib/edl'

type Props = {
  src: string
  videoRef: RefObject<HTMLVideoElement | null>
  cuts: Cut[]
  onTime: (time: number) => void
  onLoaded: (duration: number) => void
}

/**
 * Plays the ORIGINAL file but skips over cut regions, so you preview the edited
 * result without rendering anything. The skip happens on `timeupdate`: if the
 * playhead lands inside a cut, we jump it to the cut's end.
 */
export function PreviewPlayer({ src, videoRef, cuts, onTime, onLoaded }: Props) {
  // Keep the latest cuts in a ref so the timeupdate handler never goes stale.
  const cutsRef = useRef<Cut[]>(cuts)
  useEffect(() => {
    cutsRef.current = cuts
  }, [cuts])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    function onTimeUpdate() {
      const hit = cutAt(cutsRef.current, video!.currentTime)
      if (hit) {
        video!.currentTime = Math.min(hit.end, video!.duration || hit.end)
        return
      }
      onTime(video!.currentTime)
    }
    function onMeta() {
      onLoaded(video!.duration)
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('loadedmetadata', onMeta)
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('loadedmetadata', onMeta)
    }
  }, [videoRef, onTime, onLoaded])

  return (
    <div className="overflow-hidden border rule bg-ink">
      <video
        ref={videoRef}
        src={src}
        controls
        className="block aspect-video w-full bg-ink"
      />
    </div>
  )
}
