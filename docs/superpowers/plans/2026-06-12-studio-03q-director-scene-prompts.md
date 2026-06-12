# Studio 03q — Director Writes Per-Scene Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the master director author a default per-scene *refine prompt* (prepopulating 03l's editable `scene.refinePrompt`) instead of drafting a per-scene script (`draftText`), and remove `draftText` end-to-end.

**Architecture:** The director's per-scene output changes from `draftText` (a finished script the refiner ignored since 03p) to `refinePrompt` (a 1–2 sentence instruction the refiner already consumes as its `direction` via 03l). `draftText` is then deleted from the model, taking three pieces of diff-viewer-era orphaned code with it. Tasks 1–4 are additive and stay green; Task 5 is the atomic field removal; Task 6 is UI copy; Task 7 rewrites the backend Gemini prompt.

**Tech Stack:** React 19 + TypeScript, Vite 8, Vitest + Testing Library, Redux Toolkit, MSW (mocks gated by `MOCK_STUDIO`), BFFless pipeline rule `138f27fb` (`POST /api/scenes`, `google/gemini-3.1-pro`).

**Spec:** `stories/inprogress/studio/03q-director-scene-prompts.md`

**Branch:** `feat/studio-03q-director-scene-prompts` (already created; spec already committed).

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/lib/director.ts` | modify | `DirectorScene` wire type; `toScenes` coercion; delete `scenesToTimedWords` |
| `src/lib/director.test.ts` | modify | `toScenes` → `refinePrompt`; title fallback from transcript |
| `src/lib/scenes.ts` | modify | remove `Scene.draftText`; `buildScenes` emits `refinePrompt`; drop `SHORTEN_RATIO` |
| `src/lib/scenes.test.ts` | modify | `buildScenes` asserts `refinePrompt`; fixture loses `draftText` |
| `src/lib/refiner.ts` | modify | `effectiveSegments` fallback → `scene.transcript` |
| `src/lib/refiner.test.ts` | modify | fallback tests use `transcript` |
| `src/components/Studio/SceneMeta.tsx` | modify | Script + Est-narration stats from `effectiveSegments` text |
| `src/components/Studio/SceneMeta.test.tsx` | create | assert stats track effective narration |
| `src/components/Studio/SceneRefinePanel.tsx` | modify | textarea label/hint; drop stale "draft is kept" copy |
| `src/components/Studio/SceneRefinePanel.test.tsx` | modify | fixture loses `draftText`; copy assertion if any |
| `src/components/Studio/ScenePreviewDialog.test.tsx` | modify | fixture loses `draftText` |
| `src/store/studioSlice.test.ts` | modify | fixture loses `draftText` |
| `src/components/Studio/useScenePipeline.ts` | modify | delete `updateDraft`, `generateVoice` + their return entries |
| `src/components/Studio/SceneEditor.tsx` | delete | legacy `draftText` editor, never mounted |
| `src/mocks/handlers.ts` | modify | `/api/scenes` mock emits `refinePrompt`, not `draftText` |
| BFFless rule `138f27fb` | modify | `prep` Gemini prompt: request `refinePrompt`, drop `draftText` |

---

## Task 1: Director coerces `refinePrompt`; title falls back to transcript

**Files:**
- Modify: `src/lib/director.ts` (`DirectorScene` ~line 29; `toScenes` ~line 121; `leadWords` use ~line 136)
- Test: `src/lib/director.test.ts`

This task is **additive** — `draftText` stays for now so the build stays green; we add `refinePrompt` alongside and repoint the title fallback.

- [ ] **Step 1: Update the failing tests in `director.test.ts`**

Replace the fixture and add a `refinePrompt` assertion. In the first `toScenes` block (lines ~35-50), change the raw scenes to carry `refinePrompt` and assert it survives:

```ts
const raw: DirectorScene[] = [
  { title: 'Intro', start: 0, end: 60, transcript: 'Welcome to the talk', refinePrompt: 'Tighten the intro to a 15s hook.', cuts: [{ start: 10, end: 20 }] },
  { title: 'Demo', start: 60, end: 130, transcript: 'Here is the demo', refinePrompt: 'Cut the dead air; keep the screen-share.', cuts: [] },
]
```

In the object the first scene is expected to equal (around line 45), replace the `draftText: 'Welcome to the talk'` line with:

```ts
      transcript: 'Welcome to the talk',
      refinePrompt: 'Tighten the intro to a 15s hook.',
```

Rewrite the title-fallback test (lines ~75-77) to derive the title from the **transcript**:

```ts
  it('falls back to a title derived from the transcript', () => {
    const [scene] = toScenes([{ start: 0, end: 10, transcript: 'the quick brown fox jumps over' }], 10)
    expect(scene.title).toBe('the quick brown fox jumps…')
  })
```

In the remaining **`toScenes`** fixtures that only set `draftText` (lines ~57-58, 68, 87-90), replace `draftText:` with `transcript:` (those tests assert clamping/voicing, not script text, so the field swap is inert).

**Do NOT touch the `scenesToTimedWords` describe block (lines ~98-112)** — that function and its tests are deleted in Task 5; leaving them here keeps Task 1 compiling (`draftText` still exists until then).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/director.test.ts`
Expected: FAIL — `toScenes` doesn't set `refinePrompt`; title still derived from `draftText` (now empty) → `Scene 1`.

- [ ] **Step 3: Implement in `director.ts`**

In `DirectorScene` (after the `draftText?` line ~37), add:

```ts
  /** The director's default refine prompt for this scene (story 03q) — a short
   *  instruction the per-scene refiner follows; seeds `scene.refinePrompt`. */
  refinePrompt?: string
```

In `toScenes`, after `const transcript = str(s?.transcript).trim()` (~line 135), repoint the title fallback to the transcript and read the prompt:

```ts
    const refinePrompt = str(s?.refinePrompt).trim()
    const title = str(s?.title).trim() || (leadWords(transcript) ? `${leadWords(transcript)}…` : `Scene ${i + 1}`)
```

In the pushed scene object (~line 144), add the prompt when present (keep `draftText` for now):

```ts
      ...(refinePrompt ? { refinePrompt } : {}),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/director.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/director.ts src/lib/director.test.ts
git commit -m "feat(studio): 03q — director coerces per-scene refinePrompt; title from transcript"
```

---

## Task 2: Mocks emit `refinePrompt`

**Files:**
- Modify: `src/mocks/handlers.ts` (director mock ~line 364)
- Modify: `src/lib/scenes.ts` (`buildScenes` ~line 195)
- Test: `src/lib/scenes.test.ts`

Additive — `draftText` still emitted alongside so nothing breaks yet.

- [ ] **Step 1: Update `scenes.test.ts` `buildScenes` assertions**

The current test (lines ~40-44) asserts the mock draft is shorter than the scene. Replace those two `narrationSeconds(scene.draftText)` assertions with a `refinePrompt` presence check:

```ts
    const [scene] = buildScenes(120)
    expect(scene.refinePrompt).toBeTruthy()
    expect(typeof scene.refinePrompt).toBe('string')
```

(Drop the now-unused `narrationSeconds` / `sceneVideoSeconds` imports from this file only if no other test in it uses them — check before removing.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/scenes.test.ts`
Expected: FAIL — `scene.refinePrompt` is undefined.

- [ ] **Step 3: Implement**

In `buildScenes` (`src/lib/scenes.ts`, the returned scene object ~line 207-217), add a deterministic prompt alongside the existing `draftText`:

```ts
      refinePrompt: `Tighten scene ${i + 1} to a crisp run; drop the dead air in the middle.`,
```

In `src/mocks/handlers.ts`, the director mock scene object (~line 363-365) currently has:

```ts
      draftText: direction ? `${beat.draft} (${direction})` : beat.draft,
```

Add a `refinePrompt` line beside it:

```ts
      refinePrompt: `Tighten this beat${direction ? `, ${direction}` : ''}; drop the dead air in the middle, keep the on-screen action visible.`,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/scenes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scenes.ts src/lib/scenes.test.ts src/mocks/handlers.ts
git commit -m "feat(studio): 03q — mocks emit per-scene refinePrompt"
```

---

## Task 3: Pre-refine baseline falls back to the transcript

**Files:**
- Modify: `src/lib/refiner.ts` (`effectiveSegments` ~line 320)
- Test: `src/lib/refiner.test.ts`

- [ ] **Step 1: Update `refiner.test.ts`**

In the `scene()` fixture helper (~line 36-37), move the fallback text from `draftText` to `transcript`:

```ts
    transcript: 'the director first pass script',
```

(Leave `draftText` in the helper for now — it's removed in Task 5. If TypeScript flags an unused-but-present field, that's fine; the field still exists.)

In the fallback tests (~lines 161-169), use `transcript`:

```ts
  it('falls back to one transcript segment + director cuts when not refined', () => {
    const s = scene({ start: 0, end: 100, transcript: 'fallback', cuts: [{ start: 40, end: 50 }] })
    expect(effectiveSegments(s)).toEqual([{ text: 'fallback', start: 0, end: 100 }])
```

and the default-helper case (~line 169):

```ts
    expect(effectiveSegments(s)).toEqual([{ text: 'the director first pass script', start: 0, end: 100 }])
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/refiner.test.ts`
Expected: FAIL — `effectiveSegments` still reads `draftText` (now blank in the fixture) → returns `[]`.

- [ ] **Step 3: Implement in `refiner.ts`**

Change `effectiveSegments` (~line 320-324) to fall back to the transcript and update its doc comment:

```ts
/**
 * The narration segments to render for a scene: the refiner's if present, else a
 * single placeholder segment spanning the whole scene built from the scene's
 * original `transcript` (story 03q — the director no longer drafts a script).
 * Lets the diff viewer read one shape regardless.
 */
export function effectiveSegments(scene: Scene): NarrationSegment[] {
  if (scene.refined?.segments?.length) return scene.refined.segments
  const text = str(scene.transcript).trim()
  return text ? [{ text, start: scene.start, end: scene.end }] : []
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/refiner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/refiner.ts src/lib/refiner.test.ts
git commit -m "feat(studio): 03q — pre-refine diff baseline falls back to transcript"
```

---

## Task 4: SceneMeta stats from the effective narration

**Files:**
- Modify: `src/components/Studio/SceneMeta.tsx` (lines ~42-45)
- Test: `src/components/Studio/SceneMeta.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `src/components/Studio/SceneMeta.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SceneMeta } from './SceneMeta'
import type { Scene } from '../../lib/scenes'

const base: Scene = {
  id: 'scene-1', index: 0, title: 'Intro', start: 0, end: 100,
  transcript: 'one two three four five six seven eight nine ten',
  status: 'pending', narrationSeconds: null,
}

describe('SceneMeta script stat', () => {
  it('uses the refined narration text once refined, not the transcript', () => {
    const refined: Scene = {
      ...base,
      refined: { segments: [{ text: 'one two three', start: 0, end: 30 }], cuts: [], source: 'ai' },
    }
    render(<SceneMeta scene={refined} />)
    // transcript is 10 words, refined script is 3 → "10 → 3 words"
    expect(screen.getByText(/10 → 3 words/)).toBeInTheDocument()
  })

  it('pre-refine, reflects the transcript fallback (no reduction)', () => {
    render(<SceneMeta scene={base} />)
    expect(screen.getByText(/10 → 10 words/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/Studio/SceneMeta.test.tsx`
Expected: FAIL — current code reads `scene.draftText` (undefined-ish) so `draftWords` is 0 → "10 → 0 words".

- [ ] **Step 3: Implement in `SceneMeta.tsx`**

Replace the `draftText`-derived lines (~42-45) with effective-narration-derived ones (note `effectiveSegments` is already imported at line 11):

```ts
  const draftScript = effectiveSegments(scene).map((s) => s.text).join(' ')
  const origWords = wordCount(scene.transcript)
  const draftWords = wordCount(draftScript)
  const reduction = origWords > 0 ? Math.round((1 - draftWords / origWords) * 100) : 0

  const estNarration = narrationSeconds(draftScript)
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/Studio/SceneMeta.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Studio/SceneMeta.tsx src/components/Studio/SceneMeta.test.tsx
git commit -m "feat(studio): 03q — SceneMeta script stats from effective narration"
```

---

## Task 5: Remove `draftText` and the orphaned code

**Files:**
- Modify: `src/lib/scenes.ts`, `src/lib/director.ts`, `src/mocks/handlers.ts`, `src/components/Studio/useScenePipeline.ts`
- Modify (fixtures): `src/lib/refiner.test.ts`, `src/lib/scenes.test.ts`, `src/components/Studio/SceneRefinePanel.test.tsx`, `src/components/Studio/ScenePreviewDialog.test.tsx`, `src/store/studioSlice.test.ts`
- Delete: `src/components/Studio/SceneEditor.tsx`

This task is the atomic field removal — TypeScript won't compile until every `draftText` reference is gone, so it lands as one commit verified by a full build + test run.

- [ ] **Step 1: Remove the field and its producers**

- `src/lib/scenes.ts`: delete the `draftText: string` line from `Scene` (~line 73). In `buildScenes`, delete the `const draftText = …` line (~205), the `const firstWords = draftText.split(...)` line (~206) — replace `firstWords` with a transcript-derived title: `const firstWords = transcript.split(' ').slice(0, 4).join(' ')` — and the `draftText,` field in the returned object (~214). Delete `export const SHORTEN_RATIO = 0.6` (~130) — now unread.
- `src/lib/director.ts`: delete `draftText?: string` from `DirectorScene` (~37); delete `const draftText = str(s?.draftText).trim()` (~134) and the `draftText,` field in the pushed object (~151). Delete the entire `scenesToTimedWords` function (~168-181) and its `TWord` import if now unused. Update the module doc comment that mentions `draftText`.
- `src/lib/director.test.ts`: delete the whole `describe('scenesToTimedWords', …)` block (~98-112) and drop `scenesToTimedWords` from the import — the function no longer exists.
- `src/mocks/handlers.ts`: delete the `draftText: …` line from the director mock scene (~364).

- [ ] **Step 2: Remove the orphaned hook actions**

In `src/components/Studio/useScenePipeline.ts`: delete the `updateDraft` callback (~1108-1114) and the `generateVoice` callback (~1116-1127), and remove `updateDraft,` and `generateVoice,` from the hook's return object (~1264-1265). If `narrationSeconds` is no longer used elsewhere in the file, drop it from the import.

- [ ] **Step 3: Delete the legacy editor**

```bash
git rm src/components/Studio/SceneEditor.tsx
```

- [ ] **Step 4: Fix the remaining fixtures**

Remove every leftover `draftText:` line from these test fixtures (they're Scene/DirectorScene object literals; the field no longer exists on the type):
- `src/lib/refiner.test.ts` — the `scene()` helper (~37).
- `src/lib/scenes.test.ts` — the fixture at ~51.
- `src/components/Studio/SceneRefinePanel.test.tsx`, `src/components/Studio/ScenePreviewDialog.test.tsx`, `src/store/studioSlice.test.ts` — each scene literal that sets `draftText`.

- [ ] **Step 5: Verify the whole project compiles, lints, and tests green**

Run: `npm run build`
Expected: PASS (no `draftText` type errors anywhere).

Run: `npm run lint`
Expected: only the two pre-existing `ChatPanel.tsx` `set-state-in-effect` errors.

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(studio): 03q — remove draftText and its orphaned code"
```

---

## Task 6: SceneRefinePanel copy reflects the prefilled prompt

**Files:**
- Modify: `src/components/Studio/SceneRefinePanel.tsx` (intro copy ~52-58; textarea label ~106)
- Test: `src/components/Studio/SceneRefinePanel.test.tsx`

- [ ] **Step 1: Update the panel copy**

In `SceneRefinePanel.tsx`, change the textarea label (~line 106) from `Direction for this scene · optional` to signal the prefill:

```tsx
          <span className="meta-label">Direction for this scene — the director's suggestion, edit freely</span>
```

In the intro paragraph (~52-58), delete the stale sentence: `Your original draft is kept — refining never overwrites it.` (there is no draft anymore). Leave the rest of the paragraph intact.

- [ ] **Step 2: Update/add the test assertion**

Run `npx vitest run src/components/Studio/SceneRefinePanel.test.tsx` first; if any test asserts the old label string `Direction for this scene · optional` or the removed sentence, update it to the new label. Add an assertion that the textarea shows the prefilled value:

```tsx
  it('prefills the direction textarea from scene.refinePrompt', () => {
    // render the panel with a scene whose refinePrompt is set, then:
    expect(screen.getByRole('textbox')).toHaveValue('Tighten the intro to a 15s hook.')
  })
```

(Reuse the file's existing render helper / props; set the fixture scene's `refinePrompt` accordingly.)

- [ ] **Step 3: Run to verify it passes**

Run: `npx vitest run src/components/Studio/SceneRefinePanel.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Studio/SceneRefinePanel.tsx src/components/Studio/SceneRefinePanel.test.tsx
git commit -m "feat(studio): 03q — refine panel copy reflects the director's prefilled prompt"
```

---

## Task 7: Rewrite the `/api/scenes` Gemini prompt (rule `138f27fb`)

**Files:**
- Modify: BFFless proxy rule `138f27fb` (`prep` function-handler only)
- Modify: `stories/inprogress/studio/03q-director-scene-prompts.md` (fill the "Built" notes)
- Modify: `MEMORY.md` + `project_studio_director_pipeline.md` memory

Use the **`bffless-pipeline`** skill. The mock already matches the new shape (Task 2), so this is the swap-don't-rewrite "real" half. Only the `prep` step's `system_instruction`/`prompt` changes — the 03f Part-0 enqueue + `postSteps` + `parse` are untouched (`parse` passes scene fields through opaquely).

- [ ] **Step 1: Back up the current rule**

```bash
# via the bffless MCP: get_proxy_rule for 138f27fb, write the JSON to:
#   .bffless-backups/2026-06-12-03q-scenes.json
```
Use `mcp__bffless-j5s__get_proxy_rule` (id `138f27fb`) and save the returned definition to that path before editing.

- [ ] **Step 2: Edit the `prep` prompt**

In the `prep` function-handler's prompt/`system_instruction`, find where the per-scene JSON shape is described. Make two changes:
1. **Remove** `draftText` (the "tightened script" field) from the requested per-scene object and any instruction telling the model to rewrite/shorten the narration.
2. **Add** a `refinePrompt` field with this instruction (adapt wording to the existing prompt's voice):

> For each scene also return `refinePrompt`: a one-to-two sentence imperative instruction to the second-pass refiner describing how to cut and re-voice THIS scene given the whole video — what to tighten or drop, the pacing/tone, anything on-screen to preserve, and a rough target length. This is a prompt for the refiner, NOT narration text.

Keep `synopsis`, `title`, `start`, `end`, `cuts`, `voicing` exactly as they are. Apply via `mcp__bffless-j5s__update_proxy_rule`.

- [ ] **Step 3: Verify against the live rule via debug logs**

The rule ships with debug on (03m). POST a small request to `/api/scenes` (or trigger from the app with `MOCK_STUDIO` off) and inspect the job's stored prompt + the parsed `result`:

```bash
# poll the job (GET /api/studio/job?id=<jobId>) and confirm:
#  - each scene in result has a non-empty `refinePrompt`
#  - no scene has `draftText`
```
Expected: scenes carry `refinePrompt`, none carry `draftText`.

- [ ] **Step 4: Record the rule edit + update memory**

- Fill the spec's acceptance checklist and add a "Built — rule edit (2026-06-12)" section to `03q-director-scene-prompts.md` noting the backup path and the debug-verified behavior (mirror 03l's "Built" section style).
- Update memory `project_studio_director_pipeline.md` (director now returns per-scene `refinePrompt`, not `draftText`) and refresh its `MEMORY.md` one-liner.

- [ ] **Step 5: Commit**

```bash
git add stories/inprogress/studio/03q-director-scene-prompts.md .bffless-backups/2026-06-12-03q-scenes.json
git commit -m "feat(studio): 03q — /api/scenes prompt returns per-scene refinePrompt, drops draftText"
```

(Memory files live outside the repo; they're updated in place, not committed here.)

---

## Final verification

- [ ] `npm run build` — green.
- [ ] `npm run lint` — only the two known `ChatPanel.tsx` errors.
- [ ] `npm run test:run` — green.
- [ ] Manually (mock mode): run the director → open a scene → the "Direction for this scene" textarea is prefilled with the director's suggestion; editing + refining sends it through unchanged; SceneMeta's Script stat reads sensibly pre/post refine.
- [ ] Flip the README status row for 03q from 📝 to ✅ and move the story toward `stories/done/` per the README's "How to work it" once the rule is verified live.
