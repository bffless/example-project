import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Scene } from '../../lib/scenes'
import { effectiveCuts, effectiveSegments } from '../../lib/refiner'
import {
  planAssembly,
  buildFfmpegCommand,
  type AssembleSegment,
} from '../../lib/export/assemble'
import { assemble } from '../../lib/export/ffmpeg'

type Props = {
  scenes: Scene[]
  duration: number
  /** The in-memory source clip, when present (preferred — no refetch). */
  file: File | null
  /** The persisted bucket serve path, used when the clip isn't in memory. */
  sourceUrl: string | null
  /** The saved final cut's serve path (persisted) — survives reload. Null until saved. */
  finalCutUrl: string | null
  /** True while the assembled MP4 is uploading to the bucket. */
  saving: boolean
  /** Upload the assembled blob → bucket; resolves to the saved serve URL (throws on failure). */
  onSave: (blob: Blob) => Promise<string>
}

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** Fetch a serve path / data URL into raw bytes for ffmpeg's virtual FS. */
async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * The Export step (story 05): assemble the built scenes into one MP4 with
 * ffmpeg.wasm, then **save** it. The whole plan is the pure `planAssembly` walk
 * (cut / segment / dead space); this component gathers the bytes, runs the
 * command, and surfaces progress.
 *
 * Two distinct actions on the result:
 *  - **Save to my library** uploads the MP4 to the bucket and persists only the
 *    serve URL (like every other resource), so it survives a hard reload. This is
 *    the durable copy.
 *  - **Download** writes the bytes to the user's disk as an external file — a
 *    one-off export, not saved state.
 *
 * Re-assembling produces a new (unsaved) blob; saving it overwrites the stored URL.
 */
export function AssembleBar({ scenes, duration, file, sourceUrl, finalCutUrl, saving, onSave }: Props) {
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState<string>('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // The freshly-assembled cut (transient — never persisted). `resultUrl` is its
  // object URL for the inline preview; `savedBlob` is whichever blob has been
  // uploaded, so we can tell a just-assembled cut apart from a saved one.
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [savedBlob, setSavedBlob] = useState<Blob | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Revoke the previous result's object URL when it's replaced or on unmount.
  const resultRef = useRef<string | null>(null)
  useEffect(() => {
    resultRef.current = resultUrl
    return () => {
      if (resultRef.current) URL.revokeObjectURL(resultRef.current)
    }
  }, [resultUrl])

  // The flat narration segments + cuts across every scene's effective layer — the
  // exact lists the timeline walk consumes. `effectiveSegments/Cuts` already pick
  // the refined layer over the director baseline.
  const segments = useMemo<AssembleSegment[]>(
    () => scenes.flatMap((s) => effectiveSegments(s)),
    [scenes],
  )
  const cuts = useMemo(() => scenes.flatMap((s) => effectiveCuts(s)), [scenes])

  const plan = useMemo(
    () => planAssembly({ segments, cuts, duration }),
    [segments, cuts, duration],
  )

  // How much of the cut footage is dropped, and whether anything's still silent —
  // an un-voiced run renders as silence, worth flagging so a preview isn't a
  // surprise. Assemble is NOT gated on "built": that's the producer's own
  // done-tracker — they can stitch the scenes together and watch the cut at any
  // time, voiced or not.
  const droppedSeconds = Math.max(0, duration - plan.duration)
  const unvoiced = segments.filter((s) => !s.audioUrl).length
  const canAssemble = duration > 0 && plan.video.length > 0

  // The producer's built tracker — surfaced here as readiness, not a hard gate:
  // you can assemble a preview anytime, but "all scenes built" is the signal the
  // whole cut is good to go. Mark each scene built in its SceneMeta panel / tab.
  const builtCount = scenes.filter((s) => s.status === 'built').length
  const allBuilt = scenes.length > 0 && builtCount === scenes.length

  // Is the cut currently on screen the one that's been saved? A fresh assemble
  // clears this (new blob ≠ savedBlob), prompting another save.
  const savedCurrent = !!resultBlob && savedBlob === resultBlob
  // What the inline player shows: the fresh blob if we just assembled, otherwise
  // the saved serve path (so a reloaded session still plays its saved cut).
  const playerSrc = resultUrl ?? finalCutUrl

  const run = useCallback(async () => {
    if (running || !canAssemble) return
    setRunning(true)
    setError(null)
    setSaveError(null)
    setProgress(0)
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl)
      setResultUrl(null)
    }
    setResultBlob(null)
    try {
      const command = buildFfmpegCommand(plan)

      setStage('Loading the source clip…')
      const source = file
        ? new Uint8Array(await file.arrayBuffer())
        : sourceUrl
          ? await fetchBytes(sourceUrl)
          : null
      if (!source) throw new Error('No source clip available to assemble.')

      setStage(`Gathering ${command.audioInputs.length} narration clip${command.audioInputs.length === 1 ? '' : 's'}…`)
      const clips = await Promise.all(
        command.audioInputs.map((segIndex) => {
          const url = segments[segIndex]?.audioUrl
          if (!url) throw new Error(`Segment ${segIndex} has no audio to assemble.`)
          return fetchBytes(url)
        }),
      )

      setStage('Encoding the final cut…')
      const blob = await assemble({
        source,
        clips,
        command,
        onProgress: setProgress,
      })
      setResultBlob(blob)
      setResultUrl(URL.createObjectURL(blob))
      setStage(`Done · ${(blob.size / 1_048_576).toFixed(1)} MB · save it to keep it`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('')
    } finally {
      setRunning(false)
    }
  }, [running, canAssemble, plan, file, sourceUrl, segments, resultUrl])

  const save = useCallback(async () => {
    if (!resultBlob || saving) return
    setSaveError(null)
    try {
      await onSave(resultBlob)
      setSavedBlob(resultBlob)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }, [resultBlob, saving, onSave])

  return (
    <div className="border rule bg-paper p-5">
      <p className="meta-label">Export · assemble &amp; save the cut</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
        Stitch every scene together into one MP4 — cut footage dropped, each scene's
        re-voiced narration over the kept video, dead space silent — right here in
        the browser with ffmpeg.wasm. Assemble anytime to see how it plays, then
        <span className="text-ink"> save</span> it to keep it (it persists to your
        library and survives a refresh) or download a copy.
      </p>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[12px] text-ink-mute">
        <span>{scenes.length} scene{scenes.length === 1 ? '' : 's'}</span>
        <span>
          {fmtTime(duration)} → {fmtTime(plan.duration)} ({fmtTime(droppedSeconds)} cut)
        </span>
        <span>{plan.audio.filter((a) => a.kind === 'clip').length} narration clips</span>
        {unvoiced > 0 && (
          <span className="text-terracotta-ink">
            {unvoiced} run{unvoiced === 1 ? '' : 's'} unvoiced → silent
          </span>
        )}
      </div>

      <p className="mt-2 text-[12.5px]">
        {allBuilt ? (
          <span className="text-ink">✓ All {scenes.length} scenes built — the cut is ready to export.</span>
        ) : (
          <span className="text-ink-soft">
            {builtCount}/{scenes.length} scenes built — mark each scene built (in its tab) when it's good to go.
          </span>
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={resultBlob ? 'pill-ghost' : 'pill-cta'}
          disabled={running || saving || !canAssemble}
          onClick={run}
        >
          {running ? 'Assembling…' : resultBlob || finalCutUrl ? 'Re-assemble' : 'Assemble & preview'}
        </button>

        {/* Save the freshly-assembled blob to the bucket (the durable copy). */}
        {resultBlob && !running && !savedCurrent && (
          <button type="button" className="pill-cta" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save to my library'}
          </button>
        )}
        {savedCurrent && <span className="text-[12.5px] text-ink-soft">✓ Saved</span>}

        {/* Download a local copy (separate from saving). */}
        {playerSrc && !running && (
          <a className="pill-ghost" href={playerSrc} download="studio-final-cut.mp4">
            Download MP4
          </a>
        )}
      </div>

      {/* A reloaded session with a saved cut but no fresh assemble — tell the
          producer it's the saved one, and re-assemble re-derives it from edits. */}
      {finalCutUrl && !resultBlob && !running && (
        <p className="mt-3 text-[12.5px] text-ink-soft">
          Showing your saved final cut. Refine the scenes and re-assemble to update
          it, then save again to replace it.
        </p>
      )}

      {(running || stage) && !error && (
        <div className="mt-4">
          {running && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-deep">
              <div
                className="h-full bg-terracotta transition-[width] duration-200"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
          {stage && <p className="mt-2 text-[12.5px] text-ink-soft">{stage}</p>}
        </div>
      )}

      {error && (
        <p className="mt-3 whitespace-pre-wrap text-[13px] text-terracotta-ink">{error}</p>
      )}
      {saveError && (
        <p className="mt-3 text-[13px] text-terracotta-ink">Couldn’t save: {saveError}</p>
      )}

      {playerSrc && !running && (
        <div className="mt-4">
          <video src={playerSrc} controls className="w-full rounded-md border border-paper-line" />
        </div>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-ink-mute">
        Audio is loudness-matched per clip (EBU R128) with short fades at the joins,
        so clips don’t jump in volume or click. Room-tone differences between the
        original and re-recorded takes remain — that’s a re-record decision, not an
        ffmpeg fix.
      </p>
    </div>
  )
}
