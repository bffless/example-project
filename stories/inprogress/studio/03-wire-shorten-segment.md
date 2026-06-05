# 03 — Wire shorten + segment into scenes (stages ④⑤)

> Read `00-architecture-and-state.md` first.

**Status:** ⏳ queued · **Backend: BFFless `replicate`/`ai_handler` (LLM).**
The brain of the feature.

## Goal

Replace mocked `buildScenes` with real AI that (④) **shortens the whole
transcript** and (⑤) **groups the shortened transcript into scenes**, returning
each scene as `{ tightened narration text, original-video start/end timestamps,
title }`. These become the scene queue and the YouTube chapters.

## Backend

Can be one pipeline (`/api/scenes`) with two LLM steps, or two endpoints — keep
them as two stages on the board either way.

1. **Shorten** — `ai_handler`/`replicate` LLM. Input = the timestamped
   transcript (from story 02). Prompt: "Condense this talk — cut rambling,
   restarts, and dead weight; keep the points and the speaker's phrasing." Output
   = shortened transcript (ideally still carrying source timestamps per kept
   span).
2. **Segment** — LLM. Input = shortened transcript. Prompt: "Break into logical
   2–5 min scenes where it makes sense (don't split a good continuous run just to
   hit a number). For each scene return a title, the narration text, and the
   original-video start/end timestamps it maps to."
3. `function_handler` — validate: clamp timestamps to `[0, duration]`, ensure
   ascending non-overlapping spans, coerce to the `Scene` shape from
   `src/lib/scenes.ts`.
4. `response_handler` — `{ scenes: [{ title, start, end, transcript, draftText }] }`.
5. Validators: `auth_required` + `rate_limit`.

## Front-end

- Mock `/api/scenes` in MSW (canned scenes with text + timestamps).
- In `useScenePipeline.ts`: stages `shorten` and `segment` call the pipeline;
  set `scenes` from the response (then attach real thumbnails via the existing
  `captureFramesAt` browser step). The scene workspace already consumes the
  `Scene` shape — no UI rewrite.

## Acceptance criteria

- [ ] Real scenes come back with tightened text + valid in-bounds, ascending
      timestamps; they populate the queue and the chapter list.
- [ ] Mock and real share the `Scene` shape (swap, don't rewrite the UI).
- [ ] Timestamps validated/clamped server-side; `auth_required` + `rate_limit`.
- [ ] build/lint/tests pass.

## Out of scope

Voice clone / re-voice (04), assemble/render (05).
