# Studio Projects Entity (Story 11a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/studio` from a single implicit project into a keyed collection of projects with a stable ID, a project-list landing UI, and create/open/rename/delete — all persisted locally.

**Architecture:** The `studio` slice becomes `{ index, working, activeProjectId, savedVoices }`. Existing reducers are re-pointed to mutate the *active* project's working state through one `active(state)` helper; dispatch sites are unchanged. A middleware keeps each project's lightweight `index` metadata (phase, thumbnail, updatedAt) in sync. `savedVoices` is hoisted out of the project into a shared library. `Studio.tsx` branches on `activeProjectId`: null → project list, set → the existing workspace.

**Tech Stack:** React 19, Redux Toolkit 2 + redux-persist, TypeScript, Vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-15-studio-projects-entity-design.md`

**Branch:** `studio/projects` (already created; the four-story initiative shares it).

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/lib/projects.ts` | Pure project-model helpers: `ProjectMeta` type, `phaseOf`, `deriveProjectMeta`, untitled-naming | **create** |
| `src/lib/projects.test.ts` | Unit tests for the above | **create** |
| `src/store/studioSlice.ts` | Slice: new root shape, `ProjectWorkingState`, `active()`, re-pointed reducers, project-mgmt reducers, hoisted `savedVoices`, selectors | **modify (major)** |
| `src/store/studioSlice.test.ts` | Reducer + routing + selector tests | **create** |
| `src/store/projectMetaSync.ts` | Middleware stamping `index` metadata after working-state changes | **create** |
| `src/store/projectMetaSync.test.ts` | Middleware test (through a store) | **create** |
| `src/store/index.ts` | Persist key bump (clean slate) + persist new shape; register middleware | **modify** |
| `src/pages/Studio.tsx` | Branch on `activeProjectId`; read through `selectActive`; ← Projects nav; wire create/open | **modify** |
| `src/components/Studio/ProjectList.tsx` | The landing list: header, New-project CTA, grid, empty state | **create** |
| `src/components/Studio/ProjectCard.tsx` | One card: thumbnail, editable name, phase badge, edited-time, delete | **create** |
| `src/components/Studio/useScenePipeline.ts` | Read working-state through `selectActive`; `savedVoices` from root | **modify** |
| `src/components/Studio/useAutoBuild.ts` | Read `autoBuild` through `selectActive` | **modify** |

---

## Task 1: Pure project-model helpers

**Files:**
- Create: `src/lib/projects.ts`
- Test: `src/lib/projects.test.ts`

Pure helpers only — **no ID minting here** (ID minting is impure and lives in the reducer). `ProjectWorkingState` is imported as a type from the slice (type-only import → erased, no runtime cycle).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/projects.test.ts
import { describe, it, expect } from 'vitest'
import { phaseOf, deriveProjectMeta, nextUntitledName, DEFAULT_PROJECT_NAME } from './projects'
import { freshWorkingState } from '../store/studioSlice'

describe('phaseOf', () => {
  it('is import when there are no sources', () => {
    expect(phaseOf(freshWorkingState())).toBe('import')
  })

  it('is prep when a source exists but no scenes', () => {
    const w = freshWorkingState()
    w.sources = [{ id: 's1', order: 0, fileName: 'a.mp4', duration: 10, sourceUrl: 'u', audioUrl: null, audioPeaks: [], words: [], transcribeJobId: null, stageProgress: {} }]
    expect(phaseOf(w)).toBe('prep')
  })

  it('is export when every scene is built and inExport is set', () => {
    const w = freshWorkingState()
    w.sources = [{ id: 's1', order: 0, fileName: 'a.mp4', duration: 10, sourceUrl: 'u', audioUrl: null, audioPeaks: [], words: [], transcribeJobId: null, stageProgress: { upload: { status: 'done' }, extract: { status: 'done' }, transcribe: { status: 'done' } } }]
    for (const id of ['contact', 'voice', 'director'] as const) w.stageProgress[id] = { status: 'done' }
    w.scenes = [{ id: 'sc1', status: 'built' } as never]
    w.inExport = true
    expect(phaseOf(w)).toBe('export')
  })
})

describe('deriveProjectMeta', () => {
  it('reads the first persisted contact-sheet url as the thumbnail', () => {
    const w = freshWorkingState()
    w.contactSheets = [{ url: undefined } as never, { url: '/api/uploads/thumbnails/x.png' } as never]
    expect(deriveProjectMeta(w).thumbnailUrl).toBe('/api/uploads/thumbnails/x.png')
  })

  it('returns a null thumbnail when no sheet has a persisted url', () => {
    expect(deriveProjectMeta(freshWorkingState()).thumbnailUrl).toBeNull()
  })
})

describe('nextUntitledName', () => {
  it('returns the default when none exist', () => {
    expect(nextUntitledName([])).toBe(DEFAULT_PROJECT_NAME)
  })
  it('numbers the next one when the default name is taken', () => {
    expect(nextUntitledName([DEFAULT_PROJECT_NAME])).toBe(`${DEFAULT_PROJECT_NAME} 2`)
    expect(nextUntitledName([DEFAULT_PROJECT_NAME, `${DEFAULT_PROJECT_NAME} 2`])).toBe(`${DEFAULT_PROJECT_NAME} 3`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/projects.test.ts`
Expected: FAIL — `Cannot find module './projects'` (and `freshWorkingState` export missing; that export is added in Task 2 — for now stub it so this task compiles, see Step 3 note).

- [ ] **Step 3: Write the implementation**

> **Note:** `freshWorkingState` and the `ProjectWorkingState` type are formally added to the slice in Task 2. To keep Task 1 self-contained and green, do Task 2's *type + `freshWorkingState` extraction* sub-steps (2.1–2.3) first if running strictly task-by-task. The plan orders them this way deliberately: Task 1 defines the contract the slice then satisfies.

```ts
// src/lib/projects.ts
import type { ProjectWorkingState } from '../store/studioSlice'
import {
  GLOBAL_STAGES,
  PER_VIDEO_STAGES,
  studioPhase,
  type StudioPhase,
} from './pipeline'

/** Lightweight, always-persisted project metadata — enough to render a card in
 *  the list WITHOUT loading the heavy working state (story 11d depends on this). */
export type ProjectMeta = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  phase: StudioPhase
  thumbnailUrl: string | null
}

export const DEFAULT_PROJECT_NAME = 'Untitled project'

/** Coarse macro-phase for the card badge, derived purely from working state.
 *  Mirrors the hook's ready/allBuilt derivation so the badge matches the stepper. */
export function phaseOf(w: ProjectWorkingState): StudioPhase {
  const hasSource = w.sources.length > 0
  const allBuilt = w.scenes.length > 0 && w.scenes.every((s) => s.status === 'built')
  const sourcesReady =
    w.sources.length > 0 &&
    w.sources.every((s) => PER_VIDEO_STAGES.every((id) => s.stageProgress[id]?.status === 'done'))
  const ready = sourcesReady && GLOBAL_STAGES.every((id) => w.stageProgress[id]?.status === 'done')
  return studioPhase({ hasSource, ready, allBuilt })
}

/** The denormalized bits of `ProjectMeta` that derive from working state. */
export function deriveProjectMeta(w: ProjectWorkingState): Pick<ProjectMeta, 'phase' | 'thumbnailUrl'> {
  return {
    phase: phaseOf(w),
    thumbnailUrl: w.contactSheets.find((s) => s.url)?.url ?? null,
  }
}

/** First free "Untitled project [N]" given the names already in use. */
export function nextUntitledName(existing: string[]): string {
  if (!existing.includes(DEFAULT_PROJECT_NAME)) return DEFAULT_PROJECT_NAME
  let n = 2
  while (existing.includes(`${DEFAULT_PROJECT_NAME} ${n}`)) n++
  return `${DEFAULT_PROJECT_NAME} ${n}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/projects.test.ts`
Expected: PASS (after Task 2's `freshWorkingState`/`ProjectWorkingState` exist).

- [ ] **Step 5: Commit**

```bash
git add src/lib/projects.ts src/lib/projects.test.ts
git commit -m "feat(studio): pure project-model helpers (phaseOf, deriveProjectMeta, naming)"
```

---

## Task 2: Restructure the slice shape (types, freshWorkingState, active(), re-point reducers, hoist savedVoices)

**Files:**
- Modify: `src/store/studioSlice.ts`
- Test: `src/store/studioSlice.test.ts`

This is the mechanical core. Existing reducer **bodies** stay identical except their target changes from `state` to `active(state)`.

- [ ] **Step 2.1: Rename the state type and drop `savedVoices` from it**

Rename `export type StudioState = {...}` → `export type ProjectWorkingState = {...}` and **remove the `savedVoices: SavedVoice[]` field** from it (it moves to the root). Keep `SavedVoice` exported.

- [ ] **Step 2.2: Add the root state type**

```ts
import type { ProjectMeta } from '../lib/projects'

/** Root studio state: a keyed collection of projects + the active pointer +
 *  the shared (cross-project) saved-voice library. See projects design doc. */
export type StudioState = {
  index: Record<string, ProjectMeta>
  working: Record<string, ProjectWorkingState>
  activeProjectId: string | null
  savedVoices: SavedVoice[]
}
```

- [ ] **Step 2.3: Extract `freshWorkingState()` and the new `initialState`**

Rename the existing `const initialState: StudioState = {...}` object → `export function freshWorkingState(): ProjectWorkingState { return {...} }` (the same object literal, **minus `savedVoices`**). Then add:

```ts
const initialState: StudioState = {
  index: {},
  working: {},
  activeProjectId: null,
  savedVoices: [],
}

/** The active project's working state, or undefined when none is open. All
 *  project-scoped reducers funnel through this. */
function active(state: StudioState): ProjectWorkingState | undefined {
  return state.activeProjectId ? state.working[state.activeProjectId] : undefined
}
```

- [ ] **Step 2.4: Re-point every project-scoped reducer through `active(state)`**

**Uniform transformation (apply to every existing reducer EXCEPT the savedVoices ones and `resetStudio`):** add `const w = active(state); if (!w) return` at the top, then replace each `state.` with `w.`.

Worked examples:

```ts
setScenes(state, action: PayloadAction<Scene[]>) {
  const w = active(state); if (!w) return
  w.scenes = action.payload
},
patchScene(state, action: PayloadAction<{ id: string; patch: Partial<Scene> }>) {
  const w = active(state); if (!w) return
  const scene = w.scenes.find((s) => s.id === action.payload.id)
  if (scene) Object.assign(scene, action.payload.patch)
},
setPeopleCount(state, action: PayloadAction<number>) {
  const w = active(state); if (!w) return
  const n = Math.max(1, Math.floor(action.payload))
  while (w.cast.length < n)
    w.cast.push({ id: nextPersonId(w.cast), name: defaultPersonName(w.cast.length), voice: null })
  if (w.cast.length > n) {
    const removed = w.cast.slice(n).map((p) => p.id)
    w.cast = w.cast.slice(0, n)
    for (const vid of Object.keys(w.speakerAssignments))
      for (const label of Object.keys(w.speakerAssignments[vid]))
        if (removed.includes(w.speakerAssignments[vid][label]))
          delete w.speakerAssignments[vid][label]
  }
  w.voice = w.cast[0]?.voice ?? null
},
```

**Full inventory to transform this way** (every reducer that currently reads `state.<workingField>`): `patchStage`, `failActiveStage`, `setRevisitPrep`, `setInExport`, `setPlanRevealed`, `setDiarize`, `setScenes`, `patchScene`, `setSourceUrl`, `setAudioUrl`, `setAudioPeaks`, `setContactSheets`, `setWords`, `setSynopsis`, `setDirection`, `setScenesJobId`, `setDirectorPromptJobId`, `setVoice`, `setSelected`, `setDuration`, `setFileName`, `setFinalCutUrl`, `setDescription`, `setDescriptionTitle`, `addSource`, `patchSource`, `patchSourceStage`, `removeSource`, `reorderSources`, `setPeopleCount`, `renamePerson`, `setPersonVoice`, `removePerson`, `assignSpeaker`, `startAutoBuild`, `pauseAutoBuild`, `resumeAutoBuild`, `stopAutoBuild`, `haltAutoBuild`, `completeAutoBuild`, `setAutoPointer`.

- [ ] **Step 2.5: Hoist the `savedVoices` reducers to the root** (they operate on `state.savedVoices` directly — leave them reading `state.`, NOT `w.`):

```ts
addSavedVoice(state, action: PayloadAction<SavedVoice>) {
  const id = action.payload.voiceId.trim()
  if (!id) return
  state.savedVoices = [
    { voiceId: id, label: action.payload.label || id },
    ...state.savedVoices.filter((v) => v.voiceId !== id),
  ]
},
removeSavedVoice(state, action: PayloadAction<string>) {
  state.savedVoices = state.savedVoices.filter((v) => v.voiceId !== action.payload)
},
```

- [ ] **Step 2.6: Remove the old `resetStudio`** (replaced by `resetProject` in Task 3) and drop `resetStudio` from the exports for now (re-added under the new name in Task 3).

- [ ] **Step 3: Write the failing test**

```ts
// src/store/studioSlice.test.ts
import { describe, it, expect } from 'vitest'
import reducer, { setScenes, setDirection, addSavedVoice, freshWorkingState, type StudioState } from './studioSlice'

const withOneProject = (): StudioState => ({
  index: { p1: { id: 'p1', name: 'A', createdAt: 1, updatedAt: 1, phase: 'import', thumbnailUrl: null } },
  working: { p1: freshWorkingState() },
  activeProjectId: 'p1',
  savedVoices: [],
})

describe('project-scoped reducers route to the active project', () => {
  it('setScenes mutates the active project only', () => {
    const next = reducer(withOneProject(), setScenes([{ id: 'sc1', status: 'pending' } as never]))
    expect(next.working.p1.scenes).toHaveLength(1)
  })
  it('is a no-op when no project is active', () => {
    const empty: StudioState = { index: {}, working: {}, activeProjectId: null, savedVoices: [] }
    const next = reducer(empty, setDirection('hi'))
    expect(next).toEqual(empty)
  })
})

describe('savedVoices live at the root, shared across projects', () => {
  it('addSavedVoice writes to root state, not a project', () => {
    const next = reducer(withOneProject(), addSavedVoice({ voiceId: 'v1', label: 'Mine' }))
    expect(next.savedVoices).toEqual([{ voiceId: 'v1', label: 'Mine' }])
    expect('savedVoices' in next.working.p1).toBe(false)
  })
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/store/studioSlice.test.ts src/lib/projects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/studioSlice.ts src/store/studioSlice.test.ts
git commit -m "refactor(studio): re-point slice reducers onto the active project; hoist savedVoices"
```

---

## Task 3: Project-management reducers

**Files:**
- Modify: `src/store/studioSlice.ts`
- Test: `src/store/studioSlice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/store/studioSlice.test.ts
import reducer, {
  createProject, openProject, closeProject, renameProject, deleteProject, resetProject,
} from './studioSlice'

describe('project management', () => {
  it('createProject mints an id, adds index + working, and makes it active', () => {
    const next = reducer(undefined, createProject({ id: 'p1', now: 100 }))
    expect(next.activeProjectId).toBe('p1')
    expect(next.index.p1.name).toBe('Untitled project')
    expect(next.index.p1.createdAt).toBe(100)
    expect(next.working.p1.scenes).toEqual([])
  })

  it('names the second untitled project "Untitled project 2"', () => {
    let s = reducer(undefined, createProject({ id: 'p1', now: 1 }))
    s = reducer(s, createProject({ id: 'p2', now: 2 }))
    expect(s.index.p2.name).toBe('Untitled project 2')
  })

  it('openProject / closeProject move the active pointer', () => {
    let s = reducer(undefined, createProject({ id: 'p1', now: 1 }))
    s = reducer(s, closeProject())
    expect(s.activeProjectId).toBeNull()
    s = reducer(s, openProject('p1'))
    expect(s.activeProjectId).toBe('p1')
  })

  it('renameProject updates the name + updatedAt', () => {
    let s = reducer(undefined, createProject({ id: 'p1', now: 1 }))
    s = reducer(s, renameProject({ id: 'p1', name: 'Cat site', now: 5 }))
    expect(s.index.p1.name).toBe('Cat site')
    expect(s.index.p1.updatedAt).toBe(5)
  })

  it('deleteProject drops index + working and clears active if it was active', () => {
    let s = reducer(undefined, createProject({ id: 'p1', now: 1 }))
    s = reducer(s, deleteProject('p1'))
    expect(s.index.p1).toBeUndefined()
    expect(s.working.p1).toBeUndefined()
    expect(s.activeProjectId).toBeNull()
  })

  it('resetProject clears the active project working state but keeps it in the list', () => {
    let s = reducer(undefined, createProject({ id: 'p1', now: 1 }))
    s = reducer(s, setDirection('hello'))
    s = reducer(s, resetProject())
    expect(s.working.p1.direction).toBe('')
    expect(s.index.p1).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/studioSlice.test.ts`
Expected: FAIL — `createProject is not exported`.

- [ ] **Step 3: Add the reducers**

Add these to the slice `reducers` object (after the savedVoices reducers). Import the naming helper: `import { DEFAULT_PROJECT_NAME, nextUntitledName, type ProjectMeta } from '../lib/projects'`.

```ts
/** Create a new, empty project and make it active. `id`/`now` are passed in
 *  (impure values stay out of the reducer): `id = crypto.randomUUID()`. */
createProject(state, action: PayloadAction<{ id: string; now: number }>) {
  const { id, now } = action.payload
  const name = nextUntitledName(Object.values(state.index).map((m) => m.name))
  state.index[id] = { id, name, createdAt: now, updatedAt: now, phase: 'import', thumbnailUrl: null }
  state.working[id] = freshWorkingState()
  state.activeProjectId = id
},
openProject(state, action: PayloadAction<string>) {
  if (state.working[action.payload]) state.activeProjectId = action.payload
},
closeProject(state) {
  state.activeProjectId = null
},
renameProject(state, action: PayloadAction<{ id: string; name: string; now: number }>) {
  const meta = state.index[action.payload.id]
  if (!meta) return
  meta.name = action.payload.name
  meta.updatedAt = action.payload.now
},
deleteProject(state, action: PayloadAction<string>) {
  delete state.index[action.payload]
  delete state.working[action.payload]
  if (state.activeProjectId === action.payload) state.activeProjectId = null
},
/** "Start this project over": reset its working state, keep it in the list. */
resetProject(state) {
  const id = state.activeProjectId
  if (!id) return
  state.working[id] = freshWorkingState()
},
```

> `DEFAULT_PROJECT_NAME` is imported only so it's available if you inline a default elsewhere; `nextUntitledName` already uses it internally. If the linter flags it as unused, drop it from the import.

- [ ] **Step 4: Add to the action exports**

Add `createProject, openProject, closeProject, renameProject, deleteProject, resetProject` to the destructured `export { ... } = studioSlice.actions` block.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/store/studioSlice.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/studioSlice.ts src/store/studioSlice.test.ts
git commit -m "feat(studio): project create/open/close/rename/delete/reset reducers"
```

---

## Task 4: Index-metadata sync middleware

**Files:**
- Create: `src/store/projectMetaSync.ts`
- Test: `src/store/projectMetaSync.test.ts`

After any `studio/*` action that touched the active project, refresh that project's `index` metadata (`updatedAt`, `phase`, `thumbnailUrl`). Keeping this in middleware (not the reducers) means the 40 re-pointed reducers don't each have to remember to stamp metadata.

- [ ] **Step 1: Write the failing test**

```ts
// src/store/projectMetaSync.test.ts
import { describe, it, expect, vi } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import studioReducer, { createProject, setContactSheets } from './studioSlice'
import { projectMetaSync } from './projectMetaSync'

function makeStore() {
  return configureStore({
    reducer: { studio: studioReducer },
    middleware: (gdm) => gdm().concat(projectMetaSync),
  })
}

describe('projectMetaSync', () => {
  it('refreshes the active project meta after a working-state change', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    const store = makeStore()
    store.dispatch(createProject({ id: 'p1', now: 1 }))
    store.dispatch(setContactSheets([{ url: '/api/uploads/thumbnails/x.png' } as never]))
    const meta = store.getState().studio.index.p1
    expect(meta.thumbnailUrl).toBe('/api/uploads/thumbnails/x.png')
    expect(meta.updatedAt).toBe(100)
    vi.restoreAllMocks()
  })

  it('ignores non-studio actions and the create/open/rename/delete actions themselves', () => {
    const store = makeStore()
    store.dispatch(createProject({ id: 'p1', now: 1 }))
    const before = store.getState().studio.index.p1.updatedAt
    store.dispatch({ type: 'other/thing' })
    expect(store.getState().studio.index.p1.updatedAt).toBe(before)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/projectMetaSync.test.ts`
Expected: FAIL — `Cannot find module './projectMetaSync'`.

- [ ] **Step 3: Write the middleware**

```ts
// src/store/projectMetaSync.ts
import type { Middleware } from '@reduxjs/toolkit'
import { deriveProjectMeta } from '../lib/projects'
import type { StudioState } from './studioSlice'

/** Project-management actions manage `index` themselves — skip them so we don't
 *  clobber createdAt/name or re-stamp on open/close. */
const SKIP = new Set([
  'studio/createProject',
  'studio/openProject',
  'studio/closeProject',
  'studio/renameProject',
  'studio/deleteProject',
])

/** After a working-state mutation, refresh the active project's denormalized
 *  index metadata (phase, thumbnail, updatedAt) so the list stays render-ready. */
export const projectMetaSync: Middleware = (store) => (next) => (action) => {
  const result = next(action)
  const type = (action as { type?: string }).type
  if (typeof type === 'string' && type.startsWith('studio/') && !SKIP.has(type)) {
    const studio = (store.getState() as { studio: StudioState }).studio
    const id = studio.activeProjectId
    const meta = id ? studio.index[id] : undefined
    const working = id ? studio.working[id] : undefined
    if (id && meta && working) {
      const { phase, thumbnailUrl } = deriveProjectMeta(working)
      // Mutate via dispatch-free direct write is not allowed (state is frozen);
      // dispatch a tiny internal patch instead:
      store.dispatch({ type: 'studio/_syncMeta', payload: { id, phase, thumbnailUrl, now: Date.now() } })
    }
  }
  return result
}
```

Add the matching internal reducer to the slice (so the patch is applied immutably and is the ONLY place `_syncMeta` is handled). In `studioSlice.ts` reducers:

```ts
/** Internal: applied by projectMetaSync middleware. Not exported as a public action. */
_syncMeta(state, action: PayloadAction<{ id: string; phase: ProjectMeta['phase']; thumbnailUrl: string | null; now: number }>) {
  const meta = state.index[action.payload.id]
  if (!meta) return
  meta.phase = action.payload.phase
  meta.thumbnailUrl = action.payload.thumbnailUrl
  meta.updatedAt = action.payload.now
},
```

Export `_syncMeta` from the actions block too (the middleware references the string type `studio/_syncMeta`, but exporting keeps it discoverable; mark with a comment that it's internal). Add `'studio/_syncMeta'` to the `SKIP` set so the sync doesn't recurse.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/projectMetaSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/projectMetaSync.ts src/store/projectMetaSync.test.ts src/store/studioSlice.ts
git commit -m "feat(studio): middleware keeps project index metadata in sync"
```

---

## Task 5: Selectors

**Files:**
- Modify: `src/store/studioSlice.ts`
- Test: `src/store/studioSlice.test.ts`

A stable empty working state lets consumers read fields safely when no project is open (the workspace subtree isn't rendered then, but the hook still runs).

- [ ] **Step 1: Write the failing test**

```ts
// add to src/store/studioSlice.test.ts
import { selectActive, selectProjectList, EMPTY_WORKING } from './studioSlice'

describe('selectors', () => {
  it('selectActive returns a stable empty working state when none is open', () => {
    const s = { studio: { index: {}, working: {}, activeProjectId: null, savedVoices: [] } } as never
    expect(selectActive(s)).toBe(EMPTY_WORKING)
  })
  it('selectProjectList sorts by updatedAt desc', () => {
    let st = reducer(undefined, createProject({ id: 'p1', now: 1 }))
    st = reducer(st, createProject({ id: 'p2', now: 2 }))
    st = reducer(st, renameProject({ id: 'p1', name: 'x', now: 9 }))
    const list = selectProjectList({ studio: st } as never)
    expect(list.map((m) => m.id)).toEqual(['p1', 'p2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/studioSlice.test.ts`
Expected: FAIL — `selectActive is not exported`.

- [ ] **Step 3: Add the selectors**

```ts
import type { RootState } from './index'

/** Frozen empty working state — a STABLE reference so useSelector reads don't
 *  thrash when no project is open. */
export const EMPTY_WORKING: ProjectWorkingState = Object.freeze(freshWorkingState()) as ProjectWorkingState

export const selectActive = (s: RootState): ProjectWorkingState =>
  s.studio.activeProjectId ? (s.studio.working[s.studio.activeProjectId] ?? EMPTY_WORKING) : EMPTY_WORKING

export const selectActiveProjectId = (s: RootState): string | null => s.studio.activeProjectId

export const selectProjectList = (s: RootState): ProjectMeta[] =>
  Object.values(s.studio.index).sort((a, b) => b.updatedAt - a.updatedAt)
```

> `RootState` is declared in `src/store/index.ts`, which imports this slice — a *type-only* import the other direction is safe (erased at runtime). If `tsc` complains about the cycle, type the selector args as `{ studio: StudioState }` instead of `RootState`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/store/studioSlice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/studioSlice.ts src/store/studioSlice.test.ts
git commit -m "feat(studio): selectActive / selectProjectList selectors"
```

---

## Task 6: Persistence (clean-slate key bump + new shape)

**Files:**
- Modify: `src/store/index.ts`

Per the spec, the existing single-project session is **discarded** (no migration). Bump the persist key so old localStorage is ignored, and register the new middleware.

- [ ] **Step 1: Change the persist key and version**

Replace the `persistConfig` block. The new shape has its own clean key; the legacy `migrations`/`createMigrate` for the old flat shape are no longer relevant to the new key, so drop them (and the `freshProgress` import if now unused).

```ts
const persistConfig = {
  key: 'studio-projects', // new key → clean slate; old `studio` localStorage is ignored
  version: 1,
  storage,
}
```

- [ ] **Step 2: Register the middleware**

```ts
import { projectMetaSync } from './projectMetaSync'
// ...
middleware: (getDefaultMiddleware) =>
  getDefaultMiddleware({
    serializableCheck: {
      ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
    },
  }).concat(projectMetaSync, studioApi.middleware),
```

- [ ] **Step 3: Verify the build type-checks**

Run: `npm run build`
Expected: PASS (no type errors). Fix any now-unused imports (`createMigrate`, `migrations`, `freshProgress`) flagged by `noUnusedLocals`.

- [ ] **Step 4: Commit**

```bash
git add src/store/index.ts
git commit -m "chore(studio): persist projects under a fresh key; register metadata middleware"
```

---

## Task 7: Migrate the three consumer files to read through `selectActive`

**Files:**
- Modify: `src/components/Studio/useScenePipeline.ts` (lines ~200–218)
- Modify: `src/pages/Studio.tsx` (lines ~54–71)
- Modify: `src/components/Studio/useAutoBuild.ts` (line ~60)

**Uniform transformation:** `useAppSelector((s) => s.studio.<field>)` → `useAppSelector((s) => selectActive(s).<field>)` for every *working-state* field. The ONE exception is `savedVoices`, which stays `s.studio.savedVoices` (it's hoisted to the root). Add `import { selectActive } from '../../store/studioSlice'` (adjust depth for `Studio.tsx`).

- [ ] **Step 1: `useScenePipeline.ts`** — change lines 200–218. Examples:

```ts
const scenes = useAppSelector((s) => selectActive(s).scenes)
const sourceUrl = useAppSelector((s) => selectActive(s).sourceUrl)
// ...same for audioUrl, audioPeaks, persistedSheets(contactSheets), words, synopsis,
// description, direction, directorPromptJobId, scenesJobId, voice, cast,
// speakerAssignments, diarize, selectedId, finalCutUrl, sources, stageProgress (line 190)
const savedVoices = useAppSelector((s) => s.studio.savedVoices) // <-- UNCHANGED (root)
```

- [ ] **Step 2: `Studio.tsx`** — change lines 54–71:

```ts
const direction = useAppSelector((s) => selectActive(s).direction)
const duration = useAppSelector((s) => selectActive(s).duration)
const fileName = useAppSelector((s) => selectActive(s).fileName)
const revisitPrep = useAppSelector((s) => selectActive(s).revisitPrep)
const inExport = useAppSelector((s) => selectActive(s).inExport)
const planRevealed = useAppSelector((s) => selectActive(s).planRevealed)
```

- [ ] **Step 3: `useAutoBuild.ts`** — change line 60:

```ts
const run = useAppSelector((s) => selectActive(s).autoBuild)
```

- [ ] **Step 4: Verify build + existing tests still pass**

Run: `npm run build && npm run test:run`
Expected: PASS. (No dispatch sites changed; the re-pointed reducers + middleware route everything to the active project.)

- [ ] **Step 5: Commit**

```bash
git add src/components/Studio/useScenePipeline.ts src/pages/Studio.tsx src/components/Studio/useAutoBuild.ts
git commit -m "refactor(studio): read working state through selectActive"
```

---

## Task 8: ProjectCard + ProjectList components

**Files:**
- Create: `src/components/Studio/ProjectCard.tsx`
- Create: `src/components/Studio/ProjectList.tsx`

Use the existing editorial tokens (`pill-cta`, `pill-ghost`, `meta-label`, `rule`, `bg-paper-deep`). Reference `src/components/Studio/MediaImport.tsx` for the surrounding look. Keep these presentational — all state actions are passed in as props from `Studio.tsx` (Task 9).

- [ ] **Step 1: Write `ProjectCard.tsx`**

```tsx
import { useState } from 'react'
import type { ProjectMeta } from '../../lib/projects'

const PHASE_LABEL: Record<ProjectMeta['phase'], string> = {
  import: 'Import', prep: 'Prep', build: 'Build', export: 'Export',
}

function editedAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function ProjectCard({
  meta, now, onOpen, onRename, onDelete,
}: {
  meta: ProjectMeta
  now: number
  onOpen: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(meta.name)

  return (
    <div className="flex flex-col border rule bg-paper-deep/30 overflow-hidden">
      <button type="button" onClick={() => onOpen(meta.id)} className="block aspect-video bg-ink/5">
        {meta.thumbnailUrl
          ? <img src={meta.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          : <span className="meta-label flex h-full items-center justify-center text-ink-soft">No preview</span>}
      </button>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="meta-label">{PHASE_LABEL[meta.phase]}</span>
          <span className="text-[12px] text-ink-soft">edited {editedAgo(meta.updatedAt, now)}</span>
        </div>
        {editing ? (
          <input
            autoFocus value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); if (draft.trim()) onRename(meta.id, draft.trim()) }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="w-full border rule bg-paper px-2 py-1 text-[15px]"
          />
        ) : (
          <button type="button" onClick={() => onOpen(meta.id)} className="text-left text-[16px] font-medium">
            {meta.name}
          </button>
        )}
        <div className="mt-1 flex items-center gap-2">
          <button type="button" className="pill-ghost text-[12px]" onClick={() => { setDraft(meta.name); setEditing(true) }}>Rename</button>
          <button
            type="button" className="pill-ghost text-[12px]"
            onClick={() => { if (confirm(`Delete "${meta.name}"? This can't be undone.`)) onDelete(meta.id) }}
          >Delete</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `ProjectList.tsx`**

```tsx
import type { ProjectMeta } from '../../lib/projects'
import { ProjectCard } from './ProjectCard'

export function ProjectList({
  projects, now, onNew, onOpen, onRename, onDelete,
}: {
  projects: ProjectMeta[]
  now: number
  onNew: () => void
  onOpen: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[14px] text-ink-soft">
          {projects.length === 0 ? 'No projects yet.' : `${projects.length} project${projects.length === 1 ? '' : 's'}`}
        </p>
        <button type="button" className="pill-cta" onClick={onNew}>+ New project</button>
      </div>
      {projects.length === 0 ? (
        <div className="border rule bg-paper-deep/30 px-6 py-16 text-center">
          <p className="text-[16px] text-ink-soft">Start your first project — upload a recording and the app preps it for you.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((m) => (
            <ProjectCard key={m.id} meta={m} now={now} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Studio/ProjectCard.tsx src/components/Studio/ProjectList.tsx
git commit -m "feat(studio): ProjectList + ProjectCard components"
```

---

## Task 9: Wire the page — branch on `activeProjectId`

**Files:**
- Modify: `src/pages/Studio.tsx`

- [ ] **Step 1: Add imports + dispatch handlers**

```ts
import { ProjectList } from '../components/Studio/ProjectList'
import {
  createProject, openProject, closeProject, renameProject, deleteProject, resetProject,
  selectActiveProjectId, selectProjectList,
} from '../store/studioSlice'
```

Inside the `Studio()` component:

```ts
const activeProjectId = useAppSelector(selectActiveProjectId)
const projects = useAppSelector(selectProjectList)

const onNewProject = () => dispatch(createProject({ id: crypto.randomUUID(), now: Date.now() }))
const onOpenProject = (id: string) => dispatch(openProject(id))
const onCloseProject = () => dispatch(closeProject())
const onRenameProject = (id: string, name: string) => dispatch(renameProject({ id, name, now: Date.now() }))
const onDeleteProject = (id: string) => dispatch(deleteProject(id))
```

- [ ] **Step 2: Early-return the list when no project is open**

Right before the existing `return (` (around line 531), add:

```tsx
if (!activeProjectId) {
  return (
    <>
      <PageHero
        eyebrow="EP 09 — Studio · scene producer"
        title={<>Your projects<Dot /></>}
        lead="Each recording you turn into a short video is its own project. Pick up where you left off, or start a new one."
      />
      <Section eyebrow="— Producer" title={<>Projects<Dot /></>} divider={false}>
        <ProjectList
          projects={projects}
          now={Date.now()}
          onNew={onNewProject}
          onOpen={onOpenProject}
          onRename={onRenameProject}
          onDelete={onDeleteProject}
        />
      </Section>
    </>
  )
}
```

- [ ] **Step 3: Replace "Start over" with "← Projects" + keep a scoped reset**

In the control bar (around line 593–600), replace the single "Start over" button with two:

```tsx
<button type="button" className="pill-ghost" disabled={pipe.running || rehydrating} onClick={onCloseProject}>
  ← Projects
</button>
<button
  type="button" className="pill-ghost"
  disabled={pipe.running || rehydrating}
  onClick={() => { if (confirm('Start this project over? Clears its prep and scenes.')) dispatch(resetProject()) }}
>
  Start over
</button>
```

> The previous `startOver` handler dispatched the old `resetStudio`. Remove that handler (and its `resetStudio` import). If `startOver` did extra cleanup (e.g. revoking an object URL), keep that cleanup and call it from the `resetProject` onClick.

- [ ] **Step 4: Verify build + lint + tests**

Run: `npm run build && npm run lint && npm run test:run`
Expected: PASS.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`, open `/studio`. Verify: empty list → "+ New project" creates a project and enters Import; importing a clip works; the card shows the right phase + "edited just now"; rename and delete work; "← Projects" returns to the list; reload keeps both the list and the project you were in (clean slate only on first load after the key bump).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Studio.tsx
git commit -m "feat(studio): project list landing + open/close/new wiring"
```

---

## Task 10: Story doc + status table

**Files:**
- Create: `stories/inprogress/studio/11a-projects-entity.md`
- Modify: `stories/inprogress/studio/README.md`

- [ ] **Step 1: Write the story file** mirroring the format of `03s-auto-build.md` (header pointing at this plan + the spec, a "Why", the locked decisions, and the file map). Set status to the shipped state once merged.

- [ ] **Step 2: Add a row to the README "Order & status" table**

```
| 11a | `11a-projects-entity.md` | projects collection + list/create/switch · split index/working state · savedVoices hoisted | ✅ done |
```

and a one-line note under "Where we are now" that the `studio/projects` initiative (11a–11d) has begun.

- [ ] **Step 3: Commit**

```bash
git add stories/inprogress/studio/11a-projects-entity.md stories/inprogress/studio/README.md
git commit -m "docs(studio): story 11a — projects as a first-class entity"
```

---

## Final verification

- [ ] `npm run build` — type-check + bundle clean
- [ ] `npm run lint` — no errors
- [ ] `npm run test:run` — all green
- [ ] Manual: list ↔ workspace navigation, create/rename/delete, two projects each retain their own state across a reload

---

## Self-review notes (for the implementer)

- **Task ordering wrinkle:** Task 1's test imports `freshWorkingState` from the slice (added in Task 2.3). If executing strictly serially, do slice sub-steps 2.1–2.3 before running Task 1's test, or expect Task 1 red until Task 2 lands. Functionally they form one unit.
- **No dispatch sites change** — that's the design's payoff. If you find yourself editing a `dispatch(...)` call, stop: the re-pointed reducer + middleware already handle it.
- **Deleting a project orphans its bucket assets** — intentional; cleanup is story 11c/11d.
- **`crypto.randomUUID()`** is available in all target browsers and jsdom 22+; the reducer never calls it (the page passes the id in), keeping reducers pure and tests deterministic.
