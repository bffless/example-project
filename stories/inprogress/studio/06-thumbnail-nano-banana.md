# 06 — Thumbnail studio (nano banana)

> Read `00-architecture-and-state.md` first.

**Status:** ⏳ queued · **Backend: BFFless `replicate` (`google/nano-banana`).**
Self-contained side feature; can ship independently of the pipeline stories.

## Goal

Generate the video thumbnail in Studio, replacing the manual flow (a skill
writes a prompt → paste into nano-banana by hand). Pick a scene's frame (we
already capture one per scene), optionally add topic/notes, the pipeline drafts
the image prompt and calls **`google/nano-banana`** on Replicate, and renders
the result inline with regenerate/variations.

## Backend (`/api/thumbnail` pipeline)

1. (optional) `ai_handler` — draft an image prompt from the topic/notes (+ a
   caption of the chosen frame); return it editable.
2. `replicate` — `google/nano-banana`; `input.prompt` = the (edited) prompt;
   pass the chosen scene frame as a reference image where supported.
3. `response_handler` — `{ prompt, imageUrl }` (or store + serve via
   `file_upload`/`signed_url`).
4. Validators: `auth_required` + `rate_limit`.

## Front-end

- Mock `/api/thumbnail` in MSW (placeholder image + drafted prompt) first.
- `src/components/Studio/ThumbnailStudio.tsx`: pick a scene frame (reuse
  `scene.thumb` or grab the current `videoRef` frame), editable prompt textarea,
  Generate → result, Regenerate, a small variations grid, download. Surface it
  as a tab/section so it doesn't clutter the scene workspace.

## Acceptance criteria

- [ ] With the mock: pick a frame → editable drafted prompt → Generate → image →
      Regenerate → download.
- [ ] Real pipeline calls `google/nano-banana`; UI consumes the same
      `{prompt,imageUrl}` shape as the mock.
- [ ] `auth_required` + `rate_limit`; build/lint/tests pass.

## Out of scope

Brand templates / overlay-text compositing, billing (07).
