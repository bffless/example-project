# Studio URL routing (Story 11b) — design

> **Initiative:** `studio/projects` (one long-lived branch; see the 11a design doc
> `2026-06-15-studio-projects-entity-design.md`). This is **story 11b**: lift project
> selection and pipeline phase out of Redux flags and into the URL. 11a (entity),
> 11c (GCS per-project layout), 11d (server sync) are the rest.
>
> Read `stories/inprogress/studio/00-architecture-and-state.md` first.

## The problem

After 11a, `/studio` is a single param-less route. Two things that should be in the
URL live only in Redux:

- **Which project** is open — the `activeProjectId` pointer.
- **Which phase** the producer is viewing — derived from the `revisitPrep` / `inExport`
  flags plus readiness (`displayPhase` = `prep` | `build` | `export`).

So there are no shareable/deep-linkable URLs, the browser Back/Forward buttons don't
move between projects or phases, and a reload can't restore "I was on Build of project
X" from the address bar.

## Goal

RESTful, deep-linkable URLs drive navigation. The URL is the **single source of truth**
for which project and which phase; Back/Forward and reload work.

```
/studio                                  → project list
/studio/project/:projectId               → bare; redirects to the project's resume phase
/studio/project/:projectId/:phase        → workspace at phase ∈ {prep, build, export}
```

(`import` is not a URL phase — it's `prep` with no source uploaded yet.)

## Key constraint (do not break 11a)

The slice's `active()` helper — which routes **every** project-scoped write — reads
`state.activeProjectId`. So we do **not** remove that pointer. Instead the URL becomes
the source of truth and a small **sync effect** keeps `state.activeProjectId` mirrored
to the `:projectId` param. All ~41 re-pointed reducers and every dispatch site stay
untouched. `activeProjectId` simply stops being something we rely on across reloads
(the URL restores it).

## Decisions locked in brainstorming

- **URL scheme:** `/studio/project/:projectId/:phase` (the word `project` spelled out).
- **Phase flags removed entirely:** delete `revisitPrep` and `inExport` from
  `ProjectWorkingState`, their reducers, and `freshWorkingState`. The URL `:phase` segment
  (clamped to what readiness allows) is the only source of phase truth.
- **Open default = resume:** opening a project (card click, or bare `/project/:id`)
  redirects to the project's furthest-reached phase, derived from its state.
- **Component split (recommended approach):** extract the list into its own page; render
  the workspace **keyed by `projectId`** so a project switch remounts it — which resets
  transient `file`/`files` state structurally and lets us retire the 11a
  `clearTransientSource` workaround. (Rejected alternative: one param-reading component, no
  split — less churn but keeps the 977-line file, the manual transient-clear, and gives no
  remount isolation.)

## Architecture

### Routing (`src/App.tsx`)

```tsx
<Route path="studio">
  <Route index element={<StudioProjects />} />
  <Route path="project/:projectId" element={<StudioProjectGuard />} />
  <Route path="project/:projectId/:phase" element={<StudioProjectGuard />} />
  <Route path="*" element={<Navigate to="/studio" replace />} />
</Route>
```

Both `project/*` routes render the same `StudioProjectGuard`; it reads the optional
`:phase` (undefined on the bare route).

### `StudioProjectGuard` — redirects, then renders the workspace

Reuses the already-tested `phaseOf(working)` (story 11a) as the canonical readiness
ladder, mapping `import` → `prep`. Pure decision logic lives in a new
`src/lib/studioRoute.ts` so it is unit-tested independently of React Router.

- **Unknown/stale id** (`working[projectId]` missing) → `<Navigate to="/studio" replace />`.
- **Bare `/project/:id`** (no `:phase`) → `<Navigate>` to `/studio/project/:id/<resumePhase>` (replace).
- **`:phase` invalid or ahead of `maxPhaseFor(working)`** → `<Navigate>` to the furthest
  allowed phase (replace).
- **Valid** → render `<Studio key={projectId} projectId={projectId} phase={phase} />`.

These redirects can't loop: a bare or too-far phase resolves to an allowed phase, which
then renders.

### `src/lib/studioRoute.ts` (pure)

```ts
export const URL_PHASES = ['prep', 'build', 'export'] as const
export type UrlPhase = (typeof URL_PHASES)[number]

/** Furthest phase the project may currently show (import collapses to prep). */
export function maxPhaseFor(w: ProjectWorkingState): UrlPhase

/** Resolve a requested :phase against the project's state.
 *  Returns either { phase } (render this) or { redirectTo } (a UrlPhase to Navigate to). */
export function resolvePhase(w: ProjectWorkingState, requested: string | undefined):
  | { phase: UrlPhase }
  | { redirectTo: UrlPhase }
```

`maxPhaseFor` = `phaseOf(w)` with `import` mapped to `prep`. `resolvePhase`:
- `requested` undefined or not a `UrlPhase` → `{ redirectTo: maxPhaseFor(w) }`.
- `requested` ahead of `maxPhaseFor(w)` on the `prep<build<export` ladder → `{ redirectTo: maxPhaseFor(w) }`.
- otherwise → `{ phase: requested }`.

### `Studio.tsx` (the workspace), now param-driven

- Receives `projectId` + `phase` props (already validated by the guard).
- **Sync effect:** `useEffect(() => { dispatch(openProject(projectId)) }, [projectId, dispatch])`
  mirrors the Redux active pointer to the URL. (Runs on mount; the component is keyed by
  `projectId`, so it runs once per project.)
- `displayPhase` = the `phase` prop (no more flag derivation).
- `navigatePhase(p)`, "← Back to prep", "Continue to export", "← Projects" → `useNavigate()`
  calls (`/studio/project/:id/<p>` and `/studio`). `StudioStepper`'s `phase`/`navigable`/
  `onNavigate` API is unchanged; `navigable` derives from `maxPhaseFor`.
- The 11a `clearTransientSource` helper and its handler calls are **removed** — keyed
  remount supersedes them.

### `StudioProjects.tsx` (new list page)

The 11a list branch, moved to its own route component. Uses `selectProjectList` +
`useNavigate`:
- New project → `dispatch(createProject({ id: crypto.randomUUID(), now: Date.now() }))`,
  then `navigate('/studio/project/' + id)` (bare → resume = `prep` for a fresh project).
- Open → `navigate('/studio/project/' + id)`.
- Rename / delete → dispatch as in 11a. `closeProject` is no longer needed from here.

### Slice changes (`src/store/studioSlice.ts`)

Remove `revisitPrep` and `inExport` from `ProjectWorkingState`, delete the
`setRevisitPrep`/`setInExport` reducers and their exports, and drop both from
`freshWorkingState()`. Update tests that referenced them. (`phaseOf` already ignores
`inExport` after the 11a fix, so it is unaffected.)

## Error handling

- Stale/unknown `:projectId` (e.g. localStorage cleared, shared link to a project that
  doesn't exist locally) → redirect to `/studio`. No crash, no error screen (11d may add
  a "fetch from server" path; out of scope here).
- Out-of-range `:phase` → clamp to the furthest allowed phase (never 404 inside a real
  project).
- Unmatched `/studio/*` → redirect to `/studio`.

## Testing

- **Pure (TDD):** `src/lib/studioRoute.test.ts` for `maxPhaseFor` and `resolvePhase`
  across the ladder — fresh project (→ prep), ready-not-built (build allowed, export
  clamped), all-built (export allowed), undefined/garbage phase (→ redirect to max).
- **Component:** a light `MemoryRouter` render test of `StudioProjectGuard`: unknown id →
  redirect to `/studio`; bare id → redirect to resume phase; too-far phase → redirect to
  max; valid phase → renders the workspace.
- All existing `npm run test:run` must stay green; `npm run build` + `npm run lint` pass.

## Scope guard — 11b does NOT

- touch GCS storage paths (11c) or the server (11d);
- remove `activeProjectId` from Redux (it stays, synced from the URL — removing it would
  break the `active()` write routing);
- change the prep/build/export view internals beyond how the phase is selected.

## Files

- **New:** `src/pages/StudioProjects.tsx`, `src/lib/studioRoute.ts` + `studioRoute.test.ts`,
  `StudioProjectGuard` (in `Studio.tsx` or its own small file).
- **Modified:** `src/App.tsx` (nested routes), `src/pages/Studio.tsx` (param-driven phase,
  navigate-based nav, sync effect, retire `clearTransientSource`), `src/store/studioSlice.ts`
  (drop the two flags) + `studioSlice.test.ts`, `stories/inprogress/studio/` (story 11b +
  README row).

## Acceptance

- `/studio` lists projects; clicking one navigates to `/studio/project/:id/<resumePhase>`.
- The stepper and the back/continue buttons change the URL; browser Back/Forward move
  between phases (and projects).
- Deep-linking `/studio/project/:id/build` on a ready project opens Build; on a not-ready
  project redirects to `prep`; on an unknown id redirects to `/studio`.
- A hard reload restores the exact project + phase from the URL.
- Switching projects does not bleed one project's in-memory clip into another (keyed
  remount).
- `npm run build`, `npm run lint`, `npm run test:run` all pass.
