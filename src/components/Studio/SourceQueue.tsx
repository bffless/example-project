import { useRef, useState } from 'react'
import { skipToken } from '@reduxjs/toolkit/query'
import type { VideoSource } from '../../store/studioSlice'
import { PER_VIDEO_STAGES, type StageId } from '../../lib/pipeline'
import { useSignDownloadQuery } from '../../store/studioApi'
import { PreviewPlayer } from './PreviewPlayer'
import { AudioArtifact } from './AudioArtifact'
import { TranscriptText } from './TranscriptText'

type Props = {
  sources: VideoSource[]
  busyId: string | null
  onReorder: (from: number, to: number) => void
  onRemove: (id: string) => void
  onProcess: (id: string) => void
  onProcessAll: () => void
}

const STAGE_LABELS: Record<StageId, string> = {
  upload: 'Upload',
  extract: 'Audio',
  transcribe: 'Transcribe',
  thumbnails: 'Thumbnails',
  director: 'Director',
  clone: 'Clone',
}

type RowProps = {
  source: VideoSource
  index: number
  busy: boolean
  isThisOne: boolean
  isDragTarget: boolean
  onDragStart: (e: React.DragEvent<HTMLLIElement>) => void
  onDragOver: (e: React.DragEvent<HTMLLIElement>) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent<HTMLLIElement>) => void
  onDragEnd: () => void
  onRemove: (id: string) => void
  onProcess: (id: string) => void
}

function SourceRow({
  source,
  index,
  busy,
  isThisOne,
  isDragTarget,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onRemove,
  onProcess,
}: RowProps) {
  const [expanded, setExpanded] = useState(false)
  const previewRef = useRef<HTMLVideoElement>(null)

  // Hook must be called unconditionally; conditionally skip via skipToken.
  const { data: signed } = useSignDownloadQuery(
    expanded && source.sourceUrl ? source.sourceUrl : skipToken,
  )

  const canExpand = !!source.sourceUrl

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={[
        'flex items-start gap-4 border-b bg-paper px-5 py-4 last:border-b-0 transition-colors',
        'rule',
        isDragTarget ? 'bg-terracotta/5 border-l-2 border-l-terracotta' : 'border-l-2 border-l-transparent',
      ].join(' ')}
    >
      {/* Drag handle */}
      <span
        className="mt-0.5 flex-shrink-0 cursor-grab select-none text-ink-faint"
        aria-hidden="true"
      >
        &#9776;
      </span>

      {/* Main content */}
      <div className="min-w-0 flex-1">
        {/* Filename + order */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-ink-faint">{index + 1}</span>
          <span
            data-testid="source-name"
            className="font-serif text-[17px] leading-tight text-ink truncate"
          >
            {source.fileName}
          </span>
        </div>

        {/* Per-stage status strip */}
        <div className="mt-2 flex items-center gap-4">
          {PER_VIDEO_STAGES.map((stageId) => {
            const status = source.stageProgress[stageId]?.status ?? 'pending'
            return (
              <StageIndicator
                key={stageId}
                label={STAGE_LABELS[stageId]}
                status={status}
              />
            )
          })}
        </div>

        {/* Action buttons */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="pill-cta"
            disabled={busy}
            onClick={() => onProcess(source.id)}
            aria-label={`Process this video: ${source.fileName}`}
          >
            {isThisOne ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-paper border-t-transparent" />
                Processing&hellip;
              </span>
            ) : (
              'Process this video'
            )}
          </button>
          <button
            type="button"
            className="pill-ghost"
            onClick={() => onRemove(source.id)}
            aria-label={`Remove ${source.fileName}`}
          >
            Remove
          </button>
          {canExpand && (
            <button
              type="button"
              className="pill-ghost"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Hide preview' : 'Show preview'}
            </button>
          )}
        </div>

        {/* Expanded per-source detail: preview player + waveform + transcript */}
        {expanded && (
          <div className="mt-4 border rule bg-paper-deep/30 p-4 flex flex-col gap-4">
            {signed?.url ? (
              <PreviewPlayer
                src={signed.url}
                videoRef={previewRef}
                cuts={[]}
                onLoaded={() => {}}
              />
            ) : (
              <span className="font-mono text-[12px] text-ink-faint">Loading preview&hellip;</span>
            )}
            {source.audioUrl && (
              <AudioArtifact peaks={source.audioPeaks} audioUrl={source.audioUrl} />
            )}
            {source.words.length > 0 && (
              <TranscriptText words={source.words} />
            )}
          </div>
        )}
      </div>
    </li>
  )
}

export function SourceQueue({ sources, busyId, onReorder, onRemove, onProcess, onProcessAll }: Props) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const busy = busyId !== null

  return (
    <div>
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <p className="meta-label">Source videos &middot; {sources.length} clip{sources.length !== 1 ? 's' : ''}</p>
        <button
          type="button"
          className="pill-cta"
          disabled={busy || sources.length === 0}
          onClick={onProcessAll}
        >
          Process all
        </button>
      </div>

      {/* Queue list */}
      <ol className="overflow-hidden border rule">
        {sources.map((source, index) => {
          const isThisOne = busyId === source.id
          const isDragTarget = dragOverIndex === index

          return (
            <SourceRow
              key={source.id}
              source={source}
              index={index}
              busy={busy}
              isThisOne={isThisOne}
              isDragTarget={isDragTarget}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', String(index))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDragOverIndex(index)
              }}
              onDragLeave={() => {
                setDragOverIndex(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const from = parseInt(e.dataTransfer.getData('text/plain'), 10)
                setDragOverIndex(null)
                if (!isNaN(from) && from !== index) {
                  onReorder(from, index)
                }
              }}
              onDragEnd={() => {
                setDragOverIndex(null)
              }}
              onRemove={onRemove}
              onProcess={onProcess}
            />
          )
        })}
      </ol>

      {sources.length === 0 && (
        <p className="mt-4 text-center font-mono text-[13px] text-ink-mute">
          No source videos yet. Add a video above.
        </p>
      )}
    </div>
  )
}

type IndicatorProps = {
  label: string
  status: 'pending' | 'active' | 'done' | 'error'
}

function StageIndicator({ label, status }: IndicatorProps) {
  const dot = (() => {
    if (status === 'done')
      return <span className="flex h-2.5 w-2.5 flex-shrink-0 items-center justify-center rounded-full bg-terracotta text-[8px] font-bold text-paper">&#10003;</span>
    if (status === 'error')
      return <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-terracotta-ink" />
    if (status === 'active')
      return <span className="h-2.5 w-2.5 flex-shrink-0 animate-ping rounded-full bg-terracotta" />
    return <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full border border-paper-line bg-paper" />
  })()

  return (
    <span className="flex items-center gap-1.5">
      {dot}
      <span
        className={[
          'font-mono text-[10px] uppercase tracking-wider',
          status === 'done'
            ? 'text-ink-mute line-through decoration-ink-faint'
            : status === 'active'
              ? 'text-terracotta'
              : status === 'error'
                ? 'text-terracotta-ink'
                : 'text-ink-faint',
        ].join(' ')}
      >
        {label}
      </span>
    </span>
  )
}
