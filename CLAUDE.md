# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Conventions

- For anything fetched from GitHub (files, PRs, issues, releases, raw content), use `gh` — not `curl`.
- Prefer Tailwind utility classes for new styles rather than writing custom CSS. Theme tokens are defined in `src/index.css` via `@theme` (Tailwind v4 CSS-first config — no `tailwind.config.js`).

## Commands

- `npm run dev` — Vite dev server with HMR
- `npm run build` — type-check (`tsc -b`) then `vite build` into `dist/`
- `npm run lint` — ESLint over the repo (`eslint.config.js`, flat config)
- `npm test` — Vitest in watch mode
- `npm run test:run` — single Vitest run (CI mode)
- `npm run test:coverage` — Vitest with v8 coverage; emits `coverage/lcov.info` consumed by the PR workflow
- Run a single Vitest file: `npx vitest run src/components/ContactDialog.test.tsx`
- Run one test by name: `npx vitest run -t "submits the form"`
- `npm run test:e2e` — Playwright; the config builds the app and starts `vite preview` on port 4173 itself, so no need to run `dev`/`preview` separately
- `npm run test:e2e:ui` — Playwright UI mode

## Architecture

Single-page React 19 + TypeScript app built with Vite 8, deployed as a static bundle to BFFless. There's no application backend in this repo — runtime data and auth come from BFFless endpoints that the deployed site sits behind.

### Runtime integrations

- **`src/components/CommentsSection.tsx`** uses `useBffState` from `@bffless/use-bff-state` against `/api/comments`. The hook owns fetch/update/loading/error state; the component just renders and calls `update({...})` to append. PR-preview deployments resolve `/api/*` through the `api-backend` proxy rule set declared in `.github/workflows/pr-preview.yml`.
- **`src/lib/useSession.ts`** talks to `/_bffless/auth/session` and `/_bffless/auth/refresh` (BFFless built-in cookie-based auth relay). It dedupes concurrent calls via a module-level `inFlight` promise — `refetch()` resets it. Tests and any new auth-aware code must be aware of this singleton: it persists across renders within a session.
- **`src/components/ContactDialog.tsx`** uses the native `<dialog>` element with `showModal()`. Authenticated users get a file-attachment field that uploads to `/api/uploads/contact-attachments` first, then POSTs the resulting `attachment_url` alongside the form payload to `/api/contact`. Unauthenticated users submit without the upload step.

### Tests

- Vitest is configured in `vite.config.ts` (not a separate `vitest.config.ts`): `jsdom`, globals on, setup `src/test/setup.ts` (registers `@testing-library/jest-dom` and `cleanup()` after each test). Test files live next to source as `*.test.ts(x)`.
- Coverage excludes `src/main.tsx` and `src/test/**`; the `lcov.info` output is what `bffless/compare-coverage` diffs against the `production` alias on PRs.
- Playwright tests live in `e2e/`. `e2e/home.spec.ts` mocks both `**/api/comments**` and `**/_bffless/auth/**` via `page.route` so the preview server doesn't need a real backend. Screenshots are written to `screenshots/` and uploaded as artifacts.

### CI / deploys

Two GitHub Actions workflows drive everything:

- `.github/workflows/deploy.yml` — runs on push to `main`. Builds, runs coverage + Playwright, then uses `bffless/upload-artifact@v1` to publish `dist/`, `coverage/`, `screenshots/`, and `playwright-report/` to the `production` alias.
- `.github/workflows/pr-preview.yml` — runs on PRs. Same build/test pipeline, but uses `bffless/compare-coverage` and `bffless/compare-screenshots` against `production` to post diffs as PR comments, then uploads everything to a `pr-<number>` alias with `proxy-rule-set-name: api-backend` so `/api/*` routes work in the preview.

When editing these workflows, note that `bffless/upload-artifact` derives the served prefix from `path` by default — don't set `base-path` redundantly unless the served prefix actually needs to differ from the upload path (see memory `feedback_bffless_base_path.md`).

### TypeScript config

Project references: root `tsconfig.json` → `tsconfig.app.json` (src, bundler resolution, `verbatimModuleSyntax`, `noUnusedLocals/Parameters`, `erasableSyntaxOnly`) and `tsconfig.node.json` (Vite/Playwright configs). `npm run build` invokes `tsc -b`, so type errors in either project break the build — fix the offending code rather than excluding it (see memory `feedback_fix_code_not_config.md`).

## Studio (`/studio`)

The biggest feature area and the current active work. `/studio` turns one long, rambly screen recording into a short video **re-voiced in the user's own cloned voice**: an AI "master director" shortens the transcript and splits it into scenes; the producer then builds each scene one at a time (refine the cut, voice the script, assemble).

**Source of truth is `stories/inprogress/studio/`.** Read `00-architecture-and-state.md` first, then the specific story. The `README.md` there holds the live status table and "where we are now". Don't re-derive the design from chat history or git log — it's all in the stories. Background facts also live in the auto-memory (`project_studio_*` files).

### The locked pipeline

Prep runs six stages **one at a time** (`STAGE_DEFS` in `src/lib/pipeline.ts`; the top-level stepper is Import → Prep → Build → Export from `studioPhase()`):

1. **Upload source** → bucket (presigned, story 01)
2. **Extract + upload audio** (16 kHz mono WAV → bucket, story 01b)
3. **Transcribe** with word timestamps (WhisperX, story 02)
4. **Contact sheet** — interval-sampled frames composed into one timestamped image (browser-side)
5. **Master director** — `/api/scenes`: feeds transcript + contact sheets to `google/gemini-3.1-pro`, gets back `{ synopsis, scenes[] }` where each scene = `{ title, start, end, transcript, draftText, cuts[] }` (story 03)
6. **Voice** — clone the user's own voice / reuse a saved `voice_id` / pick a MiniMax preset (story 04)

Then **Build** (per scene, in `TranscriptDiff.tsx`): optionally run the **per-scene refiner** (`/api/refine-scene`, a denser second-pass director, story 03c) for anchored narration `segments` + better `cuts`; hand-edit cuts (drag-paint); voice each segment (record yourself / AI TTS / reuse original audio); mark built. Story 05 (ffmpeg.wasm assemble) is queued.

### Layout

- **State:** durable business state in the Redux `studio` slice (`src/store/studioSlice.ts`), persisted to localStorage via redux-persist so a hard reload resumes mid-pipeline. `/api/*` goes through RTK Query (`src/store/studioApi.ts`). Only transient UI (in-memory `File`/object URL, spinners) stays in React `useState`. See memory `project_studio_state_redux.md`.
- **Pure logic** lives in `src/lib/*` and is **unit-tested** next to source (`*.test.ts`): `scenes.ts` (Scene model), `director.ts` / `refiner.ts` (request shaping + response coercion, shared by mock and real), `frames.ts` / `contactSheet.ts` (capture + compose), `filmstrip.ts` (sprite index), `audio.ts` (WAV extract/slice), `transcriptGrid.ts` (time-grid layout), `pipeline.ts` (stages/phases).
- **Orchestration:** `src/components/Studio/useScenePipeline.ts` runs the prep stages and owns the scene queue + per-scene edit/voice/build actions, backed by the Redux slice + RTK Query. Swap a mocked stage for a real `/api/*` here without touching the UI.
- **Page:** `src/pages/Studio.tsx` composes the stepper + prep board (`PipelineBoard`) + Build workspace (`SceneTabs` + `TranscriptDiff`).

### Non-negotiable patterns (the skills below cover these in depth)

- **Mock-first, swap-don't-rewrite.** Every new `/api/*` gets an MSW mock in `src/mocks/handlers.ts` (gated by `MOCK_STUDIO`, currently `false`) **before** any UI. Mock and real **must return the same shape** — coerce both through one pure `toX()` function (e.g. `toScenes`, `toRefinement`) so swapping the mock for the live pipeline never touches the UI. Unhandled `/api/*` falls through the Vite proxy to `https://j5s.dev`.
- **Never stream large files through a pipeline.** The BFFless edge nginx caps request bodies at **1 MB** on every route. Uploads use the **presigned direct-to-bucket** flow (prepare → browser PUT to GCS → register); to feed a bucket object to Replicate, mint a `signed_url` server-side and pass that URL.
- **Non-destructive layers.** The director's `draftText`/`cuts` are an immutable baseline; the refiner and hand-edits write to a separate `scene.refined` layer (`source: 'ai' | 'manual'`). Reverting = `refined = null`. Downstream reads `refined ?? baseline` via `effectiveSegments`/`effectiveCuts`.
- **No base64 in Redux/localStorage.** Contact sheets and audio persist **url-only** (the small `/api/uploads/...` serve path); the transient `dataUrl` is emptied after upload.
- **Validators deferred to story 07.** `auth_required` + `rate_limit` are intentionally **off** on the studio pipeline rules so local unauthenticated dev works (see memory `project_studio_upload_auth_temp.md`). Don't "fix" this — restore it in story 07.
- **Replicate token required for live AI.** `/api/scenes`, `/api/refine-scene`, `/api/transcribe`, and the voice endpoints need the project Replicate API token in BFFless Settings → AI. Not exposed via MCP — a human sets it. Without it you get `REPLICATE_NOT_CONFIGURED`.
- **One stage per PR**; `npm run build`, `npm run lint`, `npm run test:run` must pass. Don't browser-verify / pixel-perfect during prototyping (memory `feedback_no_pixel_perfect_prototyping.md`).

When wiring a new studio stage end-to-end, use the **`wire-studio-stage`** skill. When building or debugging the BFFless pipeline behind an `/api/*` endpoint, use the **`bffless-pipeline`** skill.
