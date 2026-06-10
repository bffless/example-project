import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { setDuration, setFileName, setRevisitPrep } from '../store/studioSlice'
import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { MediaImport } from '../components/Studio/MediaImport'
import { PreviewPlayer } from '../components/Studio/PreviewPlayer'
import { PipelineBoard } from '../components/Studio/PipelineBoard'
import { ContactSheetPreview } from '../components/Studio/ContactSheetPreview'
import { effectiveCuts, effectiveSegments, segmentsToTimedWords, gaps, overlaps } from '../lib/refiner'
import { sceneAtTime } from '../lib/scenes'
import { buildFilmstrip } from '../lib/filmstrip'
import type { CutSpan } from '../lib/transcriptGrid'
import { SceneList } from '../components/Studio/SceneList'
import { SceneTabs } from '../components/Studio/SceneTabs'
import { SceneMeta } from '../components/Studio/SceneMeta'
import { SceneRefinePanel } from '../components/Studio/SceneRefinePanel'
import type { SegmentControl } from '../components/Studio/SegmentVoiceControl'
import { VoiceStudio } from '../components/Studio/VoiceStudio'
import { StudioStepper } from '../components/Studio/StudioStepper'
import { AudioArtifact } from '../components/Studio/AudioArtifact'
import { TranscriptText } from '../components/Studio/TranscriptText'
import { TranscriptDiff } from '../components/Studio/TranscriptDiff'
import { SceneAssembleBar } from '../components/Studio/SceneAssembleBar'
import { FinalCutBar } from '../components/Studio/FinalCutBar'
import { useScenePipeline } from '../components/Studio/useScenePipeline'
import { studioPhase, type StudioPhase } from '../lib/pipeline'

export function Studio() {
  // The in-memory clip is transient — never persisted. After a hard reload it's
  // gone, but the persisted serve reference (`pipe.sourceUrl`) and all pipeline
  // state come back. When a remaining browser step needs the raw bytes we pull
  // the clip back from the bucket automatically (no re-attach prompt); the banner
  // only appears as a fallback if that fetch fails.
  const [file, setFile] = useState<File | null>(null)
  const [rehydrating, setRehydrating] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  // Free-text direction the user hands the master director (e.g. "keep the demo
  // at 12:30, make the intro punchy"). Only used by the director prep step.
  const [direction, setDirection] = useState('')
  // The voice step's resource is revealed by clicking its board action (rather
  // than running a pipeline inline) — and stays open once a voice exists.
  const [showVoiceStudio, setShowVoiceStudio] = useState(false)
  const dispatch = useAppDispatch()
  const duration = useAppSelector((s) => s.studio.duration)
  const fileName = useAppSelector((s) => s.studio.fileName)
  // Once prep is complete the workspace shows Build. This lets the user hop back
  // to Prep (to tweak the director, re-pick a voice, etc.) without losing any
  // work — a view toggle that touches no pipeline state. Persisted in Redux (not
  // local useState) so a hard reload while revisiting Prep keeps you on Prep
  // rather than snapping forward to Build.
  const revisitPrep = useAppSelector((s) => s.studio.revisitPrep)

  const videoRef = useRef<HTMLVideoElement>(null)
  const pipe = useScenePipeline()

  // The Build scene tabs are sticky under the global header (`h-14` = 3.5rem).
  // The diff's "placing" bar is also sticky and must clear them, so measure the
  // tab strip's (stable, single-line) height and hand it down as a CSS variable
  // the diff reads for its own sticky `top`. A callback ref wires up a
  // ResizeObserver when the strip mounts (Build phase) and tears it down on
  // unmount — keeping the height correct across responsive font/zoom changes.
  const [tabsHeight, setTabsHeight] = useState(0)
  const tabsRef = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setTabsHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
  // The Build preview plays the selected scene's own clip once it's cut (story
  // 03g). That clip is ~1–2 min, but the diff grid/filmstrip are keyed to the
  // FULL source `duration` — so the clip player must report nothing. A stable
  // no-op keeps the global duration the full-source length.
  const noLoaded = useCallback(() => {}, [])

  function selectFile(f: File) {
    // Re-attaching the same clip to a restored session resumes it untouched;
    // any other pick starts a fresh session.
    const resuming = hasPersisted && f.name === fileName
    setRestoreError(null)
    setFile(f)
    if (!resuming) {
      pipe.reset()
      dispatch(setFileName(f.name))
      dispatch(setDuration(0))
    }
  }

  function startOver() {
    setFile(null)
    setRestoreError(null)
    // pipe.reset() dispatches resetStudio, which already clears revisitPrep.
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
      pipe.next({ file, src: url, duration, direction })
      return
    }
    const f = await rehydrateClip()
    if (!f) return
    const tmpUrl = URL.createObjectURL(f)
    try {
      await pipe.next({ file: f, src: tmpUrl, duration, direction })
    } finally {
      URL.revokeObjectURL(tmpUrl)
    }
  }

  // The board's action button. Most steps run inline; the voice step instead
  // reveals the VoiceStudio resource at the bottom of prep (recording + clone or
  // preset happen there, not through the pipeline runner).
  function onBoardAction() {
    if (pipe.currentStageId === 'clone') {
      setShowVoiceStudio(true)
      return
    }
    void runStep()
  }

  const selected = pipe.scenes.find((s) => s.id === pipe.selectedId) ?? null

  // The diff viewer is scoped to the SELECTED scene only (story 03c "per-scene
  // scope"): every input below is derived from `selected`, not flatMapped across
  // the whole talk, and the grid is windowed to `[selected.start, selected.end]`.
  // The Original pane's words are the slice of the full transcript that overlaps
  // the scene's window (timestamps stay absolute, so scene 2 reads from 1:44).
  const sceneWords = useMemo(
    () =>
      selected
        ? pipe.words.filter((w) => w.start < selected.end && w.end > selected.start)
        : [],
    [pipe.words, selected],
  )

  // The shortened script laid back on the timeline, for the diff's right pane.
  // Uses the refiner's anchored segments when a scene has been refined (words
  // flow at the speaking rate from each segment's start, leaving the kept pauses
  // empty); falls back to a single draftText segment for un-refined scenes.
  const editedWords = useMemo(
    () => (selected ? segmentsToTimedWords(effectiveSegments(selected)) : []),
    [selected],
  )

  // Time-aligned frames for the diff viewer's filmstrip gutter (story 03e),
  // reusing the already-captured contact sheets as sprites. The per-scene refiner
  // sheets come first (denser, so they win on overlap), then the whole-clip prep
  // sheets fill everywhere else.
  const filmstrip = useMemo(
    () => buildFilmstrip([...pipe.scenes.flatMap((s) => s.sheets ?? []), ...pipe.contactSheets]),
    [pipe.scenes, pipe.contactSheets],
  )

  // Dropped footage spans for the selected scene (refiner's cuts, else
  // director's), drawn as red cells in the diff viewer.
  const cutSpans = useMemo(
    () => (selected ? effectiveCuts(selected) : []),
    [selected],
  )

  // Per-segment voice controls for the selected scene — each narration run gets an
  // inline record/AI/play control in the diff viewer's New pane.
  const segmentControls = useMemo<SegmentControl[]>(
    () =>
      selected
        ? effectiveSegments(selected).map((seg, i) => ({
            sceneId: selected.id,
            index: i,
            start: seg.start,
            end: seg.end,
            text: seg.text,
            audioUrl: seg.audioUrl,
            audioSeconds: seg.audioSeconds,
            audioSource: seg.audioSource,
            busy: pipe.voicingSegKey === `${selected.id}:${i}`,
          }))
        : [],
    [selected, pipe.voicingSegKey],
  )

  // A cut hand-edit on the diff grid. The grid hands us a span on the whole-talk
  // timeline; route it to whichever scene owns its start, clamped to that scene
  // by `editSceneCut`. (A drag that crosses a scene boundary edits only the
  // start scene — fine, scenes are built one at a time.)
  const onEditCut = useCallback(
    (span: CutSpan, op: 'add' | 'remove') => {
      const owner = sceneAtTime(pipe.scenes, span.start)
      if (owner) pipe.editSceneCut(owner.id, span, op)
    },
    [pipe],
  )

  // Empty gaps on the selected scene's New timeline — since 03h just the
  // lands-clean hint for a drop (glow + preview tint), not a gate.
  const gapSpans = useMemo(
    () => (selected ? gaps(effectiveSegments(selected), selected) : []),
    [selected],
  )

  // Where the selected scene's runs overlap (story 03h) — the amber conflict
  // fill in the diff viewer; assemble stays blocked while any remain.
  const overlapSpans = useMemo(
    () => (selected ? overlaps(effectiveSegments(selected)) : []),
    [selected],
  )

  // Drop a grabbed original-audio clip — route to the scene owning the drop time.
  const onAdoptOriginal = useCallback(
    (origStart: number, origEnd: number, dropStart: number) => {
      const owner = sceneAtTime(pipe.scenes, dropStart)
      if (owner) pipe.adoptOriginalAudio(owner.id, origStart, origEnd, dropStart)
    },
    [pipe],
  )

  const phase = studioPhase({
    hasSource,
    ready: pipe.ready,
    allBuilt: pipe.allBuilt,
  })

  // Show the prep view while prep is unfinished OR when the user has chosen to
  // revisit it after completing it. The top stepper then reflects Prep as current
  // and lets them jump back to Build.
  const inPrep = !pipe.ready || revisitPrep
  const displayPhase = inPrep ? 'prep' : phase
  // Prep & Build are freely navigable once prep is done; before that you can only
  // be in Prep.
  const navigablePhases: StudioPhase[] = pipe.ready ? ['prep', 'build'] : []
  function navigatePhase(p: StudioPhase) {
    if (p === 'prep') dispatch(setRevisitPrep(true))
    else if (p === 'build') dispatch(setRevisitPrep(false))
  }

  // Setting the voice is the last prep step, so completing it flips `ready` and
  // would auto-jump to Build. Keep the producer on Prep instead (to sample the
  // voice, change it, etc.) — moving to Build stays an explicit choice.
  function chooseVoiceClone(blob: Blob) {
    dispatch(setRevisitPrep(true))
    pipe.cloneFromRecording(blob)
  }
  function chooseVoicePreset(id: string) {
    dispatch(setRevisitPrep(true))
    pipe.pickPresetVoice(id)
  }
  function chooseVoiceSaved(id: string) {
    dispatch(setRevisitPrep(true))
    pipe.reuseVoiceId(id)
  }

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
            <StudioStepper
              phase={displayPhase}
              navigable={navigablePhases}
              onNavigate={navigatePhase}
            />

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
              <div className="flex items-center gap-2">
                {/* Once prep is done, Build can hop back to Prep (no work lost).
                    Going forward to Build is the bottom "Continue" CTA. */}
                {pipe.ready && !revisitPrep && (
                  <button
                    type="button"
                    className="pill-ghost"
                    onClick={() => dispatch(setRevisitPrep(true))}
                  >
                    ← Back to prep
                  </button>
                )}
                <button
                  type="button"
                  className="pill-ghost"
                  disabled={pipe.running || rehydrating}
                  onClick={startOver}
                >
                  Start over
                </button>
              </div>
            </div>

            {inPrep ? (
              /* Prep phase: the notes board (left, a third) + the source preview
                 (right, two thirds), then the transcript editor full-width below
                 once transcription has produced words. */
              <div className="flex flex-col gap-8">
                <div className="grid items-start gap-8 lg:grid-cols-[1fr_2fr]">
                  <PipelineBoard
                    stages={pipe.stages}
                    currentStageId={pipe.currentStageId}
                    busy={pipe.running || rehydrating}
                    onAction={onBoardAction}
                    panelStageId="director"
                  />
                  <div>
                    {/* Spacer so the video top lines up with the board's first
                        item. The master director's panel (direction + send) lives
                        at the BOTTOM of this column — you review the ingredients
                        first, then send the cut. */}
                    <div className="mb-3 flex items-baseline justify-between" aria-hidden="true">
                      <p className="meta-label">&nbsp;</p>
                      <p className="font-mono text-[12px]">&nbsp;</p>
                    </div>
                    <PreviewPlayer
                      src={previewSrc}
                      videoRef={videoRef}
                      cuts={[]}
                      onLoaded={onLoaded}
                    />
                    {pipe.audioUrl && (
                      <div className="mt-4">
                        <AudioArtifact peaks={pipe.audioPeaks} audioUrl={pipe.audioUrl} />
                      </div>
                    )}
                    {pipe.words.length > 0 && (
                      <div className="mt-4">
                        <TranscriptText words={pipe.words} />
                      </div>
                    )}
                    {pipe.contactSheets.length > 0 && (
                      <div className="mt-6">
                        <ContactSheetPreview sheets={pipe.contactSheets} />
                      </div>
                    )}
                    {/* The master director's action sits at the bottom — after the
                        ingredients — when it's the current step. */}
                    {pipe.currentStageId === 'director' && (
                      <div className="mt-6">
                        <DirectorPanel
                          value={direction}
                          onChange={setDirection}
                          onSubmit={runStep}
                          busy={pipe.running || rehydrating}
                          sheetCount={pipe.contactSheets.length}
                          wordCount={pipe.words.length}
                        />
                      </div>
                    )}
                    {/* The director's result — synopsis + scene breakdown together,
                        shown as soon as it lands so it's visible during the rest of
                        prep (clone), each in its own box to match the other
                        prep-artifact sections above. */}
                    {pipe.scenes.length > 0 && (
                      <div className="mt-6 flex flex-col gap-4">
                        {pipe.synopsis && <SynopsisCard synopsis={pipe.synopsis} />}
                        <div className="border rule bg-paper-deep/30 p-4">
                          <SceneList
                            scenes={pipe.scenes}
                            selectedId={pipe.selectedId}
                            onSelect={pipe.select}
                          />
                        </div>
                      </div>
                    )}
                    {/* The voice step: a resource under the scenes & chapters,
                        sized to this right column (not full-bleed). Revealed by
                        the board's "Choose your voice" action (or whenever a voice
                        already exists). Record + clone or pick a preset here —
                        it's the last prep step before Build. */}
                    {(showVoiceStudio || pipe.voice) && (
                      <div className="mt-6">
                        <VoiceStudio
                          voice={pipe.voice}
                          savedVoices={pipe.savedVoices}
                          cloning={pipe.cloning}
                          samplingVoice={pipe.samplingVoice}
                          onClone={chooseVoiceClone}
                          onPickPreset={chooseVoicePreset}
                          onReuseVoiceId={chooseVoiceSaved}
                          onForgetVoice={pipe.forgetVoice}
                          onClearVoice={pipe.clearVoice}
                          onGenerateSample={pipe.generateSample}
                        />
                      </div>
                    )}
                  </div>
                </div>
                {/* Once every prep step is done (incl. the voice), the producer
                    moves to Build deliberately — completing prep no longer
                    auto-advances. */}
                {pipe.ready && (
                  <div className="flex flex-wrap items-center justify-between gap-4 border rule bg-terracotta/5 px-5 py-4">
                    <p className="text-[14px] text-ink-soft">
                      Prep complete — {pipe.scenes.length} scene
                      {pipe.scenes.length === 1 ? '' : 's'} and your voice is ready.
                    </p>
                    <button
                      type="button"
                      className="pill-cta"
                      onClick={() => dispatch(setRevisitPrep(false))}
                    >
                      Continue to build →
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Build phase: a scene tab strip across the top, then the source
                 video over the full-width transcript time-grid diff. The diff is
                 the main editing area — where we'll work the shortened script
                 against the original — so it gets the whole page width. */
              <div
                className="flex flex-col gap-6"
                // The diff's sticky "placing" bar reads this to clear the sticky
                // scene tabs above it: header (3.5rem) + measured tab strip.
                style={{ '--diff-sticky-top': `calc(3.5rem + ${tabsHeight}px)` } as CSSProperties}
              >
                {pipe.synopsis && <SynopsisCard synopsis={pipe.synopsis} />}
                {/* Only the tab strip sticks under the global header (its
                    "Scenes · chapters" label scrolls away). `tabsRef` measures
                    JUST the strip so the diff's placing bar parks flush beneath
                    it. Frosted like the header; z below it (z-40) so it wins. */}
                <SceneTabs
                  scenes={pipe.scenes}
                  selectedId={pipe.selectedId}
                  onSelect={pipe.select}
                  tablistRef={tabsRef}
                  tablistClassName="sticky top-14 z-30 bg-paper/85 backdrop-blur"
                />
                {/* Video capped on the left; the space to its right carries the
                    selected scene's metadata. The diff below still gets the full
                    page width. */}
                <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
                  <div className="lg:max-w-2xl lg:flex-[3]">
                    {/* Once this scene is cut (story 03g), play its own short clip
                        instead of the whole film — and don't let it overwrite the
                        full-source `duration` the grid relies on (see noLoaded). */}
                    <PreviewPlayer
                      src={selected?.clipUrl ?? previewSrc}
                      videoRef={videoRef}
                      cuts={[]}
                      onLoaded={selected?.clipUrl ? noLoaded : onLoaded}
                    />
                  </div>
                  {selected && (
                    <SceneMeta
                      scene={selected}
                      className="lg:flex-[2]"
                      onToggleBuilt={pipe.toggleBuilt}
                    />
                  )}
                </div>
                {selected && (
                  <SceneRefinePanel
                    scene={selected}
                    slicing={pipe.slicingId === selected.id}
                    sheeting={pipe.sheetingId === selected.id}
                    refining={pipe.refiningId === selected.id}
                    error={pipe.sceneError}
                    onSlice={() => pipe.sliceScene(selected.id, file)}
                    onGenerateSheets={() => pipe.generateSceneSheets(selected.id)}
                    onRefine={() => pipe.refineScene(selected.id)}
                    onClear={() => pipe.clearRefinement(selected.id)}
                  />
                )}
                {selected && pipe.words.length > 0 && (
                  <TranscriptDiff
                    words={sceneWords}
                    editedWords={editedWords}
                    cuts={cutSpans}
                    segments={segmentControls}
                    canGenerateAI={!!pipe.voice}
                    onGenerateAI={pipe.generateSegmentNarration}
                    onRecord={pipe.recordSegmentNarration}
                    onEditCut={onEditCut}
                    dropTargets={gapSpans}
                    onAdoptOriginal={onAdoptOriginal}
                    onDeleteSegment={pipe.deleteSegment}
                    onMoveRun={pipe.moveRun}
                    overlaps={overlapSpans}
                    frames={filmstrip}
                    duration={duration}
                    windowStart={selected.start}
                    windowEnd={selected.end}
                    originalAudioUrl={pipe.audioUrl ?? undefined}
                  />
                )}
                {/* Assemble the SELECTED scene off its own cut clip (story 03g
                    phase 2). Keyed by scene id so switching tabs resets its
                    transient render/preview. Bounded memory — only this scene's
                    short clip is in wasm at a time, never the whole film. */}
                {selected && (
                  <SceneAssembleBar
                    key={selected.id}
                    scene={selected}
                    saving={pipe.savingSceneCutId === selected.id}
                    onSave={(blob) => pipe.saveSceneCut(selected.id, blob)}
                  />
                )}
                {/* Master assemble: stream-copy concat of every scene's saved
                    assembled cut → the whole video. Enabled once all are assembled. */}
                <FinalCutBar
                  scenes={pipe.scenes}
                  finalCutUrl={pipe.finalCutUrl}
                  saving={pipe.savingFinalCut}
                  onSave={pipe.saveFinalCut}
                />
              </div>
            )}
          </div>
        )}
      </Section>
    </>
  )
}

/**
 * The headline prep step: hand the cut to the AI master director. Shown in the
 * right column only when the director step is current, so the direction input
 * and the "send" action sit together and read as the big moment (not a buried
 * board button). The free-text direction is optional — an aside to the AI ("keep
 * the demo at 12:30", "punchier intro") — so the button works empty too.
 */
function DirectorPanel({
  value,
  onChange,
  onSubmit,
  busy,
  sheetCount,
  wordCount,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  busy?: boolean
  sheetCount: number
  wordCount: number
}) {
  return (
    <div className="mb-6 border-l-2 border-terracotta bg-terracotta/5 p-5">
      <p className="meta-label">Final prep step · the master director</p>
      <h3 className="mt-1 font-serif text-[22px] leading-tight text-ink">
        Send it to the AI director
      </h3>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
        Gemini reads your {wordCount.toLocaleString()}-word transcript and{' '}
        {sheetCount} contact sheet{sheetCount === 1 ? '' : 's'} together, then returns a
        one-line synopsis and your scenes — each with a tightened script, the
        original-video span, and the footage to cut.
      </p>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="meta-label">Your direction · optional</span>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
          rows={3}
          placeholder="e.g. Keep the live demo around 12:30. Make the intro punchy and drop the throat-clearing."
          className="w-full resize-y rounded-md border border-paper-line bg-paper p-3 text-[14px] leading-relaxed text-ink disabled:opacity-60"
        />
      </label>

      <button type="button" className="pill-cta mt-4" disabled={busy} onClick={onSubmit}>
        {busy ? 'Directing…' : 'Send to the AI director →'}
      </button>
    </div>
  )
}

/** The director's one-line logline of the whole talk — the "what's this about". */
function SynopsisCard({ synopsis }: { synopsis: string }) {
  return (
    <div className="border-l-2 border-terracotta bg-terracotta/5 px-5 py-4">
      <p className="meta-label">The director’s take</p>
      <p className="mt-1.5 font-serif text-[18px] leading-snug text-ink">{synopsis}</p>
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
