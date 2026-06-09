# 03g — Per-scene clip slicing (cut each scene to its own video)

> Read `00-architecture-and-state.md` first, then this. Skill: `wire-studio-stage`
> for the end-to-end pattern, `bffless-pipeline` for the upload rule.

## The problem (why this exists)

Assemble today is **one whole-film pass**, not per-scene. `AssembleBar`
(`src/components/Studio/AssembleBar.tsx`) is rendered once in the Export step
(`Studio.tsx:508`), flattens **every** scene's segments + cuts, and runs a single
`planAssembly` over the entire `[0, duration]` timeline against the **full source
video** loaded into ffmpeg.wasm's MEMFS.

That falls apart at length. On a 3:48 clip the Export bar reads
`3:48 → 1:16 (2:32 cut)` — proof it is walking the whole source — and it drags the
full raw file through one giant `filter_complex` (every kept-footage `trim`, one
big `concat`, every audio clip + silence) in a single `libx264` re-encode. The
result: a ~10-minute run that produced **garbage with no audio, broken ~8s in**.
The full file sits in a 32-bit wasm heap (~2 GB ceiling) alongside decode
buffers, the graph balloons, and the single-threaded encode chokes. At ~53s the
same code works fine.

**The fix is divide-and-conquer:** give every scene its own small clip, so all
downstream work touches a ~1–2 min file (the regime that already works), never
the whole film. This story builds the slicing half; the per-scene assemble +
master-concat is the follow-on phase.

## Model

- Slicing is **lazy and per-scene** — a build step you run when you start working
  a scene, not an eager batch after `/api/scenes`. It joins the existing per-scene
  steps (contact sheets, refine) as **step 0**, in front of them.
- The cut is a **frame-accurate trim** of the raw to the scene's
  `[start, end]` span (scene 1 = `0:00–1:44`, scene 2 = `1:44–3:48`), done in
  ffmpeg.wasm. Frame-accurate (not stream-copy) so the clip's `t=0` is exactly
  `scene.start` — clip-local rebasing downstream is just `−scene.start`, and the
  clip is guaranteed clean + seekable. Cost is one short per-scene encode, run
  only when you start that scene — never all at once.
- The clip is **presign-uploaded to the bucket** and its serve URL persisted on
  the scene (`Scene.clipUrl`), like every other artifact — survives reload; a
  reload with `clipUrl` set means the cut's already done; re-cut overwrites it.
- Once cut, the **Build preview player plays the scene clip**, not the full film
  — fixing the "video at the top is the full 3:48 video" problem directly.

## Scope — two phases, ONE branch (`feat/studio-upload-bucket`, no PRs)

**Phase 1 (this work):** the "Cut this scene" step → clip in bucket →
`Scene.clipUrl`, plus swapping the Build preview to the clip. Self-contained and
demonstrable: cut scene 1, the left-hand player becomes the 1:44 clip.

**Phase 2 (next, same branch):** refactor assemble to be genuinely per-scene off
`clipUrl` (clip-local rebasing of cuts/segments) and add the **master-concat** at
Export (stream-copy join of the finished per-scene MP4s — the piece that doesn't
exist yet). Out of scope here.

## Phase 1 — the pieces

### Data model (`src/lib/scenes.ts`)
Add to `Scene`:
```ts
/** Serve path of this scene's own sliced clip ([start,end] of the source),
 *  once cut (story 03g). Absent until the "Cut this scene" step runs; the Build
 *  preview and the per-scene assemble (phase 2) read it instead of the full
 *  source. Re-cutting overwrites it. */
clipUrl?: string
```
(`clipSeconds` is derivable as `end − start`; don't store it.)

### Pure logic + tests (`src/lib/export/`)
- A small pure helper that builds the ffmpeg **trim argv** for a scene span —
  `buildSliceCommand({ start, end, source?, output? })` — frame-accurate
  (`-ss`/`-to` with `-accurate_seek`, re-encode `libx264 ultrafast` + aac,
  `+faststart`). Unit-tested next to source (`*.test.ts`) like `assemble.ts`.
- The clip-local rebasing math (`original = clipTime + scene.start`, and the
  inverse for cuts/segments) lives as a tiny pure helper too, with tests — phase
  2 consumes it but the preview swap needs the forward map now.

### ffmpeg executor (`src/lib/export/ffmpeg.ts`)
Reuse the existing lazy single-threaded core. Add a thin `slice(...)` that writes
the source, execs the trim argv, reads back the clip Blob, cleans up — same shape
as `assemble()`.

### Orchestration (`src/components/Studio/useScenePipeline.ts`)
- New busy flag `slicingId: string | null` (mirror `sheetingId`/`refiningId`).
- `sliceScene(sceneId)`: get the source bytes (in-memory `file` ?? fetch
  `sourceUrl`), run `slice(...)`, presign-upload the clip
  (`uploadReq({ file, kind: 'scene-clip' })`), then persist via a new
  `setSceneClip({ id, url })` reducer. Mirror the `adoptOriginal` (03d) slice +
  upload precedent.

### State (`src/store/studioSlice.ts`)
`setSceneClip` reducer sets `scene.clipUrl`. (Reset clears it with the scene.)

### UI (`src/components/Studio/SceneRefinePanel.tsx`)
Add **step 0 · Cut this scene** above the contact-sheet step: a button driven by
`slicingId === scene.id`, showing "Cut scene" / "Cutting…" / "Re-cut" + a
"clip ready" affordance once `scene.clipUrl` is set. Wire from `Studio.tsx`:
`slicing={pipe.slicingId === selected.id}` / `onSlice={() => pipe.sliceScene(selected.id)}`.

### Build preview swap (`src/pages/Studio.tsx:460`)
When the selected scene has a `clipUrl`, the Build player's `src` becomes the
clip. Two **gotchas** (call them out in code):
1. **Don't clobber the global `duration`.** `onLoaded` sets the Redux `duration`
   the entire diff grid/filmstrip is keyed to (the full-source length). The Build
   clip player must **not** call it — pass a no-op / omit `onLoaded` there, or
   gate it so it only fires for the full-source preview.
2. **Time-base offset.** The clip plays clip-local (`t=0` = `scene.start`); the
   grid/cuts/filmstrip are in original-video seconds. For scene 1 (`start=0`)
   they coincide; scene 2+ needs `original = clipTime + scene.start`. Keep the
   Build player a pure clip *viewer* decoupled from the grid's original-time
   `currentTime`, OR offset its `onTime` by `scene.start`. (Today the Build
   `PreviewPlayer` passes `cuts={[]}` and no `onTime`, so the minimal path is:
   just swap `src`, leave it a viewer.) Fall back to the full source when
   `clipUrl` is absent.

### BFFless rule (`bffless-pipeline` skill)
New presigned **scene-clip** upload, mirroring the `source` upload rules
(prepare → browser PUT → register). Validators **off** until story 07 (see memory
`project_studio_upload_auth_temp.md`). Same `kind` plumbing as `audio`/`thumbnails`.

### Mock (`src/mocks/handlers.ts`)
Add the `kind: 'scene-clip'` presigned upload to the `MOCK_STUDIO` handlers so
local dev never hits the bucket; serve the object back like the other kinds.

## Non-goals
- Per-scene **assemble** off `clipUrl` and the **master-concat** at Export
  (phase 2).
- Stream-copy / multithread / encode-quality tuning (still parked, story 05).
- Touching the validators-off posture (story 07).

## Done when
`npm run build`, `npm run lint`, `npm run test:run` pass; cutting a scene uploads
a clip and persists `clipUrl` (survives reload); the Build preview plays the scene
clip (not the full film) once cut, with the diff grid still keyed to the full
source duration.
