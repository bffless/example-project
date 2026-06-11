# 03k — Scene Audio → Refiner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Cut this scene" saves the scene's audio alongside its video clip, and `/api/refine-scene` passes that audio to Gemini so cut/segment boundaries align to the natural flow of speech (no kept coughs, shouts, interruptions).

**Architecture:** Spec is `stories/inprogress/studio/03k-scene-audio-refiner.md` — read it first. Client side: a new `Scene.clipAudioUrl` written by `sliceScene` (slice the already-uploaded talk WAV with the existing `sliceAudioWav`, upload, both-or-neither patch), a required `audioUrl` on `RefineSceneRequest`, and a Refine gate in `SceneRefinePanel`. Server side: pipeline rule `afacb572` signs the audio like the sheets and feeds Gemini's `audio` input with two prompt additions (offset mapping + flow rule). Response shape unchanged — `toRefinement` and the 03j verbatim guard are untouched.

**Tech Stack:** React 19 + TS, Redux Toolkit / RTK Query, MSW, Vitest + RTL, BFFless pipelines (`bffless-pipeline` skill), Replicate `google/gemini-3.1-pro`.

**Branch:** `feat/studio-03k-scene-audio-refiner` (stacked on the 03j branch — PR #18 is open; rebase onto `main` once it merges).

**Conventions that bind every task:** mock-first (MSW before the real rule), URL-only persistence (no blobs in Redux), sequential uploads (Vite-proxy keep-alive 502s), non-destructive scene layers, no browser/pixel verification — `npm run build` / `npm run lint` / `npm run test:run` are the done bar.

---

### Task 1: `Scene.clipAudioUrl` field

**Files:**
- Modify: `src/lib/scenes.ts:94-99` (the `clipUrl` doc block + field)

- [ ] **Step 1: Add the field after `clipUrl`**

In `src/lib/scenes.ts`, replace:

```ts
  /** Serve path of this scene's own sliced clip — `[start, end]` of the source,
   *  cut frame-accurately and uploaded on its own (story 03g, the "Cut this
   *  scene" build step). Absent until that step runs. Once set, the Build preview
   *  plays this small clip instead of the whole source, and the per-scene assemble
   *  reads it. Re-cutting overwrites it. */
  clipUrl?: string
```

with:

```ts
  /** Serve path of this scene's own sliced clip — `[start, end]` of the source,
   *  cut frame-accurately and uploaded on its own (story 03g, the "Cut this
   *  scene" build step). Absent until that step runs. Once set, the Build preview
   *  plays this small clip instead of the whole source, and the per-scene assemble
   *  reads it. Re-cutting overwrites it. */
  clipUrl?: string
  /** Serve path of this scene's soundtrack — the same `[start, end]` span sliced
   *  from the talk WAV and uploaded at cut time alongside `clipUrl` (story 03k).
   *  URL-only, like everything persisted. The refiner requires it (Gemini listens
   *  to align cuts/segments to the natural flow). Re-cutting overwrites it. */
  clipAudioUrl?: string
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: PASS (type-only, optional field — no call sites break)

- [ ] **Step 3: Commit**

```bash
git add src/lib/scenes.ts
git commit -m "feat(studio): Scene.clipAudioUrl — the scene's cut soundtrack (03k)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: MSW mock requires `audioUrl` (mock-first)

**Files:**
- Modify: `src/mocks/handlers.ts:121-131` (the `/api/refine-scene` handler)

- [ ] **Step 1: Add the field + validation to the handler**

In `src/mocks/handlers.ts`, replace:

```ts
  http.post('/api/refine-scene', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      start?: number
      end?: number
      transcript?: string
      draftText?: string
      cuts?: { start: number; end: number }[]
    }
    const jobId = enqueueJob('refine', mockRefiner(body))
    return HttpResponse.json({ jobId, status: 'pending' })
  }),
```

with:

```ts
  http.post('/api/refine-scene', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      start?: number
      end?: number
      transcript?: string
      draftText?: string
      cuts?: { start: number; end: number }[]
      audioUrl?: string
    }
    // Mirrors the real rule's schema (story 03k): the scene's cut audio is
    // required — refine without ears is the old cough-blind behavior.
    if (!body.audioUrl) {
      return HttpResponse.json({ error: 'audioUrl is required' }, { status: 400 })
    }
    const jobId = enqueueJob('refine', mockRefiner(body))
    return HttpResponse.json({ jobId, status: 'pending' })
  }),
```

- [ ] **Step 2: Verify build + existing tests**

Run: `npm run build && npm run test:run`
Expected: PASS (`MOCK_STUDIO` is `false`; no test posts to this handler without going through `refineScene`, which Task 4 updates)

- [ ] **Step 3: Commit**

```bash
git add src/mocks/handlers.ts
git commit -m "feat(studio): mock /api/refine-scene requires audioUrl (03k, mock-first)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `sliceScene` cuts + uploads the scene audio

**Files:**
- Modify: `src/components/Studio/useScenePipeline.ts:843-883` (`sliceScene` + its doc comment)

- [ ] **Step 1: Replace `sliceScene`**

`sliceAudioWav` is already imported (line 18) and `audioUrl` (the talk WAV serve path) is already in the hook's scope. Replace the whole `sliceScene` callback **and** the comment above it with:

```ts
  // Cut this scene into its own video clip + soundtrack (story 03g + 03k, build
  // step 0). The raw source is the immutable source of truth — every scene
  // re-reads it: prefer the in-memory `file` (no refetch), else pull the persisted
  // source serve URL back. We trim `[start, end]` frame-accurately in ffmpeg.wasm
  // and slice the same span from the talk WAV, upload both (kind `scene-clip` /
  // `audio`, SEQUENTIALLY — the keep-alive 502 lesson), and persist both serve
  // paths in ONE patch, so the scene gets both resources or neither and a reload
  // resumes with the cut done. Re-cutting overwrites both.
  const sliceScene = useCallback(
    async (sceneId: string, file: File | null) => {
      if (slicingId) return
      const scene = scenes.find((s) => s.id === sceneId)
      if (!scene) return
      setSlicingId(sceneId)
      setSceneError(null)
      try {
        if (!audioUrl) throw new Error('No extracted audio to cut the scene soundtrack from.')
        const source = file
          ? new Uint8Array(await file.arrayBuffer())
          : sourceUrl
            ? // Direct bucket read — no `credentials`, it's a presigned URL, and
              // sending cookies cross-origin would fail the CORS check.
              new Uint8Array(await (await fetch(await signedSourceUrl())).arrayBuffer())
            : null
        if (!source) throw new Error('No source clip available to cut from.')

        const command = buildSliceCommand({
          start: scene.start,
          end: scene.end,
          output: `scene-${scene.index}.mp4`,
        })
        const blob = await ffmpegSlice({ source, command })
        const clip = new File([blob], `scene-${scene.index}.mp4`, { type: 'video/mp4' })
        const { url } = await uploadReq({ file: clip, kind: 'scene-clip' }).unwrap()
        const wav = await sliceAudioWav(audioUrl, scene.start, scene.end)
        const audioFile = new File([wav], `scene-${scene.index}-audio.wav`, { type: 'audio/wav' })
        const { url: clipAudioUrl } = await uploadReq({ file: audioFile, kind: 'audio' }).unwrap()
        patchScene(sceneId, { clipUrl: url, clipAudioUrl })
      } catch (e) {
        setSceneError(stageError(e))
      } finally {
        setSlicingId(null)
      }
    },
    [slicingId, scenes, audioUrl, sourceUrl, signedSourceUrl, uploadReq, patchScene],
  )
```

Note the dependency array gains `audioUrl`.

- [ ] **Step 2: Verify**

Run: `npm run build && npm run lint && npm run test:run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/Studio/useScenePipeline.ts
git commit -m "feat(studio): Cut-this-scene saves the soundtrack too (03k)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `RefineSceneRequest.audioUrl` + `refineScene` sends it

Type + call site change together so `tsc -b` never sees a half-state.

**Files:**
- Modify: `src/lib/refiner.ts:51-54` (inside `RefineSceneRequest`)
- Modify: `src/components/Studio/useScenePipeline.ts:744-758` (inside `refineScene`)

- [ ] **Step 1: Add the request field**

In `src/lib/refiner.ts`, replace:

```ts
  /** Bucket serve paths of the scene's dense contact sheets, in order. */
  sheetUrls: string[]
  /** Optional free-text direction from the user. */
  direction: string
```

with:

```ts
  /** Bucket serve paths of the scene's dense contact sheets, in order. */
  sheetUrls: string[]
  /** Serve path of the scene's cut soundtrack (`scene.clipAudioUrl`) — required;
   *  the pipeline signs it like the sheets and Gemini listens to align cut and
   *  segment boundaries to the natural flow of speech (story 03k). */
  audioUrl: string
  /** Optional free-text direction from the user. */
  direction: string
```

- [ ] **Step 2: Guard + pass it in `refineScene`**

In `src/components/Studio/useScenePipeline.ts`, inside `refineScene`'s `try` block, replace:

```ts
      try {
        const scoped = words.filter((w) => w.start >= scene.start && w.start < scene.end)
```

with:

```ts
      try {
        // Belt-and-braces with the SceneRefinePanel gate (story 03k): the refiner
        // is required to listen, so refining an un-cut scene is an error, not a
        // silent fall-back to the old deaf behavior.
        if (!scene.clipAudioUrl) throw new Error('Cut this scene first — the refiner needs its audio.')
        const scoped = words.filter((w) => w.start >= scene.start && w.start < scene.end)
```

and replace the request body:

```ts
        const { jobId } = await refineSceneReq({
          start: scene.start,
          end: scene.end,
          transcript: timedTranscript(scoped),
          draftText: scene.draftText,
          cuts: scene.cuts ?? [],
          sheetUrls,
          direction: '',
        }).unwrap()
```

with:

```ts
        const { jobId } = await refineSceneReq({
          start: scene.start,
          end: scene.end,
          transcript: timedTranscript(scoped),
          draftText: scene.draftText,
          cuts: scene.cuts ?? [],
          sheetUrls,
          audioUrl: scene.clipAudioUrl,
          direction: '',
        }).unwrap()
```

(`studioApi.ts` needs no edit — its `refineScene` mutation is typed by `RefineSceneRequest`.)

- [ ] **Step 3: Verify**

Run: `npm run build && npm run lint && npm run test:run`
Expected: PASS — if `tsc` flags any other `RefineSceneRequest` literal (e.g. a test fixture), add `audioUrl: '/api/uploads/audio/scene-0-audio.wav'` to it rather than loosening the type.

- [ ] **Step 4: Commit**

```bash
git add src/lib/refiner.ts src/components/Studio/useScenePipeline.ts
git commit -m "feat(studio): refine request carries the scene audio (03k)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Refine gate in `SceneRefinePanel` (TDD)

**Files:**
- Test: `src/components/Studio/SceneRefinePanel.test.tsx` (create)
- Modify: `src/components/Studio/SceneRefinePanel.tsx:36-37, 51-68, 107-115`

- [ ] **Step 1: Write the failing test**

Create `src/components/Studio/SceneRefinePanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { SceneRefinePanel } from './SceneRefinePanel'
import type { Scene } from '../../lib/scenes'

const noop = () => {}

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    index: 0,
    title: 'Opening',
    start: 0,
    end: 10,
    transcript: 'hello there',
    draftText: 'hello there',
    cuts: [],
    sheets: [{ index: 0, dataUrl: '', url: '/api/uploads/thumbnails/sheet-01.jpg' }],
    ...overrides,
  } as unknown as Scene
}

function renderPanel(scene: Scene) {
  return render(
    <SceneRefinePanel
      scene={scene}
      slicing={false}
      sheeting={false}
      refining={false}
      onSlice={noop}
      onGenerateSheets={noop}
      onRefine={noop}
      onClear={noop}
    />,
  )
}

describe('SceneRefinePanel refine gate (story 03k)', () => {
  it('disables Refine until the scene is cut, with a hint', () => {
    renderPanel(makeScene({ clipUrl: '/api/uploads/scene-clip/scene-0.mp4' })) // no clipAudioUrl
    const refine = screen.getByRole('button', { name: /refine scene/i })
    expect(refine).toBeDisabled()
    expect(refine).toHaveAttribute('title', 'Cut this scene first')
  })

  it('enables Refine when the scene has audio and sheets', () => {
    renderPanel(
      makeScene({
        clipUrl: '/api/uploads/scene-clip/scene-0.mp4',
        clipAudioUrl: '/api/uploads/audio/scene-0-audio.wav',
      }),
    )
    expect(screen.getByRole('button', { name: /refine scene/i })).toBeEnabled()
  })

  it('still hints about sheets when audio is there but sheets are not', () => {
    renderPanel(
      makeScene({
        clipAudioUrl: '/api/uploads/audio/scene-0-audio.wav',
        sheets: [],
      }),
    )
    const refine = screen.getByRole('button', { name: /refine scene/i })
    expect(refine).toBeDisabled()
    expect(refine).toHaveAttribute('title', 'Generate scene contact sheets first')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/Studio/SceneRefinePanel.test.tsx`
Expected: FAIL — the first test: Refine is currently enabled with sheets present (no audio gate yet)

- [ ] **Step 3: Implement the gate**

In `src/components/Studio/SceneRefinePanel.tsx`, replace:

```tsx
  const hasClip = !!scene.clipUrl
```

with:

```tsx
  const hasClip = !!scene.clipUrl
  const hasAudio = !!scene.clipAudioUrl
```

Replace the step-0 status hint:

```tsx
            {hasClip && (
              <span className="ml-2 font-mono text-[12px] text-ink-mute">clip ready</span>
            )}
```

with:

```tsx
            {hasClip && (
              <span className="ml-2 font-mono text-[12px] text-ink-mute">
                {hasAudio ? 'clip + audio ready' : 'clip ready — re-cut to save audio'}
              </span>
            )}
```

Replace the Refine button:

```tsx
            <button
              type="button"
              className="pill-cta"
              disabled={busy || !hasSheets}
              onClick={onRefine}
              title={hasSheets ? undefined : 'Generate scene contact sheets first'}
            >
```

with:

```tsx
            <button
              type="button"
              className="pill-cta"
              disabled={busy || !hasSheets || !hasAudio}
              onClick={onRefine}
              title={
                !hasAudio
                  ? 'Cut this scene first'
                  : hasSheets
                    ? undefined
                    : 'Generate scene contact sheets first'
              }
            >
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/Studio/SceneRefinePanel.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Full verification + commit**

Run: `npm run build && npm run lint && npm run test:run`
Expected: PASS

```bash
git add src/components/Studio/SceneRefinePanel.tsx src/components/Studio/SceneRefinePanel.test.tsx
git commit -m "feat(studio): gate Refine behind the scene cut (03k)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Pipeline rule `afacb572` — sign the audio, feed Gemini, teach the prompt

Server-side, via the BFFless MCP tools. **Invoke the `bffless-pipeline` skill before starting** — it has the handler-chain mechanics and gotchas. No repo files change in this task.

- [ ] **Step 1: Back up the current rule**

Call `mcp__bffless-j5s__get_proxy_rule` with rule id `afacb572` and save the complete JSON response to `/tmp/afacb572-pre-03k.json` (the 03j prompt edits were verified against pre-edit backups — same practice).

- [ ] **Step 2: Add `audioUrl` to the request schema**

In the rule's request-validation step, add `audioUrl` as a **required string**, alongside the existing `sheetUrls`/`draftText`/etc. Then confirm rejection works without spending Replicate credits:

Run: `curl -s -o /dev/null -w "%{http_code}" -X POST https://j5s.dev/api/refine-scene -H 'content-type: application/json' -d '{"start":0,"end":10,"transcript":"","draftText":"x","cuts":[],"sheetUrls":[],"direction":""}'`
Expected: `400` (and a request **with** `audioUrl` must not be sent — it would enqueue a paid Gemini job)

- [ ] **Step 3: Sign the audio and pass it to Gemini**

In the rule's async `postSteps` (03f Part 0), find where `sheetUrls` are signed (presigned GCS URLs minted server-side — the only way Replicate can read bucket objects) and where the Replicate `google/gemini-3.1-pro` call maps `images`. Mirror the signing for the single `audioUrl`, and add the signed result as the model's `audio` input. Gotcha from 03 (memory `project_studio_director_pipeline`): Replicate string inputs are **expressions** — quote string literals.

- [ ] **Step 4: Add the two prompt blocks**

Append to the refiner prompt/system instruction (where `{start}` is the existing scene-start template value the prompt already interpolates):

Offset mapping:

> The attached audio is this scene's soundtrack, cut to exactly this scene's span: audio time 0:00 corresponds to {start} seconds on the timeline used by the transcript, the segments, and the cuts. Add {start} to any time you hear in the audio before using it as a segment or cut boundary.

Flow rule:

> Listen to the audio and align every cut and segment boundary to the natural flow of speech. Anything that does not belong in the final cut — a cough, a shout or an interruption (e.g. yelling at a pet), a throat clear, an off-script noise, a restart — must not start, end, or sit inside a kept segment. Nudge the boundary to exclude it, or split the segment into two around it and let the gap (or a cut) carry the removal. Never tag a segment "original" if its span contains such a sound.

- [ ] **Step 5: Verify the rule edit**

Call `mcp__bffless-j5s__get_proxy_rule` for `afacb572` again and diff against `/tmp/afacb572-pre-03k.json`: the only deltas must be the schema field, the audio signing, the `audio` model input, and the prompt blocks. ⚠️ Live-Gemini behavior (does it actually dodge the cough?) is **deferred** — same as 03j — until James runs a real cut+refine; don't enqueue paid jobs to test.

---

### Task 7: Story status + final verification

**Files:**
- Modify: `stories/inprogress/studio/03k-scene-audio-refiner.md:5` (status line) and the acceptance-criteria checkboxes
- Modify: `stories/inprogress/studio/README.md` (diagram line + table row: 📝 → ✅)

- [ ] **Step 1: Flip the story status**

In `03k-scene-audio-refiner.md`, replace the status line with:

```markdown
**Status:** ✅ shipped (FE + rule `afacb572` schema/sign/audio/prompt) — live-Gemini
effect (does it dodge the cough?) deferred until a real cut+refine runs, same as 03j.
```

and check off every acceptance-criteria box that is actually done (the live-Gemini one stays an annotated deferral, mirroring 03j's style).

- [ ] **Step 2: Update the README**

In `README.md`: change the 03k diagram line's 📝 to ✅, and the table row's status to `✅ done*` (the `*` legend already means "needs the Replicate token / live run").

- [ ] **Step 3: Final gates**

Run: `npm run build && npm run lint && npm run test:run`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add stories/inprogress/studio/03k-scene-audio-refiner.md stories/inprogress/studio/README.md
git commit -m "docs(studio): mark story 03k shipped

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** both-or-neither cut (T3) · refine gate + hint (T5) + guard (T4) · required request field (T4) · mock-first validation (T2) · rule schema/sign/audio/prompt with exact text (T6) · status flip (T7). The spec's out-of-scope list stays out.
- **Type consistency:** `Scene.clipAudioUrl` (T1) is what T3 patches, T4 guards/sends, T5 gates on; the wire field is `audioUrl` everywhere (`RefineSceneRequest`, mock body, rule schema).
- **Order constraint:** T4 must not be split — adding the required field without updating the call site breaks `tsc -b`.
