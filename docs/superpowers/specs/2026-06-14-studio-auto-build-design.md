# Studio Auto Build — design

**Date:** 2026-06-14
**Status:** Design approved, ready for implementation plan
**Slots in as:** new `03*` story (~`03s — auto build`), reusing 03f job/poll infra and 05 assemble.

## Problem

The per-scene Build step works well manually, but every scene requires the user to
fire the same chain of actions by hand, one scene at a time. We want an **"auto
mode"** — like auto-approve in Claude Code — where the user presses one button and
the producer builds every pending scene end to end, then stitches the final cut,
auto-approving each action and only stopping on error.

The user also wants a **high-level view** of everything auto mode has to do: the set
of scenes, the steps within each scene, live status, and the ability to drill into
any scene to watch the real editor operate.

## Current Build loop (what auto mode automates)

Per scene, in order (all atomic actions already exist in
`src/components/Studio/useScenePipeline.ts`, with explicit dependency gates):

1. **Cut scene** → MP4 + WAV clip → `scene.clipUrl` + `scene.clipAudioUrl`
2. **Generate contact sheets** → `scene.sheets`
3. **Refine scene** → `/api/refine-scene` (the one async / pollable Gemini job;
   resumable via `scene.refineJobId`) → `scene.refined`
4. **Voice each segment** → AI TTS / record / reuse original (per segment)
5. **Assemble** → ffmpeg.wasm → scene MP4 blob
6. **Save** → `scene.assembledUrl`, then `markBuilt` → `status = 'built'`

Then, project-level: **final stitch** (`FinalCutBar` → `saveFinalCut`) concats all
assembled scenes into one video.

Today, per-scene status is only `pending | built` plus transient busy flags and a
single shared `sceneError`. There is no durable per-scene step/progress model — the
prep board's `pending | active | done | error` stage model (`src/lib/pipeline.ts`)
is the pattern we mirror.

## Decisions (from brainstorming)

- **Observability surface:** a new **task-tree dashboard** (Scenes → per-scene
  steps with live status), with the existing editor as the drill-down detail.
- **Auto voicing:** **AI TTS, honoring `original` tags.** Segments the refiner tags
  `original` reuse source audio (already auto-adopted by the refiner); every other
  segment gets AI TTS in the cloned/selected voice
  (`seg.voiceId ?? speakerVoice ?? global voice`). Recording is not automatable and
  is out for auto runs.
- **Error recovery:** **Halt + resume from failure.** The run stops on the first
  error; the failing scene/step is marked `error` with the message. A **Resume**
  button re-runs from exactly that step, keeping all prior completed work.
- **Run scope:** **pending scenes → then final stitch.** Skip already-built scenes,
  build each pending scene in order, then auto-run the final concat. One press =
  export-ready cut.

## Architecture

### 1. Step model — `src/lib/autoBuild.ts` (pure, unit-tested)

Define the per-scene build sequence as data, mirroring `pipeline.ts`'s
`StageDef` + `pending|active|done|error` model:

```
SCENE_STEPS = [
  cut       → isDone: clipUrl && clipAudioUrl
  sheets    → isDone: sheets present
  refine    → isDone: refined present                 (async/pollable)
  voice     → isDone: every non-'original' segment has audio
  assemble  → isDone: (assembled blob available)      (see save)
  save      → isDone: assembledUrl present
]
```

Each step carries an `isDone(scene)` predicate **derived from existing scene
fields** — the codebase already treats "field present = step done," so we avoid a
second source of truth. Voice sub-progress (`3/4 voiced`) is derived by counting
segments with audio.

Pure helpers to unit-test:
- step definitions + each `isDone` predicate
- "next pending step for a scene" and "next pending scene for the run"
  (skips `built` scenes; honors derived doneness so a partially-built scene resumes
  at the right step)

### 2. Durable run state — `autoBuild` in `src/store/studioSlice.ts` (persisted)

Store only the **run pointer**, not a per-step duplicate matrix:

```ts
autoBuild: {
  status:        'idle' | 'running' | 'paused' | 'halted' | 'done',
  currentSceneId: string | null,
  currentStepId:  StepId | null,
  error:          string | null,   // stageError() message on halt
  includeFinalStitch: true,
}
```

Dashboard per-step status is computed: steps before the pointer = `done` (verified
by predicate), step at the pointer = `running` (or `error` when halted there), after
= `pending`. Resume = re-run the action at the pointer.

### 3. Orchestrator — `useAutoBuild.ts` (on top of `useScenePipeline`)

When `status === 'running'`, an effect loop drives the sequence:

```
pick next non-built scene
  for each step whose isDone(scene) is false:
    set pointer (currentSceneId, currentStepId)
    call the matching atomic action; await it
  markBuilt; advance to next scene
when no pending scenes remain → run final stitch → status = 'done'
on any throw → autoBuild.error = stageError(e); status = 'halted'  (pointer stays)
```

- Reuses existing atomic actions (`sliceScene`, `generateSceneSheets`,
  `refineScene`, the per-segment voicers).
- **Sequential** — one scene, one step at a time. (Cut and sheets are independent;
  kept sequential for v1 legibility. Parallelizing them is a possible later
  optimization, explicitly out of scope here.)

### Required refactors — extract, don't rewrite

The orchestrator cannot press a component's button, so pull these into callables
that both the manual UI and the orchestrator use (no behavior change to manual path):

1. **`assembleScene(scene, …): Promise<Blob>`** — extracted from
   `SceneAssembleBar.tsx` (`planScene` → `buildFfmpegCommand` → ffmpeg.wasm). The bar
   calls the same function.
2. **`assembleFinalCut(…)`** — extracted from `FinalCutBar.tsx`, called by both the
   bar and the orchestrator.
3. **`voiceAllSegments(scene)`** — new aggregate in the hook that loops segments and
   calls `generateSegmentNarration` for each non-`original` segment (original-tagged
   are already auto-adopted by the refiner).

### 4. Dashboard UI — `AutoBuildBoard.tsx` + mode toggle

- **Entry:** a primary **`Auto build ▶`** control at the top of the Build phase
  switches the Build view from manual `SceneTabs` to the dashboard. Auto is a *mode*,
  not a one-way door — flip back to manual any time.
- **Board:** run header (`▶ Running · Scene 2/5`, controls) + scene tree. Each scene
  row shows rolled-up status + elapsed time; the active scene auto-expands to its six
  steps with per-step icons (`✓ ⟳ · ✗`) and the `Voice (n/m)` sub-count. The board is
  a **pure render of slice state** — no logic of its own.
- **Controls:** `Start` / `Pause` / `Resume` / `Stop`.
  - **Pause** stops *after the current in-flight step finishes* — never abort an
    in-flight ffmpeg or refine job (cleaner, resumable state).
  - **Stop** ends the run, completed work intact (`status = idle`).
  - **Resume** appears after pause/halt; re-runs from the pointer.
- **Drill-in:** clicking a scene row selects it (`setSelectedId`) and reveals the
  existing editor (`TranscriptDiff` + bars) for that scene — watch segments populate
  live, or hand-edit when paused/halted/done. The manual editor is unchanged; it
  becomes the drill-down detail.

## Semantics & edge cases

- **Reload mid-run:** `autoBuild` state is persisted; a hard reload lands on the
  dashboard at the last pointer in **`paused`** state (never auto-resume into a
  browser-side step that was in flight, since cut/sheets/assemble aren't resumable
  across reload). Press **Resume** to continue; a refine in progress resumes its poll
  via `refineJobId`.
- **No voice configured:** halt before the first voice step with a clear message,
  rather than failing deep in a scene.
- **Scene with zero non-original segments:** voice step is a no-op, marked done.
- **Already-built scenes:** skipped; the pointer starts at the first pending scene.
- **Replicate not configured / out of credit:** surfaces as the halt message via the
  existing `stageError()` extraction.

## Testing

Per repo convention (`*.test.ts` next to source; build/lint/tests are the gate; no
pixel-perfect/browser verification during prototyping):

- `autoBuild.ts` — step definitions, `isDone` predicates, next-pending selection
  (fully unit-tested, pure).
- Orchestrator advance logic against mocked atomic actions: happy path,
  halt-on-error, resume-from-pointer, skip-built.

## Story & PR structure

One **`03*` story** (~`03s — auto build`). Per the one-branch-per-refactor rule:
**one branch + one umbrella PR**, commits per sub-part:

1. `autoBuild.ts` step model + tests
2. Extract `assembleScene` / `assembleFinalCut` + add `voiceAllSegments`
3. `autoBuild` slice state (persisted)
4. `useAutoBuild` orchestrator
5. `AutoBuildBoard` UI + Build-phase mode toggle

`npm run build`, `npm run lint`, `npm run test:run` must pass.

## Out of scope

- Auto-running the **prep** phase (stays manual; possible future extension).
- Parallelizing cut + sheets within a scene.
- Recording-based voicing in auto runs (not automatable).
