# 05 — Assemble the final cut with ffmpeg.wasm

> Read `00-architecture-and-state.md` first.

**Status:** ⏳ queued · **Browser (ffmpeg.wasm). The deliverable.**

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

**Assemble-time default — still open for this story.** Whatever trailing dead
space the producer *doesn't* clip is, per the three-state rule, kept silent video.
Decide what assemble does with a tail the producer left uncut: keep it silent, or
trim at the last segment. Lean toward **honoring the edit** (keep what's not cut)
so export = what the grid shows — but it should at least be robust to a last scene
whose `end` stops short of `duration` (see the `toScenes` note below).

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
- [ ] All scenes built → assemble produces a playable MP4: cuts removed, the three
      states honored (cut/segment/dead), audio in sync, in scene order.
- [ ] ffmpeg core is lazy-loaded; progress shows; errors surfaced.
- [ ] The pure slice-walk + graph helper is unit-tested (cases above).
- [ ] MVP ships **without** loudnorm/crossfades; those are a tracked follow-up.
- [ ] build/lint/tests pass.

## Out of scope

Loudness/crossfade audio polish (follow-up), thumbnail (06), billing (07),
multithreaded ffmpeg + COOP/COEP (follow-up).
