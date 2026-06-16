# Studio Server-Side Project Sync (Story 11d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. For the BFFless schema + rule work, also use the **bffless-pipeline** skill.

**Goal:** Persist Studio projects on the server (a `studio_projects` data schema + `/api/projects` CRUD) and sync local↔server so the server is the durable home and localStorage caches only the active project.

**Architecture:** Server-home, active-only-local. The list loads from the server; opening a project hydrates its working state; edits debounce-autosave and flush on exit; non-active working state is evicted (leveraging 11b's keyed-by-projectId workspace remount). Last-write-wins by `updatedAt`. No clean-slate — local-only projects are pushed up.

**Tech Stack:** React 19, Redux Toolkit / RTK Query, TypeScript, Vitest, MSW; BFFless data schema + `data_create`/`data_query`/`data_update`/`data_delete` pipeline handlers (edited via the `bffless-j5s` MCP).

**Spec:** `docs/superpowers/specs/2026-06-16-studio-server-sync-design.md`
**Branch:** `studio/projects` (initiative branch — already checked out).

## BFFless coordinates
- Project id: `8c452c73-0590-4422-b474-779929916600` (`example-project`); `studio` rule set: `cf413ff6-4989-44a6-afc9-75c3545b5e8e` (attached to `production`, reachable at `https://j5s.dev`).
- Model the CRUD on the existing **jobs** schema `acdca97c-f9cc-4469-90a3-676a242924cb` and its rules: `data_create` `{ schemaId, fields: { name: "expression" } }` (e.g. `"kind": "'transcribe'"`, `"request": "request.body"`); `data_query` `{ schemaId, recordId: "request.query.id" }`. Inspect via MCP `get_pipeline_schema` / the saved rule set.

## Current code (verified)
- Slice (`src/store/studioSlice.ts`): `index: Record<string, ProjectMeta>`, `working: Record<string, ProjectWorkingState>`, `activeProjectId`, `savedVoices`. `freshWorkingState()`, `active()`, `createProject({id,now})`, `openProject`, `renameProject`, `deleteProject`, `resetProject`, `_syncMeta` reducers; selectors `selectActive`, `selectActiveProjectId`, `selectProjectList`, `EMPTY_WORKING`. `ProjectMeta = { id, name, createdAt, updatedAt, phase, thumbnailUrl }` (in `src/lib/projects.ts`).
- API (`src/store/studioApi.ts`): `createApi`, `baseQuery: fetchBaseQuery({ baseUrl: '/', credentials: 'include' })`; mutations/queries + an `export const { useXMutation, ... } = studioApi` hooks block.
- `StudioProjects.tsx`, `StudioProjectGuard.tsx` (current: redirect when working missing), `Studio.tsx` (workspace, keyed by projectId).

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| BFFless: `studio_projects` schema + `/api/projects*` rules | server persistence | **create** (MCP) |
| `src/lib/projectSync.ts` | pure: reconcile/pickNewer/serialize | **create** |
| `src/lib/projectSync.test.ts` | tests | **create** |
| `src/store/studioSlice.ts` | `hydrateProject`/`evictWorking`/`reconcileIndex` reducers | **modify** |
| `src/store/studioApi.ts` | `listProjects`/`getProject`/`createProjectRecord`/`saveProject` + delete extension | **modify** |
| `src/components/Studio/useProjectAutosave.ts` | debounced save + flush/evict on exit | **create** |
| `src/pages/StudioProjects.tsx` | list from server + reconcile + states; create-on-server | **modify** |
| `src/pages/StudioProjectGuard.tsx` | hydrate-or-redirect | **modify** |
| `src/pages/Studio.tsx` | autosave hook + save indicator | **modify** |
| `src/mocks/handlers.ts` | CRUD mocks (in-memory store) | **modify** |
| story doc + README | docs | **create/modify** |

---

## PART 1 — server foundation (MCP + live verify)

### Task 1: SPIKE — `studio_projects` schema + create/get rules, keyed by our project id

The key unknown: can a record be keyed by **our** 11a project id (so get/update/delete use `recordId = projectId`)? Resolve it before building the rest.

- [ ] **Step 1:** Load MCP tools (ToolSearch): `create_pipeline_schema`, `get_pipeline_schema`, `list_pipeline_schemas`, `create_proxy_rule`, `get_proxy_rule`, `update_proxy_rule`. Inspect the jobs schema (`get_pipeline_schema acdca97c-...`) as the model.
- [ ] **Step 2:** Create a `studio_projects` schema with fields: `name` (string), `createdAt` (number), `updatedAt` (number), `phase` (string), `thumbnailUrl` (string, nullable), `data` (string/text — the JSON blob). Record the new `schemaId`.
- [ ] **Step 3:** Create `POST /api/projects` (studio rule set, validators `[]`): a `data_create` step with `fields` mapping each column from `request.body.*` (`name`, `createdAt`, `updatedAt`, `phase`, `thumbnailUrl`, `data`), then a `response_handler` returning the created record. **Attempt to key the record by our id:** set `fields.id = "request.body.id"` (or whatever the schema requires to use a client-supplied primary id). Create `GET /api/projects/:id` (or `?id=`): a `data_query` with `recordId` = the path/query id + a `function_handler` to parse `data` back to an object + response.
- [ ] **Step 4: LIVE verify** against `https://j5s.dev` (auth off):
  ```bash
  curl -sS -X POST https://j5s.dev/api/projects -H 'Content-Type: application/json' \
    -d '{"id":"sync-spike","name":"Spike","createdAt":1,"updatedAt":1,"phase":"prep","thumbnailUrl":null,"data":"{\"scenes\":[]}"}'
  curl -sS "https://j5s.dev/api/projects/sync-spike"   # or ?id=sync-spike, matching the rule
  ```
  Confirm the GET returns the record with `id: "sync-spike"` and the `data` field. **If a client-supplied `id` is NOT honored** (the record gets an auto id), switch the design to a `projectId` field on the schema and query/update/delete by a **filter** on `projectId` instead of `recordId` — record the working approach in the commit body; it propagates to Task 2. **If neither keying nor filtering works, STOP / BLOCKED.**
- [ ] **Step 5:** `npm run build && npm run lint && npm run test:run` (no app change yet — confirm nothing regressed). Commit `git commit --allow-empty -m "spike(studio): studio_projects schema + create/get rules, keyed by project id (verified live)"` with the schemaId, rule ids, and the keying approach in the body.

### Task 2: list / update / delete rules

Using the keying approach proven in Task 1:
- [ ] **Step 1:** `GET /api/projects` — a `data_query` that lists ALL `studio_projects` records, then a `function_handler` `shape` that maps each to `{ id, name, createdAt, updatedAt, phase, thumbnailUrl }` (drop the heavy `data` field from the list payload), then response. (If `data_query` can't list-all or can't project fields, note it; returning full records is acceptable fallback — flag the bandwidth.)
- [ ] **Step 2:** `PUT /api/projects/:id` — a `data_update` keyed by the id (recordId or filter, per Task 1) writing `name`, `updatedAt`, `phase`, `thumbnailUrl`, `data` from `request.body.*`; response returns the updated record.
- [ ] **Step 3:** Extend the existing `POST /api/projects/delete` rule (11c, id `67359cca-...`): after the `file_delete` step, add a `data_delete` step removing the `studio_projects` record by id (per Task 1 keying), then keep the response. Use `update_proxy_rule`.
- [ ] **Step 4: LIVE verify:** list (`GET /api/projects` includes `sync-spike`, no `data` field if projected); update (`PUT /api/projects/sync-spike` with new name → GET shows it); delete (`POST /api/projects/delete {"projectId":"sync-spike"}` → GET 404 / list excludes it). Clean up the `sync-spike` record.
- [ ] **Step 5:** build/lint/test green; commit `--allow-empty` with the verified round-trips in the body.

---

## PART 2 — pure logic, slice, RTK

### Task 3: pure `projectSync.ts`

**Files:** Create `src/lib/projectSync.ts`, `src/lib/projectSync.test.ts`.

- [ ] **Step 1: failing test**
```ts
// src/lib/projectSync.test.ts
import { describe, it, expect } from 'vitest'
import { reconcileIndex, pickNewer, toServerRecord, fromServerRecord } from './projectSync'
import { freshWorkingState } from '../store/studioSlice'
import type { ProjectMeta } from './projects'

const meta = (id: string, updatedAt: number, name = id): ProjectMeta =>
  ({ id, name, createdAt: 1, updatedAt, phase: 'prep', thumbnailUrl: null })

describe('reconcileIndex', () => {
  it('adds server-only projects', () => {
    const out = reconcileIndex({}, [meta('a', 5)])
    expect(out.a.name).toBe('a')
  })
  it('keeps local-only projects (unsynced)', () => {
    const out = reconcileIndex({ a: meta('a', 5) }, [])
    expect(out.a).toBeDefined()
  })
  it('takes the newer meta by updatedAt (server newer)', () => {
    const out = reconcileIndex({ a: meta('a', 5, 'old') }, [meta('a', 9, 'new')])
    expect(out.a.name).toBe('new')
  })
  it('keeps local when local is newer', () => {
    const out = reconcileIndex({ a: meta('a', 9, 'local') }, [meta('a', 5, 'server')])
    expect(out.a.name).toBe('local')
  })
})

describe('pickNewer', () => {
  it('returns whichever updatedAt is larger', () => {
    expect(pickNewer(meta('a', 5), meta('a', 9)).updatedAt).toBe(9)
    expect(pickNewer(meta('a', 9), meta('a', 5)).updatedAt).toBe(9)
  })
})

describe('server record round-trip', () => {
  it('serializes meta + working to a record and back', () => {
    const w = freshWorkingState(); w.direction = 'hi'
    const rec = toServerRecord(meta('a', 5, 'A'), w)
    expect(typeof rec.data).toBe('string')
    expect(rec.id).toBe('a'); expect(rec.name).toBe('A')
    const back = fromServerRecord(rec)
    expect(back.meta.id).toBe('a'); expect(back.meta.name).toBe('A')
    expect(back.working.direction).toBe('hi')
  })
  it('fromServerRecord tolerates a bad data blob (returns fresh working)', () => {
    const back = fromServerRecord({ id: 'a', name: 'A', createdAt: 1, updatedAt: 5, phase: 'prep', thumbnailUrl: null, data: 'not json' })
    expect(back.working).toBeTruthy()
    expect(Array.isArray(back.working.scenes)).toBe(true)
  })
})
```
- [ ] **Step 2:** run `npx vitest run src/lib/projectSync.test.ts` → FAIL (module missing).
- [ ] **Step 3: implement**
```ts
// src/lib/projectSync.ts
import type { ProjectMeta } from './projects'
import type { ProjectWorkingState } from '../store/studioSlice'
import { freshWorkingState } from '../store/studioSlice'

/** The server record shape (studio_projects). `data` is JSON.stringify(working). */
export type ProjectRecord = ProjectMeta & { data: string }

export const pickNewer = (a: ProjectMeta, b: ProjectMeta): ProjectMeta =>
  b.updatedAt > a.updatedAt ? b : a

/** Merge the server's project metas into the local index: add server-only, refresh
 *  by newer updatedAt, keep local-only entries (unsynced). */
export function reconcileIndex(
  local: Record<string, ProjectMeta>,
  server: ProjectMeta[],
): Record<string, ProjectMeta> {
  const out: Record<string, ProjectMeta> = { ...local }
  for (const s of server) {
    const l = out[s.id]
    out[s.id] = l ? pickNewer(l, s) : s
  }
  return out
}

const META_KEYS = ['id', 'name', 'createdAt', 'updatedAt', 'phase', 'thumbnailUrl'] as const

export function toServerRecord(meta: ProjectMeta, working: ProjectWorkingState): ProjectRecord {
  return { ...meta, data: JSON.stringify(working) }
}

export function fromServerRecord(rec: ProjectRecord): { meta: ProjectMeta; working: ProjectWorkingState } {
  const meta = {} as ProjectMeta
  for (const k of META_KEYS) (meta as Record<string, unknown>)[k] = rec[k]
  let working: ProjectWorkingState
  try {
    working = { ...freshWorkingState(), ...(JSON.parse(rec.data) as Partial<ProjectWorkingState>) }
  } catch {
    working = freshWorkingState()
  }
  return { meta, working }
}
```
- [ ] **Step 4:** run the test → PASS. `npx eslint src/lib/projectSync.ts` clean.
- [ ] **Step 5:** commit `feat(studio): pure project-sync helpers (reconcileIndex, server record round-trip)`.

### Task 4: slice reducers `hydrateProject` / `evictWorking` / `reconcileIndex`

**Files:** Modify `src/store/studioSlice.ts`; Test `src/store/studioSlice.test.ts`.

- [ ] **Step 1: failing test** (append):
```ts
import reducer, { hydrateProject, evictWorking, reconcileServerIndex, freshWorkingState, createProject, type StudioState } from './studioSlice'

describe('server-sync reducers', () => {
  it('hydrateProject fills working[id] from a server copy', () => {
    let s = reducer(undefined, createProject({ id: 'p1', now: 1 }))
    const w = freshWorkingState(); w.direction = 'srv'
    s = reducer(s, hydrateProject({ id: 'p1', working: w }))
    expect(s.working.p1.direction).toBe('srv')
  })
  it('evictWorking drops working[id] but keeps its index meta', () => {
    let s = reducer(undefined, createProject({ id: 'p1', now: 1 }))
    s = reducer(s, evictWorking('p1'))
    expect(s.working.p1).toBeUndefined()
    expect(s.index.p1).toBeDefined()
  })
  it('reconcileServerIndex merges server metas (adds server-only, keeps local-only)', () => {
    let s = reducer(undefined, createProject({ id: 'local', now: 9 }))
    s = reducer(s, reconcileServerIndex([{ id: 'srv', name: 'Srv', createdAt: 1, updatedAt: 2, phase: 'prep', thumbnailUrl: null }]))
    expect(s.index.local).toBeDefined()
    expect(s.index.srv.name).toBe('Srv')
  })
})
```
- [ ] **Step 2:** run → FAIL (reducers/exports missing).
- [ ] **Step 3: implement** — add to the slice `reducers` object (import the pure helper: `import { reconcileIndex } from '../lib/projects'`? NO — `reconcileIndex` is in `projectSync.ts`; import from there: `import { reconcileIndex as reconcileIndexPure } from '../lib/projectSync'`). Reducers:
```ts
hydrateProject(state, action: PayloadAction<{ id: string; working: ProjectWorkingState }>) {
  state.working[action.payload.id] = action.payload.working
},
evictWorking(state, action: PayloadAction<string>) {
  delete state.working[action.payload]
},
reconcileServerIndex(state, action: PayloadAction<ProjectMeta[]>) {
  state.index = reconcileIndexPure(state.index, action.payload)
},
```
Add `hydrateProject, evictWorking, reconcileServerIndex` to the `studioSlice.actions` export block. (Name the action `reconcileServerIndex` to avoid colliding with the pure `reconcileIndex`.)
- [ ] **Step 4:** run tests → PASS; eslint clean; `npx tsc --noEmit -p tsconfig.app.json` — note any cycle between `studioSlice` (imports `projectSync`) and `projectSync` (type-imports `studioSlice` + runtime-imports `freshWorkingState`). `freshWorkingState` is a runtime import in `projectSync` from the slice → and the slice runtime-imports `reconcileIndex` from `projectSync`: a runtime cycle. **Break it:** `reconcileIndex`/`pickNewer` don't need `freshWorkingState`; only `fromServerRecord` does. If the cycle bites, move `freshWorkingState` to a tiny `src/lib/freshWorkingState.ts` (or keep `fromServerRecord` out of the slice's import path — the slice only needs `reconcileIndex`). Simplest: the slice imports only `reconcileIndex` from `projectSync`, and `projectSync` imports `freshWorkingState` from the slice — since the slice's import of `reconcileIndex` doesn't transitively need a constructed value at module-init, confirm `tsc`/vitest are happy; if not, relocate `freshWorkingState`. Resolve before committing.
- [ ] **Step 5:** commit `feat(studio): hydrate/evict/reconcile reducers for server sync`.

### Task 5: RTK Query CRUD endpoints + MSW mocks

**Files:** Modify `src/store/studioApi.ts`, `src/mocks/handlers.ts`.

- [ ] **Step 1:** Add endpoints to the `studioApi` builder (use the keying/route shape proven in Tasks 1–2 — adjust `getProject`/`saveProject` URLs to `/api/projects/:id` or `?id=` accordingly):
```ts
listProjects: builder.query<ProjectMeta[], void>({
  query: () => ({ url: 'api/projects' }),
  transformResponse: (raw: unknown) => toProjectMetaList(raw), // tolerant coercion (array | {data:[]})
}),
getProject: builder.query<ProjectRecord, string>({
  query: (id) => ({ url: `api/projects/${encodeURIComponent(id)}` }),
  transformResponse: (raw: unknown) => raw as ProjectRecord,
}),
createProjectRecord: builder.mutation<unknown, ProjectRecord>({
  query: (record) => ({ url: 'api/projects', method: 'POST', body: record }),
}),
saveProject: builder.mutation<unknown, ProjectRecord>({
  query: (record) => ({ url: `api/projects/${encodeURIComponent(record.id)}`, method: 'PUT', body: record }),
}),
```
Import `ProjectMeta` (from `../lib/projects`) and `ProjectRecord` (from `../lib/projectSync`) as types; add a small tolerant `toProjectMetaList(raw)` (array, or `{data:[]}`, filtering to objects with an `id`). Add the four hooks (`useListProjectsQuery`, `useLazyGetProjectQuery`, `useCreateProjectRecordMutation`, `useSaveProjectMutation`) to the exported hooks block. Extend `deleteProjectAssets` only if the route body changed (it didn't — `{projectId}` still drives both `file_delete` and `data_delete` server-side).
- [ ] **Step 2:** MSW mocks (`src/mocks/handlers.ts`) — add an in-memory `Map<string, ProjectRecord>` (`projectStore`) and handlers: `POST /api/projects` (store the record), `GET /api/projects` (return metas — strip `data`), `GET /api/projects/:id` (return the record), `PUT /api/projects/:id` (upsert), and extend the existing `POST /api/projects/delete` mock to also `projectStore.delete(projectId)`. Match the file's `http`/`HttpResponse` style.
- [ ] **Step 3:** `npm run build && npm run lint && npm run test:run` — all pass.
- [ ] **Step 4:** commit `feat(studio): RTK Query project CRUD endpoints + MSW mocks`.

---

## PART 3 — wiring

### Task 6: `useProjectAutosave` hook

**Files:** Create `src/components/Studio/useProjectAutosave.ts`; Test `src/components/Studio/useProjectAutosave.test.tsx`.

Watches the active working state, debounce-saves, flushes + evicts on unmount, flushes on `beforeunload`.

- [ ] **Step 1: failing test** (fake timers; a minimal store + a Wrapper provider):
```tsx
// src/components/Studio/useProjectAutosave.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import studioReducer, { createProject } from '../../store/studioSlice'
import { studioApi } from '../../store/studioApi'
import { useProjectAutosave } from './useProjectAutosave'

function makeStore() {
  const store = configureStore({
    reducer: { studio: studioReducer, [studioApi.reducerPath]: studioApi.reducer },
    middleware: (g) => g().concat(studioApi.middleware),
  })
  store.dispatch(createProject({ id: 'p1', now: 1 }))
  return store
}
function Harness({ id }: { id: string }) { useProjectAutosave(id); return null }

describe('useProjectAutosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('debounce-saves after the active working state changes', async () => {
    const store = makeStore()
    const spy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', spy)
    render(<Provider store={store}><Harness id="p1" /></Provider>)
    // mutate working state
    act(() => { store.dispatch({ type: 'studio/setDirection', payload: 'x' }) })
    act(() => { vi.advanceTimersByTime(2000) })
    const putCall = spy.mock.calls.find((c) => String(c[0]).includes('/api/projects/p1'))
    expect(putCall).toBeTruthy()
    vi.restoreAllMocks()
  })
})
```
(If wiring fake timers + RTK Query proves flaky, simplify to assert the hook dispatches `saveProject` via a spied store action instead of asserting `fetch`; keep the debounce assertion.)
- [ ] **Step 2:** run → FAIL (module missing).
- [ ] **Step 3: implement**
```ts
// src/components/Studio/useProjectAutosave.ts
import { useEffect, useRef } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { selectActive, evictWorking } from '../../store/studioSlice'
import { studioApi } from '../../store/studioApi'
import { toServerRecord } from '../../lib/projectSync'
import { deriveProjectMeta } from '../../lib/projects'

const DEBOUNCE_MS = 1500

/** Server-sync for the active project: debounce-saves working-state changes, and
 *  on unmount (you left the project — 11b remounts the workspace per projectId)
 *  flushes a final save then evicts the working state from the store. */
export function useProjectAutosave(projectId: string) {
  const dispatch = useAppDispatch()
  const working = useAppSelector(selectActive)
  const meta = useAppSelector((s) => s.studio.index[projectId])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ working, meta })
  latest.current = { working, meta }

  const save = () => {
    const { working: w, meta: m } = latest.current
    if (!m) return
    const record = toServerRecord({ ...m, ...deriveProjectMeta(w), updatedAt: Date.now() }, w)
    void dispatch(studioApi.endpoints.saveProject.initiate(record))
  }

  // Debounce on working-state change (skip the first render — that's the hydrated load).
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(save, DEBOUNCE_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [working]) // eslint may want `save`/deps — see note

  // Flush on tab close.
  useEffect(() => {
    const onUnload = () => save()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  // Flush + evict on unmount (leaving the project).
  useEffect(() => {
    return () => { save(); dispatch(evictWorking(projectId)) }
  }, [projectId])
}
```
**ESLint note:** this repo treats `react-hooks/*` as errors and may flag `save` not being in deps / `set-state-in-effect`. `save` reads from `latest.current` (a ref) so it doesn't need to be a dep; if the linter insists, wrap `save` in `useCallback` with `[dispatch]` and add it to deps, or inline it. There is NO `setState` in these effects (only `dispatch` + `setTimeout`), so `set-state-in-effect` does not apply. Do NOT add disable comments — restructure (refs/useCallback) to satisfy the rules.
- [ ] **Step 4:** run the test → PASS; `npm run build && npm run lint && npm run test:run` green.
- [ ] **Step 5:** commit `feat(studio): useProjectAutosave (debounced save, flush+evict on exit)`.

### Task 7: `StudioProjects` — list from server + create-on-server + states

**Files:** Modify `src/pages/StudioProjects.tsx`.

- [ ] **Step 1:** Use `useListProjectsQuery()`; on data, `dispatch(reconcileServerIndex(data))`. Render the (reconciled) `selectProjectList` as today. Add states: while `isFetching` and the list is empty, show a "Loading projects…" line; if `isError`, render the cached list + a non-blocking "Couldn't reach the server — showing your local copy." note. Reconcile in an effect (guard against the `react-hooks/set-state-in-effect` rule — dispatching to Redux is fine, not a setState).
```tsx
const { data: serverList, isFetching, isError } = useListProjectsQuery()
useEffect(() => { if (serverList) dispatch(reconcileServerIndex(serverList)) }, [serverList, dispatch])
```
- [ ] **Step 2:** `onNew` also creates the server record:
```tsx
const [createRecord] = useCreateProjectRecordMutation()
const onNew = () => {
  const id = crypto.randomUUID(); const now = Date.now()
  dispatch(createProject({ id, now }))
  const meta = { id, name: 'Untitled project', createdAt: now, updatedAt: now, phase: 'import' as const, thumbnailUrl: null }
  void createRecord(toServerRecord(meta, freshWorkingState())) // best-effort; reconcile/save will catch up if it fails
  navigate(`/studio/project/${id}`)
}
```
(Import `useListProjectsQuery`, `useCreateProjectRecordMutation` from `../store/studioApi`; `reconcileServerIndex`, `freshWorkingState` from `../store/studioSlice`; `toServerRecord` from `../lib/projectSync`. Use the same default name the slice's `createProject` uses — `'Untitled project'`; the slice is the source of truth for the name, so if they could differ, prefer reading the created meta from the store after dispatch. Keep it simple: the server record is a starting point; the next autosave/reconcile overwrites it.)
- [ ] **Step 3:** `npm run build && npm run lint && npm run test:run` green.
- [ ] **Step 4:** commit `feat(studio): project list loads from the server (reconcile) + create-on-server`.

### Task 8: `StudioProjectGuard` — hydrate-or-redirect

**Files:** Modify `src/pages/StudioProjectGuard.tsx`.

- [ ] **Step 1:** When `working[projectId]` is missing, trigger `getProject(projectId)` (lazy query) and show a load state; hydrate on success; redirect to `/studio` only when the project is unknown locally AND the server returns no record.
```tsx
import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { openProject, hydrateProject, selectActiveProjectId } from '../store/studioSlice'
import { useLazyGetProjectQuery } from '../store/studioApi'
import { fromServerRecord } from '../lib/projectSync'
import { resolvePhase } from '../lib/studioRoute'
import { Studio } from './Studio'

export function StudioProjectGuard() {
  const { projectId, phase } = useParams()
  const dispatch = useAppDispatch()
  const working = useAppSelector((s) => (projectId ? s.studio.working[projectId] : undefined))
  const knownMeta = useAppSelector((s) => (projectId ? s.studio.index[projectId] : undefined))
  const activeProjectId = useAppSelector(selectActiveProjectId)
  const [fetchProject, { isError: fetchFailed, isUninitialized }] = useLazyGetProjectQuery()

  // Sync the active pointer once working is present.
  useEffect(() => {
    if (projectId && working && activeProjectId !== projectId) dispatch(openProject(projectId))
  }, [projectId, working, activeProjectId, dispatch])

  // Hydrate from the server when we don't have the working state locally.
  useEffect(() => {
    if (!projectId || working) return
    let cancelled = false
    fetchProject(projectId).unwrap().then(
      (rec) => { if (!cancelled && rec) { const { working: w } = fromServerRecord(rec); dispatch(hydrateProject({ id: projectId, working: w })) } },
      () => {},
    )
    return () => { cancelled = true }
  }, [projectId, working, fetchProject, dispatch])

  if (!projectId) return <Navigate to="/studio" replace />
  if (!working) {
    // Truly unknown (not local, and the server fetch failed/empty) → list. Else loading.
    if (!knownMeta && fetchFailed) return <Navigate to="/studio" replace />
    return <div className="container-page py-16 text-ink-soft">Loading project…</div>
  }
  const resolved = resolvePhase(working, phase)
  if ('redirectTo' in resolved) return <Navigate to={`/studio/project/${projectId}/${resolved.redirectTo}`} replace />
  if (activeProjectId !== projectId) return null
  return <Studio key={projectId} projectId={projectId} phase={resolved.phase} />
}
```
(`isUninitialized` imported in case it's needed to distinguish "not yet fetched" from "failed"; the `!knownMeta && fetchFailed` guard avoids redirecting before the fetch resolves. Adjust the `getProject` URL/arg to match the route shape proven in Task 1. Reuse `.container-page`/text tokens for the loading state.)
- [ ] **Step 2:** `npm run build && npm run lint && npm run test:run` green. If the existing `StudioProjectGuard.test.tsx` (11b) asserts unknown-id → redirect with NO server, ensure it still holds (no server record + not in index → redirect); update the test's expectations only if the loading-state intermediate render breaks an assertion (e.g. assert it eventually redirects).
- [ ] **Step 3:** commit `feat(studio): guard hydrates a project from the server (hydrate-or-redirect)`.

### Task 9: `Studio` workspace — autosave hook + save indicator

**Files:** Modify `src/pages/Studio.tsx`.

- [ ] **Step 1:** Call `useProjectAutosave(projectId)` near the top of the component (it's keyed by projectId, so mount/unmount maps to entering/leaving the project).
- [ ] **Step 2:** Add a quiet save indicator to the control bar. Read the save mutation state via `studioApi.endpoints.saveProject.select(...)` is awkward (the arg varies); simplest is to expose status from the hook. Extend `useProjectAutosave` to return `{ status: 'idle'|'saving'|'saved'|'error', savedAt: number|null }` (track via the mutation promise: set 'saving' before dispatch, 'saved'+stamp on fulfill, 'error' on reject — store in `useState`, which is fine here since it's event-driven, not render-derived). Render it in the control bar: `Saving…` / `Saved` / `Save failed`. Keep it non-blocking and subtle (`text-ink-soft text-[12px]`).
- [ ] **Step 3:** `npm run build && npm run lint && npm run test:run` green.
- [ ] **Step 4:** commit `feat(studio): autosave the active project + a save-status indicator`.

### Task 10: full verification + story doc

- [ ] **Step 1:** Full gates: `npm run build`, `npm run lint`, `npm run test:run` — all green; report count.
- [ ] **Step 2: LIVE end-to-end** (against j5s.dev, `MOCK_STUDIO` off): create a project (record POSTed), reload (list loads from server), open it (hydrates), edit (autosave PUT — confirm via a follow-up `GET /api/projects/:id` showing the change), delete (record + bucket gone). Quote the curl/Network results.
- [ ] **Step 3:** Create `stories/inprogress/studio/11d-server-sync.md` (mirror 11c's format): Status ✅ shipped (live-verified); Why; What shipped (schema + CRUD rules, projectSync, slice reducers, RTK endpoints, autosave hook, list-from-server, hydrate-or-redirect guard, save indicator, eviction); Scope guard (no auth/07, savedVoices local, LWW, no offline queue). Update README: 11d row ✅; mark the **`studio/projects` initiative (11a–11d) complete**.
- [ ] **Step 4:** commit `docs(studio): story 11d — server-side project sync`.

---

## Self-review notes (for the implementer)
- **Task 1 is the gate.** Confirm a record can be addressed by our project id (recordId or a `projectId` filter) before building list/update/delete. The chosen approach propagates to Tasks 2 and 5's URLs.
- **Watch the `projectSync` ↔ `studioSlice` import cycle** (Task 4) — `projectSync` runtime-imports `freshWorkingState` from the slice; the slice runtime-imports `reconcileIndex` from `projectSync`. If `tsc`/vitest complain, relocate `freshWorkingState` to its own module. Type-only imports are fine.
- **Eviction relies on 11b's keyed remount** — leaving a project unmounts the workspace, firing the autosave hook's unmount cleanup (flush + evict). Don't add a separate eviction path.
- **No clean-slate** — do NOT bump the persist key; local projects must survive and reconcile/push-up.
- **Best-effort everywhere** — create/save/delete failures never block the UI; the local copy is the fallback and re-syncs later.
- **Validators stay off** (story 07) — the new routes are unscoped; flag the destructive ones for `auth_required` in 07.
