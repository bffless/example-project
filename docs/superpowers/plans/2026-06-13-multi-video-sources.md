# Multi-video sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/studio` ingest several source videos in one project (each uploaded, audio-extracted, and transcribed on its own), then have one master-director call see the whole combined talk and produce chapters that each belong to exactly one source video — Build and Export essentially unchanged.

**Architecture:** Replace the single-video fields on the Redux `studio` slice with an ordered `sources[]` array (`VideoSource`). Scenes gain `sourceId` and their `start`/`end` become **local to that source video**. The director sees a **global/concatenated** view (combined transcript + one whole-talk contact sheet, both stamped with global time); `toScenes` inverts that — mapping each returned scene back to `(sourceId, localStart, localEnd)` and auto-splitting any chapter that crosses a video boundary. A pure `src/lib/sources.ts` owns the global↔local math. Four sequential PRs (09a–09d); each leaves the app working.

**Tech Stack:** React 19 + TypeScript, Vite, Redux Toolkit + redux-persist, RTK Query, Vitest (jsdom). Pure logic in `src/lib/*` with co-located `*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-06-13-multi-video-sources-design.md`

---

## Conventions for every task

- Run a single test file with `npx vitest run <path>`; one test by name with `npx vitest run -t "<name>"`.
- A story is one PR. Within a story, commit after each green task. Branch per story off `main`: `git checkout main && git pull && git checkout -b studio-09a-sources-state`.
- `npm run build`, `npm run lint`, `npm run test:run` must all pass before the story's PR.
- No ESLint disables, no tsconfig excludes — fix the code (`feedback_fix_code_not_config`).
- Don't browser-verify during prototyping — rely on build/lint/tests (`feedback_no_pixel_perfect_prototyping`).

---

# Story 09a — State model: `sources[]`, `Scene.sourceId`, migration, `sources.ts`

**Outcome:** The slice holds `sources: VideoSource[]`; `Scene` has `sourceId` with local bounds; a redux-persist migration wraps any existing single-video session into a one-element `sources[]`. A new pure `src/lib/sources.ts` provides global↔local helpers. **The app behaves identically for a single video** — the hook reads `sources[0]` for what used to be top-level fields. No multi-add UI yet.

**Branch:** `studio-09a-sources-state`

## Task 1: `StageDef.scope` — tag stages per-video vs. global

**Files:**
- Modify: `src/lib/pipeline.ts`
- Test: `src/lib/pipeline.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/pipeline.test.ts
import { describe, it, expect } from 'vitest'
import { STAGE_DEFS, PER_VIDEO_STAGES, GLOBAL_STAGES } from './pipeline'

describe('stage scopes', () => {
  it('tags upload/extract/transcribe as per-video and the rest as global', () => {
    expect(PER_VIDEO_STAGES).toEqual(['upload', 'extract', 'transcribe'])
    expect(GLOBAL_STAGES).toEqual(['thumbnails', 'director', 'clone'])
  })
  it('every STAGE_DEF carries a scope', () => {
    expect(STAGE_DEFS.every((s) => s.scope === 'video' || s.scope === 'global')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/pipeline.test.ts`
Expected: FAIL — `PER_VIDEO_STAGES` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/pipeline.ts`, add `scope` to `StageDef` and derive the two lists:

```ts
export type StageScope = 'video' | 'global'

export type StageDef = {
  id: StageId
  title: string
  note: string
  where: Where
  /** Per-video stages run once per source in the prep accordion (story 09b);
   *  global stages run once for the whole project after every video is ready. */
  scope: StageScope
  actionLabel?: string
}
```

Add `scope: 'video'` to the `upload`, `extract`, `transcribe` entries and `scope: 'global'` to `thumbnails`, `director`, `clone`. Then at the bottom:

```ts
export const PER_VIDEO_STAGES = STAGE_DEFS.filter((s) => s.scope === 'video').map((s) => s.id)
export const GLOBAL_STAGES = STAGE_DEFS.filter((s) => s.scope === 'global').map((s) => s.id)
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/lib/pipeline.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline.ts src/lib/pipeline.test.ts
git commit -m "feat(studio): tag prep stages with per-video vs global scope (09a)"
```

## Task 2: `src/lib/sources.ts` — global↔local timeline math

**Files:**
- Create: `src/lib/sources.ts`
- Test: `src/lib/sources.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/sources.test.ts
import { describe, it, expect } from 'vitest'
import { sourceOffsets, totalDuration, globalToLocal, localToGlobal } from './sources'

const SOURCES = [
  { id: 'a', duration: 100 },
  { id: 'b', duration: 50 },
  { id: 'c', duration: 200 },
]

describe('sources timeline math', () => {
  it('totalDuration sums durations', () => {
    expect(totalDuration(SOURCES)).toBe(350)
    expect(totalDuration([])).toBe(0)
  })

  it('sourceOffsets places each source after the previous', () => {
    expect(sourceOffsets(SOURCES)).toEqual([
      { id: 'a', start: 0, end: 100 },
      { id: 'b', start: 100, end: 150 },
      { id: 'c', start: 150, end: 350 },
    ])
  })

  it('globalToLocal routes a global second to (sourceId, localTime)', () => {
    expect(globalToLocal(SOURCES, 0)).toEqual({ sourceId: 'a', localTime: 0 })
    expect(globalToLocal(SOURCES, 120)).toEqual({ sourceId: 'b', localTime: 20 })
    expect(globalToLocal(SOURCES, 349)).toEqual({ sourceId: 'c', localTime: 199 })
  })

  it('globalToLocal clamps a boundary instant to the source it ends, and out-of-range to the last', () => {
    // The end of a source belongs to the NEXT source's 0 (half-open), except the very end.
    expect(globalToLocal(SOURCES, 100)).toEqual({ sourceId: 'b', localTime: 0 })
    expect(globalToLocal(SOURCES, 350)).toEqual({ sourceId: 'c', localTime: 200 })
    expect(globalToLocal(SOURCES, 999)).toEqual({ sourceId: 'c', localTime: 200 })
  })

  it('globalToLocal returns null for no sources', () => {
    expect(globalToLocal([], 5)).toBeNull()
  })

  it('localToGlobal is the inverse', () => {
    expect(localToGlobal(SOURCES, 'b', 20)).toBe(120)
    expect(localToGlobal(SOURCES, 'a', 0)).toBe(0)
    expect(localToGlobal(SOURCES, 'missing', 5)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/sources.test.ts`
Expected: FAIL — cannot find module `./sources`.

- [ ] **Step 3: Implement**

```ts
// src/lib/sources.ts
/**
 * Pure timeline math for the multi-video project (story 09a). The master
 * director sees all sources stitched into ONE global timeline (video A occupies
 * [0, durA), video B [durA, durA+durB), …); these helpers convert between that
 * global time and a single source's local time. Stored scenes use LOCAL time +
 * a `sourceId`; the global timeline only exists transiently while building the
 * director request and coercing its response. Order is whatever the caller
 * passes — callers sort `sources` by `order` first.
 */

export type SourceLike = { id: string; duration: number }
export type SourceSpan = { id: string; start: number; end: number }

const dur = (d: unknown): number => (typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : 0)

/** Total length of all sources, in seconds. */
export function totalDuration(sources: SourceLike[]): number {
  return sources.reduce((sum, s) => sum + dur(s.duration), 0)
}

/** Each source's [start, end) on the global timeline, in input order. */
export function sourceOffsets(sources: SourceLike[]): SourceSpan[] {
  const out: SourceSpan[] = []
  let cursor = 0
  for (const s of sources) {
    const end = cursor + dur(s.duration)
    out.push({ id: s.id, start: cursor, end })
    cursor = end
  }
  return out
}

/**
 * Route a GLOBAL second to its owning source + LOCAL second. Spans are half-open
 * `[start, end)` so a boundary instant belongs to the next source; the very end
 * of the timeline clamps into the last source. Out-of-range clamps to the
 * nearest end. Null when there are no sources.
 */
export function globalToLocal(
  sources: SourceLike[],
  t: number,
): { sourceId: string; localTime: number } | null {
  const spans = sourceOffsets(sources)
  if (spans.length === 0) return null
  const clamped = Math.max(0, Math.min(t, spans[spans.length - 1].end))
  for (const span of spans) {
    if (clamped < span.end) return { sourceId: span.id, localTime: clamped - span.start }
  }
  const last = spans[spans.length - 1]
  return { sourceId: last.id, localTime: last.end - last.start }
}

/** LOCAL second within `sourceId` → its GLOBAL second. Null if id is unknown. */
export function localToGlobal(
  sources: SourceLike[],
  sourceId: string,
  localTime: number,
): number | null {
  const span = sourceOffsets(sources).find((s) => s.id === sourceId)
  return span ? span.start + localTime : null
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/lib/sources.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sources.ts src/lib/sources.test.ts
git commit -m "feat(studio): pure global<->local timeline math for multi-video (09a)"
```

## Task 3: Add `sourceId` to the `Scene` type

**Files:**
- Modify: `src/lib/scenes.ts`
- Test: `src/lib/scenes.test.ts` (existing)

- [ ] **Step 1: Write the failing test**

Add to `src/lib/scenes.test.ts`:

```ts
import { buildScenes } from './scenes'

it('buildScenes stamps every scene with a sourceId', () => {
  const scenes = buildScenes(420, 210, 'vid-1')
  expect(scenes.length).toBeGreaterThan(0)
  expect(scenes.every((s) => s.sourceId === 'vid-1')).toBe(true)
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/scenes.test.ts -t "sourceId"`
Expected: FAIL — `buildScenes` takes two args / `sourceId` missing.

- [ ] **Step 3: Implement**

In `src/lib/scenes.ts`, add the field to `Scene` (just after `id`/`index`):

```ts
export type Scene = {
  id: string
  index: number
  /** The source video this chapter belongs to (story 09a). `start`/`end` are
   *  LOCAL to this source's timeline. Every scene belongs to exactly one source;
   *  a chapter never spans a video boundary (the director coercion splits it). */
  sourceId: string
  title: string
  start: number
  end: number
  // …rest unchanged
```

Update `buildScenes` to accept and stamp a `sourceId` (default `'source-1'` so existing single-video callers/tests keep working):

```ts
export function buildScenes(duration: number, targetSceneSeconds = 210, sourceId = 'source-1'): Scene[] {
  // …unchanged body, but add `sourceId,` to the returned scene object literal.
```

(Add `sourceId,` inside the `return { id: …, index: i, … }` object.)

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/lib/scenes.test.ts` → PASS (all existing tests still pass — `sourceId` defaults).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scenes.ts src/lib/scenes.test.ts
git commit -m "feat(studio): add Scene.sourceId; scenes' start/end are source-local (09a)"
```

## Task 4: `VideoSource` type + `sources[]` on the slice

**Files:**
- Modify: `src/store/studioSlice.ts`
- Test: `src/store/studioSlice.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// src/store/studioSlice.test.ts
import { describe, it, expect } from 'vitest'
import reducer, {
  addSource, patchSource, removeSource, reorderSources, patchSourceStage,
} from './studioSlice'

const initial = reducer(undefined, { type: '@@INIT' })

describe('sources reducers', () => {
  it('addSource appends a fresh source with pending per-video progress', () => {
    const s = reducer(initial, addSource({ id: 'v1', fileName: 'a.mp4', duration: 100 }))
    expect(s.sources).toHaveLength(1)
    expect(s.sources[0]).toMatchObject({ id: 'v1', fileName: 'a.mp4', duration: 100, order: 0 })
    expect(s.sources[0].stageProgress.upload?.status).toBe('pending')
  })

  it('patchSource updates one source by id', () => {
    let s = reducer(initial, addSource({ id: 'v1', fileName: 'a.mp4', duration: 100 }))
    s = reducer(s, patchSource({ id: 'v1', patch: { sourceUrl: '/api/uploads/source/x' } }))
    expect(s.sources[0].sourceUrl).toBe('/api/uploads/source/x')
  })

  it('patchSourceStage updates one source-stage status', () => {
    let s = reducer(initial, addSource({ id: 'v1', fileName: 'a.mp4', duration: 100 }))
    s = reducer(s, patchSourceStage({ id: 'v1', stage: 'upload', patch: { status: 'done' } }))
    expect(s.sources[0].stageProgress.upload?.status).toBe('done')
  })

  it('reorderSources moves and renumbers order', () => {
    let s = reducer(initial, addSource({ id: 'v1', fileName: 'a', duration: 1 }))
    s = reducer(s, addSource({ id: 'v2', fileName: 'b', duration: 1 }))
    s = reducer(s, reorderSources({ from: 1, to: 0 }))
    expect(s.sources.map((x) => x.id)).toEqual(['v2', 'v1'])
    expect(s.sources.map((x) => x.order)).toEqual([0, 1])
  })

  it('removeSource drops it and renumbers', () => {
    let s = reducer(initial, addSource({ id: 'v1', fileName: 'a', duration: 1 }))
    s = reducer(s, addSource({ id: 'v2', fileName: 'b', duration: 1 }))
    s = reducer(s, removeSource('v1'))
    expect(s.sources.map((x) => x.id)).toEqual(['v2'])
    expect(s.sources[0].order).toBe(0)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/store/studioSlice.test.ts`
Expected: FAIL — `addSource` is not exported / `sources` undefined.

- [ ] **Step 3: Implement**

In `src/store/studioSlice.ts`:

Add the type and a fresh-source factory, importing `PER_VIDEO_STAGES`:

```ts
import { STAGE_DEFS, PER_VIDEO_STAGES, type StageId, type StageStatus } from '../lib/pipeline'

/**
 * One source video in a multi-video project (story 09a). Everything that used to
 * be a single top-level field (the bucket serve paths, the waveform, the
 * transcript words, the clip duration, the per-video prep progress) now lives
 * here, one per uploaded clip. Whole-project state (global contact sheets,
 * synopsis, direction, scenes, voice, final cut) stays top-level.
 */
export type VideoSource = {
  id: string
  /** Sequence in the final cut + the global-timeline offset. Drag reorders it. */
  order: number
  fileName: string
  duration: number
  sourceUrl: string | null
  audioUrl: string | null
  audioPeaks: number[]
  words: TranscriptWord[]
  /** Per-video prep progress: only the per-video stages (upload/extract/transcribe). */
  stageProgress: StageProgressMap
}

/** Fresh per-video progress: every per-video stage pending. */
export const freshSourceProgress = (): StageProgressMap => {
  const out: StageProgressMap = {}
  for (const id of PER_VIDEO_STAGES) out[id] = { status: 'pending' }
  return out
}

const makeSource = (p: { id: string; fileName: string; duration: number; order: number }): VideoSource => ({
  id: p.id,
  order: p.order,
  fileName: p.fileName,
  duration: p.duration,
  sourceUrl: null,
  audioUrl: null,
  audioPeaks: [],
  words: [],
  stageProgress: freshSourceProgress(),
})
```

Add `sources: VideoSource[]` to `StudioState` and `initialState` (`sources: []`). **Keep** the existing top-level `sourceUrl`/`audioUrl`/`audioPeaks`/`words`/`duration`/`fileName` fields for now — Task 6 will make the hook prefer `sources[0]`, and 09b/09d retire the direct reads. (Leaving them avoids a big-bang hook rewrite in 09a.)

Add reducers:

```ts
addSource(state, action: PayloadAction<{ id: string; fileName: string; duration: number }>) {
  state.sources.push(makeSource({ ...action.payload, order: state.sources.length }))
},
patchSource(state, action: PayloadAction<{ id: string; patch: Partial<VideoSource> }>) {
  const src = state.sources.find((s) => s.id === action.payload.id)
  if (src) Object.assign(src, action.payload.patch)
},
patchSourceStage(state, action: PayloadAction<{ id: string; stage: StageId; patch: Partial<StageProgress> }>) {
  const src = state.sources.find((s) => s.id === action.payload.id)
  if (!src) return
  const prev = src.stageProgress[action.payload.stage] ?? { status: 'pending' }
  src.stageProgress[action.payload.stage] = { ...prev, ...action.payload.patch }
},
removeSource(state, action: PayloadAction<string>) {
  state.sources = state.sources.filter((s) => s.id !== action.payload).map((s, i) => ({ ...s, order: i }))
},
reorderSources(state, action: PayloadAction<{ from: number; to: number }>) {
  const { from, to } = action.payload
  if (from < 0 || to < 0 || from >= state.sources.length || to >= state.sources.length) return
  const [moved] = state.sources.splice(from, 1)
  state.sources.splice(to, 0, moved)
  state.sources = state.sources.map((s, i) => ({ ...s, order: i }))
},
```

Export all five from the `studioSlice.actions` destructure. In `resetStudio`, add `sources: []` to the returned object (it already spreads `initialState`, so this is automatic — just confirm `initialState.sources` is `[]`).

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/store/studioSlice.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/studioSlice.ts src/store/studioSlice.test.ts
git commit -m "feat(studio): VideoSource type + sources[] reducers on the slice (09a)"
```

## Task 5: redux-persist migration v3 — wrap a single-video session into `sources[]`

**Files:**
- Modify: `src/store/index.ts`
- Test: `src/store/migrations.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Refactor the migration to a named export so it's testable, then:

```ts
// src/store/migrations.test.ts
import { describe, it, expect } from 'vitest'
import { migrations } from './index'

describe('migration v3 — single video → sources[]', () => {
  it('wraps the flat single-video fields into one source and stamps scenes', () => {
    const v2 = {
      sourceUrl: '/api/uploads/source/x', audioUrl: '/api/uploads/audio/y',
      audioPeaks: [0.1, 0.2], words: [{ text: 'hi', start: 0, end: 1 }],
      duration: 120, fileName: 'talk.mp4',
      stageProgress: { upload: { status: 'done' }, extract: { status: 'done' }, transcribe: { status: 'done' } },
      scenes: [{ id: 'scene-1', index: 0, start: 0, end: 120, title: 'S', transcript: '', status: 'pending', narrationSeconds: null }],
    }
    const out = migrations[3](v2) as any
    expect(out.sources).toHaveLength(1)
    expect(out.sources[0]).toMatchObject({
      sourceUrl: '/api/uploads/source/x', audioUrl: '/api/uploads/audio/y',
      duration: 120, fileName: 'talk.mp4', order: 0,
    })
    expect(out.sources[0].words).toEqual([{ text: 'hi', start: 0, end: 1 }])
    expect(out.scenes[0].sourceId).toBe(out.sources[0].id)
  })

  it('leaves a session that already has sources[] untouched', () => {
    const v3 = { sources: [{ id: 'v1', order: 0, fileName: 'a', duration: 1, sourceUrl: null, audioUrl: null, audioPeaks: [], words: [], stageProgress: {} }], scenes: [] }
    expect((migrations[3](v3) as any).sources).toHaveLength(1)
  })

  it('handles a never-imported session (no source) by giving it an empty sources[]', () => {
    const out = migrations[3]({ scenes: [] }) as any
    expect(out.sources).toEqual([])
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/store/migrations.test.ts`
Expected: FAIL — `migrations` not exported / no key `3`.

- [ ] **Step 3: Implement**

In `src/store/index.ts`, export `migrations` and add v3. Bump `version: 3`.

```ts
export const migrations = {
  2: (state: Record<string, unknown> | undefined) => {
    if (!state) return state
    const next = { ...state }
    delete next.stages
    if (!next.stageProgress) next.stageProgress = freshProgress()
    return next
  },
  // v3: single-video fields → sources[] (story 09a). A pre-09a session has flat
  // sourceUrl/audioUrl/words/duration/fileName; wrap them into one VideoSource and
  // stamp the existing scenes with that source's id. Idempotent: a session that
  // already has `sources` is returned unchanged.
  3: (state: Record<string, unknown> | undefined) => {
    if (!state) return state
    if (Array.isArray(state.sources)) return state
    const next = { ...state } as Record<string, unknown>
    const hasSource = typeof state.sourceUrl === 'string' || typeof state.fileName === 'string'
    if (!hasSource) {
      next.sources = []
      return next
    }
    const sp = state.stageProgress as Record<string, unknown> | undefined
    const id = 'source-1'
    next.sources = [{
      id, order: 0,
      fileName: (state.fileName as string) ?? 'source.mp4',
      duration: (state.duration as number) ?? 0,
      sourceUrl: (state.sourceUrl as string) ?? null,
      audioUrl: (state.audioUrl as string) ?? null,
      audioPeaks: (state.audioPeaks as number[]) ?? [],
      words: (state.words as unknown[]) ?? [],
      stageProgress: {
        upload: (sp?.upload as object) ?? { status: 'pending' },
        extract: (sp?.extract as object) ?? { status: 'pending' },
        transcribe: (sp?.transcribe as object) ?? { status: 'pending' },
      },
    }]
    if (Array.isArray(state.scenes)) {
      next.scenes = (state.scenes as Record<string, unknown>[]).map((s) => ({ ...s, sourceId: s.sourceId ?? id }))
    }
    return next
  },
}

const persistConfig = {
  key: 'studio',
  version: 3,
  storage,
  migrate: createMigrate(migrations as never),
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/store/migrations.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/index.ts src/store/migrations.test.ts
git commit -m "feat(studio): persist migration v3 wraps single video into sources[] (09a)"
```

## Task 6: Hook + page read `sources[0]` (single-video behavior preserved)

**Files:**
- Modify: `src/components/Studio/useScenePipeline.ts`
- Modify: `src/pages/Studio.tsx`

**Goal:** No behavior change. Introduce a single selector for "the current source" = `sources[0]`, and have the existing `uploadClip`/`extractAndUploadAudio`/`transcribe` write into both the legacy top-level fields **and** `sources[0]` so the array becomes the live source of truth without ripping out every downstream read yet.

- [ ] **Step 1: Add the source bridge in the hook**

After the existing selectors in `useScenePipeline.ts`, add:

```ts
const sources = useAppSelector((s) => s.studio.sources)
// 09a bridge: until 09b/09d make every read per-source, the "current" source is
// the first (single-video projects have exactly one). Ensures one exists so the
// prep steps have somewhere to write.
const currentSource = sources[0] ?? null
```

In `uploadClip`, when there's no source yet, create one from the file before writing its url; keep writing the legacy field too:

```ts
const uploadClip = useCallback(
  async ({ file, duration }: StepContext) => {
    patch('upload', { status: 'active' })
    let sourceId = currentSource?.id
    if (!sourceId) {
      sourceId = 'source-1'
      dispatch(addSource({ id: sourceId, fileName: file.name, duration }))
    }
    const { url } = await uploadReq({ file, kind: 'source' }).unwrap()
    dispatch(setSourceUrl(url))                          // legacy
    dispatch(patchSource({ id: sourceId, patch: { sourceUrl: url } }))
    patch('upload', { status: 'done', detail: `${mb(file.size)} → storage bucket` })
  },
  [patch, dispatch, uploadReq, currentSource],
)
```

Mirror the same dual-write in `extractAndUploadAudio` (`setAudioUrl`/`setAudioPeaks` **and** `patchSource({ patch: { audioUrl, audioPeaks } })`) and `transcribe` (`setWords` **and** `patchSource({ patch: { words: got } })`). Import `addSource`, `patchSource` from the slice. `StepContext` already carries `duration`.

- [ ] **Step 2: Build + lint + full test run**

Run: `npm run build && npm run lint && npm run test:run`
Expected: all green; existing component/e2e behavior unchanged (single video still uploads/extracts/transcribes, now also populating `sources[0]`).

- [ ] **Step 3: Commit**

```bash
git add src/components/Studio/useScenePipeline.ts src/pages/Studio.tsx
git commit -m "feat(studio): prep steps dual-write into sources[0] (09a bridge)"
```

## Story 09a self-check
- [ ] `npm run build && npm run lint && npm run test:run` green.
- [ ] Open a single-video session that predates this change (or simulate via the migration test) — it rehydrates with one source, scenes carry `sourceId`.
- [ ] Open the PR: `gh pr create` titled `feat(studio): multi-video state model + migration (09a)`.

---

# Story 09b — Multi-add Import + reorderable per-video prep accordion

**Outcome:** The user adds many videos (each ≤2 GiB), sees them as an ordered, drag-reorderable queue, and runs upload → extract → transcribe **per video** ("Process this video" / "Process all"). After this story, every source ends transcribed; the global contact-sheet + director steps still run on the single combined path wired in 09c.

**Branch:** `studio-09b-multi-import`

## Task 1: `MediaImport` accepts multiple files

**Files:**
- Modify: `src/components/Studio/MediaImport.tsx`
- Modify: `src/pages/Studio.tsx` (the `onSelect` handler)
- Test: `src/components/Studio/MediaImport.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Studio/MediaImport.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MediaImport } from './MediaImport'

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'video/mp4' })

describe('MediaImport multi-select', () => {
  it('passes every accepted file up in one call', () => {
    const onSelect = vi.fn()
    render(<MediaImport onSelect={onSelect} />)
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file('a.mp4'), file('b.mp4')] } })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/components/Studio/MediaImport.test.tsx`
Expected: FAIL — `onSelect` called with a single `File`, not an array.

- [ ] **Step 3: Implement**

Change the prop to `onSelect: (files: File[]) => void`, add `multiple` to the `<input>`, and validate each file with the existing `sourceFileError`, collecting the valid ones:

```tsx
type Props = { onSelect: (files: File[]) => void }

function accept(list: FileList | null | undefined) {
  const files = Array.from(list ?? [])
  if (files.length === 0) return
  const errors: string[] = []
  const ok: File[] = []
  for (const f of files) {
    const err = sourceFileError(f)
    if (err) errors.push(`${f.name}: ${err}`)
    else ok.push(f)
  }
  setError(errors.length ? errors.join(' · ') : null)
  if (ok.length) onSelect(ok)
}
// onDrop → accept(e.dataTransfer.files); onChange → accept(e.target.files)
```

Update the copy: heading "Drop your clips to auto-shorten", body mentions "Add one or more long recordings…".

In `src/pages/Studio.tsx`, change the `onSelect` handler to loop: for each file create a source (`addSource`) and keep the **first** file in the existing transient `file` state so today's single-video preview path keeps working until 09d generalizes it. (Full multi-file object-URL management lands in Task 3.)

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/components/Studio/MediaImport.test.tsx` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/Studio/MediaImport.tsx src/pages/Studio.tsx src/components/Studio/MediaImport.test.tsx
git commit -m "feat(studio): multi-select import → onSelect(File[]) (09b)"
```

## Task 2: `SourceQueue` component — ordered, drag-reorderable list

**Files:**
- Create: `src/components/Studio/SourceQueue.tsx`
- Test: `src/components/Studio/SourceQueue.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Studio/SourceQueue.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SourceQueue } from './SourceQueue'
import type { VideoSource } from '../../store/studioSlice'

const src = (id: string, order: number, fileName: string): VideoSource => ({
  id, order, fileName, duration: 60, sourceUrl: null, audioUrl: null, audioPeaks: [], words: [],
  stageProgress: { upload: { status: 'pending' }, extract: { status: 'pending' }, transcribe: { status: 'pending' } },
})

describe('SourceQueue', () => {
  const sources = [src('v1', 0, 'a.mp4'), src('v2', 1, 'b.mp4')]

  it('lists every source by filename in order', () => {
    render(<SourceQueue sources={sources} onReorder={vi.fn()} onRemove={vi.fn()} onProcess={vi.fn()} onProcessAll={vi.fn()} busyId={null} />)
    const names = screen.getAllByTestId('source-name').map((n) => n.textContent)
    expect(names).toEqual(['a.mp4', 'b.mp4'])
  })

  it('fires onProcess with the source id', () => {
    const onProcess = vi.fn()
    render(<SourceQueue sources={sources} onReorder={vi.fn()} onRemove={vi.fn()} onProcess={onProcess} onProcessAll={vi.fn()} busyId={null} />)
    fireEvent.click(screen.getAllByRole('button', { name: /process this video/i })[0])
    expect(onProcess).toHaveBeenCalledWith('v1')
  })

  it('fires onRemove with the source id', () => {
    const onRemove = vi.fn()
    render(<SourceQueue sources={sources} onReorder={vi.fn()} onRemove={onRemove} onProcess={vi.fn()} onProcessAll={vi.fn()} busyId={null} />)
    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[1])
    expect(onRemove).toHaveBeenCalledWith('v2')
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/components/Studio/SourceQueue.test.tsx`
Expected: FAIL — cannot find `./SourceQueue`.

- [ ] **Step 3: Implement**

Create `SourceQueue.tsx`. Props:

```tsx
import type { VideoSource } from '../../store/studioSlice'
import { PER_VIDEO_STAGES } from '../../lib/pipeline'

type Props = {
  sources: VideoSource[]
  busyId: string | null              // the source currently processing (spinner)
  onReorder: (from: number, to: number) => void
  onRemove: (id: string) => void
  onProcess: (id: string) => void
  onProcessAll: () => void
}
```

Render each source as a row (an accordion item): a drag handle (`draggable`, `onDragStart` stashes the index, `onDrop` calls `onReorder(from, idx)`), the filename in a `<span data-testid="source-name">`, a per-stage status strip derived from `source.stageProgress[id]?.status` over `PER_VIDEO_STAGES` (reuse the visual language of `StageCard`/`PipelineBoard` — three dots labeled Upload / Audio / Transcribe), a "Process this video" button (disabled when `busyId`), and a "Remove" button (`aria-label="Remove {fileName}"`). Above the list: a "Process all" button. Use the editorial tokens (`.pill-cta`, `.pill-ghost`, `.rule`, `.meta-label`) per the conventions. Drag-reorder via native HTML5 DnD keeps deps zero.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/components/Studio/SourceQueue.test.tsx` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/Studio/SourceQueue.tsx src/components/Studio/SourceQueue.test.tsx
git commit -m "feat(studio): SourceQueue — ordered, drag-reorder per-video list (09b)"
```

## Task 3: Per-video processing in the hook (`processSource` / `processAll`)

**Files:**
- Modify: `src/components/Studio/useScenePipeline.ts`

**Goal:** Run a single source's three per-video stages in sequence, writing into that source via `patchSource`/`patchSourceStage`, and expose `processSource(id)` / `processAll()` plus `processingId`.

- [ ] **Step 1: Generalize the three per-video steps to take a source**

Refactor `uploadClip`/`extractAndUploadAudio`/`transcribe` to operate on a `VideoSource` + its in-memory `File`. Each:
- calls `dispatch(patchSourceStage({ id, stage, patch: { status: 'active' } }))`,
- does its work (`uploadReq`, `extractAudio`, `transcribeReq` against **that source's** `audioUrl`),
- writes results via `dispatch(patchSource({ id, patch: {...} }))`,
- marks the stage done.

Add the driver (object URL is per-file, created here, revoked after):

```ts
const [processingId, setProcessingId] = useState<string | null>(null)

const processSource = useCallback(
  async (id: string, file: File) => {
    if (processingId || stepInFlight) return
    stepInFlight = true
    setProcessingId(id)
    const src = URL.createObjectURL(file)
    try {
      const duration = await measureVideoDuration(src) // small helper, mirrors measureAudioDuration for <video>
      dispatch(patchSource({ id, patch: { duration, fileName: file.name } }))
      await uploadSource(id, file)
      await extractSourceAudio(id, file)
      await transcribeSource(id)
    } catch (e) {
      // mark whichever per-video stage is active as errored on this source
      dispatch(patchSourceStage({ id, stage: activeStageFor(id), patch: { status: 'error', detail: stageError(e) } }))
    } finally {
      URL.revokeObjectURL(src)
      stepInFlight = false
      setProcessingId(null)
    }
  },
  [processingId, dispatch, /* …step deps */],
)

const processAll = useCallback(
  async (files: Map<string, File>) => {
    for (const s of [...sources].sort((a, b) => a.order - b.order)) {
      if (PER_VIDEO_STAGES.every((st) => s.stageProgress[st]?.status === 'done')) continue
      const f = files.get(s.id)
      if (f) await processSource(s.id, f)   // sequential — keep the dev proxy happy
    }
  },
  [sources, processSource],
)
```

`measureVideoDuration(src)` is the existing pattern from `measureAudioDuration` but on a `<video>` `loadedmetadata` — add it next to that helper. The in-memory `File`s are held in a `Map<sourceId, File>` owned by the page (transient — Task 4); `processAll` takes that map.

Expose `processSource`, `processAll`, `processingId`, `sources` from the hook's return object.

- [ ] **Step 2: Build + lint**

Run: `npm run build && npm run lint`
Expected: green (no behavior wired into the page yet).

- [ ] **Step 3: Commit**

```bash
git add src/components/Studio/useScenePipeline.ts
git commit -m "feat(studio): per-source processSource/processAll in the pipeline hook (09b)"
```

## Task 4: Wire the queue into the prep page

**Files:**
- Modify: `src/pages/Studio.tsx`

- [ ] **Step 1: Implement**

- Hold the in-memory files as `useState<Map<string, File>>` keyed by source id (transient — lost on reload, which is fine; reload resumes from persisted per-source progress and re-prompts to re-attach only sources that aren't done, a later refinement).
- `MediaImport`'s `onSelect(files)` → for each file, dispatch `addSource({ id, fileName, duration: 0 })` (id e.g. `source-${Date.now()}-${i}` — but Date.now() is fine in a component event handler, NOT in a workflow) and store the file in the map under that id.
- Render `<SourceQueue sources={sources} busyId={pipe.processingId} onReorder={(f,t)=>dispatch(reorderSources({from:f,to:t}))} onRemove={(id)=>{dispatch(removeSource(id)); /* drop from map */}} onProcess={(id)=>pipe.processSource(id, files.get(id)!)} onProcessAll={()=>pipe.processAll(files)} />` inside the Prep phase, in place of (or above) the single-file `PipelineBoard`'s per-video rows.
- The global stages (`thumbnails`/`director`/`clone`) keep their existing board/panel UI; show them **after** the queue, gated on every source being transcribed.

- [ ] **Step 2: Build + lint + test**

Run: `npm run build && npm run lint && npm run test:run`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Studio.tsx
git commit -m "feat(studio): wire multi-video import + queue into prep (09b)"
```

## Story 09b self-check
- [ ] Add two small clips with mocks on (`MOCK_STUDIO=true` in handlers) — both appear in the queue, reorder by drag, each processes upload→extract→transcribe independently, "Process all" walks them in order.
- [ ] `npm run build && npm run lint && npm run test:run` green; PR `feat(studio): multi-video import + per-video prep loop (09b)`.

---

# Story 09c — Global contact sheet + combined transcript + director coercion

**Outcome:** After every source is transcribed, one global step samples frames across the **whole** combined timeline (total-duration-aware spacing, ≤10 images), the director gets one combined boundary-marked transcript + the global sheet, and `toScenes` maps its global-timed scenes back to per-video `(sourceId, localStart, localEnd)`, auto-splitting any boundary-crossing chapter.

**Branch:** `studio-09c-global-director`

## Task 1: Combined transcript builder

**Files:**
- Modify: `src/lib/director.ts`
- Test: `src/lib/director.test.ts` (existing)

- [ ] **Step 1: Write the failing test**

```ts
import { combinedTimedTranscript } from './director'

it('combinedTimedTranscript offsets each source to global time with boundary markers', () => {
  const out = combinedTimedTranscript([
    { id: 'a', fileName: 'one.mp4', duration: 16, words: [{ text: 'hello', start: 0, end: 1 }] },
    { id: 'b', fileName: 'two.mp4', duration: 16, words: [{ text: 'world', start: 0, end: 1 }] },
  ])
  // Source A's words at global 0; a boundary marker naming source B at global 16; B's words offset to ~16.
  expect(out).toMatch(/\[0:00\] hello/)
  expect(out).toMatch(/--- VIDEO 2: two\.mp4 \(starts 0:16\) ---/)
  expect(out).toMatch(/\[0:16\] world/)
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/director.test.ts -t "combinedTimedTranscript"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

In `src/lib/director.ts`, reuse `timedTranscript` per source, offsetting each source's words by its global start (from `sourceOffsets` in `sources.ts`), and join with a labeled boundary line:

```ts
import { sourceOffsets } from './sources'

export type TranscriptSource = { id: string; fileName: string; duration: number; words: TWord[] }

export function combinedTimedTranscript(sources: TranscriptSource[]): string {
  const spans = sourceOffsets(sources)
  return sources
    .map((s, i) => {
      const offset = spans[i].start
      const shifted = s.words.map((w) => ({
        ...w,
        start: typeof w.start === 'number' ? w.start + offset : w.start,
        end: typeof w.end === 'number' ? w.end + offset : w.end,
      }))
      const body = timedTranscript(shifted)
      const header = `--- VIDEO ${i + 1}: ${s.fileName} (starts ${clockLabel(offset)}) ---`
      return i === 0 ? `${header}\n${body}` : `\n${header}\n${body}`
    })
    .join('\n')
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/lib/director.test.ts -t "combinedTimedTranscript"` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/director.ts src/lib/director.test.ts
git commit -m "feat(studio): combinedTimedTranscript — global-time transcript with boundary markers (09c)"
```

## Task 2: `toScenes` — global→local mapping + boundary auto-split

**Files:**
- Modify: `src/lib/director.ts`
- Test: `src/lib/director.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { toScenes } from './director'

const SOURCES = [{ id: 'a', duration: 100 }, { id: 'b', duration: 100 }] // global [0,100),[100,200)

it('maps a scene fully inside one source to local coords + sourceId', () => {
  const [s] = toScenes([{ start: 120, end: 160, title: 'X' }], SOURCES)
  expect(s).toMatchObject({ sourceId: 'b', start: 20, end: 60 })
})

it('auto-splits a scene that crosses a boundary into one scene per source', () => {
  const out = toScenes([{ start: 80, end: 140, title: 'Crosser' }], SOURCES)
  expect(out).toHaveLength(2)
  expect(out[0]).toMatchObject({ sourceId: 'a', start: 80, end: 100 })
  expect(out[1]).toMatchObject({ sourceId: 'b', start: 0, end: 40 })
})

it('clamps cuts into the (local) scene span', () => {
  const [s] = toScenes([{ start: 100, end: 160, title: 'X', cuts: [{ start: 110, end: 130 }] }], SOURCES)
  expect(s.sourceId).toBe('b')
  expect(s.cuts).toEqual([{ start: 10, end: 30 }])
})

it('single-source projects behave like before (local == global, one sourceId)', () => {
  const out = toScenes([{ start: 0, end: 50 }, { start: 50, end: 100 }], [{ id: 'a', duration: 100 }])
  expect(out.every((s) => s.sourceId === 'a')).toBe(true)
  expect(out[1]).toMatchObject({ start: 50, end: 100 })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/director.test.ts -t "boundary"`
Expected: FAIL — `toScenes` takes `(raw, duration)` not `(raw, sources)`.

- [ ] **Step 3: Implement**

Change `toScenes` to take the source list instead of a single `duration`. Keep the existing clamp/sort/monotonic logic on the **global** timeline first, then split each global scene at boundaries and convert to local. Cuts convert with the scene's source offset.

```ts
import { sourceOffsets, type SourceLike } from './sources'

export function toScenes(raw: DirectorScene[], sources: SourceLike[]): Scene[] {
  if (!Array.isArray(raw) || sources.length === 0) return []
  const spans = sourceOffsets(sources)
  const bound = spans[spans.length - 1].end
  const sorted = [...raw].sort((a, b) => num(a?.start) - num(b?.start))

  // 1) clamp + monotonic on the GLOBAL timeline (unchanged logic)
  const global: { start: number; end: number; raw: DirectorScene }[] = []
  let cursor = 0
  for (const s of sorted) {
    const start = Math.min(Math.max(num(s?.start), cursor), bound)
    let end = Math.min(Math.max(num(s?.end), start), bound)
    if (end <= start) end = Math.min(start + 0.05, bound)
    cursor = end
    global.push({ start, end, raw: s })
  }

  // 2) split each global scene at every boundary it crosses, convert to local
  const out: Scene[] = []
  for (const g of global) {
    for (const span of spans) {
      const segStart = Math.max(g.start, span.start)
      const segEnd = Math.min(g.end, span.end)
      if (segEnd - segStart <= 0.05) continue
      const localStart = segStart - span.start
      const localEnd = segEnd - span.start
      const i = out.length
      const transcript = str(g.raw?.transcript).trim()
      const refinePrompt = str(g.raw?.refinePrompt).trim()
      const title = str(g.raw?.title).trim() || (leadWords(transcript) ? `${leadWords(transcript)}…` : `Scene ${i + 1}`)
      const cuts = (Array.isArray(g.raw?.cuts) ? g.raw.cuts : [])
        .map((c) => clampCut({ start: num(c?.start) - span.start, end: num(c?.end) - span.start }, localStart, localEnd))
        .filter((c): c is Cut => c !== null)
      const voicing = toVoicing(g.raw?.voicing)
      out.push({
        id: `scene-${i + 1}`, index: i, sourceId: span.id, title,
        start: localStart, end: localEnd, transcript, status: 'pending', narrationSeconds: null, cuts,
        ...(voicing ? { voicing } : {}),
        ...(refinePrompt ? { refinePrompt } : {}),
      })
    }
  }
  return out.map((s, i) => ({ ...s, index: i, id: `scene-${i + 1}` }))
}
```

(Note: re-id/index after split so ids stay dense and ordered. A scene fully inside one source produces exactly one segment — single-video behavior preserved.)

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/lib/director.test.ts` → PASS (update any existing `toScenes(raw, duration)` test callers to pass `[{ id: 'source-1', duration }]`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/director.ts src/lib/director.test.ts
git commit -m "feat(studio): toScenes maps global director scenes to per-source local + auto-split (09c)"
```

## Task 3: Global contact-sheet capture across all sources

**Files:**
- Create: `src/lib/globalSheet.ts`
- Test: `src/lib/globalSheet.test.ts`
- Modify: `src/components/Studio/useScenePipeline.ts` (the `thumbnails` step)

- [ ] **Step 1: Write the failing test (pure planning only)**

```ts
// src/lib/globalSheet.test.ts
import { describe, it, expect } from 'vitest'
import { planGlobalSheetCaptures } from './globalSheet'

it('spaces frames across the combined timeline and routes each to its source + local time', () => {
  const sources = [{ id: 'a', duration: 100 }, { id: 'b', duration: 100 }]
  const caps = planGlobalSheetCaptures(sources)
  // Every capture names a real source and a local time within it; globals are unique + ascending.
  expect(caps.length).toBeGreaterThan(0)
  expect(caps.every((c) => c.sourceId === 'a' || c.sourceId === 'b')).toBe(true)
  expect(caps.every((c) => c.localTime >= 0 && c.localTime <= 100)).toBe(true)
  const globals = caps.map((c) => c.globalTime)
  expect([...globals]).toEqual([...globals].sort((x, y) => x - y))
})

it('stays within the per-call image budget for very long totals', () => {
  const sources = Array.from({ length: 20 }, (_, i) => ({ id: `v${i}`, duration: 600 })) // ~3.3h
  const caps = planGlobalSheetCaptures(sources)
  expect(caps.length).toBeLessThanOrEqual(120) // MAX_FRAMES; composed into ≤10 sheets
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/globalSheet.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the planner**

```ts
// src/lib/globalSheet.ts
import { planContactSheet } from './contactSheet'
import { globalToLocal, totalDuration, type SourceLike } from './sources'

export type GlobalCapture = { globalTime: number; sourceId: string; localTime: number }

/**
 * Plan the whole-talk director contact sheet across many sources (story 09c).
 * Reuse the clip-wide spacing on the COMBINED duration (so total length sets the
 * interval and the ≤10-image budget holds), then route each global timestamp to
 * the source + local time it should be captured from. The burned-in label uses
 * the GLOBAL time so the director reads one continuous timeline.
 */
export function planGlobalSheetCaptures(sources: SourceLike[]): GlobalCapture[] {
  const total = totalDuration(sources)
  const plan = planContactSheet(total)
  const out: GlobalCapture[] = []
  for (const globalTime of plan.times) {
    const local = globalToLocal(sources, globalTime)
    if (local) out.push({ globalTime, sourceId: local.sourceId, localTime: local.localTime })
  }
  return out
}

export { planContactSheet }
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/lib/globalSheet.test.ts` → PASS

- [ ] **Step 5: Rewrite the `thumbnails` step to capture globally**

In `useScenePipeline.ts`, replace `generateThumbnails` so it:
- Computes `planGlobalSheetCaptures(sources)`.
- Groups captures by `sourceId`; for each source, fetches its signed source URL once (reuse the `signedSourceUrl` pattern but per-source: sign `source.sourceUrl`), wraps the bytes in a same-origin blob URL (the CORS lesson from `generateSceneSheets`), and captures frames at the **local** times via `captureFramesAt`.
- Composes the frames into sheets stamped with **global** `clockLabel(globalTime)` (pass global times into `composeContactSheet`), tiled ≤10 via the same `chunk`/`cellsPerSheet` math.
- Uploads each (kind `thumbnails`) and `dispatch(setContactSheets(uploaded))` — global `contactSheets` stays top-level, unchanged shape.

This step is gated (Task 4) on every source being transcribed.

- [ ] **Step 6: Build + lint + test**

Run: `npm run build && npm run lint && npm run test:run` → green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/globalSheet.ts src/lib/globalSheet.test.ts src/components/Studio/useScenePipeline.ts
git commit -m "feat(studio): global contact sheet across all sources (total-duration spacing) (09c)"
```

## Task 4: Director reads the combined inputs + gate the global stages

**Files:**
- Modify: `src/components/Studio/useScenePipeline.ts`

- [ ] **Step 1: Implement**

- In `runDirector`, build the request from all sources:
  ```ts
  const transcript = combinedTimedTranscript(sources.map((s) => ({ id: s.id, fileName: s.fileName, duration: s.duration, words: s.words })))
  const sheetUrls = persistedSheets.map((s) => s.url).filter((u): u is string => !!u)
  const duration = totalDuration(sources)  // global bound
  const { jobId } = await scenesReq({ transcript, sheetUrls, direction, duration }).unwrap()
  ```
- In `completeDirectorJob`, call `toScenes(data.scenes ?? [], sources.map((s) => ({ id: s.id, duration: s.duration })))` instead of `toScenes(data.scenes, clipDuration)`. Scene-card thumbs: capture per scene off **that scene's** source — group built scenes by `sourceId`, sign each source once, capture at the scene midpoints' **local** times. (Best-effort, unchanged failure tolerance.)
- Derive prep readiness from the new scopes: every source has all `PER_VIDEO_STAGES` done **and** the global stages done. Replace the `ready` memo:
  ```ts
  const sourcesReady = sources.length > 0 && sources.every((s) => PER_VIDEO_STAGES.every((id) => s.stageProgress[id]?.status === 'done'))
  const globalReady = GLOBAL_STAGES.every((id) => stageProgress[id]?.status === 'done')
  const ready = sourcesReady && globalReady
  ```
- Gate the `thumbnails`/`director` actions in the page on `sourcesReady`.

- [ ] **Step 2: Build + lint + test**

Run: `npm run build && npm run lint && npm run test:run` → green. Update `useScenePipeline`/page tests that asserted single-`duration` director calls.

- [ ] **Step 3: Commit**

```bash
git add src/components/Studio/useScenePipeline.ts src/pages/Studio.tsx
git commit -m "feat(studio): director sees combined transcript+sheet; prep-ready spans all sources (09c)"
```

## Task 5: Live pipeline prompt — boundary rule (BFFless, rule `138f27fb`)

**Files:** none in-repo (BFFless rule); document in the story file.

- [ ] **Step 1:** Use the `bffless-pipeline` skill. In rule `138f27fb`'s `prep` step, add one instruction to the system prompt: *"The transcript is several videos concatenated, separated by `--- VIDEO n: … ---` markers with each video's global start time. Group the talk into chapters, but NEVER start a chapter in one video and end it in another — a chapter must lie entirely within one video's span."* The client `toScenes` auto-split is the safety net; this just reduces splits. Leave validators off (story 07). Note any verification in the story file.

- [ ] **Step 2: Commit** the story-file note (no code).

## Story 09c self-check
- [ ] With mocks on + two sources, the director returns scenes that each carry a `sourceId`; a deliberately boundary-crossing mock scene splits into two.
- [ ] `npm run build && npm run lint && npm run test:run` green; PR `feat(studio): global director over combined sources (09c)`.

---

# Story 09d — Build resolves footage by `sourceId`; retire the legacy globals

**Outcome:** Every per-scene Build operation (slice, refiner sheets, refine word-scoping, original-audio adopt) resolves **the scene's source video** by `sourceId` instead of the single top-level `sourceUrl`/`audioUrl`/`words`. The legacy top-level fields are removed. Export is verified to work unchanged across sources.

**Branch:** `studio-09d-build-by-source`

## Task 1: `sourceForScene` selector helper

**Files:**
- Modify: `src/lib/sources.ts`
- Test: `src/lib/sources.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { sourceForScene } from './sources'

it('finds the VideoSource a scene belongs to', () => {
  const sources = [{ id: 'a', duration: 1 }, { id: 'b', duration: 1 }] as any
  expect(sourceForScene(sources, { sourceId: 'b' } as any)?.id).toBe('b')
  expect(sourceForScene(sources, { sourceId: 'z' } as any)).toBeNull()
})
```

- [ ] **Step 2: Run it, verify it fails** → `npx vitest run src/lib/sources.test.ts -t "belongs to"` → FAIL.

- [ ] **Step 3: Implement**

```ts
export function sourceForScene<T extends { id: string }>(sources: T[], scene: { sourceId: string }): T | null {
  return sources.find((s) => s.id === scene.sourceId) ?? null
}
```

- [ ] **Step 4: Run it** → PASS.
- [ ] **Step 5: Commit** `feat(studio): sourceForScene helper (09d)`.

## Task 2: Per-scene footage reads resolve by `sourceId`

**Files:**
- Modify: `src/components/Studio/useScenePipeline.ts`

- [ ] **Step 1: Implement**

Replace each top-level read inside a per-scene action with the scene's source:

- `signedSourceUrl`: make it take a `sourceUrl` arg — `const signFor = useCallback(async (url) => (await signReq(url, true).unwrap()).url, [signReq])`. Callers pass `sourceForScene(sources, scene)!.sourceUrl`.
- `generateSceneSheets` (line ~729): resolve `const src = sourceForScene(sources, scene)`; guard on `src?.sourceUrl`; fetch `signFor(src.sourceUrl)` for the blob.
- `sliceScene` (~914): same — read `src.sourceUrl` and `src.audioUrl` for the video + soundtrack slice.
- `refineScene` (~773): scope words from **that source's** `words` — `const src = sourceForScene(sources, scene); const scoped = src.words.filter((w) => w.start >= scene.start && w.start < scene.end)` (now local times, matching the source's local words).
- `adoptOriginalAudio` (~856), `sliceAndUploadSpans` (~293), `adoptSegmentOriginal`: slice from `src.audioUrl`, not the top-level `audioUrl`. `sliceAndUploadSpans` gains a `sourceAudioUrl` parameter; callers pass the scene's source audio.

Each guard throws a clear message (`No source available for this scene.`) if `src` is missing.

- [ ] **Step 2: Build + lint + test**

Run: `npm run build && npm run lint && npm run test:run`
Expected: green. Update hook tests that stubbed top-level `audioUrl`/`sourceUrl` to stub a `sources[]` instead.

- [ ] **Step 3: Commit** `feat(studio): Build slices/refines per scene.sourceId (09d)`.

## Task 3: Remove the legacy top-level single-video fields

**Files:**
- Modify: `src/store/studioSlice.ts`, `src/components/Studio/useScenePipeline.ts`, `src/pages/Studio.tsx`, and any reader of `s.studio.sourceUrl`/`audioUrl`/`audioPeaks`/`words`/`duration`/`fileName`.

- [ ] **Step 1: Find every reader**

Run: `grep -rn "studio\.\(sourceUrl\|audioUrl\|audioPeaks\|words\|duration\|fileName\)\b" src` and `grep -rn "set\(SourceUrl\|AudioUrl\|AudioPeaks\|Words\|Duration\|FileName\)\b" src`
Expected: a finite list — the hook bridge (Task 09a-6), the page preview/`hasPersisted`, waveform/`AudioArtifact`, the director.

- [ ] **Step 2: Migrate each reader to `sources`**

- Page `hasPersisted`: `sources.length > 0 && sources.some((s) => s.sourceUrl)` (or all-ready for the Build gate).
- Waveform/audio artifact: per-source (show the selected scene's source audio, or the queue rows show each source's peaks).
- Delete the `setSourceUrl`/`setAudioUrl`/`setAudioPeaks`/`setWords`/`setDuration`/`setFileName` reducers and the `sourceUrl`/`audioUrl`/`audioPeaks`/`words`/`synopsis`-adjacent single fields from `StudioState`/`initialState`. (`synopsis`/`direction`/`scenes`/`voice`/`finalCutUrl`/`contactSheets` stay.)
- Bump persist to **version 4** with a no-op-ish migration that deletes the now-dead keys (they're already mirrored into `sources[0]` by v3, so just `delete next.sourceUrl` etc.).

- [ ] **Step 3: Build + lint + test**

Run: `npm run build && npm run lint && npm run test:run`
Expected: green. The TS compiler is the safety net — every removed field surfaces as a build error to fix (don't suppress; `feedback_fix_code_not_config`).

- [ ] **Step 4: Commit** `refactor(studio): drop legacy single-video slice fields; sources[] is the source of truth (09d)`.

## Task 4: Verify Export across sources

**Files:** none (verification + a test).

- [ ] **Step 1:** Confirm `assemble`/`FinalCutBar` concat reads `scene.assembledUrl` in scene order and never references a global source. Add an assertion test in `src/lib/export/assemble.test.ts` that a two-source scene list (scenes with differing `sourceId`, local bounds) plans + concats by scene order with no cross-source coordinate leak.
- [ ] **Step 2:** `npm run test:run` → green.
- [ ] **Step 3: Commit** `test(studio): export concat is source-agnostic across multi-video scenes (09d)`.

## Story 09d self-check
- [ ] With mocks on + two sources fully prepped + director run, build a scene from source A and a scene from source B — each slices/refines/voices from its own clip; export concats both.
- [ ] `npm run build && npm run lint && npm run test:run` green; PR `feat(studio): multi-video Build + Export by sourceId (09d)`.

---

## Plan self-review notes (addressed)

- **Spec coverage:** `sources[]`+migration (09a T4–5), `Scene.sourceId`/local bounds (09a T3), `sources.ts` global↔local (09a T2), per-video accordion loop + reorder (09b), standalone global sheet w/ total-duration spacing (09c T3), combined boundary-marked transcript (09c T1), single global director call + `toScenes` map/auto-split (09c T2/T4), `sourceId`-aware Build (09d T1–2), zero-change Export verified (09d T4), stage-scope split (09a T1). All spec sections map to a task.
- **Sequencing deviation from the spec's 09a–09d:** the spec put director coercion in 09d; this plan moves it to **09c** because the global→local inversion is meaningless without the combined transcript that creates the global coords — they ship together. 09d is therefore purely Build-side resolution + legacy cleanup. (Recorded here so the spec and plan don't appear to disagree.)
- **Type consistency:** `VideoSource`, `addSource/patchSource/patchSourceStage/reorderSources/removeSource`, `PER_VIDEO_STAGES`/`GLOBAL_STAGES`, `globalToLocal/localToGlobal/sourceOffsets/totalDuration/sourceForScene`, `combinedTimedTranscript`, `planGlobalSheetCaptures`, and the new `toScenes(raw, sources)` signature are used consistently across all four stories.
