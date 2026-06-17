# Studio Export-phase thumbnail generator (nano-banana) — design

**Date:** 2026-06-17
**Story:** rewrites `stories/inprogress/studio/06-thumbnail-nano-banana.md`
**Status:** design approved, pending spec review

## Problem

Today, when James is ready to upload a finished video, he runs the `image-prompts`
skill by hand to craft a nano-banana prompt, pastes it into Google's nano banana,
and downloads the image manually. This belongs in the product: at the **Export
phase** (where the finished video, recommended title, and YouTube description
already live), generate the **final YouTube thumbnail** in-app.

> **Three things called "thumbnail" — keep them distinct.**
> 1. **Director contact sheet** (`UploadKind: 'thumbnails'`, `scene.thumb`) — the
>    interval-sampled frames we *give* the master director as input.
> 2. **Project-card image** (`ProjectMeta.thumbnailUrl`) — derived from the first
>    contact sheet; the image on the project list card.
> 3. **YouTube thumbnail** (this feature) — the AI *output* image for upload.
>
> This feature is #3 only. Do not touch #1 or #2.

## Approach

A **two-step pipeline**, because the creator edits the drafted prompt before the
image is generated (human-in-the-loop, per story 06's "return it editable"):

1. **`POST /api/thumbnail/draft`** — an `ai_handler` (one-time completion, JSON
   response format) that **drafts** the nano-banana prompt. Returns `{ prompt }`.
2. **`POST /api/thumbnail/render`** — a `replicate` step calling
   `google/nano-banana` with the (edited) prompt; stores the image to the bucket
   and returns a serve path. Returns `{ imageUrl }` (a `/api/uploads/...` path).

Text-only — no reference frame is fed to nano-banana. No variations grid.

### Why the skill is *selected*, not inlined

The `image-prompts` skill (`.bffless/skills/image-prompts/`) is **enabled and
selected** on the draft handler via BFFless's Skills panel (Skills Mode → *Select
Skills* → `image-prompts`; Skills Path `.bffless/skills`). The handler loads it
with the `load_skill` tool at runtime. The skill is the **example/reference**
that owns prompt anatomy, the named house styles, content-type style routing, and
the text/color/negatives rules — *not* foundation duplicated into the system
prompt. The system prompt stays lean and **directs the handler to use the skill**.

This requires `.bffless/skills/image-prompts/` to be **committed** so it deploys
with the bundle (currently untracked).

## The draft handler's system prompt

> You write a single image-generation prompt for `google/nano-banana` that becomes
> a YouTube video's final thumbnail.
>
> You have the **`image-prompts` skill** — **load it with `load_skill` before
> writing.** It defines the prompt anatomy, the named house styles
> (retro-blueprint / modern-dev-tool / editorial-print), how to route a style from
> the video's content type, the text/color/negatives rules, and examples. Follow
> it exactly; don't invent your own format.
>
> The user message gives you **TITLE**, **DESCRIPTION**, **SCRIPT** (the final
> spoken script — your evidence for what the video is about and which house style
> fits), and **NOTES** (the creator's optional free-text wishes). When NOTES are
> present they **override** style routing and defaults — honor them.
>
> Route the house style from the content type per the skill. Write the exact
> headline text yourself (≤5 words) — never a placeholder. Apply the skill's color
> caps and always include the negatives list.
>
> Return **JSON only**: `{ "prompt": "<full multi-section prompt, ready to
> paste>" }` — no commentary, no markdown fences.

### Dynamic user message

Templated from the project (RTK Query request body → handler template vars):

- **TITLE** — `description.title` (the recommended title shown on Export).
- **DESCRIPTION** — the YouTube description (summary + chapters).
- **SCRIPT** — `videoScript(scenes)` (the **final kept** narration, not the raw
  uncut transcript — that's what the video actually is).
- **NOTES** — the creator's free-text "what I want the thumbnail to be like".

## Data flow

```
ThumbnailStudio (Export step)
  notes textarea ─▶ thumbnailDraft({ title, description, script, notes })
                      └▶ POST /api/thumbnail/draft ─▶ ai_handler (+image-prompts skill)
                            ◀── { prompt }
  editable prompt textarea (prefilled with the draft)
  Generate ─▶ thumbnailRender({ prompt })
                └▶ POST /api/thumbnail/render ─▶ replicate google/nano-banana
                      └▶ response_handler: upload image to bucket
                            ◀── { imageUrl: "/api/uploads/<kind>/<id>.png" }
  persist serve path on the project ─▶ on reload, sign via /api/uploads/sign ─▶ <img> + Download
```

## Components / units

- **`src/lib/thumbnail.ts`** (pure, unit-tested) — the shared shape layer, mirror
  of `director.ts`/`describe.ts`:
  - `buildThumbnailDraftRequest(scenes, description, notes)` → `{ title, description, script, notes }`
  - `toThumbnailPrompt(raw)` → `{ prompt: string }` (tolerant, trims, never throws)
  - `toThumbnailImage(raw)` → `{ imageUrl: string }` (tolerant)
- **`src/store/studioApi.ts`** — two mutations: `thumbnailDraft`, `thumbnailRender`.
  Render's response coerced through `toThumbnailImage`. (Reuse `signDownload` for
  display.)
- **`src/store/studioSlice.ts`** — new durable per-project field on
  `ProjectWorkingState`, e.g. `youtubeThumbnail: { notes, prompt, url } | null`,
  persisted **url-only** (no base64). Rides server-sync automatically via
  `toServerRecord`/`fromServerRecord` (it serializes working state into `data`).
  A reducer to set/clear it.
- **`src/components/Studio/ThumbnailStudio.tsx`** — Export-step section beside
  `ExportSummary`: notes textarea → **Draft prompt** → editable prompt textarea →
  **Generate** → image (signed) with **Regenerate** + **Download**. Title /
  description / script pulled from project state. Transient object URLs stay in
  `useState`; the durable serve path lives in the slice.
- **`src/pages/Studio.tsx`** — mount `ThumbnailStudio` in the Export phase.

## Backend (BFFless rules)

- **`/api/thumbnail/draft`** → pipeline: `ai_handler` (JSON, one-time, Skills:
  `image-prompts` selected, Skills Path `.bffless/skills`, system prompt above) →
  `response_handler` `{ prompt }`.
- **`/api/thumbnail/render`** → pipeline: `replicate` `google/nano-banana` (mint a
  `signed_url` server-side only if an input image is ever needed — text-only for
  now) → `file_upload` to bucket → `response_handler` `{ imageUrl }` serve path.
- **`UploadKind`**: add a distinct `'youtube-thumbnail'` kind (so the bucket path
  and debugging are unambiguous); do **not** reuse `'thumbnails'` (the director
  contact sheet) or `'export'`.

## Error handling

- Tolerant coercion in `thumbnail.ts` (never throws on a malformed model reply).
- `REPLICATE_NOT_CONFIGURED` surfaces as a friendly "AI not configured" message
  (the live render needs the project Replicate token in BFFless Settings → AI).
- Draft/render failures leave prior state intact; the editable prompt is retained
  so Generate can be retried without re-drafting.

## Persistence

The rendered thumbnail is uploaded to the **bucket**; its serve path is saved on
the **project record** (`ProjectWorkingState.youtubeThumbnail.url`), so it
survives reload and rides story 11d server-sync across devices. On load it's
**re-signed** via `/api/uploads/sign` (`signDownload`) for `<img>` display and the
**Download** action — never `file_serve` (OOM), per the signed-downloads memory.

## Testing

- Unit tests for `thumbnail.ts` (request shaping + both coercers).
- **MSW mock first** for both endpoints (placeholder image + a drafted prompt),
  gated by `MOCK_STUDIO`; mock and real return the **same shape**.
- `npm run build`, `npm run lint`, `npm run test:run` green.
- No browser/pixel-perfect verification during prototyping.

## Conventions honored

- Mock-first, swap-don't-rewrite; one `toX()` shape for mock + real.
- No base64 in Redux/localStorage — url-only.
- Validators (`auth_required` + `rate_limit`) stay **off** until story 07, like
  the rest of the studio pipeline (local unauthenticated dev). Restore in 07.
- One stage per PR.

## Out of scope

- Reference-frame / image-to-image input (text-only for now).
- Variations grid.
- Brand-template / overlay-text compositing.
- Billing / gating (story 07).
