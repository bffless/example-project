# Multi-video sources (upload many clips, one project)

**Date:** 2026-06-13
**Status:** Approved

## What

Let a producer feed `/studio` **multiple source videos** in one project instead
of one. The largest single upload stays capped at ~2 GiB (the browser Web Audio
`decodeAudioData` wall — see memory `project_studio_source_upload_cap`); long
content is handled by adding **several clips** (e.g. 10–20 files, ~30 GiB total),
not by lifting that cap. This is the deferred direction from
`project_studio_multi_video_plan`, now being built.

Each video is uploaded, has its audio extracted, and is transcribed **on its own**
in a per-video loop the user watches. Then a single **master director** call sees
the **whole combined talk** and groups it into chapters. Every chapter belongs to
**exactly one** source video (a chapter never spans a boundary); there are simply
more chapters now, pointing at different videos. Build and Export are essentially
unchanged — each scene already works off its own sliced clip.

## Why

The single-file ceiling is a hard browser limit we chose not to fight (James
rejected both ffmpeg-in-browser and server-side extraction). Real source material
— a day of screen recordings, a multi-part talk — naturally arrives as several
files. Supporting an **array** of sources keeps prep fully client-side, sidesteps
the 2 GiB wall, and matches how the footage actually exists. The pipelines barely
change: it's the same upload → extract → transcribe → direct flow, looped over an
array, with the director and storage models reconciled so chapters stay per-video.

## Design

### The reconciliation at the heart of this

Two facts are in tension and the design exists to hold both:

1. **The master director must run once, over everything**, so it can paint the
   big picture (a coherent synopsis and chaptering across the whole talk). Calling
   it per-video would lose the global view.
2. **Each stored chapter belongs to one video** (`one chapter = one video`), so
   Build slices from a single clip and Export concats per-scene clips — both
   unchanged.

We hold both by giving the director a **global/concatenated view** as *input* and
storing **per-video scenes** as *output*:

- **Input:** a combined transcript in source order, every word offset onto one
  global timeline, with explicit **video-boundary markers**, plus one global
  contact sheet spanning all videos (frames stamped with global time). The prompt
  instructs the director to keep each chapter inside one video.
- **Output coercion (`toScenes`):** map each returned global-timed scene back to
  `(sourceId, localStart, localEnd)`. If a scene still **crosses a boundary**,
  **auto-split** it at the boundary into per-video scenes (instruct + auto-split
  fallback — the stored model is always valid even if the model misbehaves).

### Data model — a `sources[]` array

Today `studioSlice` holds one video's fields (`sourceUrl`, `audioUrl`,
`audioPeaks`, `words`, `duration`, `fileName`, and the per-video `stageProgress`).
Introduce a `VideoSource` and make state hold an array:

```ts
type VideoSource = {
  id: string
  order: number              // sequence + global-timeline offset; drag updates it
  fileName: string
  duration: number
  sourceUrl: string | null   // bucket serve path (signed on read, never streamed)
  audioUrl: string | null
  audioPeaks: number[]
  words: TranscriptWord[]
  stageProgress: StageProgressMap   // per-video: upload / extract / transcribe
}
```

`studio.sources: VideoSource[]` replaces the flat per-video fields. **Whole-project**
state stays top-level: the global `contactSheets`, `synopsis`, `direction`,
`scenes`, `voice`/`savedVoices`, `finalCutUrl`, and the new global contact-sheet
stage progress.

`Scene` (in `src/lib/scenes.ts`) gains **`sourceId: string`**, and its `start`/`end`
become **local to that source video** (not global). Helpers that assume one
timeline (`sceneAtTime`, the Build diff windowing) operate within a scene's source.
The global timeline exists only transiently while building the director request and
coercing its response; it is never the stored coordinate system.

**Global ↔ local mapping** is a small pure helper: given the ordered `sources[]`,
each video occupies `[offset, offset + duration)` where `offset` is the sum of
prior durations. `globalToLocal(t)` → `(sourceId, localT)`; `localToGlobal(sourceId,
localT)` → `t`. Unit-tested, used by the combined-transcript builder, the global
contact-sheet sampler, and `toScenes` coercion.

**Back-compat / migration.** A top-level redux-persist merge can't reshape a flat
single-video session into `sources[]`. Add a redux-persist **migration** (bump the
persist version) that, when it finds the old flat shape, wraps `sourceUrl` /
`audioUrl` / `audioPeaks` / `words` / `duration` / `fileName` / `stageProgress`
into a one-element `sources[]` and stamps the existing scenes with that single
`sourceId`. An in-progress single-video project survives the upgrade untouched.

### Prep flow — per-video accordion + a standalone global contact-sheet step

**Import** becomes multi-select. The user adds N videos (each still guarded at
≤2 GiB by the existing client check); they land in an **ordered queue** that is
**drag-to-reorder** (order drives both the director's source ordering and the
final concat). Order and reordering happen before/around prep; reordering after the
director has run is out of scope for v1 (it would invalidate scenes).

The per-video loop runs **three** steps (contact sheets are no longer here):

1. **Upload** source → bucket (presigned, story 01)
2. **Extract & upload audio** (16 kHz mono WAV → bucket, story 01b)
3. **Transcribe** with word timestamps (WhisperX, story 02)

Each video is an **accordion row** showing its own 3-step progress. "Process this
video" auto-runs that video's three steps in sequence with live per-step status;
"Process all" walks the queue video-by-video. The user watches each video advance
through its steps. This reuses today's `STAGE_DEFS` machinery, scoped per source.

`STAGE_DEFS` therefore splits into **per-video** stages (`upload`, `extract`,
`transcribe`) tracked on each `VideoSource.stageProgress`, and **global** stages
(`thumbnails`/contact-sheets, `director`, `clone`) tracked in top-level progress.
The `studioPhase()` derivation of "prep done → Build" becomes: every video's three
steps done **and** the global sheets + director + clone done.

**Contact sheets move out of the loop into one global step** that runs after every
video is transcribed — because only then is the **total combined duration** known.
It samples frames across the **whole** timeline with spacing scaled to that total
(longer total → wider spacing), so the composed sheets land at the director's
**~10-image cap** (`project_studio_director_gemini`) regardless of length. Each
frame is captured from the correct video at its **local** time but **stamped with
global** time, so the director reads one continuous contact sheet. (The per-scene
**refiner** sheets in Build are unaffected — they remain dense and per-scene.)

### Master director — `/api/scenes`, unchanged endpoint

One call, same rule (`138f27fb`). The request body changes only in how the
transcript is assembled: a **combined** `timedTranscript()` across sources in order,
each line offset to global time, with a clear **boundary marker** between videos
(e.g. a labeled separator line naming the next source and its global start). The
prompt gains one rule: *group into chapters, but never start a chapter in one video
and end it in another.* `toScenes` does the global→local mapping + auto-split
described above. `synopsis` stays a single whole-talk logline.

### Build — unchanged flow, `sourceId`-aware resolution

The only change: the reads that today pull from the single global `sourceUrl` /
`audioUrl` (`useScenePipeline.ts` — scene slicing for `clipUrl`/`clipAudioUrl`,
story 03g; the refiner's dense sheet capture, story 03c; `signedSourceUrl()`)
look up **the scene's source video** by `sceneId → sourceId` and sign **that**
video's URLs. Footage already comes from the **bucket via a signed URL**
(`useScenePipeline.ts:925`), never the in-memory `File`, so there is no
hold-in-memory or re-attach problem — Build just points at a different bucket
object per scene. Diff viewer, voicing, mark-built: untouched. The producer still
builds one scene at a time; there are just more scenes, across different videos.

### Export — no change

Each scene assembles off its own `clipUrl`, and the final cut is the stream-copy
concat of every scene's `assembledUrl` in scene order (story 05). Because each
`clipUrl` is now sliced from its respective source video, multi-video export falls
out for free. Scene order = source order (chapters are emitted per video, in the
queue's order), which the concat already honors.

### Tests

- `src/lib/sources.ts` (new) + `sources.test.ts`: `globalToLocal` /
  `localToGlobal` / offset math; combined-transcript assembly with boundary
  markers; the global contact-sheet sampling-interval calc (total-duration → frame
  spacing under the image cap).
- `toScenes` coercion tests: global→local mapping; boundary auto-split; a scene
  fully inside one video unchanged.
- Migration test: a persisted flat single-video state rehydrates into a
  one-element `sources[]` with scenes stamped, nothing lost.
- Component tests for the multi-add import + reorderable accordion (add, reorder,
  per-video progress, "Process all").

## Decomposition into stories

One spec, a phased plan (one stage per PR, per the studio rule). Each builds on the
last and keeps the single-video path working throughout:

- **09a — state refactor.** `sources[]` + `VideoSource`, `Scene.sourceId`,
  redux-persist migration, the `sources.ts` global↔local helpers. Pure/logic +
  tests; no user-visible behavior change (single video still works end-to-end).
- **09b — multi-add import + per-video prep loop.** Multi-select import, the
  ordered drag-to-reorder queue, the per-video accordion running upload → extract
  → transcribe with "Process this video" / "Process all".
- **09c — global contact-sheet step + combined transcript.** Lift sheets out of
  the loop into a standalone total-duration-aware step; build the combined,
  boundary-marked director transcript.
- **09d — director coercion + Build resolution.** `toScenes` global→local mapping
  and boundary auto-split; make Build's slicing / refiner / signing resolve by
  `scene.sourceId`. (Export needs no story.)

## Out of scope

- Lifting the ~2 GiB per-file cap, ffmpeg-in-browser, or server-side extraction
  (explicitly rejected — `project_studio_multi_video_plan`).
- Chapters that span a video boundary (forbidden by design; auto-split if returned).
- Reordering videos **after** the director has run (would invalidate scenes); v1
  reordering is a pre-direct step.
- Per-video synopses / cross-video continuity hints beyond the single whole-talk
  synopsis the director already returns.
- Concurrent/parallel per-video processing — the loop is sequential (one video,
  then the next) to keep uploads and the dev proxy well-behaved
  (`reference_vite_proxy_keepalive_502`).
- Auth / rate-limiting on any rule (story 07).
