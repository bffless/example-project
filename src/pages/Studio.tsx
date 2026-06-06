import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { setDuration, setFileName } from '../store/studioSlice'
import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { MediaImport } from '../components/Studio/MediaImport'
import { PreviewPlayer } from '../components/Studio/PreviewPlayer'
import { PipelineBoard } from '../components/Studio/PipelineBoard'
import { ContactSheetPreview } from '../components/Studio/ContactSheetPreview'
import { PrepArtifacts } from '../components/Studio/PrepArtifacts'
import { buildPrepArtifacts } from '../lib/prepArtifacts'
import { SceneList } from '../components/Studio/SceneList'
import { SceneEditor } from '../components/Studio/SceneEditor'
import { StudioStepper } from '../components/Studio/StudioStepper'
import { TranscriptDiff } from '../components/Studio/TranscriptDiff'
import { useScenePipeline } from '../components/Studio/useScenePipeline'
import { formatTime } from '../lib/edl'
import { studioPhase } from '../lib/pipeline'
import type { Scene } from '../lib/scenes'

export function Studio() {
  // The in-memory clip is transient — never persisted. After a hard reload it's
  // gone, but the persisted serve reference (`pipe.sourceUrl`) and all pipeline
  // state come back. When a remaining browser step needs the raw bytes we pull
  // the clip back from the bucket automatically (no re-attach prompt); the banner
  // only appears as a fallback if that fetch fails.
  const [file, setFile] = useState<File | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [rehydrating, setRehydrating] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const dispatch = useAppDispatch()
  const duration = useAppSelector((s) => s.studio.duration)
  const fileName = useAppSelector((s) => s.studio.fileName)

  const videoRef = useRef<HTMLVideoElement>(null)
  const pipe = useScenePipeline()

  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])

  // True once there's anything to work with — a freshly-attached clip OR a
  // restored session's persisted source/scenes. Drives the import-vs-workspace
  // split and the top-level stepper so progress survives a reload.
  const hasPersisted = !!pipe.sourceUrl || pipe.scenes.length > 0
  const hasSource = !!file || hasPersisted
  // What the <video> plays: the local object URL when present, else the persisted
  // serve path (proxies to the bucket). Null only before anything is loaded.
  const previewSrc = url ?? pipe.sourceUrl

  const onLoaded = useCallback((d: number) => dispatch(setDuration(d)), [dispatch])

  function selectFile(f: File) {
    // Re-attaching the same clip to a restored session resumes it untouched;
    // any other pick starts a fresh session.
    const resuming = hasPersisted && f.name === fileName
    setRestoreError(null)
    setFile(f)
    setCurrentTime(0)
    if (!resuming) {
      pipe.reset()
      dispatch(setFileName(f.name))
      dispatch(setDuration(0))
    }
  }

  function startOver() {
    setFile(null)
    setRestoreError(null)
    setCurrentTime(0)
    pipe.reset()
  }

  /**
   * Pull the source clip back from the bucket into a `File` so the browser steps
   * (extract audio, capture frames) can run after a reload — the raw bytes live
   * only in memory and don't survive refresh, but the serve URL does. Returns the
   * reconstructed File, or null on failure (caller falls back to the prompt).
   */
  async function rehydrateClip(): Promise<File | null> {
    if (!pipe.sourceUrl) return null
    setRehydrating(true)
    setRestoreError(null)
    try {
      const res = await fetch(pipe.sourceUrl, { credentials: 'include' })
      if (!res.ok) throw new Error(`Couldn't load the saved clip (${res.status})`)
      const blob = await res.blob()
      const f = new File([blob], fileName ?? 'clip', { type: blob.type || 'video/mp4' })
      setFile(f)
      return f
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setRehydrating(false)
    }
  }

  // Run the current prep step. If the clip isn't in memory (restored session),
  // fetch it back from the bucket first, then run with a temporary object URL we
  // revoke once the step is done (the persisted `file`/`url` drive the preview).
  async function runStep() {
    if (file && url) {
      pipe.next({ file, src: url, duration })
      return
    }
    const f = await rehydrateClip()
    if (!f) return
    const tmpUrl = URL.createObjectURL(f)
    try {
      await pipe.next({ file: f, src: tmpUrl, duration })
    } finally {
      URL.revokeObjectURL(tmpUrl)
    }
  }

  // Play just the selected scene: seek to its start and pause at its end.
  const playScene = useCallback((scene: Scene) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = scene.start
    void v.play()
    const stopAtEnd = () => {
      if (v.currentTime >= scene.end) {
        v.pause()
        v.removeEventListener('timeupdate', stopAtEnd)
      }
    }
    v.addEventListener('timeupdate', stopAtEnd)
  }, [])

  const selected = pipe.scenes.find((s) => s.id === pipe.selectedId) ?? null

  const artifacts = useMemo(
    () =>
      buildPrepArtifacts({
        hasSource: !!pipe.sourceUrl,
        hasAudio: !!pipe.audioUrl,
        wordCount: pipe.words.length,
        sheetCount: pipe.contactSheets.length,
        frameCount: pipe.contactSheets.reduce((n, s) => n + s.count, 0),
        sheetsSaved: pipe.contactSheets.filter((s) => s.url).length,
      }),
    [pipe.sourceUrl, pipe.audioUrl, pipe.words, pipe.contactSheets],
  )

  const phase = studioPhase({
    hasSource,
    ready: pipe.ready,
    allBuilt: pipe.allBuilt,
  })

  return (
    <>
      <PageHero
        eyebrow="EP 09 — Studio · scene producer"
        title={
          <>
            Cut a long talk into scenes, build each in your voice<Dot />
          </>
        }
        lead="Upload one clip. The app preps it — extract audio, transcribe, shorten the whole transcript, then group it into logical 2–5 minute scenes (your chapters) with timestamps — and clones your voice. From there you build scenes one at a time: review the shortened script, re-voice it, and line it up with the footage."
      />

      <Section
        eyebrow="— Producer"
        title={hasSource ? <>Prep, then build scene by scene<Dot /></> : <>Load one clip to begin<Dot /></>}
        divider={false}
      >
        {!hasSource || !previewSrc ? (
          <div className="flex flex-col gap-8">
            <StudioStepper phase={phase} />
            <MediaImport onSelect={selectFile} />
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <StudioStepper phase={phase} />

            {restoreError && (
              <RestoreBanner
                fileName={fileName}
                error={restoreError}
                onReattach={selectFile}
              />
            )}

            {/* Control bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 border rule bg-paper-deep/30 px-5 py-4">
              <p className="text-[14px] text-ink-soft">
                {pipe.ready
                  ? `Prep complete · ${pipe.scenes.length} scenes`
                  : rehydrating
                    ? 'Restoring your clip…'
                    : pipe.running
                      ? 'Working…'
                      : 'Run each prep step below, in order.'}
              </p>
              <button
                type="button"
                className="pill-ghost"
                disabled={pipe.running || rehydrating}
                onClick={startOver}
              >
                Start over
              </button>
            </div>

            {!pipe.ready ? (
              /* Prep phase: the notes board (left, a third) + the source preview
                 (right, two thirds), then the transcript editor full-width below
                 once transcription has produced words. */
              <div className="flex flex-col gap-8">
                <PrepArtifacts artifacts={artifacts} />
                <div className="grid items-start gap-8 lg:grid-cols-[1fr_2fr]">
                  <PipelineBoard
                    stages={pipe.stages}
                    currentStageId={pipe.currentStageId}
                    busy={pipe.running || rehydrating}
                    onAction={runStep}
                  />
                  <div>
                    {/* Invisible spacer mirroring the menu's header row so the video
                        top lines up with the menu's first item, not its label. */}
                    <div className="mb-3 flex items-baseline justify-between" aria-hidden="true">
                      <p className="meta-label">&nbsp;</p>
                      <p className="font-mono text-[12px]">&nbsp;</p>
                    </div>
                    <PreviewPlayer
                      src={previewSrc}
                      videoRef={videoRef}
                      cuts={[]}
                      onTime={setCurrentTime}
                      onLoaded={onLoaded}
                    />
                    {pipe.contactSheets.length > 0 && (
                      <div className="mt-6">
                        <ContactSheetPreview sheets={pipe.contactSheets} />
                      </div>
                    )}
                  </div>
                </div>

                {pipe.words.length > 0 && (
                  <TranscriptDiff words={pipe.words} currentTime={currentTime} />
                )}
              </div>
            ) : (
              /* Build phase: scene queue + per-scene editor */
              <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
                <div className="flex flex-col gap-6">
                  <PreviewPlayer
                    src={previewSrc}
                    videoRef={videoRef}
                    cuts={[]}
                    onTime={() => {}}
                    onLoaded={onLoaded}
                  />
                  <SceneList
                    scenes={pipe.scenes}
                    selectedId={pipe.selectedId}
                    onSelect={pipe.select}
                  />
                </div>

                <div className="flex flex-col gap-6">
                  {selected && (
                    <SceneEditor
                      scene={selected}
                      voicing={pipe.voicingId === selected.id}
                      onDraftChange={(t) => pipe.updateDraft(selected.id, t)}
                      onGenerateVoice={() => pipe.generateVoice(selected.id)}
                      onMarkBuilt={() => pipe.markBuilt(selected.id)}
                      onPlayScene={() => playScene(selected)}
                    />
                  )}

                  {pipe.allBuilt ? (
                    <FinalCut scenes={pipe.scenes} />
                  ) : (
                    <p className="text-[13.5px] leading-relaxed text-ink-soft">
                      Build each scene, then assemble the final cut. The chapter list
                      below doubles as your YouTube timestamps.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>
    </>
  )
}

function FinalCut({ scenes }: { scenes: Scene[] }) {
  return (
    <div className="border rule bg-paper p-5">
      <p className="meta-label">All scenes built</p>
      <h3 className="mt-1 font-serif text-[20px] text-ink">Chapters &amp; final cut</h3>
      <ul className="mt-3 flex flex-col gap-1 font-mono text-[12.5px] text-ink-soft">
        {scenes.map((s) => (
          <li key={s.id}>
            <span className="text-terracotta-ink">{formatTime(s.start)}</span> {s.title}
          </li>
        ))}
      </ul>
      <button type="button" className="pill-cta mt-4" disabled>
        Assemble &amp; export with ffmpeg — next phase
      </button>
    </div>
  )
}

/**
 * Fallback shown only when auto-restoring the source clip from the bucket failed
 * (e.g. the serve fetch errored). Pipeline progress and data are intact; the
 * browser steps just need the clip's bytes, so we let the user re-pick the same
 * file from disk. Re-picking the matching clip resumes without resetting anything.
 */
function RestoreBanner({
  fileName,
  error,
  onReattach,
}: {
  fileName: string | null
  error: string
  onReattach: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border border-terracotta/40 bg-terracotta/5 px-5 py-4">
      <p className="text-[14px] text-ink-soft">
        Couldn’t restore the clip from the bucket ({error}). Re-attach{' '}
        {fileName ? <span className="font-mono text-ink">{fileName}</span> : 'the clip'} to continue —
        your progress is saved.
      </p>
      <button type="button" className="pill-ghost" onClick={() => inputRef.current?.click()}>
        Re-attach clip
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onReattach(f)
        }}
      />
    </div>
  )
}
