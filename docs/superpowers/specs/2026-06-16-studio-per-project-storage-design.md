# Studio per-project storage layout (Story 11c) — design

> **Initiative:** `studio/projects` (one long-lived branch; see 11a
> `2026-06-15-studio-projects-entity-design.md`, 11b
> `2026-06-16-studio-url-routing-design.md`). This is **story 11c**: move every
> project's bucket assets under one per-project prefix and wire project deletion to
> wipe that prefix. 11d (server-side project sync) is the last story.
>
> Read `stories/inprogress/studio/00-architecture-and-state.md` first.
> **External dependency:** the project-delete part needs a new CE pipeline handler,
> specified in `2026-06-16-bffless-ce-file-delete-handler.md` (built in a separate
> session). Part A below has no such dependency.

## The problem

Today every Studio upload lands under a **type-then-date** layout:
`uploads/<type>/<date>/<uuid>-<originalfile>` (e.g.
`uploads/source/2026-06-09/b9e82258-…-Screen_Recording.mov`). The key is built
server-side by the `presigned_upload` handler (`subDir: "<type>"`,
`dateBucket: true`); the browser sends only `{ filename }`. A single project's
assets are therefore scattered across `source/`, `audio/`, `thumbnails/`, `voice/`,
`export/`, `scene-clip/`, `narration/` — and within each, across date folders. You
can't see, or delete, "everything for project X" in one place.

## Goal

Nest every project's assets under one prefix, keeping today's shape otherwise:

```
uploads/projects/<projectId>/<type>/<date>/<uuid>-<originalfile>
```

`<projectId>` is the existing 11a client-minted id (`crypto.randomUUID()`) —
**no new UUID is generated anywhere.** `dateBucket` and the handler's uuid filename
prefix are unchanged; only the folder nesting changes. And: deleting a project
deletes its whole `projects/<id>/` prefix.

## Decisions locked in brainstorming

- **Key shape:** `uploads/projects/<projectId>/<type>/<date>/<uuid>-<file>` — keep
  `dateBucket: true` + uuid prefix; just nest under `projects/<id>/`.
- **Uniqueness stays in the pipeline** (the `presigned_upload`/`file_upload`
  handlers already prefix a uuid). The UI supplies only the existing `projectId`.
- **Types projectized:** `source, audio, thumbnails, voice, export, scene-clip`
  (the 6 presigned types) **and** `narration` (server-written by `/api/voice/narrate`).
  **`contact-attachments` is left alone** — it's the contact form, not a Studio project.
- **Migration:** none. 11a wiped local state, so no project references the old
  date-bucketed objects; they're orphaned and stay in place.
- **Project delete wipes the bucket:** `deleteProject` calls a new
  `POST /api/projects/delete` that deletes the `projects/<id>/` prefix via the new
  CE `file_delete` handler.
- **Validators stay off** (story 07) — but the destructive delete route is flagged
  for `auth_required` when 07 lands.

---

## Part A — per-project layout (no CE dependency)

### How keys/serving work today (verified against the live rules)

- **prepare** (`presigned_upload`): `{ subDir: "source", filename: "request.body.filename", dateBucket: true, ... }` → returns `storageKey` (= `source/<date>/<uuid>-file`) + a presigned PUT url.
- **register** (`register_upload`): `{ subDir: "source", storageKey: "request.body.storageKey", schemaId, ... }` → verifies the object, writes the record, returns the serve `url`/`publicPath`.
- **serve** (`file_serve_handler`): `GET /api/uploads/source/*` with `{ subDir: "source" }`.
- **narrate** (`/api/voice/narrate`): `replicate` → `function_handler` → `file_upload_handler { subDir: "narration" }` → response.
- **sign** (`/api/uploads/sign`): a `function_handler` that strips the `/api/uploads/` prefix and rebuilds `bffless/example-project/uploads/<key>` — **generic**, works for any key depth (no change needed).

### Rule changes (BFFless, via MCP — use the `bffless-pipeline` skill)

1. **6 prepare rules** — `source, audio, thumbnails, voice, export, scene-clip`:
   `subDir: "<type>"` → `subDir: "projects/{{request.body.projectId}}/<type>"`. Keep
   `dateBucket`, `filename`, `maxFileSize`, `allowedMimeTypes`.
2. **6 register rules** (same types): `subDir` → the **same** dynamic value. The
   client must send `projectId` in the register body for the interpolation. (Rationale:
   register's `subDir` must stay consistent with the nested `storageKey`; a static
   `subDir: "source"` against a `projects/<id>/source/...` key risks rejection or a
   wrong `publicPath`.)
3. **narrate** (`/api/voice/narrate`): the `file_upload_handler` step's
   `subDir: "narration"` → `"projects/{{request.body.projectId}}/narration"`.
4. **Add one serve rule:** `GET /api/uploads/projects/*` with `file_serve_handler
   { subDir: "projects" }`, so nested keys serve. Leave the existing per-type serve
   routes in place (harmless; they still serve pre-11c objects).

**Planning-time verification (the one genuine unknown):** confirm how
`register_upload` composes `publicPath` and how `file_serve_handler` maps the route
wildcard against `subDir`, so the single `/api/uploads/projects/*` serve rule +
dynamic register `subDir` resolve nested keys correctly. If `publicPath` is
`/api/uploads/<storageKey>` (i.e. `/api/uploads/projects/<id>/<type>/...`), the new
serve rule covers it; if register hardcodes a type segment differently, adjust
accordingly. Verify with a real round-trip (prepare → PUT → register → GET) before
declaring Part A done.

### App changes

- **`src/lib/upload.ts`:** `presignedUpload(file, basePath, projectId)` — add the
  `projectId` param; include it in **both** the prepare body (`{ filename, projectId }`)
  and the register body (`{ storageKey, originalName, projectId }`). Pure-ish; unit
  test that both bodies carry `projectId` (fetch mocked).
- **`src/store/studioApi.ts`:** the `upload` mutation `{ file, kind }` → `{ file, kind, projectId }`, forwarded to `presignedUpload`. The `narrate` mutation body gains `projectId`.
- **`src/components/Studio/useScenePipeline.ts`:** thread the active project's id
  (from `selectActiveProjectId` / the workspace's `projectId`) into every `upload`
  call and the `narrate` call. (Every upload happens inside the workspace, which is
  scoped to one project, so the id is always available.)
- **MSW mocks (`src/mocks/handlers.ts`, gated by `MOCK_STUDIO`):** prepare/register/narrate
  mocks incorporate `projectId` into the mock storage key + returned serve url, and the
  mock serve resolves the now project-nested keys (the mock must keep serving uploaded
  objects back — the swap-don't-rewrite contract).

---

## Part B — project deletion (depends on CE `file_delete`)

### New rule

`POST /api/projects/delete` (rule set `studio`, validators off for now):
```
step 1  function_handler "prep":
          const id = String((request.body && request.body.projectId) || '').trim()
          if (!id) throw new Error('projectId required')   // never an empty prefix
          return { prefix: 'projects/' + id + '/' }
step 2  file_delete: { "prefix": "{{steps.prep.prefix}}" }   // CE handler
step 3  response_handler: { body: "{{{steps.delete}}}", status: 200 }
```

### App changes

- **`src/store/studioApi.ts`:** a `deleteProjectAssets` mutation →
  `POST /api/projects/delete { projectId }`, returning `{ deleted }`.
- **`src/pages/StudioProjects.tsx`:** the existing `onDelete(id)` becomes async —
  call `deleteProjectAssets({ projectId: id })` first (best-effort), then dispatch
  `deleteProject(id)`. **Best-effort policy:** remove the project from local state
  **regardless** of the API result; on failure, surface a non-blocking warning
  (orphaned bucket objects aren't fatal and can be retried/cleaned later). Keep the
  existing confirm() gate.
- **MSW mock** for `/api/projects/delete` returning `{ deleted: 0 }`.

### Sequencing

Part A ships first (no dependency). Part B's rule + UI wiring lands once CE
`file_delete` is deployed. Until then, `deleteProject` behaves as it does after 11a
(local-only removal; bucket objects orphaned) — i.e. shipping Part A alone is safe
and is strictly an improvement.

## Error handling

- **Upload with no `projectId`** (shouldn't happen — uploads are workspace-scoped):
  the rule interpolation would produce `projects//type`; guard client-side by never
  calling upload without the active id (the workspace always has it). Not a
  server-trust boundary yet (validators off; story 07).
- **Serve of a nested key:** covered by the new `/api/uploads/projects/*` rule.
- **Delete:** the CE handler refuses an empty/`"/"` prefix and path traversal (see
  its spec); the app's `function_handler` also throws on empty `projectId`. Delete
  failures are surfaced non-blockingly; local removal still proceeds.

## Testing

- **Pure/unit:** `presignedUpload` sends `projectId` in both prepare and register
  bodies (fetch mocked); the `upload`/`narrate` mutation bodies include `projectId`.
- **MSW round-trip:** an upload through the mock lands under a `projects/<id>/...`
  key and is served back; `/api/projects/delete` mock returns cleanly and the list
  removes the project.
- **Live verification (Part A):** a real prepare → PUT → register → GET round-trip
  confirms the nested key serves (the serve-rule unknown above).
- `npm run build`, `npm run lint`, `npm run test:run` pass.

## Scope guard — 11c does NOT

- change the per-object shape (dateBucket + uuid prefix stay);
- migrate or delete pre-11c objects;
- touch `contact-attachments` (non-Studio);
- add the server-side project *record* sync (that's 11d);
- restore validators/auth (story 07) — though it flags the delete route for it.

## Files

- **Rules (MCP):** 6 prepare + 6 register + narrate edited; 1 new `/api/uploads/projects/*`
  serve rule; 1 new `/api/projects/delete` rule (Part B).
- **App — new/modified:** `src/lib/upload.ts` (+ test), `src/store/studioApi.ts`,
  `src/components/Studio/useScenePipeline.ts`, `src/pages/StudioProjects.tsx`,
  `src/mocks/handlers.ts`; story doc + README row.

## Acceptance

- A new upload (each of the 7 studio types) lands at
  `uploads/projects/<projectId>/<type>/<date>/<uuid>-<file>` and serves/plays back
  in-app.
- Two projects' assets are isolated under their own `projects/<id>/` prefixes.
- `contact-attachments` and pre-11c objects are untouched.
- (Part B, once `file_delete` ships) deleting a project removes its
  `projects/<id>/` prefix from the bucket and the project from the list.
- `npm run build`, `npm run lint`, `npm run test:run` pass.
