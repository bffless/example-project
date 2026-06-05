# 00 — Architecture & current state (read first)

> **📍 Progress:** Scene-producer prototype ✅ shipped (browser stages real,
> pipeline/AI stages mocked — see `../../done/00-scene-producer-prototype.md`).
> Next: wire the real pipelines in order. See `README.md` for the status table.

Shared context for every Studio story. Read this, then your story file. Don't
re-derive any of this from chat history — it's all here.

## What this is

`/studio` turns **one long, rambly screen recording (e.g. 45 min) into a short
video re-voiced in the user's own cloned voice**. It is **not** a manual editor
(a hand-editor was built and scrapped) and not a one-shot auto-shortener. The AI
does the rewriting up front; the user then **produces the result scene by
scene**.

The browser UI = a top-level **stepper** (Import → Prep → Build → Export, from
`studioPhase` in `src/lib/pipeline.ts`) for orientation, then a **prep "notes"
board** (steps run **one at a time** — the current step shows its action button)
followed by a **scene workspace** (a chapter/scene queue + a per-scene editor you
work one at a time).

## The locked flow

**Prep (manual, step by step on import)** — `src/lib/pipeline.ts` `STAGE_DEFS` is
the board; `useScenePipeline.next(ctx)` runs the current step. Real steps each
have their own button; the still-mocked tail is grouped behind one "Finish prep".

| # | Stage | Where | Real or mock today |
|---|-------|-------|--------------------|
| 1 | Save the clip to a bucket | pipeline | **real** (presigned, story 01) |
| 2 | **Extract & upload audio** (16 kHz mono WAV → bucket) | browser + pipeline | **real** (presigned `/api/uploads/audio`, story 01b) |
| 3 | Transcribe with timestamps | pipeline | mock (MSW `/api/transcribe`; whisper = story 02) |
| 4 | **Shorten the transcript** (condense rambling) | pipeline | mock — grouped "Finish prep" |
| 5 | **Group into scenes with timestamps** | pipeline | mock (+ real thumbnails) — grouped |
| 6 | Clone your voice | pipeline | mock — grouped |

Stage 2 now does two things: extract the WAV in-browser **and** upload that WAV
to the bucket on its own (presigned, `/api/uploads/audio`), so stage 3 can hand
Replicate an audio URL — we transcribe the WAV, not the source video.

Stage 5 returns **scenes**, each = `{ tightened narration text, original-video
start/end timestamps, thumbnail }`. These double as YouTube chapters.

**Build (per scene, one at a time)** — the scene workspace:
review the AI-shortened script → **re-voice it in the cloned voice (TTS)** →
check narration length vs the footage span → align → **mark built**. When all
scenes are built, **assemble** them with ffmpeg.wasm into the final cut.

Key consequence: the shortened narration is **shorter than the original footage
span**, so on assemble the **footage is fit to the narration** (trim/speed —
open design question, see story 05). Text-edit + regenerate is the first
alignment tool; time-stretch comes later.

## Key technical facts

- **Audio extraction is real, browser-side** (`src/lib/audio.ts`): WebAudio
  decode → OfflineAudioContext (mono + 16 kHz) → WAV PCM16 Blob. Upload the WAV
  (not the video) for STT.
- **Scene thumbnails are real, browser-side** (`src/lib/frames.ts`
  `captureFramesAt`): seek a detached `<video>` to each scene midpoint → canvas.
- **Scene model** lives in `src/lib/scenes.ts` (`Scene`, `buildScenes` =
  mock shorten+segment, `narrationSeconds`, `alignment`). The real stage-4/5
  pipeline replaces `buildScenes` and must return the same `Scene` shape.
- **Orchestration**: `src/components/Studio/useScenePipeline.ts` runs the prep
  stages and owns the scene queue + per-scene edit/voice/build state. **Swap a
  mocked stage for a real `/api/*` call here without touching the UI.**
- **Final render = ffmpeg.wasm in the browser** (story 05). Multithreaded
  ffmpeg.wasm needs COOP/COEP cross-origin-isolation headers (set via a BFFless
  cache/response-header rule on `/studio`); single-threaded works without them —
  start there.

## BFFless building blocks (for wiring)

Pipelines = handler chains, no server code. Relevant handlers: `file_upload`
(→ storage), `file_serve` (Range-aware), `signed_url`, `replicate` (whisper for
STT; an LLM/Gemini for shorten+segment; voice-clone + TTS — auto-uploads large
inputs to Replicate Files), `ai_handler`, `function_handler`, `http_request`,
`stripe_checkout`/`stripe_webhook`. Validators: `auth_required`, `rate_limit`.
Expressions: `input.*`, `query.*`, `steps.<name>.*`, `user.*`.

Front-end calls `/api/*` with `fetch(..., {credentials:'include'})`; mirror the
upload-then-POST flow in `src/components/ContactDialog.tsx`. **Mock every new
`/api/*` in `src/mocks/handlers.ts` (MSW) first**, build the UI, then wire it.

## Conventions (enforced — don't fight them)

- **Tailwind v4, CSS-first** — tokens in `src/index.css` `@theme`; reuse
  `.pill-cta`, `.pill-ghost`, `.meta-label`, `.container-page`, `.rule`,
  `<Section>`/`<PageHero>`/`<Dot>`. Paper/ink/terracotta editorial look.
- **Fix the code, not the config** — ESLint is strict; `react-hooks/
  set-state-in-effect` and `react-hooks/refs` are **errors**. Derive with
  `useMemo`, sync refs in effects, remount via `key`. No disable comments.
- **Pure logic in `src/lib/*`, unit-tested** next to source (`*.test.ts`).
- **Don't browser-verify / pixel-perfect during prototyping** — rely on build/
  lint/tests and describe behavior (user preference).
- **GitHub via `gh`, never `curl`.** Each stage is its own PR; `npm run build`,
  `npm run lint`, `npm run test:run` must pass.

## Commands

`npm run dev` · `npm run build` · `npm run lint` · `npm run test:run`
· `npx vitest run src/lib/scenes.test.ts` · `npm run test:e2e`.
