# Studio Per-Project Storage (Story 11c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. For the BFFless rule edits, also use the **bffless-pipeline** skill.

**Goal:** Nest every Studio project's bucket assets under one per-project prefix — `uploads/projects/<projectId>/<type>/<date>/<uuid>-<file>` — and (Part B) wire project deletion to wipe that prefix via the new CE `file_delete` handler.

**Architecture:** The object key is built server-side by each per-kind `presigned_upload`/`register_upload`/`file_upload` rule via its `subDir`. We make `subDir` per-project by interpolating the existing 11a `projectId` (sent from the browser in the prepare/register/narrate bodies) and add one nested serve rule. No new UUID; per-object uniqueness stays in the handler. Part B adds a delete rule + UI wiring.

**Tech Stack:** React 19, Redux Toolkit / RTK Query, TypeScript, Vitest, MSW; BFFless proxy rules (edited via the `bffless-j5s` MCP).

**Spec:** `docs/superpowers/specs/2026-06-16-studio-per-project-storage-design.md`
**CE dependency (Part B only):** `docs/superpowers/specs/2026-06-16-bffless-ce-file-delete-handler.md` (built/deployed separately).
**Branch:** `studio/projects` (initiative branch — already checked out).

## BFFless coordinates (for the rule-editing tasks)
- Project id: `8c452c73-0590-4422-b474-779929916600` (`example-project`)
- `studio` rule set id: `cf413ff6-4989-44a6-afc9-75c3545b5e8e`
- Prepare rule ids: source `5c50f027-fcbf-4f94-a330-0f1c06e21fa7`, audio `3131ba4b-f048-4dff-99b7-80bfc969246c`, thumbnails `5582b246-63a0-459d-97e2-c1d0a029bdef`, voice `2416b2ff-4d02-40fd-b79a-7dd34f5df1eb`, export `2ec4f942-bec3-41e6-a5e0-8205d15ac903`, scene-clip `411715e9-1146-48c7-a81b-7d4aadec6c92`.
- Register rule ids and the narrate (`/api/voice/narrate`) and serve (`GET /api/uploads/<type>/*`) rule ids: fetch via `get_proxy_rule_set` on the studio set and match by `path_pattern` (the set is large — slice the saved result with python/jq, as in the design exploration).

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/lib/upload.ts` | `presignedUpload` adds `projectId`, sends it in prepare + register bodies | **modify** |
| `src/lib/upload.test.ts` | assert both bodies carry `projectId`; missing id throws | **create/modify** |
| `src/store/studioApi.ts` | `upload` + `narrate` mutation args gain `projectId` | **modify** |
| `src/components/Studio/useScenePipeline.ts` | inject the active `projectId` into upload/narrate via thin wrappers (call sites unchanged) | **modify** |
| `src/mocks/handlers.ts` | prepare/register/narrate mocks nest the key under `projects/<id>/`; serve resolves it | **modify** |
| BFFless rules (MCP) | 6 prepare + 6 register + narrate `subDir` dynamic; new `/api/uploads/projects/*` serve; (Part B) `/api/projects/delete` | **modify/create** |
| `src/pages/StudioProjects.tsx` | (Part B) `onDelete` calls the delete API then removes locally | **modify** |
| `stories/inprogress/studio/11c-per-project-storage.md` + README | story doc + status row | **create/modify** |

---

## PART A — per-project layout (no CE dependency)

### Task 1: Thread `projectId` through the client upload/narrate path (backward-compatible)

Sending an extra `projectId` field that the still-static rules ignore is harmless, so this lands first and the app keeps working against today's paths until the rules change in Tasks 2–3.

**Files:** Modify `src/lib/upload.ts`, `src/store/studioApi.ts`, `src/components/Studio/useScenePipeline.ts`; Test `src/lib/upload.test.ts`.

- [ ] **Step 1: Write the failing test** (`src/lib/upload.test.ts` — add to the existing file)

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { presignedUpload } from './upload'

afterEach(() => vi.restoreAllMocks())

function mockFetchSequence() {
  const calls: { url: string; body: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    calls.push({ url, body })
    if (url.endsWith('/prepare')) {
      return new Response(JSON.stringify({ uploadUrl: 'https://bucket/put', storageKey: 'projects/p1/source/d/u-f.mov', originalName: 'f.mov' }), { status: 200 })
    }
    if (url.startsWith('https://bucket/')) return new Response(null, { status: 200 })
    if (url.endsWith('/register')) {
      return new Response(JSON.stringify({ url: '/api/uploads/projects/p1/source/d/u-f.mov' }), { status: 200 })
    }
    return new Response(null, { status: 404 })
  }))
  return calls
}

describe('presignedUpload threads projectId', () => {
  it('sends projectId in BOTH the prepare and register bodies', async () => {
    const calls = mockFetchSequence()
    const file = new File([new Uint8Array([1, 2, 3])], 'f.mov', { type: 'video/quicktime' })
    const url = await presignedUpload(file, '/api/uploads/source', 'p1')
    expect(url).toBe('/api/uploads/projects/p1/source/d/u-f.mov')
    const prep = calls.find((c) => c.url.endsWith('/prepare'))!.body as Record<string, unknown>
    const reg = calls.find((c) => c.url.endsWith('/register'))!.body as Record<string, unknown>
    expect(prep.projectId).toBe('p1')
    expect(prep.filename).toBe('f.mov')
    expect(reg.projectId).toBe('p1')
    expect(reg.storageKey).toBe('projects/p1/source/d/u-f.mov')
  })

  it('throws when projectId is empty (defensive — uploads are always project-scoped)', async () => {
    mockFetchSequence()
    const file = new File([new Uint8Array([1])], 'f.mov', { type: 'video/quicktime' })
    await expect(presignedUpload(file, '/api/uploads/source', '')).rejects.toThrow(/projectId/)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`presignedUpload` takes 2 args). Run: `npx vitest run src/lib/upload.test.ts`

- [ ] **Step 3: Update `presignedUpload`** (`src/lib/upload.ts`)

Change the signature and both bodies:
```ts
export async function presignedUpload(file: File, basePath: string, projectId: string): Promise<string> {
  if (!projectId) throw new Error('presignedUpload: projectId is required')
  const prepRes = await fetch(`${basePath}/prepare`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, projectId }),
  })
  if (!prepRes.ok) throw new Error(`Upload prepare failed (${prepRes.status})`)
  const prep = (await prepRes.json()) as PrepareResponse
  if (!prep.uploadUrl || !prep.storageKey) throw new Error('Prepare response missing uploadUrl/storageKey')

  const putRes = await fetch(prep.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!putRes.ok) throw new Error(`Bucket upload failed (${putRes.status})`)

  const regRes = await fetch(`${basePath}/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storageKey: prep.storageKey, originalName: prep.originalName ?? file.name, projectId }),
  })
  if (!regRes.ok) throw new Error(`Upload register failed (${regRes.status})`)
  const reg = (await regRes.json()) as RegisterResponse
  const url = reg.url ?? reg.data?.url ?? reg.record?.url
  if (!url) throw new Error('Register response missing url')
  return url
}
```

- [ ] **Step 4: Update `studioApi.ts`** — `upload` + `narrate` args gain `projectId`:

```ts
upload: builder.mutation<{ url: string }, { file: File; kind: UploadKind; projectId: string }>({
  async queryFn({ file, kind, projectId }) {
    try {
      const url = await presignedUpload(file, `/api/uploads/${kind}`, projectId)
      return { data: { url } }
    } catch (e) {
      return { error: { status: 'CUSTOM_ERROR' as const, error: e instanceof Error ? e.message : String(e) } }
    }
  },
}),
// ...
narrate: builder.mutation<VoiceNarrateResponse, { text: string; voiceId: string; projectId: string }>({
  query: (body) => ({ url: 'api/voice/narrate', method: 'POST', body }),
}),
```

- [ ] **Step 5: Inject `projectId` in `useScenePipeline.ts` via wrappers (call sites unchanged)**

Near the other selectors add `import { selectActiveProjectId } from '../../store/studioSlice'` (merge with the existing studioSlice import) and:
```ts
const activeProjectId = useAppSelector(selectActiveProjectId)
```
Rename the raw mutation triggers and wrap them so the existing ~13 `uploadReq({...})` and 2 `narrateReq({...})` call sites keep working unchanged:
```ts
const [uploadReqRaw] = useUploadMutation()
const [narrateReqRaw] = useNarrateMutation()
const uploadReq = useCallback(
  (a: { file: File; kind: UploadKind }) => uploadReqRaw({ ...a, projectId: activeProjectId ?? '' }),
  [uploadReqRaw, activeProjectId],
)
const narrateReq = useCallback(
  (a: { text: string; voiceId: string }) => narrateReqRaw({ ...a, projectId: activeProjectId ?? '' }),
  [narrateReqRaw, activeProjectId],
)
```
(`UploadKind` is exported from `studioApi`; import the type. `useCallback` is already imported. The `?? ''` makes `presignedUpload` throw if there is somehow no active project — which can't happen inside the project-scoped workspace, but fails loud rather than writing to a malformed path.)

- [ ] **Step 6: Run tests + build** — `npx vitest run src/lib/upload.test.ts` (pass), then `npm run build && npm run lint && npm run test:run` (all pass). Fix any other `presignedUpload(` callers the compiler flags (there should be only the `studioApi` one).

- [ ] **Step 7: Commit**
```bash
git add src/lib/upload.ts src/lib/upload.test.ts src/store/studioApi.ts src/components/Studio/useScenePipeline.ts
git commit -m "feat(studio): send projectId with every upload/narrate (per-project storage, client side)"
```

### Task 2: SPIKE — make `subDir` dynamic on the SOURCE rules + add the nested serve rule, and live-verify

This de-risks the whole approach before touching 12 more rules: it proves (a) how to express a per-project `subDir`, and (b) that the nested key serves. Use the **bffless-pipeline** skill + the `bffless-j5s` MCP.

- [ ] **Step 1: Read the three source rules** via MCP `get_proxy_rule` (or slice `get_proxy_rule_set`): source `prepare` (`5c50f027-…`), source `register`, source serve (`GET /api/uploads/source/*`). Note the exact `pipeline_config`.

- [ ] **Step 2: Determine the dynamic-`subDir` form.** The config already uses expression strings elsewhere (e.g. `filename: "request.body.filename"`, `storageKey: "request.body.storageKey"`) and triple-brace templates in `response_handler` (`"{{{steps.prepare}}}"`). Update the **source prepare** rule's `prepare` step config `subDir` to a per-project value built from `request.body.projectId`. Try the expression form first:
  - `"subDir": "'projects/' + request.body.projectId + '/source'"`
  If a live prepare (Step 4) shows the literal expression text in the key instead of the interpolated value, fall back to the template form `"projects/{{request.body.projectId}}/source"`. **Record which form works** — Task 3 reuses it verbatim.
  Apply the SAME working form to the **source register** rule's `subDir`. Keep every other config key (`dateBucket`, `filename`, `storageKey`, `schemaId`, `maxFileSize`, `allowedMimeTypes`) unchanged. Use MCP `update_proxy_rule`.

- [ ] **Step 3: Add the nested serve rule.** Create `GET /api/uploads/projects/*` in the `studio` rule set, a `file_serve_handler` step with `{ "subDir": "projects" }` (mirroring the per-type serve rules, which use `{subDir:"source"}` on `/api/uploads/source/*`). Use MCP `create_proxy_rule`. Leave the existing per-type serve rules untouched.

- [ ] **Step 4: Live round-trip verification (the gating check).** From a shell, hit the real backend (unmocked `/api/*` falls through the Vite proxy to `https://j5s.dev`; auth is off):
  ```bash
  # prepare with a projectId
  curl -sS -X POST https://j5s.dev/api/uploads/source/prepare \
    -H 'Content-Type: application/json' \
    -d '{"filename":"spike.mov","projectId":"spike-test"}'
  ```
  Confirm the returned `storageKey` is `projects/spike-test/source/<date>/<uuid>-spike.mov` (the projectId is interpolated, NOT literal). Then PUT a tiny file to the returned `uploadUrl`, POST `/api/uploads/source/register` with `{storageKey, originalName:"spike.mov", projectId:"spike-test"}`, and finally `GET` the returned serve `url` — it must return the bytes (proves the `/api/uploads/projects/*` serve rule resolves the nested key). If `register`'s returned `url` is NOT under `/api/uploads/projects/...`, report the actual shape — the serve rule may need to match it instead. **If the projectId does not interpolate in any supported `subDir` form, STOP and report BLOCKED** (we'd need a CE change to support a dynamic prefix, like `file_delete`).

- [ ] **Step 5: Commit** (the spike is config-only; record findings in the commit body)
```bash
git commit --allow-empty -m "spike(studio): per-project subDir on source rules + nested serve rule (verified live)

Working subDir form: <record the exact expression/template that interpolated>.
Live round-trip prepare→PUT→register→GET under projects/<id>/source confirmed."
```
(If you also adjust the saved story/notes, include them.)

### Task 3: Apply the proven dynamic `subDir` to the remaining rules

Using the **exact form proven in Task 2**, update via MCP `update_proxy_rule`:
- **prepare + register** for `audio`, `thumbnails`, `voice`, `export`, `scene-clip` — set each `subDir` to `…/<that-type>` (e.g. `'projects/' + request.body.projectId + '/audio'`), keeping all other config keys.
- **narrate** (`/api/voice/narrate`): the `file_upload_handler` step's `subDir: "narration"` → the per-project form `…/narration`.

- [ ] **Step 1:** Fetch each rule's current `pipeline_config` (MCP) so you preserve every other key.
- [ ] **Step 2:** Update each `subDir` to the proven per-project form. (10 rules: 5 prepare + 5 register; plus narrate = 11 edits.)
- [ ] **Step 3: Verify** each with a live prepare curl (as in Task 2 Step 4) — for each prepare type, confirm the `storageKey` nests under `projects/spike-test/<type>/…`. For narrate, a full live call needs the Replicate token (may be unavailable) — if so, verify by inspecting the updated rule config (the `subDir` matches the proven form) and rely on the round-trip already proven for the shared serve path.
- [ ] **Step 4: Commit**
```bash
git commit --allow-empty -m "feat(studio): per-project subDir on all studio upload rules + narrate"
```

### Task 4: MSW mocks for the nested layout

Keep the dev mock layer (`MOCK_STUDIO`) honest: a mocked upload must land under `projects/<id>/…` and serve back.

**Files:** Modify `src/mocks/handlers.ts`; add/extend its test if one exists.

- [ ] **Step 1:** Read `src/mocks/handlers.ts`. Find the prepare/register/narrate/serve handlers. Make the mock `prepare` build `storageKey = projects/${body.projectId}/${type}/${mockDate}/${mockId}-${filename}` and the mock `register`/serve return/resolve a `/api/uploads/projects/${...}` url, so an uploaded object round-trips through the mock. The narrate mock returns a `/api/uploads/projects/${body.projectId}/narration/...mp3` url.
- [ ] **Step 2:** If there's an MSW-backed test (e.g. a handlers test or a useScenePipeline integration test), add/extend one asserting a mocked source upload returns a `projects/<id>/source/...` url. If MSW is only wired for dev (not tests), state that and rely on Task 1's unit test + Task 2's live round-trip for coverage.
- [ ] **Step 3:** `npm run build && npm run lint && npm run test:run` — all pass.
- [ ] **Step 4: Commit**
```bash
git add src/mocks/handlers.ts
git commit -m "test(studio): MSW mocks nest uploads under projects/<id>/ and serve them back"
```

### Task 5: Story doc + README (Part A)

**Files:** Create `stories/inprogress/studio/11c-per-project-storage.md`; Modify `stories/inprogress/studio/README.md`.

- [ ] **Step 1:** Write the story file mirroring `11b-url-routing.md`: blockquote header (links to this plan + both specs, "read 00 first", note the CE `file_delete` dependency for Part B); **Status:** Part A ✅ shipped (2026-06-16); Part B ⏳ pending CE `file_delete` deploy. **Why** (project assets were scattered across type/date folders — can't see or delete a project's assets in one place). **What shipped (Part A)** (the `uploads/projects/<id>/<type>/<date>/<uuid>-<file>` layout via per-project `subDir`, the `projectId` threaded from the UI through prepare/register/narrate, the `/api/uploads/projects/*` serve rule; record the working `subDir` form from Task 2). **Scope guard** (no per-object shape change, no migration, contact-attachments untouched, validators still off, server record sync is 11d). File/rule map.
- [ ] **Step 2:** README: add the 11c row to the Order & status table (`✅ Part A · ⏳ Part B`), update the `studio/projects` "Where we are now" note (11a, 11b, 11c-A shipped; 11c-B pending CE handler; 11d queued).
- [ ] **Step 3: Commit**
```bash
git add stories/inprogress/studio/11c-per-project-storage.md stories/inprogress/studio/README.md
git commit -m "docs(studio): story 11c Part A — per-project storage layout"
```

### Part A gates
- [ ] `npm run build` · `npm run lint` · `npm run test:run` green
- [ ] Live: a real source upload lands + serves under `projects/<id>/source/...` (Task 2); each other prepare type nests correctly (Task 3)

---

## PART B — project deletion (BLOCKED until CE `file_delete` is deployed)

> Do NOT start these tasks until `file_delete` is live (the user will confirm). Until then, `deleteProject` stays local-only (its 11a behavior), which is correct and safe.

### Task 6: `/api/projects/delete` rule

- [ ] **Step 1:** In the `studio` rule set, `create_proxy_rule` `POST /api/projects/delete` (validators empty — consistent with the other studio routes; story 07 will add `auth_required` — note it):
  - step `prep` (`function_handler`): `function handler({ request }) { var id = String((request.body && request.body.projectId) || '').trim(); if (!id) throw new Error('projectId required'); return { prefix: 'projects/' + id + '/' } }`
  - step `delete` (`file_delete`): `{ "prefix": "{{steps.prep.prefix}}" }`
  - step `response` (`response_handler`): `{ "body": "{{{steps.delete}}}", "status": 200, "contentType": "application/json" }`
- [ ] **Step 2: Live-verify** against a throwaway prefix: upload one object under `projects/deltest/source/...` (prepare→PUT→register with `projectId:"deltest"`), then `curl -X POST https://j5s.dev/api/projects/delete -d '{"projectId":"deltest"}'`, expect `{ "deleted": >=1 }`, and confirm the object no longer serves (GET → 404). Also `curl … -d '{"projectId":""}'` → expect an error, no deletion.
- [ ] **Step 3: Commit** `git commit --allow-empty -m "feat(studio): /api/projects/delete wipes a project's bucket prefix (file_delete)"`

### Task 7: `deleteProjectAssets` mutation + wire `StudioProjects.onDelete`

**Files:** Modify `src/store/studioApi.ts`, `src/pages/StudioProjects.tsx`, `src/mocks/handlers.ts`.

- [ ] **Step 1:** Add an RTK mutation:
```ts
deleteProjectAssets: builder.mutation<{ deleted: number }, { projectId: string }>({
  query: (body) => ({ url: 'api/projects/delete', method: 'POST', body }),
}),
```
- [ ] **Step 2:** In `StudioProjects.tsx`, make `onDelete` best-effort then local-remove:
```ts
const [deleteAssets] = useDeleteProjectAssetsMutation()
const onDelete = async (id: string) => {
  try {
    await deleteAssets({ projectId: id }).unwrap()
  } catch {
    // best-effort: orphaned bucket objects aren't fatal; the project is still removed locally
  }
  dispatch(deleteProject(id))
}
```
(The existing `confirm()` gate lives in `ProjectCard` and is unchanged — `onDelete` is only called after confirmation.)
- [ ] **Step 3:** MSW mock for `POST /api/projects/delete` → `{ deleted: 0 }`.
- [ ] **Step 4:** `npm run build && npm run lint && npm run test:run` green; commit.
```bash
git add src/store/studioApi.ts src/pages/StudioProjects.tsx src/mocks/handlers.ts
git commit -m "feat(studio): deleting a project wipes its bucket prefix (best-effort)"
```

### Task 8: Update story 11c doc → Part B done

- [ ] Flip the story file + README row to Part B ✅, note the live delete verification. Commit.

---

## Self-review notes (for the implementer)
- **Task 2 is a hard gate.** Everything downstream assumes a per-project `subDir` interpolates. If it can't be expressed in rule config, STOP — don't edit the other 12 rules; it becomes a CE ask.
- **Client change (Task 1) is backward-compatible** — the extra `projectId` field is ignored by the still-static rules until Task 2/3, so Task 1 can ship and be verified on its own.
- **No new UUID** — `projectId` is the existing 11a id; per-object uniqueness stays in the handler (the `<uuid>-<file>` prefix is unchanged).
- **`contact-attachments` is out of scope** — don't touch its rules.
- **Part B waits for `file_delete`** — the user confirms deploy; until then ship Part A alone (strict improvement).
