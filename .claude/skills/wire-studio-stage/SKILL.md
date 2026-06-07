---
name: wire-studio-stage
description: >-
  Wire a new /studio pipeline stage or /api/* endpoint end-to-end following this
  repo's mock-first, swap-don't-rewrite workflow. Use when adding or changing a
  Studio feature that talks to the backend — transcription, the director, the
  refiner, voice/TTS, assemble, thumbnails — or any new `/api/*` the Studio UI
  calls. Covers the exact order of work (MSW mock → pure lib + tests → RTK Query
  → useScenePipeline → UI → real BFFless rule), the non-destructive scene model,
  and what persists vs. stays transient.
---

# Wiring a Studio stage end-to-end

`/studio` is the app's biggest feature. Every stage that touches the backend was
built the same way. Follow this order exactly — it's what keeps the UI stable
while the backend is still mocked, and lets one PR ship one stage.

**Before anything:** read `stories/inprogress/studio/00-architecture-and-state.md`
and the specific story file for the stage you're wiring. The `README.md` there is
the live status table. The stories are the source of truth — don't re-derive the
design from git log or chat. Memory files `project_studio_*` carry extra context.

## The golden rule: mock and real share ONE shape

The single most important pattern. For each `/api/*`, write **one pure coercion
function** (`toScenes` in `director.ts`, `toRefinement` in `refiner.ts`) that takes
the raw response and clamps/coerces it into the typed model. **Both** the MSW mock
**and** the live pipeline run their output through it. Result: swapping the mock
for the real endpoint is a one-line change in `useScenePipeline.ts` and never
touches a component. If you find yourself rewriting UI when you go live, you broke
this rule.

## Order of work

### 1. MSW mock first (`src/mocks/handlers.ts`)

Add the route to the studio handlers, gated by `MOCK_STUDIO` (a module const,
currently `false`). Return a **realistic fixture in the real response shape** —
derive it deterministically from the inputs (clip duration, scene span, draftText)
so it's exercisable offline. Captured fixtures from a real run are ideal (see the
WhisperX `TRANSCRIBE_FIXTURE`). Unhandled `/api/*` falls through the Vite proxy to
`https://j5s.dev`, so leaving the mock out = hitting the live pipeline.

### 2. Pure logic + unit tests (`src/lib/*.ts` + `*.test.ts`)

All real logic goes in `src/lib`, never in components or the hook. Mirror the
existing `director.ts` / `refiner.ts` split:

- Request shaping (e.g. `timedTranscript`, building the prompt inputs).
- `toX(raw, ...)` — the shared coercion: JSON-parse tolerantly, **clamp every
  timestamp into bounds**, sort ascending, de-overlap, drop slivers. Server *and*
  client both clamp; never trust the model's numbers.
- Any layout/derivation (`scenesToTimedWords`, `segmentsToTimedWords`, cut math
  like `addCut`/`removeCut`/`normalizeCuts`, `gaps`/`fitsGap`).

Write the `*.test.ts` alongside, covering coercion edge cases (out-of-bounds,
overlapping, empty). Tests are required — the build/PR gate runs them.

### 3. RTK Query endpoint (`src/store/studioApi.ts`)

Add a mutation. JSON endpoints are a plain `query` POST with
`credentials: 'include'`. Uploads use a custom `queryFn` that wraps
`presignedUpload` (the 3-step prepare → PUT → register flow) so the whole thing is
one mutation. Keep the request/response types next to the endpoint.

### 4. Persist the right state (`src/store/studioSlice.ts`)

Durable business state goes in the Redux `studio` slice (persisted to localStorage
so a hard reload resumes mid-pipeline). Add a reducer (`patchScene`, `setWords`,
`setSynopsis`, …). **Rules:**

- **No base64 in Redux/localStorage.** Persist contact sheets and audio **url-only**
  — the small `/api/uploads/...` serve path. Empty the transient `dataUrl` to `''`
  after upload (the `pendingSheets` pattern).
- **Never store the raw video blob.** It lives in memory until stage ① uploads it;
  after that the serve reference is enough. On reload `Studio.tsx`'s
  `rehydrateClip()` re-fetches it when a browser step needs the bytes.
- Transient-only (React `useState`, fine to lose): the in-memory `File`/object URL,
  `currentTime`, and the spinner flags (`running`, `voicingSegKey`, `sheetingId`…).

### 5. Orchestrate in `useScenePipeline.ts`

This hook runs the prep stages and owns the per-scene actions. Add the action
here, dispatching the RTK Query mutation and writing results into the slice via
the coercion function. For prep stages, the mocked `delay` becomes the real call —
**this is the only place that changes when you go from mock to live.**

### 6. UI last

Build/extend the component (`PipelineBoard` stage card, a `Scene*Panel`,
`TranscriptDiff`, an inline control). Tailwind v4 utilities only — reuse the
editorial tokens/classes (`.pill-cta`, `.pill-ghost`, `.meta-label`, `<Section>`).
Because the shape was fixed in step 2, the UI is identical for mock and real.

### 7. Build the real BFFless rule, then swap

Build the live `/api/*` pipeline (see the **`bffless-pipeline`** skill), verify it
end-to-end, then flip the mock off for that route (or rely on `MOCK_STUDIO=false`).
Note the rule id in the story file.

## Non-destructive layers (director vs. refiner vs. hand-edits)

The director's first-pass `draftText`/`cuts` on a `Scene` are an **immutable
baseline**. The refiner and all hand-edits write to a **separate** `scene.refined`
layer:

```ts
refined?: {
  segments: NarrationSegment[]   // anchored narration runs
  cuts: Cut[]
  source: 'ai' | 'manual'
} | null
```

- Reverting = `refined = null` (`clearRefinement`). Never overwrite `draftText`/`cuts`.
- Downstream always reads `refined ?? baseline` — use `effectiveSegments` /
  `effectiveCuts` from `refiner.ts`, never the raw fields.
- The first manual edit *materializes* `refined` from the baseline, then mutates
  the copy (the `setSegmentAudio`/`editSceneCut` merge pattern). Both AI refine and
  hand-edits fold into ONE flat `refined.cuts` list — un-cutting is a subtraction an
  additive overlay can't express.

## Conventions that will bite you if ignored

- **Fix the code, not the config.** ESLint is strict; `react-hooks/set-state-in-effect`
  and `react-hooks/refs` are **errors**. Derive with `useMemo`, sync refs in effects,
  remount via `key`. No disable comments, no tsconfig excludes.
- **Don't browser-verify / pixel-perfect while prototyping.** Rely on build/lint/tests
  and describe behavior (user preference).
- **One stage per PR.** `npm run build`, `npm run lint`, `npm run test:run` must pass.
  Run a single file with `npx vitest run src/lib/refiner.test.ts`.
- **GitHub via `gh`, never `curl`.**

## Quick checklist

- [ ] Read `00-architecture-and-state.md` + the story file.
- [ ] MSW mock added (gated by `MOCK_STUDIO`), real response shape.
- [ ] Pure `toX` coercion + clamping in `src/lib`, with `*.test.ts`.
- [ ] RTK Query mutation (`credentials: 'include'`); uploads via `presignedUpload`.
- [ ] Slice reducer; url-only persistence, no base64, no raw blob.
- [ ] Action wired in `useScenePipeline` (the one swap point mock→live).
- [ ] UI reads through `effective*`; non-destructive `refined` layer respected.
- [ ] Real BFFless rule built + verified (see `bffless-pipeline` skill), rule id
      noted in the story.
- [ ] build + lint + test:run green; story file + `README.md` status updated.
