import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Scene } from '../../lib/scenes'
import { effectiveCuts, effectiveSegments } from '../../lib/refiner'
import { planScene, buildFfmpegCommand } from '../../lib/export/assemble'
import { assemble } from '../../lib/export/ffmpeg'

type Props = {
  /** The scene whose tab is selected — this bar assembles ONLY this scene. */
  scene: Scene
  /** True while this scene's assembled cut is uploading. */
  saving: boolean
  /** Upload the assembled scene blob → bucket; resolves to its serve URL. */
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
 * Assemble **one scene** (story 03g phase 2) — the producer works tab by tab:
 * assemble the selected scene off its own cut clip (`scene.clipUrl`), preview it,
 * save it (`scene.assembledUrl`), then move to the next tab. Because the source is
 * the short per-scene clip — not the whole film — only that clip is ever in wasm
 * memory, which is what keeps the render from OOMing.
 *
 * The plan is the pure `planScene` walk (cuts dropped / narration over kept video /
 * dead space silent), rebased to the clip's local time. The final whole-video cut
 * is a separate, cheap concat of every scene's saved `assembledUrl` (see FinalCutBar).
 *
 * Mounted with `key={scene.id}` so switching tabs resets this transient state.
 */
export function SceneAssembleBar({ scene, saving, onSave }: Props) {
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [savedBlob, setSavedBlob] = useState<Blob | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const resultRef = useRef<string | null>(null)
  useEffect(() => {
    resultRef.current = resultUrl
    return () => {
      if (resultRef.current) URL.revokeObjectURL(resultRef.current)
    }
  }, [resultUrl])

  // This scene's effective narration segments + cuts, rebased to the clip's local
  // timeline (the clip starts at scene.start, so the plan walks [0, end-start]).
  const segments = useMemo(() => effectiveSegments(scene), [scene])
  const plan = useMemo(
    () => planScene({ segments, cuts: effectiveCuts(scene), start: scene.start, end: scene.end }),
    [segments, scene],
  )

  const sceneLen = Math.max(0, scene.end - scene.start)
  const droppedSeconds = Math.max(0, sceneLen - plan.duration)
  const unvoiced = segments.filter((s) => !s.audioUrl).length
  const hasClip = !!scene.clipUrl
  const canAssemble = hasClip && plan.video.length > 0

  const savedCurrent = !!resultBlob && savedBlob === resultBlob
  const playerSrc = resultUrl ?? scene.assembledUrl ?? null

  const run = useCallback(async () => {
    if (running || !canAssemble || !scene.clipUrl) return
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
      const command = buildFfmpegCommand(plan, { source: 'clip.mp4', output: 'scene.mp4' })

      setStage('Loading the scene clip…')
      const source = await fetchBytes(scene.clipUrl)

      setStage(
        `Gathering ${command.audioInputs.length} narration clip${command.audioInputs.length === 1 ? '' : 's'}…`,
      )
      const clips = await Promise.all(
        command.audioInputs.map((segIndex) => {
          const url = segments[segIndex]?.audioUrl
          if (!url) throw new Error(`Segment ${segIndex} has no audio to assemble.`)
          return fetchBytes(url)
        }),
      )

      setStage('Assembling this scene…')
      const blob = await assemble({ source, clips, command, onProgress: setProgress })
      setResultBlob(blob)
      setResultUrl(URL.createObjectURL(blob))
      setStage(`Done · ${(blob.size / 1_048_576).toFixed(1)} MB · save it to keep it`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('')
    } finally {
      setRunning(false)
    }
  }, [running, canAssemble, scene.clipUrl, plan, segments, resultUrl])

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
      <p className="meta-label">Assemble this scene</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
        Render <span className="text-ink">just this scene</span> from its cut clip —
        cut footage dropped, your re-voiced narration over the kept video, dead space
        silent — then save it. Do each scene tab by tab; the final cut is stitched
        from the scenes you’ve assembled.
      </p>

      {!hasClip ? (
        <p className="mt-3 text-[12.5px] text-terracotta-ink">
          Cut this scene first (step 0 above) — the assemble works on the scene’s own clip.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[12px] text-ink-mute">
          <span>
            {fmtTime(sceneLen)} → {fmtTime(plan.duration)} ({fmtTime(droppedSeconds)} cut)
          </span>
          <span>{plan.audio.filter((a) => a.kind === 'clip').length} narration clips</span>
          {unvoiced > 0 && (
            <span className="text-terracotta-ink">
              {unvoiced} run{unvoiced === 1 ? '' : 's'} unvoiced → silent
            </span>
          )}
          {scene.assembledUrl && !resultBlob && <span className="text-ink">✓ assembled</span>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={resultBlob ? 'pill-ghost' : 'pill-cta'}
          disabled={running || saving || !canAssemble}
          onClick={run}
        >
          {running
            ? 'Assembling…'
            : resultBlob || scene.assembledUrl
              ? 'Re-assemble scene'
              : 'Assemble scene'}
        </button>

        {resultBlob && !running && !savedCurrent && (
          <button type="button" className="pill-cta" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save this scene'}
          </button>
        )}
        {savedCurrent && <span className="text-[12.5px] text-ink-soft">✓ Saved</span>}

        {playerSrc && !running && (
          <a className="pill-ghost" href={playerSrc} download={`scene-${scene.index + 1}.mp4`}>
            Download
          </a>
        )}
      </div>

      {scene.assembledUrl && !resultBlob && !running && (
        <p className="mt-3 text-[12.5px] text-ink-soft">
          Showing this scene’s saved cut. Re-assemble to update it, then save again.
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

      {error && <p className="mt-3 whitespace-pre-wrap text-[13px] text-terracotta-ink">{error}</p>}
      {saveError && <p className="mt-3 text-[13px] text-terracotta-ink">Couldn’t save: {saveError}</p>}

      {playerSrc && !running && (
        <div className="mt-4">
          <video src={playerSrc} controls className="w-full rounded-md border border-paper-line" />
        </div>
      )}
    </div>
  )
}
