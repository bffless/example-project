import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { MediaImport } from '../components/Studio/MediaImport'
import { PreviewPlayer } from '../components/Studio/PreviewPlayer'
import { PipelineBoard } from '../components/Studio/PipelineBoard'
import { ContactSheetPreview } from '../components/Studio/ContactSheetPreview'
import { SceneList } from '../components/Studio/SceneList'
import { SceneEditor } from '../components/Studio/SceneEditor'
import { StudioStepper } from '../components/Studio/StudioStepper'
import { TranscriptDiff } from '../components/Studio/TranscriptDiff'
import { useScenePipeline } from '../components/Studio/useScenePipeline'
import { formatTime } from '../lib/edl'
import { studioPhase } from '../lib/pipeline'
import type { Scene } from '../lib/scenes'

export function Studio() {
  const [file, setFile] = useState<File | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const pipe = useScenePipeline()

  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])

  const onLoaded = useCallback((d: number) => setDuration(d), [])

  function selectFile(f: File) {
    setFile(f)
    setDuration(0)
    setCurrentTime(0)
    pipe.reset()
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

  const phase = studioPhase({
    hasFile: !!file,
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
        title={file ? <>Prep, then build scene by scene<Dot /></> : <>Load one clip to begin<Dot /></>}
        divider={false}
      >
        {!file || !url ? (
          <div className="flex flex-col gap-8">
            <StudioStepper phase={phase} />
            <MediaImport onSelect={selectFile} />
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <StudioStepper phase={phase} />

            {/* Control bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 border rule bg-paper-deep/30 px-5 py-4">
              <p className="text-[14px] text-ink-soft">
                {pipe.ready
                  ? `Prep complete · ${pipe.scenes.length} scenes`
                  : pipe.running
                    ? 'Working…'
                    : 'Run each prep step below, in order.'}
              </p>
              <button
                type="button"
                className="pill-ghost"
                disabled={pipe.running}
                onClick={() => setFile(null)}
              >
                Start over
              </button>
            </div>

            {!pipe.ready ? (
              /* Prep phase: the notes board (left, a third) + the source preview
                 (right, two thirds), then the transcript editor full-width below
                 once transcription has produced words. */
              <div className="flex flex-col gap-8">
                <div className="grid items-start gap-8 lg:grid-cols-[1fr_2fr]">
                  <PipelineBoard
                    stages={pipe.stages}
                    currentStageId={pipe.currentStageId}
                    busy={pipe.running}
                    onAction={() => pipe.next({ file, src: url, duration })}
                  />
                  <div>
                    {/* Invisible spacer mirroring the menu's header row so the video
                        top lines up with the menu's first item, not its label. */}
                    <div className="mb-3 flex items-baseline justify-between" aria-hidden="true">
                      <p className="meta-label">&nbsp;</p>
                      <p className="font-mono text-[12px]">&nbsp;</p>
                    </div>
                    <PreviewPlayer
                      src={url}
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
                    src={url}
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
