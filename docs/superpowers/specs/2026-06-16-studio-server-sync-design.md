# Studio server-side project sync (Story 11d) — design

> **Initiative:** `studio/projects` (one long-lived branch; see 11a
> `2026-06-15-studio-projects-entity-design.md`, 11b
> `2026-06-16-studio-url-routing-design.md`, 11c
> `2026-06-16-studio-per-project-storage-design.md`). This is **story 11d** — the
> last one: persist projects on the server and reconcile local vs server so a
> project lives on the server, not only in localStorage.
>
> Read `stories/inprogress/studio/00-architecture-and-state.md` first.

## The problem

After 11a–11c, a project is a first-class, URL-addressable entity whose assets live
under one bucket prefix — but the project **record** (its working-state JSON: scenes,
transcript, voice, etc.) still lives **only in localStorage**. So projects don't
survive a cleared browser, don't follow you across devices, and pile up in
localStorage (the ~5 MB cap the 11a split was designed to escape). The original ask:
*"pull down a project from my server without it being only in local storage … really
think through when it pulls from the server and when it saves."*

## Goal (sync model — locked in brainstorming)

**Server is the durable home; localStorage is a cache of the ACTIVE project.**
- The list loads from the server.
- Opening a project fetches its working state from the server (local = offline fallback).
- Edits auto-save (debounced) and flush on exit.
- Non-active working state is **evicted** from local, so localStorage holds only the
  active project's working state + the lightweight index.
- **Conflict:** last-write-wins by `updatedAt`.
- **No clean-slate:** on the 11d upgrade, local-only projects are pushed to the server
  (they read as "unsynced" to the normal sync path) — nothing is lost.
- **Scoping:** unscoped (single table, no owner) for now — per-user scoping is **story
  07** (the auth gate), consistent with the studio routes running validators-off.

## 1. Server data model + CRUD

A BFFless `studio_projects` data schema (same machinery as the jobs schema
`acdca97c-f9cc-4469-90a3-676a242924cb`), one record per project:

```
id           string   (the 11a client-minted project id — the record key)
name         string
createdAt    number
updatedAt    number
phase        string   ('import'|'prep'|'build'|'export' — denormalized, for the list)
thumbnailUrl string|null
data         string   (JSON.stringify(ProjectWorkingState) — the heavy blob)
```

The heavy media already lives in the bucket (11c `/api/uploads/projects/<id>/...`
URLs); `data` only holds the working-state JSON that references them. No base64.

**Pipeline rules** (modeled on the jobs CRUD — `data_create`/`data_query`/`data_update`/
`data_delete`; validators off, like the rest of studio; the destructive ones flagged
for `auth_required` in story 07):

| Route | Handler | Purpose |
|-------|---------|---------|
| `POST /api/projects` | `data_create` | create the record (fired at `createProject`) |
| `GET /api/projects` | `data_query` (list) | the project list — **meta fields only** if field-projection is supported; otherwise accept full-record payloads or split meta/data into two records (resolve in planning via the bffless-pipeline skill) |
| `GET /api/projects/:id` | `data_query` (by id) | full record incl. `data` |
| `PUT /api/projects/:id` | `data_update` | save (meta + `data`) |
| `POST /api/projects/delete` | (11c) `file_delete` **+** `data_delete` | extend the existing delete rule to also remove the record |

## 2. Sync engine (server-home, active-only local)

- **List:** `StudioProjects` renders the locally-persisted `index` instantly, then
  `GET /api/projects` → `reconcileIndex` (merge: add server-only projects, update meta
  by newer `updatedAt`, keep local-only as "unsynced"). Local-only/unsynced projects
  are pushed up via `saveProject`.
- **Create:** `createProject` (slice) also fires `createProjectRecord` so the project
  is born on the server.
- **Open:** if `working[projectId]` is absent, `GET /api/projects/:id` → `hydrateProject`.
  If a local copy exists with a **newer** `updatedAt`, keep local; else server wins.
- **Save:** `useProjectAutosave(projectId)` in the workspace debounce-saves (~1.5s) after
  working-state changes via `saveProject` (`PUT`), stamping `updatedAt`; flushes a final
  save on unmount and on `beforeunload`.
- **Eviction:** the workspace is keyed by `projectId` (11b), so leaving a project
  unmounts its instance — the autosave hook's cleanup flushes the save then dispatches
  `evictWorking(oldId)`. localStorage keeps only the active working state + the index.
- **Conflict:** last-write-wins by `updatedAt` (multi-tab/device: last save wins —
  accepted; flagged).

## 3. State, persistence & orchestration

- **Slice (`studioSlice.ts`):** `index` stays (list cache). `working` holds only the
  hydrated subset. New reducers:
  - `hydrateProject({ id, working })` — set `working[id]` from a server record.
  - `evictWorking(id)` — delete `working[id]` (keep its `index` meta).
  - `reconcileIndex(serverMeta[])` — merge the server list into `index` (add/refresh by
    newer `updatedAt`, keep local-only entries).
- **redux-persist:** **no key bump.** Persist `index` + `working` (only the active one
  survives eviction) + `savedVoices`. On boot: rehydrate local → `GET /api/projects` →
  `reconcileIndex` + push local-only.
- **RTK Query (`studioApi.ts`):** `listProjects` (query), `getProject` (query),
  `createProjectRecord` (mutation), `saveProject` (mutation); extend `deleteProjectAssets`
  to also delete the record.
- **`useProjectAutosave(projectId)` hook:** watches the active working state; debounced
  `saveProject`; flush + `evictWorking` on unmount; `beforeunload` flush.
- **Guard change (`StudioProjectGuard.tsx`, from 11b):** **hydrate-or-redirect.** If
  `working[projectId]` is present → resolve phase + render (as today). If absent: if the
  project is known (in `index`) or `getProject` succeeds → hydrate + show a load state;
  only `<Navigate to="/studio">` when truly unknown (not in index **and** server 404).
  (Today it redirects whenever working is missing — that becomes hydrate-or-redirect.)

## 4. UX states

- **List:** cached `index` renders immediately; a subtle refreshing indicator while
  `listProjects` loads; true first-run empty state; on server error, show the cached list
  + a non-blocking "couldn't refresh" note.
- **Open:** "Loading project…" while hydrating; on error, use the local cache if present,
  else an error with a back-to-projects action.
- **Save:** a quiet "Saving… / Saved · Ns ago / Save failed" indicator in the workspace
  control bar (from the `saveProject` mutation state). Failures are non-blocking;
  autosave retries on the next change/exit.

## Error handling

- **Offline / server error on list:** fall back to the cached `index`; surface a
  non-blocking refresh-failed note; retry on next visit.
- **Offline / error on open:** use the local working cache if present; else an error
  screen with back-to-projects.
- **Save failure:** non-blocking indicator; the working state stays local (persisted) and
  re-saves on the next change or on exit. No data loss (local is the fallback).
- **Unknown project id:** redirect to `/studio` (only after both index-miss and server 404).

## Testing

- **Pure (TDD):** `src/lib/projectSync.ts` — `reconcileIndex(localIndex, serverMeta[])`,
  `pickNewer(local, server)`, `toServerRecord(meta, working)` / `fromServerRecord(record)`.
  Cover: server-only added, local-only kept (unsynced), newer-wins both directions,
  round-trip serialize/deserialize.
- **Slice:** `hydrateProject` / `evictWorking` / `reconcileIndex` reducers.
- **MSW mocks** for the 4 CRUD routes (+ delete extension), persisting to an in-memory
  store so list/get/save/delete round-trip in dev.
- **Hooks/guard:** lighter integration — autosave debounce fires a save; guard hydrates a
  known-but-not-loaded project and redirects a truly-unknown one.
- `npm run build`, `npm run lint`, `npm run test:run` pass.

## Scope guard — 11d does NOT

- add auth / per-user scoping (story 07 — unscoped single table for now);
- sync `savedVoices` (stays local-only — a possible small follow-up);
- do real-time merge / collaboration (last-write-wins only);
- build an offline mutation queue beyond "keep local + retry on next change/exit";
- change the bucket layout (11c) or routing (11b).

## Files

- **Rules (MCP):** new `studio_projects` schema; new `POST/GET /api/projects`,
  `GET/PUT /api/projects/:id`; extend `POST /api/projects/delete` with `data_delete`.
- **App — new:** `src/lib/projectSync.ts` (+ test), `useProjectAutosave` hook.
- **App — modified:** `src/store/studioSlice.ts` (+ reducers, persist note),
  `src/store/studioApi.ts` (CRUD), `src/pages/StudioProjects.tsx` (list query + reconcile
  + states), `src/pages/StudioProjectGuard.tsx` (hydrate-or-redirect),
  `src/pages/Studio.tsx` (autosave hook + save indicator), `src/mocks/handlers.ts`;
  story doc + README.

## Acceptance

- A project created on one browser appears in the list on another (same backend) and
  opens with its full working state.
- Clearing localStorage and reloading restores the list from the server; opening a
  project re-hydrates it.
- localStorage holds only the active project's working state (others evicted) + the index.
- Edits auto-save (visible indicator) and survive a reload; offline edits persist locally
  and re-save when back.
- Deleting a project removes both its bucket prefix (11c) and its server record.
- `npm run build`, `npm run lint`, `npm run test:run` pass.
