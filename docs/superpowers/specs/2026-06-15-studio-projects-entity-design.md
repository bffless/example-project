# Studio Projects — design

> **Initiative:** make a **Project** a first-class entity in `/studio`, on one
> long-lived branch `studio/projects` (one-branch-per-refactor convention), as a
> sequence of four stories. This doc specifies **only story 11a** (the local-first
> entity); 11b–11d are scoped here for context but each gets its own spec when
> reached.
>
> Read `stories/inprogress/studio/00-architecture-and-state.md` first.

## The problem

Today `/studio` has no concept of a project. "The project" is just the top-level
fields of the `studio` Redux slice, and **"Start over" (`resetStudio`) wipes it** —
the work is one-and-done, with no list of past work and no way to revisit it. There
is no project ID, so there is nothing to put in a URL, nothing to key a server
record on, and nothing to name a storage folder after.

## The unifying insight

All four asks hang off one missing concept: a **`Project` with a stable ID**. Once
a project has an ID, the rest are "use that ID in three places":

| Story | What | Uses the ID for |
|-------|------|-----------------|
| **11a** | Projects as a first-class entity (local-first) | the entity itself |
| 11b | URL-driven routing | the route: `/studio/p/:projectId/{prep,build,export}` |
| 11c | GCS per-project storage layout | the folder: `uploads/projects/<id>/<type>/...` |
| 11d | Server-side persistence + sync | the DB record key |

Sequence is **11a → 11b → 11c → 11d**: each depends only on what came before, and
the highest-risk piece (server sync + local/server reconciliation) is last.

---

## Story 11a — Projects as a first-class entity (local-first)

**Goal:** stop losing work. You land on a **list of your projects**, create new
ones, and switch between them — all persisted locally. No server, no URL changes,
no GCS changes yet.

### Decisions locked in brainstorming

- **Create flow:** create-then-import. "New project" makes an empty project
  immediately, auto-named `"Untitled project"`, and drops into the existing Import
  flow. Renamable anytime.
- **Migration:** none. Bump the redux-persist key → **clean slate**. The current
  in-progress single project is discarded on upgrade (accepted).
- **List actions:** Rename, Delete, and show progress/metadata per card. **No
  Duplicate** (out of scope).
- **State shape:** **split** a lightweight project *index* from heavy per-project
  *working state*, so 11d can later swap working-state's backing store to the
  server and evict inactive projects without a re-restructure.
- **`savedVoices` is hoisted out of the project** into a shared user library —
  cloned voice IDs are explicitly reusable across projects.
- The **server-backed "only the active project is local" model is story 11d**, not
  11a. Until a server exists, localStorage is the only durable store, so 11a must
  persist every project locally. The win from the split is purely structural
  (clean swap later), and that is accepted.

### Data model (`studio` slice)

```ts
type ProjectMeta = {
  id: string                 // crypto.randomUUID(), client-minted, stable from creation
  name: string               // "Untitled project" by default; renamable
  createdAt: number
  updatedAt: number
  phase: StudioPhase         // denormalized copy of displayPhase(working) — see middleware
  thumbnailUrl: string | null // first contact-sheet frame, denormalized
}

// = today's StudioState, MINUS savedVoices (hoisted out)
type ProjectWorkingState = { /* scenes, sources, words, synopsis, direction,
  voice, cast, stageProgress, flags, finalCutUrl, description, ... */ }

type StudioState = {
  index: Record<string, ProjectMeta>            // always persisted; renders the list
  working: Record<string, ProjectWorkingState>  // 11a persists all locally; 11d swaps backing store
  activeProjectId: string | null
  savedVoices: SavedVoice[]                      // user library, shared across projects
}
```

`ProjectMeta` is **self-sufficient to render a card without loading heavy state** —
that is what makes 11d's "list projects without hydrating everything" possible.
`phase` and `thumbnailUrl` are denormalized and kept in sync (see middleware).

### Behavior

**New reducers**

- `createProject` — mint id → fresh `ProjectMeta` (`"Untitled project"`,
  timestamps) + fresh `ProjectWorkingState` → set `activeProjectId`.
- `openProject(id)` — set `activeProjectId`.
- `closeProject` — `activeProjectId = null` ("← Projects").
- `renameProject({ id, name })` — update `meta.name` + `updatedAt`.
- `deleteProject(id)` — drop from `index` + `working`; clear `activeProjectId` if it
  was active. **Bucket/server cleanup is explicitly deferred to 11c/11d** — deleting
  here orphans bucket assets, which is accepted for 11a.
- `resetProject` — the old `resetStudio`, now **scoped to the active project**
  ("start this one over"); keeps it in the list.

**Existing reducers re-pointed.** Every `state.<field>` becomes
`active(state).<field>` through one `active(state) = state.working[state.activeProjectId]`
helper; no-op when there is no active project. Mechanical.

**`projectMetaSync` middleware.** After any action that touches the active
project, it stamps `meta.updatedAt = Date.now()` and recomputes `meta.phase`
(reusing `displayPhase`) and `meta.thumbnailUrl` (first contact-sheet frame).
Keeps the index render-ready without editing every reducer.

**Nicety (optional).** If `name` is still the default when the first video
imports, derive the name from that filename.

### Persistence

- **Bump the redux-persist key** (e.g. `studio` → `studio-projects`) → clean slate,
  no migration code.
- Persist `index` + `working` + `savedVoices` + `activeProjectId` (the last so a
  reload returns you to the project you were in — until 11b puts that in the URL).
- Structure `working` as its own sub-slice/key so 11d can lazily load/evict it.

### UI (no URL change yet — that is 11b)

`src/pages/Studio.tsx` branches on `activeProjectId`:

- **`null` → `<ProjectList />`** — "New project" CTA + a grid of `<ProjectCard />`.
  Each card: thumbnail or placeholder, inline-editable name, phase badge, "edited
  2h ago", delete-with-confirm, click-to-open. First-run empty state.
- **set → the existing workspace** (stepper + prep board + Build) for that project,
  with a **"← Projects"** link that calls `closeProject`. The current "Start over"
  button becomes "← Projects"; per-project reset stays available inside.

Reuse the editorial tokens (`.pill-cta`, `.pill-ghost`, `.meta-label`,
`<Section>`/`<PageHero>`/`<Dot>`). Delete confirmation follows the app's existing
dialog pattern.

### Pure logic + tests

- **New `src/lib/projects.ts`** — `makeProject()` (fresh meta + working),
  `deriveProjectMeta(working)` (phase + thumbnail), naming helpers. Unit-tested in
  `projects.test.ts`.
- **Slice tests** — create / open / close / rename / delete / reset, and
  "existing reducers route to the active project."
- Reuse `displayPhase` for the card badge.

### Scope guard — 11a does NOT

- change URLs (11b),
- change GCS paths or clean the bucket on delete (11c),
- touch the server (11d),
- add a Duplicate action.

### Files touched

- `src/store/studioSlice.ts` (major restructure) + `studioSlice.test.ts`
- `src/store/index.ts` (persist key bump, `working` sub-key)
- new `src/lib/projects.ts` + `projects.test.ts`
- `src/pages/Studio.tsx` (branch on `activeProjectId`)
- new `src/components/Studio/ProjectList.tsx`, `ProjectCard.tsx`
- sweep of `src/components/Studio/useScenePipeline.ts` + selectors reading
  top-level state → active project

### Acceptance

- Landing on `/studio` with no projects shows the empty list + "New project".
- "New project" creates an auto-named project and enters Import; the project then
  appears in the list with the correct phase badge and last-edited time.
- Renaming and deleting from the list work; deleting the active project returns to
  the list.
- Switching between two projects preserves each one's full working state across a
  hard reload (localStorage).
- `npm run build`, `npm run lint`, `npm run test:run` pass.

---

## 11b–11d (scoped for context only)

- **11b — URL routing.** Nested React Router routes lift `activeProjectId` into the
  path (`/studio/p/:projectId/{prep,build,export}`); URL becomes the source of
  truth for which project + step; back/forward + deep links work. `activeProjectId`
  largely goes away.
- **11c — GCS per-project layout.** Upload-prepare rules key on
  `uploads/projects/<id>/<type>/...`; carries a migration question for assets
  already written under the date layout, and lets `deleteProject` clean the bucket.
- **11d — Server persistence + sync.** Save/load `ProjectWorkingState` to a BFFless
  pipeline schema keyed by project ID; reconcile local vs server (when to pull, when
  to push, conflict policy); enables "only the active project is local, the rest are
  fetched/evicted." Highest-risk piece — deliberately last.
