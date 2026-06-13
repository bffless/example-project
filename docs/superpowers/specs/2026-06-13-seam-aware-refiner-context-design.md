# Seam-aware refiner context

## Problem

Each scene is refined by an isolated `/api/refine-scene` call (`useScenePipeline.refineScene`, `useScenePipeline.ts:772`). The model never sees its neighbors, so when scenes are stitched together the seams often don't flow — scene N's narration can open in a way that clashes with how scene N-1 ended, because the two were written independently.

## Goal

When refining scene N, hand the model a short lead-in: which scene this is, and the last sentence or two of what scene N-1's narration ends with — so it can pick up the thread and match cadence at the seam.

## Decisions

- **Scope:** the *tail* of the previous scene only (~last 30 words of its effective narration). Not the full previous narration (noise), not both neighbors (YAGNI / staleness).
- **Where:** a dedicated request field, not folded into the creator's `direction` prompt. Mirrors the existing `direction` / `directorDirection` split (memory `project_studio_scene_prompts`) and keeps machine-context distinct from creator-intent in the prompt-transparency disclosure (story 03m).
- **Automatic:** always included when a previous scene exists. No opt-in checkbox.
- **Source of "ends with":** `effectiveSegments(prevScene)` — the narration the viewer will actually hear (refined segments if present, else the original-transcript fallback). Tail extracted regardless of refined state.

## Changes

### 1. `src/lib/scenes.ts` — pure helper (unit-tested)
```ts
sceneTail(scene: Scene, maxWords = 30): string
```
Join `effectiveSegments(scene)` text, return the last `maxWords` words. Works whether or not the scene is refined.

### 2. `src/lib/refiner.ts` — request shape
Add to `RefineSceneRequest`:
```ts
sceneNumber: number      // 1-based, for "scene 3 of 7"
sceneCount: number
previousContext: string  // sceneTail(prev), '' for the first scene
```
`refineDirections` is unchanged.

### 3. `src/components/Studio/useScenePipeline.ts` — wire it
In `refineScene`, compute the previous scene from the in-scope `scenes` array and add the three fields to the `refineSceneReq` body:
```ts
const idx = scenes.findIndex((s) => s.id === id)
const prev = idx > 0 ? scenes[idx - 1] : null
// body:
sceneNumber: idx + 1,
sceneCount: scenes.length,
previousContext: prev ? sceneTail(prev) : '',
```
No UI change; the `SceneRefinePanel` button is untouched.

### 4. `src/mocks/handlers.ts` — MSW mock
Accept the three new fields and surface them in the mock's prompt-label string (so prompt-transparency reflects the seam context). The canned fixture output is unchanged.

### 5. Real BFFless rule (`afacb572`)
Update the refiner system/prompt template to render the new fields into a labeled lead-in block, e.g.:
> This is scene {sceneNumber} of {sceneCount}. The previous scene's narration ended with: "{previousContext}". Begin so the narration flows naturally from it — do not repeat or rewrite it.

This is the change that actually fixes the seams.

## Trade-off (noted, not solved)

`previousContext` is a snapshot at refine time. Re-refining scene N-1 *after* scene N leaves scene N's lead-in stale until N is re-refined. Acceptable — it's a hint, not a contract, and refining is cheap. A future story could flag downstream scenes as "context changed."

## Out of scope

One-sided (previous only), no UI toggle, no auto-re-refine cascade.

## Testing

- `sceneTail` unit tests in `src/lib/scenes.test.ts`: refined scene (uses segments), unrefined scene (transcript fallback), short text (< maxWords returns all), empty scene (''), word-count truncation.
- `npm run build`, `npm run lint`, `npm run test:run` must pass.
