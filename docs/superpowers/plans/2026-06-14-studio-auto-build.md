# Studio Auto Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-press "auto build" mode to the Studio Build step: a task-tree dashboard drives every pending scene through cut → contact sheets → refine → voice → assemble+save, then stitches the final cut, auto-approving each action and halting on the first error with resume-from-pointer.

**Architecture:** A pure step model (`src/lib/autoBuild.ts`) derives each scene's per-step status from existing scene fields and computes the run's "next action". A durable `autoBuild` pointer lives in the Redux `studio` slice. An orchestrator hook (`useAutoBuild`) watches run state + scenes and fires the matching existing `useScenePipeline` action one step at a time, advancing as Redux state changes and halting when an action reports an error. A dashboard component (`AutoBuildBoard`) is a pure render of that state with Start/Pause/Resume/Stop controls; clicking a scene row drills into the existing manual editor as the detail view.

**Tech Stack:** React 19 + TypeScript, Redux Toolkit + redux-persist, RTK Query, ffmpeg.wasm (existing `src/lib/export/*`), Vitest. No new dependencies.

**Design spec:** `docs/superpowers/specs/2026-06-14-studio-auto-build-design.md`

---

## Background the implementer needs

Read these before starting; the tasks assume this context:

- **Per-scene actions already exist** in `src/components/Studio/useScenePipeline.ts` (the `pipe` object): `sliceScene(id)` (cut → `clipUrl`+`clipAudioUrl`), `generateSceneSheets(id)` (→ `scene.sheets`), `refineScene(id)` (async Gemini job → `scene.refined`), `generateSegmentNarration`/`recordSegmentNarration`/`adoptSegmentOriginal` (per-segment voicing), `saveSceneCut(id, blob)` (→ `scene.assembledUrl`), `saveFinalCut(blob)` (→ `finalCutUrl`), `toggleBuilt(id)`, and the not-yet-exported `markBuilt(id)`.
- **These actions swallow their own errors** into a shared transient `pipe.sceneError` string (via `setSceneError(stageError(e))`) and do **not** throw — except `saveSceneCut`/`saveFinalCut`, which only have a `finally` and therefore **do** throw. Each action also calls `setSceneError(null)` at its start. The orchestrator relies on both facts.
- **`stageError(e)`** (module-private in `useScenePipeline.ts`) extracts a readable message from RTK Query's serialized errors. We re-export it for the orchestrator.
- **Scene step "doneness" is derived from field presence** (`clipUrl`, `sheets`, `refined`, segment `audioUrl`, `assembledUrl`, `status`) — there is no per-step status stored. We keep it that way.
- **The refiner auto-voices `original`-tagged segments** during `completeRefineJob` (they come back with `audioUrl` already set), so after `refineScene` those segments are already voiced. `NarrationSegment.suggestedSource === 'original'` marks segments the refiner wanted voiced from the source audio.
- **Assemble logic** lives inside two components: `SceneAssembleBar.tsx` (`run()` → `effectiveSegments`/`planScene`/`buildFfmpegCommand`/`assemble`) and `FinalCutBar.tsx` (`run()` → `buildConcatCommand`/`concat`). Both fetch bytes via `useSignedBytes()` (returns `(url: string) => Promise<Uint8Array>`). We extract their `run()` bodies into a shared lib so the orchestrator can assemble headlessly.
- **The whole `studio` slice is persisted** (`src/store/index.ts`). The spec requires a run that was `running` at reload to come back **paused** — handled in the orchestrator with an in-session `liveRef`, not by auto-resuming.

## File structure

- **Create** `src/lib/autoBuild.ts` — pure step model: `AUTO_STEPS`, `nextStep`, `nextAction`, `voiceProgress`, `sceneStepStatuses`, `sceneRunStatus`, and the `AutoStepId`/`AutoRunStatus`/`AutoBuildRun` types. One responsibility: derive auto-build status/decisions from `Scene[]` + run pointer.
- **Create** `src/lib/autoBuild.test.ts` — unit tests for the above.
- **Create** `src/lib/export/assembleScene.ts` — `assembleSceneBlob(...)` and `assembleFinalCutBlob(...)`, extracted from the two bars. One responsibility: turn a scene (or all scenes) + a byte-fetcher into a rendered MP4 `Blob`.
- **Modify** `src/components/Studio/SceneAssembleBar.tsx` — call `assembleSceneBlob`.
- **Modify** `src/components/Studio/FinalCutBar.tsx` — call `assembleFinalCutBlob`.
- **Modify** `src/store/studioSlice.ts` — add `autoBuild` state + reducers.
- **Modify** `src/components/Studio/useScenePipeline.ts` — add `voiceAllSegments`, export `markBuilt`, re-export `stageError`.
- **Create** `src/components/Studio/useAutoBuild.ts` — the orchestrator hook.
- **Create** `src/components/Studio/AutoBuildBoard.tsx` — the dashboard UI.
- **Modify** `src/pages/Studio.tsx` — mode toggle + mount the board + wire `useAutoBuild`.
- **Modify** `stories/inprogress/studio/README.md` + **Create** `stories/inprogress/studio/03s-auto-build.md`.

---

## Task 1: Pure step model (`src/lib/autoBuild.ts`)

**Files:**
- Create: `src/lib/autoBuild.ts`
- Test: `src/lib/autoBuild.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/autoBuild.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Scene } from './scenes'
import type { ContactSheet } from './frames'
import {
  AUTO_STEPS,
  nextStep,
  nextAction,
  isSceneComplete,
  voiceProgress,
  sceneStepStatuses,
  sceneRunStatus,
  type AutoBuildRun,
} from './autoBuild'

const idle: AutoBuildRun = { status: 'idle', currentSceneId: null, currentStepId: null, error: null }

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    index: 0,
    sourceId: 'source-1',
    title: 'Scene 1',
    start: 0,
    end: 10,
    transcript: 'hello world',
    status: 'pending',
    narrationSeconds: null,
    ...over,
  }
}

describe('AUTO_STEPS', () => {
  it('runs cut → sheets → refine → voice → assemble', () => {
    expect(AUTO_STEPS.map((s) => s.id)).toEqual(['cut', 'sheets', 'refine', 'voice', 'assemble'])
  })
})

describe('nextStep', () => {
  it('starts at cut on a bare scene', () => {
    expect(nextStep(scene())).toBe('cut')
  })

  it('moves to sheets once the scene is cut', () => {
    expect(nextStep(scene({ clipUrl: 'u', clipAudioUrl: 'a' }))).toBe('sheets')
  })

  it('moves to refine once cut + sheeted', () => {
    expect(nextStep(scene({ clipUrl: 'u', clipAudioUrl: 'a', sheets: [{} as ContactSheet] }))).toBe(
      'refine',
    )
  })

  it('moves to voice once refined, while a segment is unvoiced', () => {
    const s = scene({
      clipUrl: 'u',
      clipAudioUrl: 'a',
      sheets: [{} as ContactSheet],
      refined: { segments: [{ text: 'hi', start: 0, end: 1 }], cuts: [], source: 'ai' },
    })
    expect(nextStep(s)).toBe('voice')
  })

  it('moves to assemble once every segment is voiced', () => {
    const s = scene({
      clipUrl: 'u',
      clipAudioUrl: 'a',
      sheets: [{} as ContactSheet],
      refined: { segments: [{ text: 'hi', start: 0, end: 1, audioUrl: 'v' }], cuts: [], source: 'ai' },
    })
    expect(nextStep(s)).toBe('assemble')
  })

  it('returns null once assembled', () => {
    const s = scene({
      clipUrl: 'u',
      clipAudioUrl: 'a',
      sheets: [{} as ContactSheet],
      refined: { segments: [{ text: 'hi', start: 0, end: 1, audioUrl: 'v' }], cuts: [], source: 'ai' },
      assembledUrl: 'done',
    })
    expect(nextStep(s)).toBeNull()
    expect(isSceneComplete(s)).toBe(true)
  })

  it('treats a refined scene with zero segments as voiced', () => {
    const s = scene({
      clipUrl: 'u',
      clipAudioUrl: 'a',
      sheets: [{} as ContactSheet],
      refined: { segments: [], cuts: [], source: 'ai' },
    })
    expect(nextStep(s)).toBe('assemble')
  })
})

describe('nextAction', () => {
  it('returns null when there are no scenes', () => {
    expect(nextAction([])).toBeNull()
  })

  it('skips built scenes and points at the first pending one', () => {
    const built = scene({ id: 'a', status: 'built' })
    const pending = scene({ id: 'b' })
    const r = nextAction([built, pending])
    expect(r?.scene.id).toBe('b')
    expect(r?.step).toBe('cut')
  })

  it('returns step=null for a fully-stepped but not-yet-built scene', () => {
    const done = scene({
      id: 'c',
      clipUrl: 'u',
      clipAudioUrl: 'a',
      sheets: [{} as ContactSheet],
      refined: { segments: [{ text: 'hi', start: 0, end: 1, audioUrl: 'v' }], cuts: [], source: 'ai' },
      assembledUrl: 'done',
      status: 'pending',
    })
    expect(nextAction([done])).toEqual({ scene: done, step: null })
  })

  it('returns null when every scene is built', () => {
    expect(nextAction([scene({ status: 'built' })])).toBeNull()
  })
})

describe('voiceProgress', () => {
  it('counts voiced vs total segments', () => {
    const s = scene({
      refined: {
        segments: [
          { text: 'a', start: 0, end: 1, audioUrl: 'v' },
          { text: 'b', start: 1, end: 2 },
        ],
        cuts: [],
        source: 'ai',
      },
    })
    expect(voiceProgress(s)).toEqual({ done: 1, total: 2 })
  })
})

describe('sceneStepStatuses', () => {
  it('marks the pointed step running while the run is running', () => {
    const s = scene({ clipUrl: 'u', clipAudioUrl: 'a' }) // cut done, sheets next
    const run: AutoBuildRun = { status: 'running', currentSceneId: 's1', currentStepId: 'sheets', error: null }
    const st = sceneStepStatuses(s, run)
    expect(st.cut).toBe('done')
    expect(st.sheets).toBe('running')
    expect(st.refine).toBe('pending')
  })

  it('marks the pointed step error while halted', () => {
    const s = scene({ clipUrl: 'u', clipAudioUrl: 'a' })
    const run: AutoBuildRun = { status: 'halted', currentSceneId: 's1', currentStepId: 'sheets', error: 'boom' }
    expect(sceneStepStatuses(s, run).sheets).toBe('error')
  })
})

describe('sceneRunStatus', () => {
  it('reports built / running / error / pending', () => {
    expect(sceneRunStatus(scene({ status: 'built' }), idle)).toBe('built')
    expect(
      sceneRunStatus(scene({ id: 'x' }), { status: 'running', currentSceneId: 'x', currentStepId: 'cut', error: null }),
    ).toBe('running')
    expect(
      sceneRunStatus(scene({ id: 'x' }), { status: 'halted', currentSceneId: 'x', currentStepId: 'cut', error: 'e' }),
    ).toBe('error')
    expect(sceneRunStatus(scene({ id: 'x' }), idle)).toBe('pending')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/autoBuild.test.ts`
Expected: FAIL — `Failed to resolve import "./autoBuild"` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/autoBuild.ts`:

```ts
/**
 * Auto Build (story 03s) — the pure decision layer for the unattended Build run.
 *
 * Auto mode drives every pending scene through the same six manual steps in order;
 * this module says, from the durable scene state alone, which step a scene is on,
 * what the run should do next, and how to colour each row in the dashboard. It
 * holds NO state of its own — "done" is derived from the same scene fields the
 * manual UI already writes (clipUrl, sheets, refined, segment audio, assembledUrl,
 * status), so there is never a second source of truth to keep in sync.
 */

import type { Scene } from './scenes'
import { effectiveSegments } from './refiner'

/** The per-scene build steps, in the order auto mode runs them. `assemble` covers
 *  both rendering the scene MP4 and saving it (one action). */
export type AutoStepId = 'cut' | 'sheets' | 'refine' | 'voice' | 'assemble'

/** Per-step display status in the dashboard. */
export type AutoStepStatus = 'pending' | 'running' | 'done' | 'error'

/** The run's lifecycle. `paused` = stopped after the current step (resumable);
 *  `halted` = stopped on an error (resumable after the cause is fixed). */
export type AutoRunStatus = 'idle' | 'running' | 'paused' | 'halted' | 'done'

/** The run pointer, persisted in the studio slice. `currentStepId` is widened with
 *  'stitch' for the project-level final concat that runs after the last scene. */
export type AutoBuildRun = {
  status: AutoRunStatus
  currentSceneId: string | null
  currentStepId: AutoStepId | 'stitch' | null
  error: string | null
}

export type AutoStepDef = {
  id: AutoStepId
  label: string
  /** True when this step's durable output already exists on the scene. */
  isDone: (scene: Scene) => boolean
}

export const AUTO_STEPS: AutoStepDef[] = [
  { id: 'cut', label: 'Cut scene', isDone: (s) => !!s.clipUrl && !!s.clipAudioUrl },
  { id: 'sheets', label: 'Contact sheets', isDone: (s) => (s.sheets?.length ?? 0) > 0 },
  { id: 'refine', label: 'Refine scene', isDone: (s) => !!s.refined },
  {
    id: 'voice',
    label: 'Voice segments',
    // Only meaningful once refined (effectiveSegments falls back to a baseline
    // before then). Done when every effective segment carries audio — including
    // the `original`-tagged ones the refiner auto-voiced.
    isDone: (s) => !!s.refined && effectiveSegments(s).every((seg) => !!seg.audioUrl),
  },
  { id: 'assemble', label: 'Assemble & save', isDone: (s) => !!s.assembledUrl },
]

/** Voiced/total segment counts for the dashboard's "Voice (n/m)" sub-progress. */
export function voiceProgress(scene: Scene): { done: number; total: number } {
  const segs = effectiveSegments(scene)
  return { done: segs.filter((s) => !!s.audioUrl).length, total: segs.length }
}

/** The first step on this scene that isn't done yet, or null when all are done. */
export function nextStep(scene: Scene): AutoStepId | null {
  for (const step of AUTO_STEPS) if (!step.isDone(scene)) return step.id
  return null
}

/** Whether every build step for this scene is complete (ready to mark built). */
export function isSceneComplete(scene: Scene): boolean {
  return nextStep(scene) === null
}

/**
 * What auto mode should do next across the whole run:
 *  - `{ scene, step }` — run `step` on the first not-yet-built scene, OR
 *  - `{ scene, step: null }` — that scene's steps are all done; mark it built, OR
 *  - `null` — no pending scenes remain; do the final stitch / finish.
 * Built scenes (`status === 'built'`) are skipped.
 */
export function nextAction(scenes: Scene[]): { scene: Scene; step: AutoStepId | null } | null {
  for (const scene of scenes) {
    if (scene.status === 'built') continue
    return { scene, step: nextStep(scene) }
  }
  return null
}

/** Per-step display status for one scene, given the live run pointer. */
export function sceneStepStatuses(scene: Scene, run: AutoBuildRun): Record<AutoStepId, AutoStepStatus> {
  const out = {} as Record<AutoStepId, AutoStepStatus>
  for (const step of AUTO_STEPS) {
    if (step.isDone(scene)) out[step.id] = 'done'
    else if (run.currentSceneId === scene.id && run.currentStepId === step.id)
      out[step.id] = run.status === 'halted' ? 'error' : run.status === 'running' ? 'running' : 'pending'
    else out[step.id] = 'pending'
  }
  return out
}

/** Rolled-up status for a scene row in the dashboard. */
export function sceneRunStatus(
  scene: Scene,
  run: AutoBuildRun,
): 'built' | 'error' | 'running' | 'pending' {
  if (scene.status === 'built') return 'built'
  if (run.currentSceneId === scene.id) {
    if (run.status === 'halted') return 'error'
    if (run.status === 'running') return 'running'
  }
  return 'pending'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/autoBuild.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/autoBuild.ts src/lib/autoBuild.test.ts
git commit -m "feat(studio): auto-build step model + selectors (03s)"
```

---

## Task 2: Extract assemble orchestration (`src/lib/export/assembleScene.ts`)

Pull the `run()` bodies out of the two assemble bars so the orchestrator can render scenes headlessly, with the components calling the same functions (no behaviour change).

**Files:**
- Create: `src/lib/export/assembleScene.ts`
- Modify: `src/components/Studio/SceneAssembleBar.tsx:96-158`
- Modify: `src/components/Studio/FinalCutBar.tsx:60-97`

- [ ] **Step 1: Write the extracted module**

Create `src/lib/export/assembleScene.ts`:

```ts
/**
 * Headless scene/final assemble (story 03s). The render logic that used to live
 * inside SceneAssembleBar/FinalCutBar's `run()` callbacks, lifted here so BOTH the
 * manual bars AND the auto-build orchestrator drive the exact same ffmpeg.wasm
 * walk. Pure orchestration over the existing `src/lib/export/*` primitives — it
 * takes a byte-fetcher (the signed-bytes reader) and returns the rendered Blob.
 * Throws on any failure so callers can surface/halt.
 */

import type { Scene } from '../scenes'
import { effectiveCuts, effectiveSegments, overlaps } from '../refiner'
import {
  planScene,
  buildFfmpegCommand,
  buildMeasureCommand,
  buildConcatCommand,
  parseLoudnorm,
  LOUDNORM_ENABLED,
  type LoudnormStats,
} from './assemble'
import { assemble, measureLoudness, concat } from './ffmpeg'

/** Reads a serve path's bytes (signing big objects straight to the bucket). */
export type FetchBytes = (url: string) => Promise<Uint8Array>

/** Render ONE scene off its own cut clip — cuts dropped, narration over kept
 *  video, dead space silent. Mirrors SceneAssembleBar.run(). */
export async function assembleSceneBlob({
  scene,
  fetchBytes,
  onStage,
  onProgress,
}: {
  scene: Scene
  fetchBytes: FetchBytes
  onStage?: (msg: string) => void
  onProgress?: (fraction: number) => void
}): Promise<Blob> {
  if (!scene.clipUrl) throw new Error('Cut this scene first — assemble works on the scene’s own clip.')
  const segments = effectiveSegments(scene)
  if (overlaps(segments).length > 0)
    throw new Error('Resolve overlapping narration runs before assembling this scene.')
  const plan = planScene({ segments, cuts: effectiveCuts(scene), start: scene.start, end: scene.end })
  if (plan.video.length === 0) throw new Error('Nothing to assemble — the whole scene is cut.')

  const draft = buildFfmpegCommand(plan, { source: 'clip.mp4', output: 'scene.mp4' })

  onStage?.('Loading the scene clip…')
  const source = await fetchBytes(scene.clipUrl)

  onStage?.(`Gathering ${draft.audioInputs.length} narration clip${draft.audioInputs.length === 1 ? '' : 's'}…`)
  const clips = await Promise.all(
    draft.audioInputs.map((segIndex) => {
      const url = segments[segIndex]?.audioUrl
      if (!url) throw new Error(`Segment ${segIndex} has no audio to assemble.`)
      return fetchBytes(url)
    }),
  )

  const loudness: (LoudnormStats | null)[] = []
  if (LOUDNORM_ENABLED) {
    for (let k = 0; k < clips.length; k++) {
      onStage?.(`Measuring narration loudness (${k + 1}/${clips.length})…`)
      loudness.push(
        await measureLoudness({ clip: clips[k], command: buildMeasureCommand(`m${k}.wav`) })
          .then(parseLoudnorm)
          .catch(() => null),
      )
    }
  }

  const command = buildFfmpegCommand(plan, { source: 'clip.mp4', output: 'scene.mp4', loudness })
  onStage?.('Assembling this scene…')
  return assemble({ source, clips, command, onProgress })
}

/** Stitch every scene's saved assembled cut into the whole video (stream-copy
 *  concat). Mirrors FinalCutBar.run(). */
export async function assembleFinalCutBlob({
  scenes,
  fetchBytes,
  onStage,
}: {
  scenes: Scene[]
  fetchBytes: FetchBytes
  onStage?: (msg: string) => void
}): Promise<Blob> {
  onStage?.(`Gathering ${scenes.length} assembled scene${scenes.length === 1 ? '' : 's'}…`)
  const parts = await Promise.all(
    scenes.map(async (s, i) => {
      if (!s.assembledUrl) throw new Error(`Scene ${i + 1} isn't assembled yet.`)
      return { name: `scene-${i}.mp4`, bytes: await fetchBytes(s.assembledUrl) }
    }),
  )

  if (parts.length === 1) return new Blob([parts[0].bytes.slice()], { type: 'video/mp4' })

  onStage?.('Stitching the final cut…')
  const command = buildConcatCommand(parts.map((p) => p.name))
  return concat({ parts, command })
}
```

- [ ] **Step 2: Point `SceneAssembleBar` at the extracted function**

In `src/components/Studio/SceneAssembleBar.tsx`, replace the imports block (lines 3-12) so the component no longer pulls the ffmpeg primitives it now delegates, and imports `assembleSceneBlob`:

```tsx
import type { Scene } from '../../lib/scenes'
import { effectiveCuts, effectiveSegments, overlaps } from '../../lib/refiner'
import { planScene } from '../../lib/export/assemble'
import { assembleSceneBlob } from '../../lib/export/assembleScene'
import { useSignedBytes } from './useSignedBytes'
import { useSignDownloadQuery } from '../../store/studioApi'
import { skipToken } from '@reduxjs/toolkit/query'
```

Then replace the body of `run` (the `try { ... }` block at lines 107-157, i.e. everything from `try {` through the matching `}` before `catch`) with a single call. The full `run` callback becomes:

```tsx
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
      const blob = await assembleSceneBlob({
        scene,
        fetchBytes,
        onStage: setStage,
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
  }, [running, canAssemble, scene, resultUrl, fetchBytes])
```

Note: `plan` is still computed above (lines 70-74) and used by the displayed stats (`plan.duration`, `plan.video.length`, `plan.audio`), so keep that `useMemo`. `segments` (line 70) is also still used by `unvoiced`/`overlapCount`, so keep it. Only the ffmpeg orchestration moved.

- [ ] **Step 3: Point `FinalCutBar` at the extracted function**

In `src/components/Studio/FinalCutBar.tsx`, replace the imports (lines 3-7) :

```tsx
import type { Scene } from '../../lib/scenes'
import { assembleFinalCutBlob } from '../../lib/export/assembleScene'
import { useSignedBytes } from './useSignedBytes'
import { useSignDownloadQuery } from '../../store/studioApi'
import { skipToken } from '@reduxjs/toolkit/query'
```

Replace the `run` callback's `try` block (lines 70-90) so it calls the helper:

```tsx
    try {
      const blob = await assembleFinalCutBlob({ scenes, fetchBytes, onStage: setStage })
      setResultBlob(blob)
      setResultUrl(URL.createObjectURL(blob))
      setStage(`Done · ${(blob.size / 1_048_576).toFixed(1)} MB · save it to keep it`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('')
    } finally {
      setRunning(false)
    }
```

- [ ] **Step 4: Verify the build, lint, and existing tests**

Run: `npm run build && npm run lint && npm run test:run`
Expected: PASS. (No tests assert the bars' internals; this is a behaviour-preserving extraction. If the build flags an unused import in either bar — e.g. `buildFfmpegCommand` — remove it.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/assembleScene.ts src/components/Studio/SceneAssembleBar.tsx src/components/Studio/FinalCutBar.tsx
git commit -m "refactor(studio): extract headless assembleScene/assembleFinalCut (03s)"
```

---

## Task 3: Durable `autoBuild` run state (`src/store/studioSlice.ts`)

**Files:**
- Modify: `src/store/studioSlice.ts`
- Test: `src/store/studioSlice.autoBuild.test.ts` (create)

- [ ] **Step 1: Write the failing reducer test**

Create `src/store/studioSlice.autoBuild.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import reducer, {
  startAutoBuild,
  pauseAutoBuild,
  resumeAutoBuild,
  stopAutoBuild,
  haltAutoBuild,
  completeAutoBuild,
  setAutoPointer,
} from './studioSlice'

const initial = reducer(undefined, { type: '@@INIT' })

describe('autoBuild reducers', () => {
  it('defaults to idle', () => {
    expect(initial.autoBuild).toEqual({ status: 'idle', currentSceneId: null, currentStepId: null, error: null })
  })

  it('start → running and clears any prior error', () => {
    const halted = reducer(initial, haltAutoBuild('boom'))
    const s = reducer(halted, startAutoBuild())
    expect(s.autoBuild.status).toBe('running')
    expect(s.autoBuild.error).toBeNull()
  })

  it('pause only from running', () => {
    const running = reducer(initial, startAutoBuild())
    expect(reducer(running, pauseAutoBuild()).autoBuild.status).toBe('paused')
    expect(reducer(initial, pauseAutoBuild()).autoBuild.status).toBe('idle')
  })

  it('resume from paused or halted → running, error cleared', () => {
    const halted = reducer(initial, haltAutoBuild('boom'))
    const r = reducer(halted, resumeAutoBuild())
    expect(r.autoBuild.status).toBe('running')
    expect(r.autoBuild.error).toBeNull()
  })

  it('halt records the message', () => {
    const s = reducer(reducer(initial, startAutoBuild()), haltAutoBuild('REPLICATE_NOT_CONFIGURED'))
    expect(s.autoBuild).toMatchObject({ status: 'halted', error: 'REPLICATE_NOT_CONFIGURED' })
  })

  it('stop resets the pointer', () => {
    const moved = reducer(initial, setAutoPointer({ sceneId: 's1', stepId: 'refine' }))
    const s = reducer(moved, stopAutoBuild())
    expect(s.autoBuild).toEqual({ status: 'idle', currentSceneId: null, currentStepId: null, error: null })
  })

  it('setAutoPointer moves the pointer', () => {
    const s = reducer(initial, setAutoPointer({ sceneId: 's2', stepId: 'voice' }))
    expect(s.autoBuild).toMatchObject({ currentSceneId: 's2', currentStepId: 'voice' })
  })

  it('complete → done', () => {
    const s = reducer(reducer(initial, startAutoBuild()), completeAutoBuild())
    expect(s.autoBuild.status).toBe('done')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/store/studioSlice.autoBuild.test.ts`
Expected: FAIL — `startAutoBuild` etc. are not exported.

- [ ] **Step 3: Add the state, reducers, and exports**

In `src/store/studioSlice.ts`:

a) Add the type import near the top (after the `Scene` import on line 17):

```ts
import type { AutoBuildRun } from '../lib/autoBuild'
```

b) Add the field to `StudioState` (inside the type, after `speakerAssignments` on line 199):

```ts
  /** Auto-build run pointer (story 03s). Durable so a reload knows a run was in
   *  progress; the orchestrator coerces a persisted `running` back to `paused`
   *  on reload (in-flight browser steps aren't resumable). The resumable truth is
   *  the scenes themselves — this is just status + where it stopped + the error. */
  autoBuild: AutoBuildRun
```

c) Add the initial value (in `initialState`, after `speakerAssignments: {}` on line 225):

```ts
  autoBuild: { status: 'idle', currentSceneId: null, currentStepId: null, error: null },
```

d) Add the reducers (inside `reducers`, just before `resetStudio` on line 417):

```ts
    /** Begin / restart an auto-build run; clears any prior halt error. */
    startAutoBuild(state) {
      state.autoBuild.status = 'running'
      state.autoBuild.error = null
    },
    /** Pause after the current step finishes (only meaningful while running). */
    pauseAutoBuild(state) {
      if (state.autoBuild.status === 'running') state.autoBuild.status = 'paused'
    },
    /** Resume a paused or halted run; clears the error. */
    resumeAutoBuild(state) {
      if (state.autoBuild.status === 'paused' || state.autoBuild.status === 'halted') {
        state.autoBuild.status = 'running'
        state.autoBuild.error = null
      }
    },
    /** End the run, leaving completed scene work intact. */
    stopAutoBuild(state) {
      state.autoBuild = { status: 'idle', currentSceneId: null, currentStepId: null, error: null }
    },
    /** Stop on an error, recording the message and leaving the pointer in place. */
    haltAutoBuild(state, action: PayloadAction<string>) {
      state.autoBuild.status = 'halted'
      state.autoBuild.error = action.payload
    },
    /** The run finished every scene (and the final stitch). */
    completeAutoBuild(state) {
      state.autoBuild.status = 'done'
    },
    /** Move the run pointer to the step currently executing. */
    setAutoPointer(state, action: PayloadAction<{ sceneId: string | null; stepId: AutoBuildRun['currentStepId'] }>) {
      state.autoBuild.currentSceneId = action.payload.sceneId
      state.autoBuild.currentStepId = action.payload.stepId
    },
```

e) Add the new action creators to the `export const { ... }` block (after `assignSpeaker,` on line 456):

```ts
  startAutoBuild,
  pauseAutoBuild,
  resumeAutoBuild,
  stopAutoBuild,
  haltAutoBuild,
  completeAutoBuild,
  setAutoPointer,
```

Note: `resetStudio` already returns `{ ...initialState, ... }`, so it resets `autoBuild` to idle automatically — no change needed there.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/store/studioSlice.autoBuild.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/studioSlice.ts src/store/studioSlice.autoBuild.test.ts
git commit -m "feat(studio): durable autoBuild run state + reducers (03s)"
```

---

## Task 4: `voiceAllSegments` + expose `markBuilt`/`stageError` (`useScenePipeline.ts`)

The orchestrator needs to voice a whole scene in one action, mark a scene built, and reuse the error extractor.

**Files:**
- Modify: `src/components/Studio/useScenePipeline.ts`

- [ ] **Step 1: Re-export `stageError`**

`stageError` is a module-private function (line 142). Add an exported alias so the orchestrator can reuse it. Immediately after the `stageError` function (after line 155), add:

```ts
/** Re-exported so the auto-build orchestrator surfaces the same readable error. */
export const autoBuildError = stageError
```

- [ ] **Step 2: Add a transient busy flag for whole-scene voicing**

Find where the other busy flags are declared (`useState` calls such as `slicingId`, `sheetingId`, `voicingSegKey`). Add alongside them:

```ts
  const [voicingSceneId, setVoicingSceneId] = useState<string | null>(null)
```

- [ ] **Step 3: Add `voiceAllSegments`**

Insert this callback after `adoptSegmentOriginal` (after line 1416, before the `// ---- Scene build loop ----` comment). It accumulates all segment audio into ONE local array and writes a single `patchScene` at the end — calling the per-segment `setSegmentAudio` in a tight loop would each merge from a stale `scene.refined` and clobber earlier segments:

```ts
  // Voice EVERY unvoiced segment in a scene for auto mode (story 03s). Segments the
  // refiner already voiced from the source audio (auto-adopted `original`) keep
  // their audio and are skipped; a still-unvoiced segment the refiner TAGGED
  // `original` is reused from the source audio; every other unvoiced segment gets
  // AI TTS in its resolved voice (per-segment override → speaker voice → global).
  // Sequential — one network call at a time. Builds the new segments array locally
  // and commits in ONE patch (a tight loop of `setSegmentAudio` would merge from a
  // stale `refined` and lose earlier segments). On failure sets `sceneError` and
  // bails WITHOUT a partial commit — auto mode reads `sceneError` to halt; resuming
  // re-voices the scene from its already-voiced segments (the skip keeps it cheap).
  const voiceAllSegments = useCallback(
    async (sceneId: string) => {
      const scene = scenes.find((s) => s.id === sceneId)
      if (!scene) return
      setVoicingSceneId(sceneId)
      setSceneError(null)
      try {
        const src = sourceForScene(sources, scene)
        const base =
          scene.refined ?? { segments: effectiveSegments(scene), cuts: scene.cuts ?? [], source: 'ai' as const }
        const segments = [...base.segments]
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i]
          if (seg.audioUrl) continue // already voiced (incl. auto-adopted original)
          if (seg.suggestedSource === 'original') {
            const [clip] = await sliceAndUploadSpans(src?.audioUrl ?? '', [{ start: seg.start, end: seg.end }])
            if (!clip) throw new Error(`Couldn't reuse the original audio for segment ${i + 1}.`)
            segments[i] = {
              ...seg,
              audioUrl: clip.url,
              audioSeconds: clip.seconds,
              audioSource: 'original',
              end: seg.start + clip.seconds,
            }
          } else {
            const label = src ? dominantSpeaker(src.words, seg.start, seg.end) : null
            const speakerVoice =
              label != null ? resolveSpeakerVoice(scene.sourceId, label, cast, speakerAssignments) : null
            const voiceId = seg.voiceId ?? speakerVoice?.voiceId ?? voice?.voiceId
            if (!voiceId)
              throw new Error('Pick a voice before auto-building — segments need a voice to narrate.')
            const { audioUrl } = await narrateReq({ text: seg.text, voiceId }).unwrap()
            const audioSeconds = await measureAudioDuration(audioUrl)
            segments[i] = {
              ...seg,
              audioUrl,
              audioSeconds,
              audioSource: 'ai',
              end: seg.start + (audioSeconds > 0 ? audioSeconds : seg.end - seg.start),
            }
          }
        }
        const total = segments.reduce((n, s) => n + (s.audioSeconds ?? 0), 0)
        patchScene(sceneId, { refined: { ...base, segments }, narrationSeconds: total > 0 ? total : null })
      } catch (e) {
        setSceneError(stageError(e))
      } finally {
        setVoicingSceneId(null)
      }
    },
    [scenes, sources, cast, speakerAssignments, voice, narrateReq, sliceAndUploadSpans, patchScene],
  )
```

- [ ] **Step 4: Export `markBuilt`, `voiceAllSegments`, `voicingSceneId` from the hook**

In the hook's return object, add these three keys (e.g. next to `toggleBuilt` on line 1555):

```ts
    markBuilt,
    voiceAllSegments,
    voicingSceneId,
```

- [ ] **Step 5: Verify build, lint, tests**

Run: `npm run build && npm run lint && npm run test:run`
Expected: PASS. (Confirms the new callback type-checks against the real `sliceAndUploadSpans`, `dominantSpeaker`, `resolveSpeakerVoice`, `narrateReq`, `measureAudioDuration`, and `patchScene` signatures already imported in this file.)

- [ ] **Step 6: Commit**

```bash
git add src/components/Studio/useScenePipeline.ts
git commit -m "feat(studio): voiceAllSegments + expose markBuilt for auto build (03s)"
```

---

## Task 5: The orchestrator (`src/components/Studio/useAutoBuild.ts`)

Drives the run: watches `autoBuild.status` + `scenes`, fires the matching `pipe` action one step at a time, advances as Redux state changes, and halts on the first error.

**Files:**
- Create: `src/components/Studio/useAutoBuild.ts`

- [ ] **Step 1: Write the orchestrator**

Create `src/components/Studio/useAutoBuild.ts`:

```ts
/**
 * Auto Build orchestrator (story 03s). When a run is `running`, this hook fires the
 * one next step on the one next scene, then waits: each `pipe` action updates Redux
 * (scene fields, or the shared `sceneError`), the effect re-runs, and `nextAction`
 * recomputes where to go — so progress is driven by state, not a tight loop holding
 * stale callbacks. The cut/sheets/refine/voice actions swallow their errors into
 * `pipe.sceneError`; we detect failure by seeing the pointed step still not done
 * with an error present on the next tick. The assemble step (we own it) and the
 * final stitch throw, so they're caught directly.
 *
 * `liveRef` is the in-session guard: it's only set by an explicit Start/Resume in
 * THIS session, so a persisted `running` status rehydrated after a reload does NOT
 * auto-fire — the mount effect coerces it to `paused` and the user resumes.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  startAutoBuild,
  pauseAutoBuild,
  resumeAutoBuild,
  stopAutoBuild,
  haltAutoBuild,
  completeAutoBuild,
  setAutoPointer,
} from '../../store/studioSlice'
import { nextAction, type AutoStepId, type AutoBuildRun } from '../../lib/autoBuild'
import { assembleSceneBlob, assembleFinalCutBlob } from '../../lib/export/assembleScene'
import { autoBuildError } from './useScenePipeline'
import { useSignedBytes } from './useSignedBytes'
import type { Scene } from '../../lib/scenes'

/** The slice of `useScenePipeline` the orchestrator drives. */
type Pipe = {
  scenes: Scene[]
  sceneError: string | null
  finalCutUrl: string | null
  sliceScene: (id: string) => Promise<void>
  generateSceneSheets: (id: string) => Promise<void>
  refineScene: (id: string) => Promise<void>
  voiceAllSegments: (id: string) => Promise<void>
  saveSceneCut: (id: string, blob: Blob) => Promise<string>
  saveFinalCut: (blob: Blob) => Promise<string>
  markBuilt: (id: string) => void
}

export type AutoBuildControls = {
  run: AutoBuildRun
  start: () => void
  pause: () => void
  resume: () => void
  stop: () => void
}

export function useAutoBuild(pipe: Pipe): AutoBuildControls {
  const dispatch = useAppDispatch()
  const run = useAppSelector((s) => s.studio.autoBuild)
  const fetchBytes = useSignedBytes()

  // In-flight guard (one step at a time) and the last step we attempted (to tell a
  // genuine failure apart from a benign warning that left the step done).
  const inFlightRef = useRef(false)
  const attemptRef = useRef<{ sceneId: string; stepId: AutoStepId } | null>(null)
  // Only true after an explicit Start/Resume in this session — gates the runner so
  // a rehydrated `running` never auto-fires.
  const liveRef = useRef(false)

  const start = useCallback(() => {
    liveRef.current = true
    dispatch(startAutoBuild())
  }, [dispatch])
  const resume = useCallback(() => {
    liveRef.current = true
    dispatch(resumeAutoBuild())
  }, [dispatch])
  const pause = useCallback(() => {
    liveRef.current = false
    dispatch(pauseAutoBuild())
  }, [dispatch])
  const stop = useCallback(() => {
    liveRef.current = false
    attemptRef.current = null
    dispatch(stopAutoBuild())
  }, [dispatch])

  // Keep `pipe` in a ref so the runner reads the CURRENT actions/state while staying
  // keyed to just the signals that should re-trigger it (status, scenes, sceneError,
  // finalCutUrl) — `pipe` itself is a fresh object every render.
  const pipeRef = useRef(pipe)
  pipeRef.current = pipe

  useEffect(() => {
    if (run.status !== 'running') return
    // A persisted `running` rehydrated after a reload (redux-persist hydrates
    // asynchronously, so status can flip to `running` AFTER mount) is not actually
    // in flight — coerce it to `paused` and wait for an explicit Resume. `liveRef`
    // is only set by Start/Resume in THIS session, so this never fires mid-run.
    if (!liveRef.current) {
      dispatch(pauseAutoBuild())
      return
    }
    if (inFlightRef.current) return
    const p = pipeRef.current
    const action = nextAction(p.scenes)

    // No pending scenes → stitch the final cut once, then finish.
    if (!action) {
      inFlightRef.current = true
      ;(async () => {
        try {
          if (!p.finalCutUrl) {
            dispatch(setAutoPointer({ sceneId: null, stepId: 'stitch' }))
            const blob = await assembleFinalCutBlob({ scenes: p.scenes, fetchBytes })
            await p.saveFinalCut(blob)
          }
          liveRef.current = false
          dispatch(completeAutoBuild())
        } catch (e) {
          liveRef.current = false
          dispatch(haltAutoBuild(autoBuildError(e)))
        } finally {
          inFlightRef.current = false
        }
      })()
      return
    }

    const { scene, step } = action

    // The step we just attempted is STILL the next step and an error surfaced → halt.
    const attempted = attemptRef.current
    if (attempted && attempted.sceneId === scene.id && attempted.stepId === step && p.sceneError) {
      attemptRef.current = null
      liveRef.current = false
      dispatch(haltAutoBuild(p.sceneError))
      return
    }

    // All steps done but not yet built → mark it built and let the effect re-run.
    if (step === null) {
      p.markBuilt(scene.id)
      return
    }

    attemptRef.current = { sceneId: scene.id, stepId: step }
    inFlightRef.current = true
    dispatch(setAutoPointer({ sceneId: scene.id, stepId: step }))
    ;(async () => {
      try {
        await runStep(step, scene, p, fetchBytes)
      } catch (e) {
        // Only the assemble step / save throw; swallowing steps are caught via the
        // attemptRef path above on the next tick.
        liveRef.current = false
        dispatch(haltAutoBuild(autoBuildError(e)))
      } finally {
        inFlightRef.current = false
      }
    })()
    // The runner reads pipe via `pipeRef`; it's keyed only to the signals that must
    // re-trigger it. exhaustive-deps can't see the ref reads, so silence it here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.status, pipe.scenes, pipe.sceneError, pipe.finalCutUrl, dispatch, fetchBytes])

  return { run, start, pause, resume, stop }
}

/** Fire one step. cut/sheets/refine/voice swallow errors into `sceneError`;
 *  assemble (render + save) throws, so the caller's catch halts the run. */
async function runStep(
  step: AutoStepId,
  scene: Scene,
  p: Pipe,
  fetchBytes: (url: string) => Promise<Uint8Array>,
): Promise<void> {
  if (step === 'cut') return p.sliceScene(scene.id)
  if (step === 'sheets') return p.generateSceneSheets(scene.id)
  if (step === 'refine') return p.refineScene(scene.id)
  if (step === 'voice') return p.voiceAllSegments(scene.id)
  // assemble: render the scene MP4 then save it (both throw on failure).
  const blob = await assembleSceneBlob({ scene, fetchBytes })
  await p.saveSceneCut(scene.id, blob)
}
```

- [ ] **Step 2: Verify build, lint, tests**

Run: `npm run build && npm run lint && npm run test:run`
Expected: PASS. The `Pipe` type is structural — `useScenePipeline`'s return must be assignable to it (it now exposes `markBuilt`/`voiceAllSegments` from Task 4). If `useSignedBytes` returns a differently-named type, adjust the `fetchBytes` annotation to `ReturnType<typeof useSignedBytes>`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Studio/useAutoBuild.ts
git commit -m "feat(studio): auto-build orchestrator hook (03s)"
```

---

## Task 6: Dashboard UI + Studio wiring

**Files:**
- Create: `src/components/Studio/AutoBuildBoard.tsx`
- Modify: `src/pages/Studio.tsx`

- [ ] **Step 1: Write the dashboard component**

Create `src/components/Studio/AutoBuildBoard.tsx`:

```tsx
import type { Scene } from '../../lib/scenes'
import {
  AUTO_STEPS,
  sceneStepStatuses,
  sceneRunStatus,
  voiceProgress,
  type AutoBuildRun,
  type AutoStepStatus,
} from '../../lib/autoBuild'

type Props = {
  scenes: Scene[]
  run: AutoBuildRun
  selectedId: string | null
  onSelect: (id: string) => void
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
}

const STEP_ICON: Record<AutoStepStatus, string> = {
  done: '✓',
  running: '⟳',
  error: '✗',
  pending: '·',
}

/**
 * Auto Build dashboard (story 03s) — a pure render of the run: the scene tree with
 * per-step status, plus the Start/Pause/Resume/Stop controls. It owns no logic;
 * everything comes from `autoBuild` selectors over the durable scene state. Clicking
 * a scene row drills into the existing manual editor below (the page's detail view).
 */
export function AutoBuildBoard({ scenes, run, selectedId, onSelect, onStart, onPause, onResume, onStop }: Props) {
  const builtCount = scenes.filter((s) => s.status === 'built').length
  const activeIndex = scenes.findIndex((s) => s.id === run.currentSceneId)
  const headline =
    run.status === 'running'
      ? `▶ Running · Scene ${activeIndex >= 0 ? activeIndex + 1 : builtCount + 1} / ${scenes.length}`
      : run.status === 'paused'
        ? '⏸ Paused'
        : run.status === 'halted'
          ? '✗ Halted'
          : run.status === 'done'
            ? '✓ Done'
            : `${builtCount} / ${scenes.length} scenes built`

  return (
    <div className="border rule bg-paper p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="meta-label">Auto build</p>
          <p className="mt-1 text-[13px] text-ink-soft">{headline}</p>
        </div>
        <div className="flex items-center gap-2">
          {run.status === 'idle' || run.status === 'done' ? (
            <button type="button" className="pill-cta" onClick={onStart}>
              Start auto build
            </button>
          ) : null}
          {run.status === 'running' && (
            <button type="button" className="pill-ghost" onClick={onPause}>
              Pause
            </button>
          )}
          {(run.status === 'paused' || run.status === 'halted') && (
            <button type="button" className="pill-cta" onClick={onResume}>
              Resume
            </button>
          )}
          {run.status !== 'idle' && run.status !== 'done' && (
            <button type="button" className="pill-ghost" onClick={onStop}>
              Stop
            </button>
          )}
        </div>
      </div>

      {run.status === 'halted' && run.error && (
        <p className="mt-3 whitespace-pre-wrap text-[13px] text-terracotta-ink">{run.error}</p>
      )}

      <ul className="mt-4 flex flex-col gap-2">
        {scenes.map((scene, i) => {
          const rolled = sceneRunStatus(scene, run)
          const steps = sceneStepStatuses(scene, run)
          const expanded = scene.id === run.currentSceneId || scene.id === selectedId
          const vp = voiceProgress(scene)
          return (
            <li key={scene.id} className="rounded-md border border-paper-line">
              <button
                type="button"
                onClick={() => onSelect(scene.id)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] ${
                  scene.id === selectedId ? 'bg-paper-deep' : ''
                }`}
              >
                <span className="truncate">
                  <span className="font-mono text-ink-mute">{i + 1}</span> {scene.title}
                </span>
                <span
                  className={
                    rolled === 'error'
                      ? 'text-terracotta-ink'
                      : rolled === 'built'
                        ? 'text-ink'
                        : rolled === 'running'
                          ? 'text-terracotta'
                          : 'text-ink-mute'
                  }
                >
                  {rolled === 'built' ? '✓ built' : rolled === 'running' ? '⟳ running' : rolled === 'error' ? '✗ error' : 'pending'}
                </span>
              </button>
              {expanded && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-paper-line px-3 py-2 font-mono text-[12px] text-ink-mute sm:grid-cols-3">
                  {AUTO_STEPS.map((step) => (
                    <span
                      key={step.id}
                      className={
                        steps[step.id] === 'error'
                          ? 'text-terracotta-ink'
                          : steps[step.id] === 'done'
                            ? 'text-ink'
                            : steps[step.id] === 'running'
                              ? 'text-terracotta'
                              : ''
                      }
                    >
                      {STEP_ICON[steps[step.id]]} {step.label}
                      {step.id === 'voice' && steps.voice !== 'pending' ? ` (${vp.done}/${vp.total})` : ''}
                    </span>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Wire `useAutoBuild` + the board into `Studio.tsx`**

In `src/pages/Studio.tsx`:

a) Add imports near the other Studio component imports:

```tsx
import { AutoBuildBoard } from '../components/Studio/AutoBuildBoard'
import { useAutoBuild } from '../components/Studio/useAutoBuild'
```

b) After the existing `const pipe = useScenePipeline()` call, add:

```tsx
  const auto = useAutoBuild(pipe)
  const [autoMode, setAutoMode] = useState(() => auto.run.status !== 'idle')
```

(If `useState` isn't already imported in this file, add it to the React import.)

c) In the Build view, replace the `<SceneTabs ... />` element (lines 701-709) with a mode toggle + conditional board/tabs:

```tsx
                <div className="flex items-center justify-end pb-2">
                  <button
                    type="button"
                    className="pill-ghost"
                    onClick={() => setAutoMode((v) => !v)}
                  >
                    {autoMode ? 'Manual scene tabs' : 'Auto build ▶'}
                  </button>
                </div>
                {autoMode ? (
                  <AutoBuildBoard
                    scenes={pipe.scenes}
                    run={auto.run}
                    selectedId={pipe.selectedId}
                    onSelect={pipe.select}
                    onStart={auto.start}
                    onPause={auto.pause}
                    onResume={auto.resume}
                    onStop={auto.stop}
                  />
                ) : (
                  <SceneTabs
                    scenes={pipe.scenes}
                    selectedId={pipe.selectedId}
                    onSelect={pipe.select}
                    tablistRef={tabsRef}
                    tablistClassName="sticky top-14 z-30 bg-paper/85 backdrop-blur"
                    onPreview={() => setPreviewOpen(true)}
                    previewDisabled={!selected}
                  />
                )}
```

Everything below (PreviewPlayer, SceneMeta, SceneRefinePanel, TranscriptDiff, SceneAssembleBar, FinalCutBar) stays unchanged — it renders for the selected scene and serves as the drill-down detail under the board.

- [ ] **Step 3: Verify build, lint, tests**

Run: `npm run build && npm run lint && npm run test:run`
Expected: PASS.

- [ ] **Step 4: Manual smoke check (optional, no pixel-perfect polish)**

Per repo convention we don't browser-verify during prototyping. If you want a quick sanity check, `npm run dev`, reach the Build phase on an existing project, toggle **Auto build ▶**, and confirm the board lists the scenes with controls. Do not polish pixels.

- [ ] **Step 5: Commit**

```bash
git add src/components/Studio/AutoBuildBoard.tsx src/pages/Studio.tsx
git commit -m "feat(studio): auto-build dashboard + Build-phase toggle (03s)"
```

---

## Task 7: Story doc + status table

**Files:**
- Create: `stories/inprogress/studio/03s-auto-build.md`
- Modify: `stories/inprogress/studio/README.md`

- [ ] **Step 1: Write the story doc**

Create `stories/inprogress/studio/03s-auto-build.md` summarizing: the goal (one-press unattended Build), the step model (`autoBuild.ts`), the durable run pointer, the orchestrator's state-driven advance + halt-and-resume, the dashboard, and the decisions from the spec (AI-TTS-honoring-original-tags, halt+resume-from-pointer, pending-scenes-then-final-stitch). Link the spec at `docs/superpowers/specs/2026-06-14-studio-auto-build-design.md`. Keep it consistent in tone with the existing `03*` story docs.

- [ ] **Step 2: Update the status table**

In `stories/inprogress/studio/README.md`, add a row for `03s — auto build` in the appropriate place in the live status table, marking it shipped/in-progress to match how the other rows in this branch are tracked.

- [ ] **Step 3: Commit**

```bash
git add stories/inprogress/studio/03s-auto-build.md stories/inprogress/studio/README.md
git commit -m "docs(studio): 03s auto build story + status (03s)"
```

---

## Final verification

- [ ] **Run the full gate**

Run: `npm run build && npm run lint && npm run test:run`
Expected: all PASS.

- [ ] **Confirm the spec is covered** (self-review checklist, already done by the author):
  - Task-tree dashboard → Task 6 (`AutoBuildBoard`).
  - AI-TTS honoring original tags → Task 4 (`voiceAllSegments`).
  - Halt + resume from failure → Tasks 3 + 5 (`haltAutoBuild`/`resumeAutoBuild`, orchestrator detection).
  - Pending-scenes-then-final-stitch → Task 5 (`nextAction` skips built; finalize branch stitches).
  - Reload → paused → Task 5 (`liveRef` + mount coercion).
  - Edge cases (no voice configured / zero-segment scene / already-built skip / Replicate error) → Tasks 1, 4, 5.

---

## Notes / decisions captured

- **Why state-driven, not a `while` loop:** the existing `pipe` actions update Redux and swallow errors into a shared `sceneError`; a loop holding their callbacks would go stale and couldn't see failures. Re-running the effect on every `scenes`/`sceneError` change keeps each action call fresh and makes resume-from-pointer fall out for free (the pointer is recomputed from scene fields).
- **Assemble = render + save as one step:** only `assembledUrl` is durable (the rendered blob is transient), so the dashboard shows one "Assemble & save" row whose doneness is `assembledUrl`.
- **Partial commit trade-off in `voiceAllSegments`:** a scene that fails partway through voicing is not committed, so resume re-voices it — but already-voiced segments are skipped, so only the un-uploaded ones re-run.
- **Out of scope (from the spec):** auto-running the Prep phase; parallelizing cut+sheets; recording-based voicing in auto runs.
