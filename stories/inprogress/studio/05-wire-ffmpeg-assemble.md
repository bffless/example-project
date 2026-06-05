# 05 — Assemble the final cut with ffmpeg.wasm

> Read `00-architecture-and-state.md` first.

**Status:** ⏳ queued · **Browser (ffmpeg.wasm). The deliverable.**

## Goal

Turn the built scenes into a downloadable MP4: for each scene, take the footage
span (`start`–`end` of the source) and lay the **re-voiced narration** (from 04)
under it, **fitting the footage to the narration length**, then concatenate the
scenes in order. Chapters/timestamps come from the scene list.

## Open design question (decide here)

The narration is shorter than the footage span. Pick how to fit (and log the
choice in the UI so nothing is silently dropped):

- **Speed up the footage** to the narration length (simple `setpts`), or
- **Trim** the span to a representative sub-clip of the narration length, or
- have **the AI return a tighter sub-span** back in story 03 and just use it.

A per-scene control (time-stretch / trim handles) is the natural follow-up to
the current text-edit-and-regenerate alignment tool.

## Tasks

1. Add `@ffmpeg/ffmpeg` + `@ffmpeg/util`; lazy-load the core on first assemble
   (keep the ~25–30 MB wasm out of the initial bundle — build already warns on
   chunk size). Single-threaded first (no COOP/COEP needed); note where the
   multithreaded core slots in.
2. `src/lib/export/assemble.ts` — per scene: trim/speed the source span to the
   narration duration, replace audio with the scene's narration track; then
   concat all scenes. Build the `filter_complex` in a **pure** helper with unit
   tests (1 scene, N scenes, narration-shorter, narration-longer).
3. `src/components/Studio/AssembleBar.tsx` (or extend `FinalCut`) — progress bar
   wired to ffmpeg `on('progress')`, download link for the result Blob, errors
   surfaced inline, disabled while running.

## Acceptance criteria

- [ ] All scenes built → assemble produces a playable MP4 whose audio is the
      cloned-voice narration, in scene order, footage fit to narration, in sync.
- [ ] ffmpeg core is lazy-loaded; progress shows; errors surfaced.
- [ ] The fit strategy is implemented and **labeled** in the UI; pure graph
      helper is unit-tested.
- [ ] build/lint/tests pass.

## Out of scope

Thumbnail (06), billing (07), multithreaded ffmpeg + COOP/COEP (follow-up).
