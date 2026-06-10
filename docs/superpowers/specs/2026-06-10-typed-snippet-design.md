# Typed snippet runs (type-then-place)

**Date:** 2026-06-10
**Status:** Approved

## What

Let the producer add a short, hand-typed narration run to the New pane — text
that comes from neither the original transcript nor the director/refiner — then
voice it with the existing per-run controls (record yourself / AI TTS).

## Why

Sometimes the new edit needs a connective line ("Now let's look at the
dashboard") that the source footage never said. Today the only ways to get a
run are the refiner's segments or adopting original audio; there is no way to
introduce new words.

## Design (approach A: type-then-place)

### UI flow (`TranscriptDiff.tsx`)

- A **"＋ Add snippet"** button in the diff toolbar, shown only when the viewer
  is editable (i.e. an `onAddSnippet` callback is wired — the Build workspace).
- Clicking it opens a sticky bar (same pattern as the "Placing…" banner): a
  text input, a live duration estimate from `narrationSeconds(text)` (word
  count ÷ 2.5 wps — the same rule the director plans with), a **Place** button
  (disabled while the text is blank), and Cancel (Esc).
- **Place** puts the New pane into the existing place mode: gaps glow, a
  clamped footprint preview sized to the estimate follows the cursor, click
  drops it. Esc cancels. This reuses the `pendingClip` machinery — the payload
  is text instead of a grabbed audio span.
- Starting a fresh Original-pane selection cancels a pending snippet (one
  placement gesture at a time).

### Model (`useScenePipeline.ts`)

- New `addSnippet(sceneId, text, dropStart)`: builds an unvoiced
  `NarrationSegment { text, start, end: start + estimate }`, clamped with
  `clampDropStart`, inserted with `insertSegment` into the `scene.refined`
  layer (`source: 'manual'`) — the same non-destructive layering as
  adopt-original. Cuts are untouched (no audio contradicts a cut). Overlap
  stays a legal, flagged state.
- The page routes the drop to the scene owning the drop time (same as
  `onAdoptOriginal`).
- No new `/api/*`, no Redux slice changes — a snippet is just a segment
  without audio, which the model already supports.

### Voicing

Zero new code: the run's VOICE row already renders Record / AI for any
unvoiced segment. One behavior change: when voicing completes,
`setSegmentAudio` also updates the run's `end` to `start + measured
audioSeconds`, so the footprint reflects the real clip rather than the
word-count guess. This applies to re-voicing existing runs too — bands become
truthful everywhere.

### Tests

- Component tests in `TranscriptDiff.test.tsx`: open bar → type → place →
  click a New-pane cell → asserts `onAddSnippet(text, dropTime)`; Esc cancels.
- Footprint-resize-on-voice covered at whatever level is practical.

## Out of scope

- Editing a snippet's text after placement (delete + re-add covers it).
- Any new backend endpoint.
