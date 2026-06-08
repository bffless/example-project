# 05 — Assemble the final cut with ffmpeg.wasm

> Read `00-architecture-and-state.md` first.

**Status:** ✅ done · **Browser (ffmpeg.wasm). The deliverable.**
**Open follow-ups (not blockers):** speed (smart-cut / `-c copy` — a browser-verified
spike), encode-quality toggle, the defensive `toScenes` clamp. Multithreading parked
(see Optimizations). Audio polish ✅ done.

> **Shipped:** the timeline walk + ffmpeg graph is the pure, unit-tested
> `src/lib/export/assemble.ts` (`buildSlices` → `planAssembly` → `buildFfmpegCommand`,
> 15 cases incl. the worked example below); the wasm core lazy-loads single-threaded
> via `src/lib/export/ffmpeg.ts` — the **ESM** core (the module worker needs a
> `default` export), bundled locally from the `@ffmpeg/core` npm package via Vite
> `?url` (no CDN; the 32 MB wasm is a hashed asset fetched only on first assemble),
> no COOP/COEP needed; `src/components/Studio/AssembleBar.tsx` drives it
> (progress bar, errors, inline `<video>` + download link) and is wired into the Build
> view's Export step (`src/pages/Studio.tsx`). **Assemble is not gated on "built"** —
> that's the producer's own done-tracker; the panel lets them stitch the scenes
> together and preview the cut anytime (un-voiced runs render silent, flagged).
> Trailing dead space is **honored** (kept silent), matching the grid.
>
> **Built tracker.** "Built" is the producer's own per-scene "good to go" flag, set
> via a **Mark built / re-open** toggle in `SceneMeta` (it drives the tab ✓ and the
> `built/total` count) — never set automatically by assembling or saving. The export
> panel surfaces an **all-scenes-built** readiness line, but as a *signal, not a hard
> gate* (you can still assemble a preview anytime). `toggleBuilt` in `useScenePipeline`.
>
> **Optimizations** (audio loudnorm/crossfades, stream-copy speed, multithreaded
> core) are **slated next — none done yet**; see the "Optimizations — slated next"
> section below (incl. why multithreaded ffmpeg.wasm is parked).
>
> **Save (persist the cut).** The assembled MP4 isn't just downloadable — **Save to
> my library** uploads it to the bucket via the presigned `export` flow and persists
> only the serve URL in the Redux `studio` slice (`finalCutUrl`, url-only like every
> other resource), so a hard reload brings the saved cut back to play/download.
> Re-assembling makes a new unsaved blob; saving overwrites the URL. New BFFless
> rules in the `studio` set (clone of the `source` pair, `export/` subDir, shared
> schema `8afd205a`): **prepare** `2ec4f942`, **register** `7459fb60`, **serve**
> `bea10a3d`. `UploadKind` gained `'export'`; `saveFinalCut`/`finalCutUrl` live in
> `useScenePipeline` + the slice. Download stays a separate one-off (local file, not
> saved state). Validators still off (story 07).

## Goal

Turn the built scenes into a downloadable MP4: apply the producer's cuts to the
source footage and lay the re-voiced narration over it, in sync, then download.

## The model (this is the whole thing — keep it this simple)

There is **one source video** and, per scene's `refined` layer, **two lists**:
`cuts[]` (footage spans to drop) and `segments[]` (the new audio clips, each
anchored to original-video seconds with a real measured `audioSeconds`).

Every slice of the original timeline is in exactly **one of three states**, and
that state decides what the slice contributes to the export:

| state | the slice is… | video | audio |
|-------|---------------|-------|-------|
| **cut** | inside a `cuts[]` span | **dropped** | — |
| **segment** | inside a `segments[]` span (and not cut) | **kept** | that clip's audio |
| **dead space** | neither cut nor segment | **kept** | **silence** |

**Cut wins on overlap.** Where a segment and a cut overlap, the cut removes that
footage — so the segment's *kept* video is its span minus any cuts inside it. This
is what keeps each segment's kept video ≈ its `audioSeconds` (see worked example).

**Assemble = walk the original timeline in order**, and for each slice: drop it,
keep-it-with-its-audio, or keep-it-silent. Because video and audio are built from
the same walk, they come out the **same length and in sync automatically** — no
fitting, no stretching, no per-clip alignment math.

### Why there's no fit step

The narration is shorter than the raw footage, but the **edit UI already absorbs
that**: the producer can't cut *more* time than the audio occupies, so for any
kept span `audio ≤ video`. The earlier "speed up / trim to fit the narration"
question is therefore **moot** — the producer settles length by painting cuts,
and assemble just renders what the three states say. Do **not** add a footage-fit
stage.

### Worked example (real state, source = 53s)

`segments`: `[2.3–5.8 original 3.5s] [9–13 recorded 3.9s] [24–43 recorded 12.96s]`
`cuts`: `[0–2.3] [5.8–8.6] [13.5–23.75] [37.1–50]`

| original time | state | video | audio |
|---|---|---|---|
| 0–2.3 | cut | drop | — |
| 2.3–5.8 | seg 0 | keep | original clip (3.5s) |
| 5.8–8.6 | cut | drop | — |
| 8.6–9 | dead | keep | silence (0.4s) |
| 9–13 | seg 1 | keep | recorded clip (3.9s) |
| 13–13.5 | dead | keep | silence (0.5s) |
| 13.5–23.75 | cut | drop | — |
| 23.75–24 | dead | keep | silence (0.25s) |
| 24–37.1 | seg 2 (cut wins past 37.1) | keep | recorded clip (12.96s) |
| 37.1–50 | cut | drop | — |
| 50–53 | dead | keep | silence (3s) ⚠️ **bug, see below** |

Adds up: ~20.6s segment video + 4.15s dead space + 28.25s cut = **53s exactly**.
Note seg 2 spans 24–43 but cut 3 starts at 37.1; **cut wins**, so its kept video
is 24–37.1 = 13.1s ≈ its 12.96s of audio. Each segment's kept video ≈ its audio.

## Trailing dead space

In the example the last cut ends at **50** but the source is **53s**, so 50–53 is
neither cut nor segment → 3s of footage with no narration. There are two separate
layers here; keep them distinct:

**Edit-time visibility — ✅ FIXED (commit `f05d1cf`).** The bug was that the diff
grid sized itself from *content* (the last transcript word / last cut), so when
the talk ends before the clip does (speech stops ~0:50 on a 0:53 clip) the editor
drew **no rows past the last word** — that trailing footage was invisible and
**couldn't be hand-cut**. Fix: `TranscriptDiff` takes a `duration` prop and floors
the grid span at the clip length (`src/components/Studio/TranscriptDiff.tsx`,
wired from `src/pages/Studio.tsx`). The trailing footage now renders as normal
**editable** cells the producer can drag to clip themselves. We deliberately did
**not** auto-trim it — the producer keeps manual control (an earlier auto-cut
attempt was reverted; it hid the footage instead of letting them edit it).

**Assemble-time default — ✅ RESOLVED: honor the edit.** `planAssembly` walks the
full `[0, duration]` timeline regardless of where the scenes/segments stop, so any
trailing tail the producer left uncut becomes a `dead` slice → **kept silent
video**. Export = what the grid shows. This is robust to a last scene whose `end`
stops short of `duration` for free (the walk owns the whole clip, not the scenes),
so the defensive `toScenes` clamp below stayed unneeded for assemble — it would
only matter for *editing* the unowned tail, which the full-duration grid (commit
`f05d1cf`) already handles.

> Defensive follow-up (not done): clamp the last scene's `end` up to `duration` in
> `toScenes` so the **real** director can never leave trailing footage unowned by
> any scene (which would render the cells but block editing — the mock scenes
> already span `[0, duration]`, so this only bites the live director).

## MVP first, enhancements second

Ship the basic, correct render **before** any audio polish. Don't get blocked
debugging a fancy filter — get a playable MP4 out, then sprinkle quality on.

**MVP (this story):**
1. Fix the trailing-dead-space bug (above).
2. Walk the timeline → drop / keep+audio / keep+silence; concat the kept video and
   the audio (segment clips + silence) so they're equal length and in sync.
3. Minimal audio handling required just to concat at all: **resample every clip to
   one common format** (e.g. 48 kHz mono) — the `original` slice and the mic
   recordings won't share a format, and you can't concat mismatched audio. Insert
   silence for dead-space spans. No loudness work, no crossfades yet.
4. Download link for the result Blob; progress + errors surfaced.

**Enhancements (later, layered on — only after MVP plays correctly):**
- **Loudness normalization** (EBU R128 / `loudnorm`) per segment — the screen-rec
  `original` audio and the mic takes sit at different volumes; back-to-back that's
  the most audible problem. Two-pass ideally.
- **Short crossfades** at segment joins to kill clicks.
- Room-tone mismatch between `original` and `recorded` clips is a *re-record in
  your own voice* decision, not an ffmpeg fix — note it in the UI, don't chase it.

## Tasks

1. Add `@ffmpeg/ffmpeg` + `@ffmpeg/util`; **lazy-load** the core on first assemble
   (keep the ~25–30 MB wasm out of the initial bundle — build already warns on
   chunk size). **Single-threaded first** (no COOP/COEP needed); note where the
   multithreaded core slots in (needs cross-origin-isolation headers on `/studio`).
2. `src/lib/export/assemble.ts` — a **pure** helper that turns
   `{ segments, cuts, duration }` into the ordered list of timeline slices
   (cut / segment / dead) and the ffmpeg graph (the `filter_complex`). **Unit-test
   the slice walk**: cut-wins overlap, trailing dead space trimmed, dead space →
   silence, single segment, N segments, segment butting a cut. Keep ffmpeg.wasm as
   a dumb executor of this pure plan.
3. `src/components/Studio/AssembleBar.tsx` (or extend `FinalCut`) — progress bar
   wired to ffmpeg `on('progress')`, download link for the result Blob, errors
   surfaced inline, disabled while running.

## Acceptance criteria

- [x] Trailing footage is visible + hand-cuttable in the editor (full-duration grid,
      commit `f05d1cf`) — not auto-trimmed.
- [x] All scenes built → assemble produces a playable MP4: cuts removed, the three
      states honored (cut/segment/dead), audio in sync, in scene order. *(Pure plan
      tested; end-to-end render runs in-browser via `AssembleBar` — not pixel-verified
      here per the no-browser-prototyping convention.)*
- [x] ffmpeg core is lazy-loaded; progress shows; errors surfaced.
- [x] The pure slice-walk + graph helper is unit-tested (cases above).
- [x] MVP ships **without** loudnorm/crossfades; those are a tracked follow-up.
- [x] build/lint/tests pass *(my files lint clean; 2 pre-existing lint errors live in
      unrelated `ChatPopup/ChatPanel.tsx`).*

## Optimizations

### Audio polish — ✅ DONE
The `original` screen-rec audio and the mic/AI takes sit at different volumes, and
back-to-back that was the most obvious artifact. `buildFfmpegCommand` now applies,
per clip, in `src/lib/export/assemble.ts`:
- **Loudness normalization** — single-pass EBU R128 `loudnorm=I=-16:TP=-1.5:LRA=11`
  so every clip lands at one target loudness (single-pass, not two-pass — pragmatic
  first cut; two-pass measure→apply is a possible later refinement).
- **Short edge fades** — `afade` in (at 0) + out (anchored at the clip's own end via
  the new `AudioPiece.audioSeconds`), ~10 ms, to kill the concat-join clicks.
  **Deliberately NOT `acrossfade`**: a real crossfade overlaps and *shortens* the
  audio, breaking the equal-length video/audio invariant the walk relies on; per-clip
  edge fades preserve it (each piece still `apad`→`atrim`s to exactly `length`).
- Toggle: `buildFfmpegCommand(plan, { audioPolish: false })` (unit-tested both ways).
- Room-tone mismatch between `original` and `recorded` clips is **not** an ffmpeg fix
  — it's a "re-record this run in your own voice" decision; noted in the AssembleBar
  UI, not chased in the graph.

### Speed — open (the hard one; needs a browser-verified spike)
- **Avoid re-encoding (the real prize, NOT done).** Today we re-encode the whole
  timeline with libx264. The kept pieces are all trims of the *same* source, so a
  `-c copy` concat-demuxer path could be orders of magnitude faster — BUT `-c copy`
  only cuts on **keyframes**, and our cuts land at arbitrary times, so a naive copy
  drops/keeps the wrong frames at every boundary (up to a GOP off) or corrupts the
  stream. Doing it right = **smart-cut** (re-encode only the boundary GOPs, copy the
  middle): complex, and **must be verified in a real browser** (can't be unit-tested,
  and a wrong cut ships a corrupt MP4). Left as a deliberate spike, not shipped blind.
- **Encode knobs (minor).** Already `-preset ultrafast`. A preview-vs-final quality
  toggle (`-crf` / resolution cap) is a small lever — a feature more than a perf win;
  not done.

### Multithreaded ffmpeg.wasm — INVESTIGATED, PARKED (don't retry blindly)
Tried `@ffmpeg/core-mt` (threaded libx264 via `SharedArrayBuffer` + pthreads) with
COOP `same-origin` + COEP `credentialless` (dev headers + graceful single-threaded
fallback). **It does not work with `@ffmpeg/ffmpeg@0.12.15` + `core-mt@0.12.10` in
a bundler** — reverted. The blocker is a module/worker-type mismatch, not a config
typo:
- `@ffmpeg/ffmpeg`'s main worker is hard-coded `{type:"module"}`, so it loads the
  core via `import()` → needs the **ESM** core.
- The ESM core spawns its pthread workers as **classic** workers, but the ESM
  pthread-worker file uses `import()` → illegal in a classic worker →
  `Uncaught SyntaxError: Cannot use import statement outside a module`.
- Swapping to the UMD pthread worker just moves the same ESM-syntax failure down to
  its `importScripts(coreURL)`. **No single `coreURL` satisfies both** a module main
  worker and classic pthread workers.

To revisit: pin a known-good `@ffmpeg/ffmpeg` + `core-mt` pairing, or ship a custom
**classic** main worker (`classWorkerURL`) so the whole chain is UMD/classic — and
verify in a real browser (can't be unit-tested). **Prod COOP/COEP headers are moot
until then** — single-threaded needs no cross-origin isolation. BFFless has **no MCP
tool** for response headers (cache rules are caching-only; proxy `headerConfig` is
for `/api/*` routes); it's set in the UI under **Settings → Response Headers**, and
the values would be `Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: credentialless` on `/**`.

## Out of scope

Thumbnail (06), billing (07). Audio polish + speed optimizations above are the
**next-up** follow-ups for this story (not yet done).
