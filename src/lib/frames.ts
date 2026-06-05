/**
 * Browser-side frame capture. Seeks a detached <video> to a set of timestamps
 * and draws each frame to a canvas — used for the filmstrip and to grab one
 * thumbnail per scene.
 */

/** Capture `count` evenly-spaced JPEG-dataURL frames across the clip. */
export async function captureFrames(
  src: string,
  duration: number,
  count: number,
  height = 48,
): Promise<string[]> {
  if (!Number.isFinite(duration) || duration <= 0 || count <= 0) return []
  const times = Array.from({ length: count }, (_, i) =>
    Math.min(duration - 0.05, (i + 0.5) * (duration / count)),
  )
  return captureFramesAt(src, times, height)
}

/** Capture one JPEG-dataURL frame at each of the given timestamps (seconds). */
export async function captureFramesAt(
  src: string,
  times: number[],
  height = 48,
): Promise<string[]> {
  if (times.length === 0) return []

  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.src = src
    video.muted = true
    video.crossOrigin = 'anonymous'
    const canvas = document.createElement('canvas')
    const out: string[] = []

    const seekTo = (i: number) => {
      if (i >= times.length) return resolve(out)
      video.currentTime = times[i]
    }

    video.addEventListener('loadeddata', () => seekTo(0))
    video.addEventListener('seeked', () => {
      const ratio = video.videoWidth / video.videoHeight || 16 / 9
      canvas.height = height
      canvas.width = Math.round(height * ratio)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        out.push(canvas.toDataURL('image/jpeg', 0.6))
      }
      seekTo(out.length)
    })
    video.addEventListener('error', () => resolve(out))
  })
}
