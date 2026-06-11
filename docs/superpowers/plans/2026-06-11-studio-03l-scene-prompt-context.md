# Studio 03l — Scene Prompts (per-scene direction + director-prompt passthrough) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forward the creator's master-director prompt to every per-scene refine call (with a per-scene, persisted include-checkbox, default checked) and give each scene its own free-text refine instruction.

**Architecture:** The director prompt moves from transient `useState` in `Studio.tsx` into the persisted Redux `studio` slice. Each `Scene` gains two input-layer fields (`refinePrompt`, `includeDirection`) that survive refine-revert. A pure helper `refineDirections()` in `src/lib/refiner.ts` shapes the two request fields (`direction` per-scene, `directorDirection` global); `useScenePipeline.refineScene` spreads it into the `/api/refine-scene` request, replacing today's hardcoded `direction: ''`. The BFFless rule `afacb572`'s `prep` step injects each field, labeled, only when non-empty. Spec: `stories/inprogress/studio/03l-scene-prompt-context.md`.

**Tech Stack:** React 19 + TypeScript, Redux Toolkit + redux-persist, RTK Query, MSW, Vitest + React Testing Library, BFFless pipelines (MCP tools, `bffless-pipeline` skill).

**Branch:** `feat/studio-03l-scene-prompt-context` (already exists, spec committed).

**Repo conventions that bind this plan (CLAUDE.md):**
- Mock-first: the MSW handler learns the new request shape before any pipeline edit.
- Mock and real must share shapes; coercion stays in one pure function.
- `npm run build`, `npm run lint`, `npm run test:run` must pass before the PR. Two pre-existing `ChatPanel.tsx` `set-state-in-effect` lint errors are known 03i-era debt — not yours to fix, and not a pass/fail signal for this story.
- Tailwind utilities only; theme tokens already exist (`meta-label`, `pill-cta`, `border-paper-line`, `text-ink*` etc. are in use — copy surrounding idiom).

---

### Task 1: MSW mock accepts the new request fields

The `/api/refine-scene` mock's typed body cast doesn't list `direction` today (and `directorDirection` doesn't exist anywhere yet). Document the full creator-steering contract on the mock first (mock-first convention). No behavior change — the deterministic fixture ignores the content.

**Files:**
- Modify: `src/mocks/handlers.ts:121-129`

- [ ] **Step 1: Extend the mock's body type**

In `src/mocks/handlers.ts`, find the `/api/refine-scene` handler's body cast:

```ts
    const body = (await request.json().catch(() => ({}))) as {
      start?: number
      end?: number
      transcript?: string
      draftText?: string
      cuts?: { start: number; end: number }[]
      audioUrl?: string
    }
```

Replace with:

```ts
    const body = (await request.json().catch(() => ({}))) as {
      start?: number
      end?: number
      transcript?: string
      draftText?: string
      cuts?: { start: number; end: number }[]
      audioUrl?: string
      // Creator steering (story 03l): the scene's own prompt + the global
      // director prompt (empty when the scene's include-checkbox is off).
      // Accepted so mock and real share the request shape; the deterministic
      // fixture ignores the content.
      direction?: string
      directorDirection?: string
    }
```

- [ ] **Step 2: Verify the suite still passes**

Run: `npm run test:run`
Expected: PASS (type-only change).

- [ ] **Step 3: Commit**

```bash
git add src/mocks/handlers.ts
git commit -m "feat(studio): 03l — refine-scene mock accepts direction + directorDirection"
```

---

### Task 2: Scene input fields + `refineDirections()` pure helper (TDD)

**Files:**
- Modify: `src/lib/scenes.ts:63-115` (the `Scene` type)
- Modify: `src/lib/refiner.ts` (helper only — the request type changes in Task 4)
- Test: `src/lib/refiner.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/refiner.test.ts` (add `refineDirections` to the existing `from './refiner'` import list):

```ts
describe('refineDirections (story 03l)', () => {
  it('sends the trimmed per-scene prompt and the trimmed global direction by default', () => {
    expect(refineDirections({ refinePrompt: '  trim the pause  ' }, '  punchy intro  ')).toEqual({
      direction: 'trim the pause',
      directorDirection: 'punchy intro',
    })
  })

  it('defaults both to empty strings when nothing is set', () => {
    expect(refineDirections({}, '')).toEqual({ direction: '', directorDirection: '' })
  })

  it('treats an absent includeDirection as include (default checked)', () => {
    expect(refineDirections({ includeDirection: undefined }, 'punchy')).toEqual({
      direction: '',
      directorDirection: 'punchy',
    })
  })

  it('excludes the director prompt when includeDirection is false', () => {
    expect(refineDirections({ refinePrompt: 'keep the code', includeDirection: false }, 'punchy')).toEqual({
      direction: 'keep the code',
      directorDirection: '',
    })
  })

  it('whitespace-only global direction sends empty regardless of the checkbox', () => {
    expect(refineDirections({ includeDirection: true }, '   ')).toEqual({
      direction: '',
      directorDirection: '',
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/refiner.test.ts`
Expected: FAIL — `refineDirections` is not exported.

- [ ] **Step 3: Add the Scene fields**

In `src/lib/scenes.ts`, inside the `Scene` type, directly after the `refined?: SceneRefinement | null` field (line ~93), add:

```ts
  /** Creator's per-scene instruction for the refiner (story 03l). An INPUT, not
   *  refiner output — it survives revert (`refined = null`) and seeds the next
   *  re-refine. Sent as the refine request's `direction`. */
  refinePrompt?: string
  /** Include the global director prompt as context in this scene's refine calls
   *  (story 03l). ABSENT = true (the checkbox defaults checked); explicit
   *  `false` excludes it. Input-layer, like `refinePrompt` — survives revert. */
  includeDirection?: boolean
```

- [ ] **Step 4: Implement the helper**

In `src/lib/refiner.ts`, directly after the `RefineSceneRequest` type (after line 59), add:

```ts
/**
 * The two creator-prompt fields of a refine request (story 03l): the scene's own
 * `refinePrompt`, plus the global director prompt — forwarded only while the
 * scene's include-checkbox is on (absent = on). Both trimmed and never
 * undefined, so the wire shape stays stable for mock and real alike.
 */
export function refineDirections(
  scene: Pick<Scene, 'refinePrompt' | 'includeDirection'>,
  direction: string,
): { direction: string; directorDirection: string } {
  return {
    direction: (scene.refinePrompt ?? '').trim(),
    directorDirection: scene.includeDirection === false ? '' : direction.trim(),
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/refiner.test.ts`
Expected: PASS (all existing + 5 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/scenes.ts src/lib/refiner.ts src/lib/refiner.test.ts
git commit -m "feat(studio): 03l — Scene refinePrompt/includeDirection + refineDirections helper"
```

---

### Task 3: Persist the director prompt in the studio slice (TDD)

**Files:**
- Modify: `src/store/studioSlice.ts`
- Test: `src/store/studioSlice.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('studioSlice', …)` block in `src/store/studioSlice.test.ts` (add `setDirection` to the existing `from './studioSlice'` import list):

```ts
  it('setDirection stores the director prompt; resetStudio clears it', () => {
    let s = reducer(undefined, setDirection('keep the demo at 12:30'))
    expect(s.direction).toBe('keep the demo at 12:30')
    s = reducer(s, resetStudio())
    expect(s.direction).toBe('')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/store/studioSlice.test.ts`
Expected: FAIL — `setDirection` is not exported.

- [ ] **Step 3: Implement the slice field**

In `src/store/studioSlice.ts`:

a. In `StudioState`, directly after the `synopsis: string | null` field (line ~83), add:

```ts
  /**
   * The creator's free-text direction to the master director (story 03l).
   * Persisted — it's sent with `/api/scenes` at prep time AND forwarded to every
   * per-scene refine in Build (each scene has an include-checkbox), so it must
   * outlive the prep step and survive reloads. Old persisted sessions rehydrate
   * without the key and fall back to '' (top-level persist merge) — no migration.
   */
  direction: string
```

b. In `initialState`, after `synopsis: null,`, add:

```ts
  direction: '',
```

c. In `reducers`, after the `setSynopsis` reducer, add:

```ts
    setDirection(state, action: PayloadAction<string>) {
      state.direction = action.payload
    },
```

d. Add `setDirection` to the exported actions list (after `setSynopsis`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/store/studioSlice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/studioSlice.ts src/store/studioSlice.test.ts
git commit -m "feat(studio): 03l — persist the director prompt in the studio slice"
```

---

### Task 4: Thread the prompts through the request + orchestration + Studio page

One task because the type change forces all its call sites: adding required `directorDirection` to `RefineSceneRequest` breaks `refineScene` until it sends it, and removing `direction` from `StepContext` breaks `Studio.tsx`'s `pipe.next(…)` calls until the page reads the slice instead. Everything compiles together at the end.

**Files:**
- Modify: `src/lib/refiner.ts:40-59` (`RefineSceneRequest`)
- Modify: `src/components/Studio/useScenePipeline.ts` (StepContext ~132, runDirector ~558-576, refineScene ~737-772, new actions, return object ~1172)
- Modify: `src/pages/Studio.tsx` (imports line 3, direction state ~42-44, DirectorPanel ~456-466, runStep ~156-169)

- [ ] **Step 1: Extend `RefineSceneRequest`**

In `src/lib/refiner.ts`, replace the last field of `RefineSceneRequest`:

```ts
  /** Optional free-text direction from the user. */
  direction: string
```

with:

```ts
  /** The creator's per-scene instruction (`scene.refinePrompt`, trimmed). */
  direction: string
  /** The creator's global director prompt, forwarded as whole-video context
   *  while the scene's include-checkbox is on (story 03l); `''` when the
   *  checkbox is off or the prompt is empty. */
  directorDirection: string
```

- [ ] **Step 2: Update `useScenePipeline.ts`**

a. Add `refineDirections` to the existing `from '../../lib/refiner'` import; add `setDirection` to the existing `from '../../store/studioSlice'` import.

b. Add a selector next to the other slice selectors (after `const synopsis = …`, line ~169):

```ts
  const direction = useAppSelector((s) => s.studio.direction)
```

c. Replace the `StepContext` type and its doc comment (lines ~127-132):

```ts
/** What each step needs: the source file, its object URL, and its duration.
 *  (The director's free-text direction now comes from the persisted slice —
 *  story 03l — not the step context.) */
export type StepContext = { file: File; src: string; duration: number }
```

d. In `runDirector` (line ~558), drop `direction` from the destructure and read the slice value; update the deps:

```ts
  const runDirector = useCallback(
    async ({ src, duration: clipDuration }: StepContext) => {
      patch('director', { status: 'active' })
      const transcript = timedTranscript(words)
      const sheetUrls = persistedSheets.map((s) => s.url).filter((u): u is string => !!u)
      // Enqueue-only: the start endpoint records a job and returns its id; the
      // Gemini call runs in the pipeline's postSteps (story 03f Part 0). Persist
      // the id so a hard reload resumes polling, then drive it to completion.
      const { jobId } = await scenesReq({
        transcript,
        sheetUrls,
        direction,
        duration: clipDuration,
      }).unwrap()
      dispatch(setScenesJobId(jobId))
      await completeDirectorJob(jobId, src, clipDuration)
    },
    [patch, dispatch, words, persistedSheets, direction, scenesReq, completeDirectorJob],
  )
```

e. In `refineScene` (line ~737), replace `direction: '',` with the helper spread, and add `direction` to the deps:

```ts
        const { jobId } = await refineSceneReq({
          start: scene.start,
          end: scene.end,
          transcript: timedTranscript(scoped),
          draftText: scene.draftText,
          cuts: scene.cuts ?? [],
          sheetUrls,
          audioUrl: scene.clipAudioUrl,
          // Creator steering (story 03l): the scene's own prompt + the global
          // director prompt (subject to the scene's include-checkbox).
          ...refineDirections(scene, direction),
        }).unwrap()
```

Deps become:

```ts
    [sheetingId, refiningId, scenes, words, direction, refineSceneReq, patchScene, completeRefineJob],
```

f. Add the two scene-prompt actions next to `editSceneCut` (after `refineScene`):

```ts
  // Creator steering for the refine call (story 03l). Both are INPUT-layer scene
  // fields — they survive revert (`clearRefinement` never touches them) and seed
  // the next re-refine.
  const setRefinePrompt = useCallback(
    (sceneId: string, text: string) => patchScene(sceneId, { refinePrompt: text }),
    [patchScene],
  )
  const setIncludeDirection = useCallback(
    (sceneId: string, on: boolean) => patchScene(sceneId, { includeDirection: on }),
    [patchScene],
  )
```

g. Expose all three in the hook's return object (after `refineScene,` line ~1206):

```ts
    direction,
    setRefinePrompt,
    setIncludeDirection,
```

- [ ] **Step 3: Update `Studio.tsx`**

a. Line 3 — add `setDirection`:

```ts
import { setDirection, setDuration, setFileName, setRevisitPrep } from '../store/studioSlice'
```

b. Replace the transient state (lines ~42-44):

```ts
  // Free-text direction the user hands the master director (e.g. "keep the demo
  // at 12:30, make the intro punchy"). Only used by the director prep step.
  const [direction, setDirection] = useState('')
```

with a read of the persisted slice (the hook exposes it — story 03l):

```ts
  // Free-text direction the user hands the master director (e.g. "keep the demo
  // at 12:30, make the intro punchy"). Persisted in the studio slice (story 03l)
  // so Build forwards it to per-scene refines long after prep, across reloads.
  const direction = pipe.direction
```

NOTE: `const pipe = useScenePipeline()` is currently declared BELOW this spot
(line ~59). Either move `const direction = pipe.direction` below that line, or
just use `pipe.direction` at the two usage sites — pick whichever leaves the
file tidiest; don't reorder unrelated declarations.

c. `DirectorPanel` call site (line ~458): bind onChange to the slice:

```tsx
                        <DirectorPanel
                          value={direction}
                          onChange={(v) => dispatch(setDirection(v))}
                          onSubmit={runStep}
                          busy={pipe.running || rehydrating}
                          sheetCount={pipe.contactSheets.length}
                          wordCount={pipe.words.length}
                        />
```

d. `runStep` (lines ~156-169): drop `direction` from both `pipe.next` calls:

```ts
  async function runStep() {
    if (file && url) {
      pipe.next({ file, src: url, duration })
      return
    }
    const f = await rehydrateClip()
    if (!f) return
    const tmpUrl = URL.createObjectURL(f)
    try {
      await pipe.next({ file: f, src: tmpUrl, duration })
    } finally {
      URL.revokeObjectURL(tmpUrl)
    }
  }
```

- [ ] **Step 4: Verify it all compiles and tests pass**

Run: `npm run build && npm run test:run`
Expected: build PASS (`tsc -b` clean — watch for `noUnusedLocals` fallout if `useState` import became unused; it's still used by other state in the file). Tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/refiner.ts src/components/Studio/useScenePipeline.ts src/pages/Studio.tsx
git commit -m "feat(studio): 03l — thread per-scene + director prompts into refine requests"
```

---

### Task 5: SceneRefinePanel UI — per-scene textarea + include-checkbox (TDD)

**Files:**
- Test: `src/components/Studio/SceneRefinePanel.test.tsx`
- Modify: `src/components/Studio/SceneRefinePanel.tsx`
- Modify: `src/pages/Studio.tsx:575-585` (pass the new props)

- [ ] **Step 1: Write the failing tests**

In `src/components/Studio/SceneRefinePanel.test.tsx`:

a. Change the vitest import to include `vi`:

```ts
import { describe, it, expect, vi } from 'vitest'
```

b. Replace the `renderPanel` helper so callers can override the new props:

```tsx
type PanelProps = Parameters<typeof SceneRefinePanel>[0]

function renderPanel(scene: Scene, extra: Partial<PanelProps> = {}) {
  return render(
    <SceneRefinePanel
      scene={scene}
      slicing={false}
      sheeting={false}
      refining={false}
      direction=""
      onSlice={noop}
      onGenerateSheets={noop}
      onRefine={noop}
      onClear={noop}
      onRefinePromptChange={noop}
      onIncludeDirectionChange={noop}
      {...extra}
    />,
  )
}
```

c. Add the new describe block (alongside the 03k one). `fireEvent` joins the existing `@testing-library/react` import:

```tsx
describe('SceneRefinePanel scene prompts (story 03l)', () => {
  it('edits the per-scene direction through onRefinePromptChange', () => {
    const onChange = vi.fn()
    renderPanel(makeScene({ refinePrompt: 'old' }), { onRefinePromptChange: onChange })
    const box = screen.getByLabelText(/direction for this scene/i)
    expect(box).toHaveValue('old')
    fireEvent.change(box, { target: { value: 'trim the pause' } })
    expect(onChange).toHaveBeenCalledWith('trim the pause')
  })

  it('hides the director-prompt row when there is no director prompt', () => {
    renderPanel(makeScene(), { direction: '   ' })
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('shows the director prompt read-only with the checkbox checked by default', () => {
    renderPanel(makeScene(), { direction: 'punchy intro' })
    const box = screen.getByRole('checkbox', { name: /include your director prompt/i })
    expect(box).toBeChecked()
    expect(screen.getByText('punchy intro')).toBeInTheDocument()
  })

  it('reflects an unchecked scene and reports toggles through onIncludeDirectionChange', () => {
    const onToggle = vi.fn()
    renderPanel(makeScene({ includeDirection: false }), {
      direction: 'punchy intro',
      onIncludeDirectionChange: onToggle,
    })
    const box = screen.getByRole('checkbox', { name: /include your director prompt/i })
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Studio/SceneRefinePanel.test.tsx`
Expected: FAIL — unknown props / missing textarea and checkbox.

- [ ] **Step 3: Implement the panel changes**

In `src/components/Studio/SceneRefinePanel.tsx`:

a. Extend `Props` and the destructure:

```ts
type Props = {
  scene: Scene
  slicing: boolean
  sheeting: boolean
  refining: boolean
  /** The creator's global director prompt (persisted slice value) — shown
   *  read-only with the include-checkbox; the row hides when it's empty. */
  direction: string
  error?: string | null
  onSlice: () => void
  onGenerateSheets: () => void
  onRefine: () => void
  onClear: () => void
  onRefinePromptChange: (text: string) => void
  onIncludeDirectionChange: (on: boolean) => void
}
```

(and add `direction`, `onRefinePromptChange`, `onIncludeDirectionChange` to the function's destructured parameters.)

b. Between the step-1 row (`1 · Scene contact sheets`, closing `</div>` ~line 91) and the step-2 row comment (`{/* Step 2 — refine */}`), insert:

```tsx
        {/* Creator steering for the refine call (story 03l). Both are inputs —
            they survive Revert and seed the next re-refine. The director prompt
            itself isn't editable here: include it as context, or don't. */}
        <label className="flex flex-col gap-1.5">
          <span className="meta-label">Direction for this scene · optional</span>
          <textarea
            value={scene.refinePrompt ?? ''}
            onChange={(e) => onRefinePromptChange(e.target.value)}
            disabled={busy}
            rows={2}
            placeholder="e.g. Trim the long pause; keep the on-screen code visible."
            className="w-full resize-y rounded-md border border-paper-line bg-paper p-3 text-[14px] leading-relaxed text-ink disabled:opacity-60"
          />
        </label>
        {direction.trim() !== '' && (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-[13.5px] text-ink">
              <input
                type="checkbox"
                checked={scene.includeDirection !== false}
                disabled={busy}
                onChange={(e) => onIncludeDirectionChange(e.target.checked)}
              />
              Include your director prompt as context
            </label>
            <p className="pl-6 text-[12.5px] leading-relaxed text-ink-mute">{direction}</p>
          </div>
        )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Studio/SceneRefinePanel.test.tsx`
Expected: PASS (3 existing 03k tests + 4 new).

- [ ] **Step 5: Wire the props in `Studio.tsx`**

At the `SceneRefinePanel` call site (line ~575):

```tsx
                  <SceneRefinePanel
                    scene={selected}
                    slicing={pipe.slicingId === selected.id}
                    sheeting={pipe.sheetingId === selected.id}
                    refining={pipe.refiningId === selected.id}
                    direction={direction}
                    error={pipe.sceneError}
                    onSlice={() => pipe.sliceScene(selected.id, file)}
                    onGenerateSheets={() => pipe.generateSceneSheets(selected.id)}
                    onRefine={() => pipe.refineScene(selected.id)}
                    onClear={() => pipe.clearRefinement(selected.id)}
                    onRefinePromptChange={(text) => pipe.setRefinePrompt(selected.id, text)}
                    onIncludeDirectionChange={(on) => pipe.setIncludeDirection(selected.id, on)}
                  />
```

(`direction` here is the same slice value from Task 4 step 3b — it's in scope in the Build branch.)

- [ ] **Step 6: Full verification**

Run: `npm run build && npm run test:run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/Studio/SceneRefinePanel.tsx src/components/Studio/SceneRefinePanel.test.tsx src/pages/Studio.tsx
git commit -m "feat(studio): 03l — scene prompt textarea + include-director-prompt checkbox"
```

---

### Task 6: Front-end gates

- [ ] **Step 1: Run all three gates**

Run: `npm run build && npm run lint && npm run test:run`
Expected: build PASS; test:run PASS; lint shows ONLY the two pre-existing `ChatPanel.tsx` `set-state-in-effect` errors (known 03i debt — zero findings in files this story touched).

- [ ] **Step 2: Fix anything the gates surfaced, then re-run until clean. Commit any fixes.**

---

### Task 7: BFFless pipeline — inject both prompts into the refiner rule

**REQUIRED SUB-SKILL: invoke the `bffless-pipeline` skill before touching the rule.** This edits live backend config (rule `afacb572`, `POST /api/refine-scene`); only the `prep` function-handler changes — the 03f Part 0 async shape (createJob/postSteps/poll) must NOT be restructured.

**Files:**
- Create: `.bffless-backups/2026-06-11-03l-refine-scene.json` (pre-edit backup, repo convention from 03k)
- Live: proxy rule `afacb572` via `mcp__bffless-j5s__get_proxy_rule` / `update_proxy_rule`

- [ ] **Step 1: Fetch and back up the rule**

Call `mcp__bffless-j5s__get_proxy_rule` for rule `afacb572`; write the full pre-edit JSON to `.bffless-backups/2026-06-11-03l-refine-scene.json` and commit it.

- [ ] **Step 2: Edit the `prep` function handler**

In the `prep` step's code, where the Gemini `prompt` is assembled (it already includes the scene transcript, draftText, cuts, and the 03k audio offset-mapping), read both fields from the request body and append them — each only when non-empty, each with its own label, appended AFTER the core scene material so instructions read as steering, not data:

```js
const directorDirection = (request.body.directorDirection || '').trim()
const sceneDirection = (request.body.direction || '').trim()
if (directorDirection) {
  prompt += `\n\nThe creator's overall direction for the whole video (context): ${directorDirection}`
}
if (sceneDirection) {
  prompt += `\n\nThe creator's instructions for this scene (follow these): ${sceneDirection}`
}
```

Adapt the variable/accessor names to the prep code's actual structure (it may build the prompt in pieces or read the body via a different binding — match what's there; the labels and only-when-non-empty behavior are the contract). Then `update_proxy_rule` with the edited code.

- [ ] **Step 3: Verify live**

a. POST a minimal valid body (with `audioUrl`, both direction fields set) to `https://j5s.dev/api/refine-scene` — expect `{ jobId, status: 'pending' }` (the enqueue path still works).
b. Use `mcp__bffless-j5s__enable_pipeline_debug` + `get_pipeline_log` (or `get_pipeline_log_step` for `prep`) to confirm the built prompt contains BOTH labeled lines, and a second POST with both fields empty produces a prompt containing NEITHER label.

- [ ] **Step 4: Record the rule edit**

In `stories/inprogress/studio/03l-scene-prompt-context.md`, add a `## Built` section noting: rule `afacb572` prep edited (labels + only-when-non-empty), backup path, verification method (debug-log inspection), and — same caveat as 03j/03k — that the live-Gemini *steering effect* is unverified until a real cut+refine runs.

- [ ] **Step 5: Commit**

```bash
git add .bffless-backups/2026-06-11-03l-refine-scene.json stories/inprogress/studio/03l-scene-prompt-context.md
git commit -m "feat(studio): 03l — rule afacb572 prep injects labeled creator prompts"
```

---

### Task 8: Story bookkeeping + final gates

**Files:**
- Modify: `stories/inprogress/studio/03l-scene-prompt-context.md` (status + acceptance boxes)
- Modify: `stories/inprogress/studio/README.md` (status row + tree line: 📝 → ✅)

- [ ] **Step 1: Check off the story's acceptance criteria** — every box that's true; status line `📝 spec ready` → `✅ shipped` with the live-Gemini caveat. Flip the README row and tree line to ✅ (use `✅ done*` in the table — the `*` "needs Replicate token to run live" convention).

- [ ] **Step 2: Final gates**

Run: `npm run build && npm run lint && npm run test:run`
Expected: all green (lint modulo the two known ChatPanel errors).

- [ ] **Step 3: Commit**

```bash
git add stories/inprogress/studio/03l-scene-prompt-context.md stories/inprogress/studio/README.md
git commit -m "docs(studio): mark story 03l shipped"
```

**Orchestrator note (not for subagents):** after the plan completes, the session owner updates the auto-memory (`project_studio_*`) with the 03l outcome and uses the finishing-a-development-branch skill (PR per repo convention: one stage per PR).
