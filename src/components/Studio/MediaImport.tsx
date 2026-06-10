import { useRef, useState, type DragEvent } from 'react'

type Props = {
  onSelect: (file: File) => void
}

/**
 * Phase 0–1 entry point: import-only. Drag a screen recording in or pick one.
 * (A built-in recorder is a later phase.) We hand the raw File up; the page
 * owns the object URL lifecycle.
 */
export function MediaImport({ onSelect }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function accept(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('video/')) {
      setError('That doesn’t look like a video file.')
      return
    }
    setError(null)
    onSelect(file)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    accept(e.dataTransfer.files?.[0])
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={[
        'corner-marks flex flex-col items-center justify-center gap-4 border border-dashed px-8 py-20 text-center transition-colors',
        dragging ? 'border-terracotta bg-terracotta/5' : 'rule bg-paper-deep/30',
      ].join(' ')}
    >
      <p className="meta-label">Import footage</p>
      <h3 className="max-w-md font-serif text-[24px] leading-tight text-ink">
        Drop one clip to auto-shorten
      </h3>
      <p className="max-w-sm text-[14.5px] leading-relaxed text-ink-soft">
        Pick a long screen recording. The browser reads it locally to extract audio and
        frames, then the pipeline does the rest. MP4, WebM, or MOV all work.
      </p>
      <button type="button" className="pill-cta mt-1" onClick={() => inputRef.current?.click()}>
        Choose a file
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => accept(e.target.files?.[0])}
      />
      {error && <p className="text-[13px] text-terracotta-ink">{error}</p>}
    </div>
  )
}
