import { useEffect, useRef, useState } from 'react'

type Props = {
  file: File
  height?: number
}

/**
 * Decodes the clip's audio with the WebAudio API and paints a min/max waveform
 * to a canvas. This is the surface where loud transients (coughs, swallows) and
 * — in a later phase — AI-flagged regions get visualized against the timeline.
 */
export function Waveform({ file, height = 56 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<{ min: number; max: number }[] | null>(null)
  const [failed, setFailed] = useState(false)

  // Decode audio → downsample to ~2000 buckets of min/max amplitude. The
  // parent remounts this via a `key` per file, so initial state is already
  // fresh — no synchronous resets needed here.
  useEffect(() => {
    let cancelled = false

    file
      .arrayBuffer()
      .then((buf) => {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new Ctx()
        return ctx.decodeAudioData(buf).finally(() => void ctx.close())
      })
      .then((audio) => {
        if (cancelled) return
        const channel = audio.getChannelData(0)
        const buckets = 2000
        const size = Math.floor(channel.length / buckets) || 1
        const out: { min: number; max: number }[] = []
        for (let i = 0; i < buckets; i++) {
          let min = 1
          let max = -1
          for (let j = 0; j < size; j++) {
            const v = channel[i * size + j] ?? 0
            if (v < min) min = v
            if (v > max) max = v
          }
          out.push({ min, max })
        }
        setPeaks(out)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [file])

  // Draw whenever peaks arrive or the element resizes.
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !peaks) return

    function draw() {
      const w = wrap!.clientWidth
      const dpr = window.devicePixelRatio || 1
      canvas!.width = w * dpr
      canvas!.height = height * dpr
      const ctx = canvas!.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, w, height)
      ctx.fillStyle = 'rgba(58, 53, 46, 0.55)' // ink-soft
      const mid = height / 2
      for (let x = 0; x < w; x++) {
        const p = peaks![Math.floor((x / w) * peaks!.length)]
        if (!p) continue
        const top = mid - p.max * mid
        const bot = mid - p.min * mid
        ctx.fillRect(x, top, 1, Math.max(1, bot - top))
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [peaks, height])

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      {!peaks && !failed && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-mute">
          Reading audio…
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-mute">
          No decodable audio track
        </div>
      )}
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
}
