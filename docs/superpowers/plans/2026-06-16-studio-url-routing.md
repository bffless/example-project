# Studio URL Routing (Story 11b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the URL the source of truth for which Studio project and which pipeline phase are showing — `/studio/project/:projectId/:phase` — with deep links, Back/Forward, and reload all working.

**Architecture:** Nested React Router routes under `/studio`. A `StudioProjectGuard` validates the `:projectId` (redirect to the list if unknown), syncs Redux `activeProjectId` from the URL (so 11a's `active()` write-routing is untouched), and clamps/resolves the `:phase` against the project's readiness ladder (reusing `phaseOf`) before rendering the workspace **keyed by projectId**. The `revisitPrep`/`inExport` Redux flags are removed; phase navigation becomes `navigate()` calls.

**Tech Stack:** React 19, React Router v7 (already installed), Redux Toolkit, TypeScript, Vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-16-studio-url-routing-design.md`
**Branch:** `studio/projects` (the initiative branch — already checked out).

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/lib/studioRoute.ts` | Pure phase-ladder helpers: `UrlPhase`, `maxPhaseFor`, `resolvePhase` | **create** |
| `src/lib/studioRoute.test.ts` | Unit tests for the above | **create** |
| `src/store/studioSlice.ts` | Remove `revisitPrep`/`inExport` (fields, reducers, exports, `freshWorkingState`) | **modify** |
| `src/store/studioSlice.test.ts` | Drop assertions on the removed flags if any | **modify (maybe)** |
| `src/pages/StudioProjects.tsx` | The project-list landing page (navigate-based) | **create** |
| `src/pages/StudioProjectGuard.tsx` | Param validation + active-sync + phase resolve, renders keyed `<Studio>` | **create** |
| `src/pages/Studio.tsx` | Becomes the workspace: `{projectId, phase}` props, navigate-based nav, no flags, no list branch | **modify (major)** |
| `src/App.tsx` | Nested `/studio` routes | **modify** |
| `stories/inprogress/studio/11b-url-routing.md` + `README.md` | Story doc + status row | **create/modify** |

---

## Task 1: Pure phase-ladder helpers

**Files:** Create `src/lib/studioRoute.ts`; Test `src/lib/studioRoute.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/studioRoute.test.ts
import { describe, it, expect } from 'vitest'
import { maxPhaseFor, resolvePhase } from './studioRoute'
import { freshWorkingState } from '../store/studioSlice'

// A working state with one fully-prepped source and N scenes (built or not).
function prepped(opts: { built?: boolean } = {}) {
  const w = freshWorkingState()
  w.sources = [{ id: 's1', order: 0, fileName: 'a.mp4', duration: 10, sourceUrl: 'u', audioUrl: 'a', audioPeaks: [], words: [], transcribeJobId: null, stageProgress: { upload: { status: 'done' }, extract: { status: 'done' }, transcribe: { status: 'done' } } }]
  for (const id of ['thumbnails', 'clone', 'director'] as const) w.stageProgress[id] = { status: 'done' }
  w.scenes = [{ id: 'sc1', status: opts.built ? 'built' : 'pending' } as never]
  return w
}

describe('maxPhaseFor', () => {
  it('is prep for a fresh project (no source)', () => {
    expect(maxPhaseFor(freshWorkingState())).toBe('prep')
  })
  it('is build when prepped but not all scenes built', () => {
    expect(maxPhaseFor(prepped())).toBe('build')
  })
  it('is export when every scene is built', () => {
    expect(maxPhaseFor(prepped({ built: true }))).toBe('export')
  })
})

describe('resolvePhase', () => {
  it('redirects an undefined phase to the furthest reached', () => {
    expect(resolvePhase(prepped(), undefined)).toEqual({ redirectTo: 'build' })
  })
  it('redirects a garbage phase to the furthest reached', () => {
    expect(resolvePhase(freshWorkingState(), 'nonsense')).toEqual({ redirectTo: 'prep' })
  })
  it('clamps a too-far phase down to the max', () => {
    expect(resolvePhase(freshWorkingState(), 'build')).toEqual({ redirectTo: 'prep' })
    expect(resolvePhase(prepped(), 'export')).toEqual({ redirectTo: 'build' })
  })
  it('renders an allowed phase as-is', () => {
    expect(resolvePhase(prepped(), 'prep')).toEqual({ phase: 'prep' })
    expect(resolvePhase(prepped(), 'build')).toEqual({ phase: 'build' })
    expect(resolvePhase(prepped({ built: true }), 'export')).toEqual({ phase: 'export' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/studioRoute.test.ts`
Expected: FAIL — `Cannot find module './studioRoute'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/studioRoute.ts
import type { ProjectWorkingState } from '../store/studioSlice'
import { phaseOf } from './projects'

/** The phases that appear in the URL. `import` (story 11a's phaseOf result for a
 *  source-less project) collapses to `prep` — there is no `import` URL. */
export const URL_PHASES = ['prep', 'build', 'export'] as const
export type UrlPhase = (typeof URL_PHASES)[number]

const isUrlPhase = (v: string | undefined): v is UrlPhase =>
  v !== undefined && (URL_PHASES as readonly string[]).includes(v)

/** Furthest phase the project may currently show, on the prep<build<export ladder. */
export function maxPhaseFor(w: ProjectWorkingState): UrlPhase {
  const p = phaseOf(w) // 'import' | 'prep' | 'build' | 'export'
  return p === 'import' ? 'prep' : p
}

/** Resolve a requested URL phase against the project's state: either render it
 *  (`{ phase }`) or redirect (`{ redirectTo }`) to the furthest allowed phase. */
export function resolvePhase(
  w: ProjectWorkingState,
  requested: string | undefined,
): { phase: UrlPhase } | { redirectTo: UrlPhase } {
  const max = maxPhaseFor(w)
  if (!isUrlPhase(requested)) return { redirectTo: max }
  if (URL_PHASES.indexOf(requested) > URL_PHASES.indexOf(max)) return { redirectTo: max }
  return { phase: requested }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/studioRoute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/studioRoute.ts src/lib/studioRoute.test.ts
git commit -m "feat(studio): pure phase-ladder route helpers (maxPhaseFor, resolvePhase)"
```

---

## Task 2: Remove the revisitPrep / inExport flags from the slice

**Files:** Modify `src/store/studioSlice.ts`; maybe `src/store/studioSlice.test.ts`

The URL now owns phase. NOTE: `npm run build` will FAIL after this task because `Studio.tsx` still reads/dispatches these — that's expected and fixed in Task 5. Verify the slice in isolation.

- [ ] **Step 1: Remove the fields from `ProjectWorkingState`**

Delete the `revisitPrep: boolean` and `inExport: boolean` fields (and their doc-comment blocks) from the `ProjectWorkingState` type. Leave `planRevealed` (unrelated — it gates the plan reveal, not phase).

- [ ] **Step 2: Remove them from `freshWorkingState()`**

Delete the `revisitPrep: false,` and `inExport: false,` lines from the object returned by `freshWorkingState()`.

- [ ] **Step 3: Delete the reducers + exports**

Remove the `setRevisitPrep` and `setInExport` reducer definitions from the `reducers` object, and remove `setRevisitPrep, setInExport,` from the destructured `export { ... } = studioSlice.actions` block.

- [ ] **Step 4: Check the slice test**

Run `grep -n "revisitPrep\|inExport\|setRevisitPrep\|setInExport" src/store/studioSlice.test.ts`. If any test references them, update/remove those assertions (none are expected from story 11a). Run:
`npx vitest run src/store/studioSlice.test.ts` → must pass.

- [ ] **Step 5: Verify the slice type-checks in isolation**

Run `npx eslint src/store/studioSlice.ts` (clean) and `npx tsc --noEmit -p tsconfig.app.json`. Expect errors ONLY in `src/pages/Studio.tsx` (it still uses the removed symbols) — that's expected; do not fix it here. There must be NO error originating inside `studioSlice.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/store/studioSlice.ts src/store/studioSlice.test.ts
git commit -m "refactor(studio): drop revisitPrep/inExport flags (phase moves to the URL)"
```

---

## Task 3: The project-list landing page

**Files:** Create `src/pages/StudioProjects.tsx`

A standalone page rendered at `/studio` (index). Reuses the presentational `ProjectList` from story 11a; create/open navigate to the project URL.

- [ ] **Step 1: Write the component**

```tsx
// src/pages/StudioProjects.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHero } from '../components/PageHero'
import { Section } from '../components/Section'
import { Dot } from '../components/Dot'
import { ProjectList } from '../components/Studio/ProjectList'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { createProject, deleteProject, renameProject, selectProjectList } from '../store/studioSlice'

export function StudioProjects() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const projects = useAppSelector(selectProjectList)
  // Mount-time clock for "edited X ago" — reading Date.now() in render is impure
  // (react-hooks/purity); a state initializer runs once and keeps render pure.
  const [now] = useState(() => Date.now())

  const onNew = () => {
    const id = crypto.randomUUID()
    dispatch(createProject({ id, now: Date.now() }))
    navigate(`/studio/project/${id}`)
  }
  const onOpen = (id: string) => navigate(`/studio/project/${id}`)
  const onRename = (id: string, name: string) => dispatch(renameProject({ id, name, now: Date.now() }))
  const onDelete = (id: string) => dispatch(deleteProject(id))

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
          now={now}
          onNew={onNew}
          onOpen={onOpen}
          onRename={onRename}
          onDelete={onDelete}
        />
      </Section>
    </>
  )
}
```

- [ ] **Step 2: Verify the import paths**

Confirm `PageHero`, `Section`, `Dot` are imported from the same paths `Studio.tsx` uses (check the top of `src/pages/Studio.tsx`; adjust the three import lines if the real paths differ, e.g. they may live under `../components/...` with different names). Then `npx eslint src/pages/StudioProjects.tsx` and `npx tsc --noEmit -p tsconfig.app.json` — the new file must have no errors of its own (Studio.tsx errors from Task 2 are still expected).

- [ ] **Step 3: Commit**

```bash
git add src/pages/StudioProjects.tsx
git commit -m "feat(studio): standalone project-list landing page"
```

---

## Task 4: Convert Studio.tsx into the param-driven workspace

**Files:** Modify `src/pages/Studio.tsx`

This is the biggest task. `Studio` stops owning project selection and phase flags; it takes `{ projectId, phase }` props (the guard validated them) and navigates for all transitions. Read the whole component first.

- [ ] **Step 1: Change the signature + imports**

Change `export function Studio() {` to:
```tsx
import { useNavigate } from 'react-router-dom'
import type { UrlPhase } from '../lib/studioRoute'
// ...
export function Studio({ projectId, phase }: { projectId: string; phase: UrlPhase }) {
  const navigate = useNavigate()
```
Update the `../store/studioSlice` import line: REMOVE `setRevisitPrep, setInExport, createProject, openProject, closeProject, renameProject, deleteProject, selectActiveProjectId, selectProjectList` (no longer used here). KEEP `selectActive, setDiarize, setDirection, setDuration, setFileName, addSource, reorderSources, removeSource` and anything else still referenced.

- [ ] **Step 2: Delete the project-management glue**

Remove these now-unused pieces from the component body:
- the `activeProjectId` and `projects` selectors,
- the `onNewProject` / `onOpenProject` / `onCloseProject` / `onRenameProject` / `onDeleteProject` handlers,
- the `revisitPrep` and `inExport` selectors,
- the entire `if (!activeProjectId) { return (...) }` list branch (it lives in `StudioProjects` now).

KEEP `clearTransientSource` — it's still used by `startOver` (see Step 6). KEEP the `now` state only if still used; if nothing references `now` after removing the list branch, delete the `const [now] = useState(() => Date.now())` line too (check with grep before removing).

- [ ] **Step 3: Add the active-project sync is handled by the guard, not here**

Do NOT add an openProject effect here — the `StudioProjectGuard` (Task 5) syncs `activeProjectId` before mounting this component and only mounts it once `activeProjectId === projectId`. This component reads its data through `selectActive` as before, which is now guaranteed to be the right project.

- [ ] **Step 4: Replace the phase derivation**

Find:
```tsx
const inPrep = !pipe.ready || revisitPrep
const displayPhase: StudioPhase = inPrep ? 'prep' : pipe.allBuilt && inExport ? 'export' : 'build'
```
Replace with:
```tsx
const displayPhase: StudioPhase = phase
const inPrep = phase === 'prep'
```
(The guard guarantees `phase` is allowed, so `phase === 'build'` only happens when prep is ready, etc.) Keep the existing `const phase = studioPhase({...})` line ABOVE — RENAME that local to avoid colliding with the new `phase` prop: call it `const stepperPhase = studioPhase({ hasSource, ready: pipe.ready, allBuilt: pipe.allBuilt })` and update its one use in the empty-import stepper (Step 7).

- [ ] **Step 5: Replace `navigatePhase`**

Find the `navigatePhase` function (it dispatches the flags) and replace its body:
```tsx
function navigatePhase(p: StudioPhase) {
  navigate(`/studio/project/${projectId}/${p}`)
}
```
Leave `navigablePhases` as-is (it already derives the ladder from `pipe.ready`/`pipe.allBuilt`). Also update the cast voice wrappers `castCloneForPerson`/`castPickPresetForPerson`/`castReuseForPerson`: DELETE their `dispatch(setRevisitPrep(true))` line — they should just call the `pipe.*` method (the producer is already on the prep URL when using the voice step, so no phase nudge is needed).

- [ ] **Step 6: Fix `startOver`**

Replace:
```tsx
function startOver() {
  clearTransientSource()
  // pipe.reset() dispatches resetProject, which already clears revisitPrep.
  pipe.reset()
}
```
with:
```tsx
function startOver() {
  clearTransientSource()        // same project, no remount → clear transient bytes manually
  pipe.reset()                  // dispatches resetProject (fresh working state)
  navigate(`/studio/project/${projectId}/prep`)  // reset project's resume phase
}
```

- [ ] **Step 7: Rewire the navigation buttons (JSX)**

Apply these exact replacements in the render:

1. Empty-import stepper (was `<StudioStepper phase={phase} />`): `<StudioStepper phase={stepperPhase} />`.
2. The "← Back to prep" button — change its guard and onClick:
   - condition `pipe.ready && !revisitPrep` → `pipe.ready && phase !== 'prep'`
   - `onClick={() => dispatch(setRevisitPrep(true))}` → `onClick={() => navigatePhase('prep')}`
3. The "← Projects" button: `onClick={onCloseProject}` → `onClick={() => navigate('/studio')}`.
4. "Continue to build →" button: `onClick={() => { dispatch(setRevisitPrep(false)); dispatch(setInExport(false)) }}` → `onClick={() => navigatePhase('build')}`.
5. The export-phase guard `) : displayPhase === 'export' ? (` stays (it reads `displayPhase`, now = `phase`). "← Back to build" button: `onClick={() => dispatch(setInExport(false))}` → `onClick={() => navigatePhase('build')}`.
6. "Continue to export →" button: `onClick={() => { dispatch(setRevisitPrep(false)); dispatch(setInExport(true)) }}` → `onClick={() => navigatePhase('export')}` (keep its `disabled={!pipe.allBuilt}`).

- [ ] **Step 8: Verify**

Run `npx eslint src/pages/Studio.tsx` (fix any unused imports/vars it flags — e.g. leftover `StudioPhase` import is still used by `displayPhase`/`navigatePhase`; `setRevisitPrep`/`setInExport` must be gone). The whole app still won't build until Task 5 wires the routes, but `Studio.tsx` itself must be eslint-clean and free of references to removed symbols. Confirm with `grep -n "revisitPrep\|inExport\|activeProjectId\|onCloseProject\|selectProjectList" src/pages/Studio.tsx` → no hits.

- [ ] **Step 9: Commit**

```bash
git add src/pages/Studio.tsx
git commit -m "refactor(studio): workspace is param-driven (projectId/phase props, navigate-based nav)"
```

---

## Task 5: The route guard + nested routes (wires it together)

**Files:** Create `src/pages/StudioProjectGuard.tsx`; Modify `src/App.tsx`

After this task the whole app compiles and works.

- [ ] **Step 1: Write the guard**

```tsx
// src/pages/StudioProjectGuard.tsx
import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { openProject, selectActiveProjectId } from '../store/studioSlice'
import { resolvePhase } from '../lib/studioRoute'
import { Studio } from './Studio'

/**
 * Owns the URL→state contract for a single project:
 * - unknown/stale :projectId → back to the list,
 * - syncs Redux `activeProjectId` from the URL (so the slice's active() write-
 *   routing keeps working) and waits for it before mounting the workspace,
 * - resolves/clamps :phase against the project's readiness ladder.
 * The workspace is keyed by projectId so switching projects remounts it (resets
 * transient in-memory clip state).
 */
export function StudioProjectGuard() {
  const { projectId, phase } = useParams()
  const dispatch = useAppDispatch()
  const working = useAppSelector((s) => (projectId ? s.studio.working[projectId] : undefined))
  const activeProjectId = useAppSelector(selectActiveProjectId)

  useEffect(() => {
    if (projectId && working && activeProjectId !== projectId) dispatch(openProject(projectId))
  }, [projectId, working, activeProjectId, dispatch])

  if (!projectId || !working) return <Navigate to="/studio" replace />

  const resolved = resolvePhase(working, phase)
  if ('redirectTo' in resolved) {
    return <Navigate to={`/studio/project/${projectId}/${resolved.redirectTo}`} replace />
  }
  // Wait one render for the sync effect to point the active project at the URL,
  // so the workspace's selectActive reads the right project from its first render.
  if (activeProjectId !== projectId) return null
  return <Studio key={projectId} projectId={projectId} phase={resolved.phase} />
}
```

- [ ] **Step 2: Update `src/App.tsx`**

Replace the single studio route. New imports + routes:
```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
// ...existing page imports...
import { StudioProjects } from './pages/StudioProjects'
import { StudioProjectGuard } from './pages/StudioProjectGuard'
```
Replace `<Route path="studio" element={<Studio />} />` (and remove the now-unused `import { Studio } from './pages/Studio'` line — `Studio` is imported by the guard now) with:
```tsx
<Route path="studio">
  <Route index element={<StudioProjects />} />
  <Route path="project/:projectId" element={<StudioProjectGuard />} />
  <Route path="project/:projectId/:phase" element={<StudioProjectGuard />} />
  <Route path="*" element={<Navigate to="/studio" replace />} />
</Route>
```

- [ ] **Step 3: Verify the whole app**

Run: `npm run build` (PASS), `npm run lint` (clean), `npm run test:run` (all pass).
Fix any leftover unused imports (e.g. `Studio` no longer imported in App.tsx).

- [ ] **Step 4: Commit**

```bash
git add src/pages/StudioProjectGuard.tsx src/App.tsx
git commit -m "feat(studio): nested /studio routes + project guard (URL drives project + phase)"
```

---

## Task 6: Guard redirect tests + manual smoke

**Files:** Create `src/pages/StudioProjectGuard.test.tsx`

Test only the redirect branches (they return `<Navigate>` before mounting the heavy `<Studio>` workspace). The valid-render path is covered indirectly by `resolvePhase` unit tests; do not mount `Studio` in a unit test.

- [ ] **Step 1: Write the test**

```tsx
// src/pages/StudioProjectGuard.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'
import studioReducer, { createProject } from '../store/studioSlice'
import { StudioProjectGuard } from './StudioProjectGuard'

function renderAt(path: string, seed?: (dispatch: ReturnType<typeof makeStore>['dispatch']) => void) {
  const store = makeStore()
  if (seed) seed(store.dispatch)
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/studio" element={<div>LIST</div>} />
          <Route path="/studio/project/:projectId/prep" element={<div>PREP-STUB</div>} />
          <Route path="/studio/project/:projectId/:phase" element={<StudioProjectGuard />} />
          <Route path="/studio/project/:projectId" element={<StudioProjectGuard />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
}
function makeStore() {
  return configureStore({ reducer: { studio: studioReducer } })
}

describe('StudioProjectGuard redirects', () => {
  it('unknown project id → back to the list', () => {
    renderAt('/studio/project/nope/build')
    expect(screen.getByText('LIST')).toBeInTheDocument()
  })
  it('bare project url → resume (prep for a fresh project)', () => {
    renderAt('/studio/project/p1', (d) => d(createProject({ id: 'p1', now: 1 })))
    expect(screen.getByText('PREP-STUB')).toBeInTheDocument()
  })
  it('phase ahead of readiness clamps down to prep', () => {
    renderAt('/studio/project/p1/build', (d) => d(createProject({ id: 'p1', now: 1 })))
    expect(screen.getByText('PREP-STUB')).toBeInTheDocument()
  })
})
```

Note: the static `/prep` route outranks the `:phase` route in React Router, so the guard's redirect to `…/p1/prep` lands on the stub instead of re-entering the guard (and never mounts `Studio`). For `createProject`-seeded `p1`, `maxPhaseFor` is `prep`, so `/build` clamps and bare resolves to `prep`.

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/pages/StudioProjectGuard.test.tsx`
Expected: PASS (3 tests). If `react-router-dom`'s route ranking surprises you and the guard re-enters itself, the redirect target is still `prep` and stable — but the stub assertion confirms no loop.

- [ ] **Step 3: Full gates**

Run: `npm run build && npm run lint && npm run test:run` — all pass; note the test count.

- [ ] **Step 4: Manual smoke (reason through / optional dev run)**

`npm run dev`, then verify: `/studio` lists projects → click one → URL becomes `/studio/project/<id>/prep` (or resume) → stepper/Back/Continue change the URL → browser Back works → reload on `/studio/project/<id>/build` restores Build (or redirects to prep if not ready) → editing the address to an unknown id bounces to `/studio` → switching projects doesn't show the previous clip.

- [ ] **Step 5: Commit**

```bash
git add src/pages/StudioProjectGuard.test.tsx
git commit -m "test(studio): route guard redirect cases (unknown id, resume, clamp)"
```

---

## Task 7: Story doc + README

**Files:** Create `stories/inprogress/studio/11b-url-routing.md`; Modify `stories/inprogress/studio/README.md`

- [ ] **Step 1: Write the story file** mirroring `11a-projects-entity.md`'s format: blockquote header pointing at this plan + the spec and "read 00-architecture-and-state.md first"; **Status:** ✅ shipped (2026-06-16, branch `studio/projects`); **Why** (deep links / Back-Forward / reload-restore were impossible with Redux-only navigation); **What shipped** (`/studio/project/:id/:phase`, `StudioProjectGuard` with active-sync + phase clamp reusing `phaseOf`, keyed workspace remount, `revisitPrep`/`inExport` removed, `studioRoute.ts` helpers); **Scope guard** (no GCS/server; `activeProjectId` kept, synced from URL); a short file map.

- [ ] **Step 2: Update the README**

Add to the "Order & status" table:
```
| 11b | `11b-url-routing.md` | URL-driven routing — /studio/project/:id/:phase · guard (active-sync + phase clamp) · keyed remount · revisitPrep/inExport removed | ✅ done |
```
And update the `studio/projects` note under "📍 Where we are now": 11a + 11b shipped; 11c (GCS per-project layout) and 11d (server sync) queued.

- [ ] **Step 3: Commit**

```bash
git add stories/inprogress/studio/11b-url-routing.md stories/inprogress/studio/README.md
git commit -m "docs(studio): story 11b — URL-driven routing"
```

---

## Final verification

- [ ] `npm run build` · `npm run lint` · `npm run test:run` all green
- [ ] Manual: list ↔ project ↔ phase navigation via URL, Back/Forward, reload-restore, unknown-id redirect, no cross-project clip bleed

---

## Self-review notes (for the implementer)

- **App won't compile between Task 2 and Task 5** — that's the intended seam (flags removed before the consumer is rewired). Each task is independently committed; the build goes green at Task 5.
- **`clearTransientSource` is NOT fully retired** (the spec's wording was optimistic): keyed remount covers project *switches*, but `startOver` resets the *same* project (no remount), so it still clears transient bytes manually and navigates to the reset resume phase.
- **`phaseOf` is the single ladder** — `maxPhaseFor` just maps its `import` result to `prep`. Don't re-derive readiness anywhere else.
- **The guard's `return null` is a one-render gate** while the active-project sync settles; it prevents the workspace's `selectActive` from reading a stale project on first paint.
