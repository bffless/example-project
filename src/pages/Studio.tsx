import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { addSource, reorderSources, removeSource, setDirection, setDuration, setFileName, setRevisitPrep } from '../store/studioSlice'
import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { MediaImport } from '../components/Studio/MediaImport'
import { SourceQueue } from '../components/Studio/SourceQueue'
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
import { JobPromptDisclosure } from '../components/Studio/PromptDisclosure'
import { DirectorPanel } from '../components/Studio/DirectorPanel'
import type { SegmentControl } from '../components/Studio/SegmentVoiceControl'
import { VoiceStudio } from '../components/Studio/VoiceStudio'
import { StudioStepper } from '../components/Studio/StudioStepper'
import { AudioArtifact } from '../components/Studio/AudioArtifact'
import { TranscriptText } from '../components/Studio/TranscriptText'
import { TranscriptDiff } from '../components/Studio/TranscriptDiff'
import { SceneAssembleBar } from '../components/Studio/SceneAssembleBar'
import { ScenePreviewDialog } from '../components/Studio/ScenePreviewDialog'
import { FinalCutBar } from '../components/Studio/FinalCutBar'
import { useScenePipeline } from '../components/Studio/useScenePipeline'
import { useSignDownloadQuery, useLazySignDownloadQuery, useSearchTranscriptMutation } from '../store/studioApi'
import { buildSearchRequest, toSearchHits } from '../lib/search'
import { skipToken } from '@reduxjs/toolkit/query'
import { GLOBAL_STAGES, studioPhase, type StudioPhase } from '../lib/pipeline'

export function Studio() {
  // The in-memory clip is transient — never persisted. After a hard reload it's
  // gone, but the persisted serve reference (`pipe.sourceUrl`) and all pipeline
  // state come back. When a remaining browser step needs the raw bytes we pull
  // the clip back from the bucket automatically (no re-attach prompt); the banner
  // only appears as a fallback if that fetch fails.
  const [file, setFile] = useState<File | null>(null)
  // In-memory File for each source id, transient (lost on reload — fine; reload
  // resumes from persisted per-source progress). Keyed by VideoSource.id.
  const [files, setFiles] = useState<Map<string, File>>(new Map())
  const [rehydrating, setRehydrating] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  // Free-text direction the user hands the master director (e.g. "keep the demo
  // at 12:30, make the intro punchy"). Persisted in the studio slice (story 03l)
  // so Build forwards it to per-scene refines long after prep, across reloads.
  const direction = useAppSelector((s) => s.studio.direction)
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
  const [previewOpen, setPreviewOpen] = useState(false)
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
  // The director already ran and produced scenes — show DirectorPanel in its
  // confirm-gated re-run variant (story 03m) instead of hiding it.
  const directorDone =
    pipe.stages.find((s) => s.id === 'director')?.status === 'done' && pipe.scenes.length > 0
  const hasSource = !!file || hasPersisted || pipe.sources.length > 0
  // What the <video> plays: the local object URL when present, else the persisted
  // source SIGNED into a direct bucket URL — the raw serve path must never be a
  // media src (streaming ~280 MB through file_serve 504s/OOMs the backend).
  // Null only before anything is loaded / while the signature is in flight.
  const { data: signedSource } = useSignDownloadQuery(
    !url && pipe.sourceUrl ? pipe.sourceUrl : skipToken,
  )
  const previewSrc = url ?? signedSource?.url ?? null
  const [signSourceUrl] = useLazySignDownloadQuery()

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

  // Multi-video import (story 09b): each picked file becomes a source in the queue
  // + is held in memory under its id for processing. Math.random for a unique id is
  // fine here (a component event handler, not a workflow).
  //
  // The `addSource` dispatches and id generation MUST happen in the handler body,
  // NOT inside the `setFiles` updater: React StrictMode double-invokes state
  // updaters in dev to surface impurity, so a dispatch in there fires twice and
  // duplicates every source (4 picked → 8 in the queue). Event handlers run once.
  function onImport(picked: File[]) {
    setRestoreError(null)
    // Default the queue to earliest-first by the file's last-modified time (the
    // only creation-ish metadata the browser exposes on a File — a good proxy for
    // when a screen recording was saved). The producer can still drag to reorder.
    const ordered = [...picked].sort((a, b) => a.lastModified - b.lastModified)
    const added: { id: string; file: File }[] = []
    for (const f of ordered) {
      const id = `source-${Date.now()}-${Math.round(Math.random() * 1e6)}`
      dispatch(addSource({ id, fileName: f.name, duration: 0 }))
      added.push({ id, file: f })
    }
    setFiles((prev) => {
      const next = new Map(prev)
      for (const { id, file } of added) next.set(id, file)
      return next
    })
  }

  function startOver() {
    setFile(null)
    setFiles(new Map())
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
      // Sign first and pull straight from the bucket — no `credentials`, it's a
      // presigned URL and cookies would fail the cross-origin CORS check.
      const { url: signed } = await signSourceUrl(pipe.sourceUrl, true).unwrap()
      const res = await fetch(signed)
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

  // Re-run the master director (story 03m) — confirm already happened in the
  // panel. Same clip-rehydration dance as runStep, but drives the director step
  // directly instead of whatever stage is current.
  async function rerunStep() {
    if (file && url) {
      void pipe.rerunDirector({ file, src: url, duration })
      return
    }
    const f = await rehydrateClip()
    if (!f) return
    const tmpUrl = URL.createObjectURL(f)
    try {
      await pipe.rerunDirector({ file: f, src: tmpUrl, duration })
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

  // The selected scene's cut clip, SIGNED into a direct bucket URL — same rule
  // as the source above: a big MP4 must never stream through file_serve (it
  // buffers/OOMs the backend; bffless/ce#317). While the signature is in
  // flight (cached 45 min, so usually instant) the player stays on previewSrc.
  const { data: signedClip } = useSignDownloadQuery(selected?.clipUrl ?? skipToken)
  const clipSrc = selected?.clipUrl ? (signedClip?.url ?? null) : null

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
  // empty); falls back to a single transcript segment for un-refined scenes.
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
            suggestedSource: seg.suggestedSource,
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

  // Drop a typed snippet — same owner routing as adopt-original.
  const onAddSnippet = useCallback(
    (text: string, dropStart: number) => {
      const owner = sceneAtTime(pipe.scenes, dropStart)
      if (owner) pipe.addSnippet(owner.id, text, dropStart)
    },
    [pipe],
  )

  // Transcript search (story 08): whole-talk, so it uses pipe.words (the FULL
  // transcript), not the scene slice the diff renders. Hits come back through
  // the shared coercion, annotated with the owning scene's title and the
  // span's words — each hit renders as a selectable time-grid "set".
  const [searchTranscript] = useSearchTranscriptMutation()
  const onSearch = useCallback(
    async (query: string) => {
      const raw = await searchTranscript(buildSearchRequest(query, pipe.words, duration)).unwrap()
      return toSearchHits(raw, duration).map((h) => ({
        ...h,
        sceneTitle: sceneAtTime(pipe.scenes, h.start)?.title,
        words: pipe.words.filter((w) => w.start < h.end && w.end > h.start),
      }))
    },
    [searchTranscript, pipe.words, pipe.scenes, duration],
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
        {pipe.sources.length === 0 && !hasPersisted && !file ? (
          <div className="flex flex-col gap-8">
            <StudioStepper phase={phase} />
            <MediaImport onSelect={onImport} />
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
                {pipe.sources.length > 0 && (
                  <SourceQueue
                    sources={[...pipe.sources].sort((a, b) => a.order - b.order)}
                    busyId={pipe.processingId}
                    onReorder={(from, to) => dispatch(reorderSources({ from, to }))}
                    onRemove={(id) => { dispatch(removeSource(id)); setFiles((prev) => { const m = new Map(prev); m.delete(id); return m }) }}
                    onProcess={(id) => { const f = files.get(id); if (f) void pipe.processSource(id, f) }}
                    onProcessAll={() => void pipe.processAll(files)}
                  />
                )}
                <div className="grid items-start gap-8 lg:grid-cols-[1fr_2fr]">
                  <PipelineBoard
                    stages={pipe.stages.filter((s) => GLOBAL_STAGES.includes(s.id))}
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
                    {previewSrc && (
                      <PreviewPlayer
                        src={previewSrc}
                        videoRef={videoRef}
                        cuts={[]}
                        onLoaded={onLoaded}
                      />
                    )}
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
                    {(pipe.currentStageId === 'director' || directorDone) && (
                      <div className="mt-6">
                        <DirectorPanel
                          value={direction}
                          onChange={(v) => dispatch(setDirection(v))}
                          onSubmit={directorDone ? rerunStep : runStep}
                          busy={pipe.running || rehydrating}
                          sheetCount={pipe.contactSheets.length}
                          wordCount={pipe.words.length}
                          rerun={directorDone}
                          sceneCount={pipe.scenes.length}
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
                        <JobPromptDisclosure
                          jobId={pipe.directorPromptJobId}
                          label="View the prompt the director was sent"
                        />
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
                <JobPromptDisclosure
                  jobId={pipe.directorPromptJobId}
                  label="View the prompt the director was sent"
                />
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
                  onPreview={() => setPreviewOpen(true)}
                  previewDisabled={!selected}
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
                      src={clipSrc ?? previewSrc ?? ''}
                      videoRef={videoRef}
                      cuts={[]}
                      onLoaded={clipSrc ? noLoaded : onLoaded}
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
                    direction={direction}
                    error={pipe.sceneError}
                    onSlice={() => pipe.sliceScene(selected.id)}
                    onGenerateSheets={() => pipe.generateSceneSheets(selected.id)}
                    onRefine={() => pipe.refineScene(selected.id)}
                    onClear={() => pipe.clearRefinement(selected.id)}
                    onRefinePromptChange={(text) => pipe.setRefinePrompt(selected.id, text)}
                    onIncludeDirectionChange={(on) => pipe.setIncludeDirection(selected.id, on)}
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
                    onUseOriginal={pipe.adoptSegmentOriginal}
                    onEditCut={onEditCut}
                    dropTargets={gapSpans}
                    onAdoptOriginal={onAdoptOriginal}
                    onAddSnippet={onAddSnippet}
                    onSearch={onSearch}
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
                    onPreview={() => setPreviewOpen(true)}
                  />
                )}
                {selected && (
                  <ScenePreviewDialog
                    open={previewOpen}
                    onClose={() => setPreviewOpen(false)}
                    scene={selected}
                    sheets={pipe.contactSheets}
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
