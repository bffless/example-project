# 03h — Free segment editing (drop anywhere + move runs)

> Read `00-architecture-and-state.md` first.

**Status:** 📝 design (approved, not yet implemented) · **Frontend-only — no new
`/api/*`. Pure model + diff-viewer interactions. The ffmpeg assembler
(`src/lib/export/assemble.ts`) is unchanged.**

## Why

The Build diff viewer can place an **original-audio** clip onto the New pane
(story 03d, the green "placing" banner), but only into a **gap that fits** — the
`fitsGap` guard refuses any drop that would overlap an existing run, and once a
run is placed it can't be moved. That's too rigid: the producer wants to re-use a
chunk of original audio that's longer than the nearest gap, and to nudge runs
around to line them up with the footage.

This story makes the New pane a **free editing surface**: drop a clip **anywhere**
(overlap allowed) and **drag any run** to re-time it. The earlier idea of an
"insert vs overwrite" toggle is **dropped** — with overlap allowed, there's only
one drop behavior, so no mode button is needed.

## The model (decided in brainstorming)

- **The New side never grows.** It stays pinned to `[scene.start, scene.end]`.
  Every drop and move is **clamped** so a run's end never passes `scene.end`. This
  is what keeps narration from ever exceeding the video budget — the problem we
  explicitly designed *away*.
- **Overlap is a legal, in-progress state, not an error.** Dropping a clip over an
  existing run (or dragging one run onto another) is allowed. The overlap region
  is **flagged** (a distinct conflict fill + a count) so the producer can see it
  and **drag a run off** to clear it.
- **No audio mixing.** The assembler assumes runs don't overlap (it concatenates
  one clip per slice). We do **not** add `amix`. Instead, **assemble is blocked
  while any overlap remains** — a clear message, never a silent audio-drop.
  Resolving overlaps (by moving a run) is the expected path. *Future, optional:*
  if we ever want to intentionally keep an overlap and have both play, that's the
  separate `amix` work — explicitly out of scope here.
- **Non-destructive, like everything else.** Drops and moves write
  `scene.refined` with `source: 'manual'`; the director/refiner baseline is never
  touched. Downstream still reads `effectiveSegments` / `effectiveCuts`.

### Worked example

Run `B` at `[30, 40]`. Drop a 10s original clip at `25` → it lands `[25, 35]`,
overlapping `B` over `[30, 35]`. The overlap lights up; assemble is blocked. The
producer drags `B` later until it clears (clamped so its end never passes
`scene.end`), the overlap resolves, assemble unblocks. The timeline never grew
past the scene.

If a scene is so packed that no move can separate two runs, the producer
**deletes** one (the existing per-run delete) — the clamp guarantees you can
never "make room" by growing the timeline, so delete is the escape hatch.

## Scope of changes

### 1. Pure model — `src/lib/refiner.ts` (+ `refiner.test.ts`)

- **Drop anywhere:** the drop no longer needs to fit a gap. Keep only a
  **within-scene clamp** so `[dropStart, dropStart + len]` stays inside
  `[scene.start, scene.end]` (shift the start left if the tail would pass the
  end). Overlap with existing runs is allowed. `fitsGap` is **repurposed from a
  gate to a hint** — it no longer blocks the drop (the guard is removed from
  `useScenePipeline`); the diff keeps it only to *tint* the footprint preview
  (lands-clean vs will-overlap). Gap glow itself comes from `gaps()` /
  `dropTargets`, unchanged.
- **`moveRun(segments, index, newStart)`** → returns the list with that run moved
  to `newStart` (keeping its duration), **clamped** to `[scene.start,
  scene.end - duration]`, re-sorted ascending by `start`. (Pure; the caller snaps
  `newStart` to the grid.)
- **`overlaps(segments)`** → the overlapping spans on the New timeline (a
  `Cut[]`-shaped list), for both the conflict paint and the assemble gate.
  Touching-but-not-overlapping (`a.end === b.start`) is **not** an overlap;
  sub-`0.05s` slivers are ignored (consistent with `gaps()`).

### 2. Pipeline actions — `src/components/Studio/useScenePipeline.ts`

- `adoptOriginalAudio`: drop the `fitsGap` guard; clamp the drop within the
  scene; allow overlap. Everything else (slice → upload → `scene.refined`) is
  unchanged.
- New **`moveRun(sceneId, index, newStart)`** action → `patchScene` with
  `refined.segments = moveRun(base.segments, …)`, recomputing `narrationSeconds`.
  Mirrors the existing adopt/delete actions.

### 3. Diff viewer — `src/components/Studio/TranscriptDiff.tsx`

- **Drop:** relax `fitsAt` / `onDrop` so a click lands **anywhere** in the scene
  window (clamped). Gaps still glow green as hints. The footprint preview stays,
  tinted to signal *will-overlap* vs *lands-clean* — informational only, both
  are droppable.
- **Move:** the **voice-control row is the drag handle** (chosen so it doesn't
  collide with cut-painting, which owns pointer-drags on the grid *cells*).
  Vertical pointer-drag on a run's `SegmentVoiceControl` → snapped `newStart` →
  `onMoveRun`. A live preview shows the run's new band while dragging.
- **Overlap paint:** a new `overlapCols` (from `overlaps()`) renders the
  conflict region with a distinct fill (warning hatch/amber — *not* the normal
  voiced green, *not* cut red). A small "N overlap(s) to resolve" note sits by
  the pane header.

### 4. `SegmentVoiceControl.tsx`

Add the drag-handle affordance (grab cursor + a hit area) and surface the
pointer-down that begins a move. Keep the existing record/AI/play controls.

### 5. Assemble gate — `SceneAssembleBar.tsx`

Compute `overlaps(effectiveSegments(scene))`; if non-empty, **disable Assemble**
and show "Resolve N overlapping run(s) first." (Belt-and-braces: leave the
assembler's "first run wins" behavior as the deterministic fallback so a stray
overlap can never crash the render — the UI just won't let you get there.)

### 6. Wiring — `src/pages/Studio.tsx`

Pass `onMoveRun={pipe.moveRun}` and the `overlaps` list into `TranscriptDiff`.

## Out of scope (YAGNI)

- **Audio mixing of overlaps** (`amix`) — overlaps are resolved, not kept.
- **Word-level editing** ("move individual words") — runs are the unit that
  carries audio; only whole runs move.
- **Horizontal / free-pixel dragging** — moves snap to the grid (`segmentSeconds`)
  like cuts and drops.
- **Rippling** (push/pull neighbours) — drops and moves only ever move the *one*
  run; nothing else shifts. The fixed-length timeline + overlap-then-resolve is
  what replaces ripple.

## Testing

- `refiner.test.ts`: `moveRun` (basic move, clamp at `scene.end`, re-sort);
  `overlaps` (none / one pair / multiple / exactly-touching / sliver-ignored);
  drop-anywhere clamp.
- Update existing adopt tests that asserted the `fitsGap` rejection.
- `npm run build`, `npm run lint`, `npm run test:run` green. One PR.
