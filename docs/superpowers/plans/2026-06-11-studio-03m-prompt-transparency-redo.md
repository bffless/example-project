# Studio 03m — Prompt Transparency + Director Re-run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the creator the exact prompt + system instruction each director/refine run sent to Gemini (collapsed, fetch-on-demand), and let them re-run the master director behind a confirm.

**Architecture:** The `studio_jobs` row stores `prompt`/`system` at enqueue (from the existing `steps.prep` output — no prompt-assembly changes); the poll endpoint returns them; the FE persists only two job-id pointers (`directorPromptJobId` on the slice, `promptJobId` on each scene) and lazy-fetches the text into transient state via a new `PromptDisclosure` component. The redo is pure FE: `DirectorPanel` (extracted to its own file) gains a confirm-gated rerun variant driving a new `rerunDirector` hook action. Spec: `stories/inprogress/studio/03m-prompt-transparency-and-redo.md`.

**Tech Stack:** React 19 + TypeScript, Redux Toolkit + redux-persist, RTK Query (`useLazyGetStudioJobQuery` already exported), MSW, Vitest + RTL, BFFless pipelines (MCP tools, `bffless-pipeline` skill).

**Branch:** `feat/studio-03l-scene-prompt-context` (per user instruction: same branch/PR #20 — do NOT create a new branch).

**Verified backend facts (from live rule fetches this session):**
- Rules `138f27fb` (`/api/scenes`) and `afacb572` (`/api/refine-scene`) both have main steps `prep → createJob → respond`; both `prep` handlers output `out.prompt` and `out.system`; both `createJob` (`data_create`) steps currently store only `{ kind, status, request }`.
- Poll rule `a486eb93` (`GET /api/studio/job`) is `query` (`data_query` by `request.query.id`) → `shape` (`function_handler` returning `{ status, kind, result, error }`) → `respond` (`{{{steps.shape}}}`, `Cache-Control: no-store`).
- Schema `studio_jobs` = `acdca97c-f9cc-4469-90a3-676a242924cb`, fields `kind`/`status`/`request`/`result`/`error`.

---

### Task 1: MSW mocks — stash and return prompt/system (mock-first)

**Files:**
- Modify: `src/mocks/handlers.ts:37-44` (job store), `:112` (scenes enqueue), `:141` (refine enqueue), `:181-191` (job poll)

- [ ] **Step 1: Extend the mock job store**

Replace the job-store block:

```ts
type MockJob = { kind: 'scenes' | 'refine'; result: unknown; polls: number }
const jobStore = new Map<string, MockJob>()
let jobCounter = 0
const enqueueJob = (kind: MockJob['kind'], result: unknown): string => {
  const jobId = `mock-job-${++jobCounter}`
  jobStore.set(jobId, { kind, result, polls: 0 })
  return jobId
}
```

with:

```ts
type MockJob = {
  kind: 'scenes' | 'refine'
  result: unknown
  polls: number
  // What the "pipeline" sent the model (story 03m) — fabricated here, but the
  // poll returns it exactly like the real rule, so the disclosure UI works offline.
  prompt?: string
  system?: string
}
const jobStore = new Map<string, MockJob>()
let jobCounter = 0
const enqueueJob = (
  kind: MockJob['kind'],
  result: unknown,
  prompt?: string,
  system?: string,
): string => {
  const jobId = `mock-job-${++jobCounter}`
  jobStore.set(jobId, { kind, result, polls: 0, prompt, system })
  return jobId
}
```

- [ ] **Step 2: Stash deterministic prompts at enqueue**

In the `/api/scenes` handler, replace:

```ts
    const jobId = enqueueJob('scenes', mockDirector(body.duration ?? 0, body.direction ?? ''))
```

with:

```ts
    const jobId = enqueueJob(
      'scenes',
      mockDirector(body.duration ?? 0, body.direction ?? ''),
      `[mock] director prompt — duration: ${body.duration ?? 0}s · your direction: ${body.direction || '(none)'}`,
      '[mock] director system instruction — the standing rules the real pipeline sends Gemini.',
    )
```

In the `/api/refine-scene` handler, replace:

```ts
    const jobId = enqueueJob('refine', mockRefiner(body))
```

with (the handler's body cast already includes `direction`/`directorDirection` from 03l):

```ts
    const jobId = enqueueJob(
      'refine',
      mockRefiner(body),
      `[mock] refine prompt — scene [${body.start ?? 0}, ${body.end ?? 0}] · scene direction: ${body.direction || '(none)'} · director context: ${body.directorDirection || '(none)'}`,
      '[mock] refiner system instruction — the standing rules the real pipeline sends Gemini.',
    )
```

- [ ] **Step 3: Return them from the job poll**

In the `http.get('/api/studio/job', …)` handler, replace the final line:

```ts
    return HttpResponse.json({ status: 'done', kind: job.kind, result: job.result })
```

with:

```ts
    return HttpResponse.json({
      status: 'done',
      kind: job.kind,
      result: job.result,
      prompt: job.prompt ?? null,
      system: job.system ?? null,
    })
```

- [ ] **Step 4: Verify and commit**

Run: `npm run test:run` — Expected: PASS (mock-only change).

```bash
git add src/mocks/handlers.ts
git commit -m "feat(studio): 03m — mock job store stashes + returns prompt/system"
```

---

### Task 2: Types + persisted pointers (TDD on the slice)

**Files:**
- Modify: `src/store/studioApi.ts:43-48` (`StudioJob`)
- Modify: `src/lib/scenes.ts` (Scene type, after `includeDirection`)
- Modify: `src/store/studioSlice.ts`
- Test: `src/store/studioSlice.test.ts`

- [ ] **Step 1: Write the failing slice test**

In `src/store/studioSlice.test.ts`, add `setDirectorPromptJobId` to the import list from `./studioSlice`, then add inside the `describe('studioSlice', …)` block:

```ts
  it('setDirectorPromptJobId stores the pointer; resetStudio clears it', () => {
    let s = reducer(undefined, setDirectorPromptJobId('job-42'))
    expect(s.directorPromptJobId).toBe('job-42')
    s = reducer(s, resetStudio())
    expect(s.directorPromptJobId).toBeNull()
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/store/studioSlice.test.ts`
Expected: FAIL — `setDirectorPromptJobId` is not exported.

- [ ] **Step 3: Implement**

a. `src/store/studioApi.ts` — extend `StudioJob`:

```ts
export type StudioJob = {
  status: 'pending' | 'running' | 'done' | 'error'
  kind: 'scenes' | 'refine'
  result?: ScenesResult | RefineSceneResult | null
  error?: string | null
  /** The stitched per-run Gemini prompt, stored on the job row at enqueue
   *  (story 03m). Null/absent on jobs older than 03m. */
  prompt?: string | null
  /** The system instruction sent with it (story 03m). */
  system?: string | null
}
```

b. `src/lib/scenes.ts` — in the `Scene` type, directly after `includeDirection?: boolean`, add:

```ts
  /** Job id of the refine run that produced `refined` (story 03m) — lets the
   *  prompt disclosure lazy-fetch what was sent to Gemini. Cleared on revert
   *  (the prompt belongs to the refinement just discarded). */
  promptJobId?: string
```

c. `src/store/studioSlice.ts` — in `StudioState`, directly after the `scenesJobId: string | null` field, add:

```ts
  /**
   * Job id of the last SUCCESSFUL master-director run (story 03m) — the prompt
   * disclosure lazy-fetches the job row to show what was sent to Gemini.
   * Separate from `scenesJobId` (in-flight resume pointer, cleared on terminal
   * status so the resume poller never re-runs a finished job).
   */
  directorPromptJobId: string | null
```

In `initialState`, after `scenesJobId: null,` add `directorPromptJobId: null,`.

In `reducers`, after `setScenesJobId`, add:

```ts
    /** Pointer to the last successful director job's row (story 03m). */
    setDirectorPromptJobId(state, action: PayloadAction<string | null>) {
      state.directorPromptJobId = action.payload
    },
```

Add `setDirectorPromptJobId` to the exported actions (after `setScenesJobId`).

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/store/studioSlice.test.ts` — Expected: PASS.
Run: `npm run build` — Expected: PASS.

```bash
git add src/store/studioApi.ts src/lib/scenes.ts src/store/studioSlice.ts src/store/studioSlice.test.ts
git commit -m "feat(studio): 03m — prompt/system on StudioJob + persisted job-id pointers"
```

---

### Task 3: Hook wiring — record the pointers, clear on revert, rerunDirector

**Files:**
- Modify: `src/components/Studio/useScenePipeline.ts` (imports ~line 40-59, `completeDirectorJob` ~325-368, `completeRefineJob` ~383-434, `clearRefinement` ~953-959, after `runDirector` ~576, return object ~1206)

- [ ] **Step 1: Import the new action**

Add `setDirectorPromptJobId` to the existing `from '../../store/studioSlice'` import list.

- [ ] **Step 2: Record the director pointer**

In `completeDirectorJob`, in the success path right before `dispatch(setScenesJobId(null))` (after the `patch('director', { status: 'done', … })` call), add:

```ts
        dispatch(setDirectorPromptJobId(jobId))
```

- [ ] **Step 3: Record the scene pointer**

In `completeRefineJob`, the success `patchScene` call gains `promptJobId: jobId`:

```ts
        patchScene(sceneId, {
          refined: { ...refinement, segments },
          refineJobId: null,
          promptJobId: jobId,
          // null (not stale) when the new refinement has no voiced audio yet.
          narrationSeconds: total > 0 ? total : null,
        })
```

- [ ] **Step 4: Clear on revert**

In `clearRefinement`, extend the patch:

```ts
      patchScene(id, { refined: null, narrationSeconds: null, promptJobId: undefined })
```

- [ ] **Step 5: Add rerunDirector**

Directly after the `runDirector` callback definition, add:

```ts
  // Re-run the master director after it's already done (story 03m). `next()`
  // runs the CURRENT stage — wrong here, it would run clone — so this drives the
  // director step directly. The UI confirm has already happened by now; the
  // scene queue is replaced wholesale by `completeDirectorJob` (which also
  // resets the selection). Same enqueue+poll as a first run, so `scenesJobId`
  // persists and a mid-redo reload resumes polling.
  const rerunDirector = useCallback(
    async (ctx: StepContext) => {
      try {
        await runDirector(ctx)
      } catch (e) {
        patch('director', { status: 'error', detail: stageError(e) })
      }
    },
    [runDirector, patch],
  )
```

- [ ] **Step 6: Expose from the hook**

In the return object, after `setIncludeDirection,` add:

```ts
    directorPromptJobId,
    rerunDirector,
```

And add the selector next to the other slice reads (after `const direction = …`):

```ts
  const directorPromptJobId = useAppSelector((s) => s.studio.directorPromptJobId)
```

- [ ] **Step 7: Verify and commit**

Run: `npm run build && npm run test:run` — Expected: PASS.

```bash
git add src/components/Studio/useScenePipeline.ts
git commit -m "feat(studio): 03m — record prompt job pointers + rerunDirector action"
```

---

### Task 4: PromptDisclosure component (TDD) + placements

**Files:**
- Create: `src/components/Studio/PromptDisclosure.tsx`
- Test: `src/components/Studio/PromptDisclosure.test.tsx` (new)
- Modify: `src/pages/Studio.tsx` (under both `SynopsisCard` call sites, ~474 and ~537)
- Modify: `src/components/Studio/SceneRefinePanel.tsx` (bottom of panel)

The component splits presentational/connected so the presentational half is RTL-testable without a store: `PromptDisclosure` (pure, takes the fetch state + `onOpen`) and `JobPromptDisclosure` (thin wrapper over `useLazyGetStudioJobQuery`, renders null without a `jobId`).

- [ ] **Step 1: Write the failing tests**

Create `src/components/Studio/PromptDisclosure.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PromptDisclosure } from './PromptDisclosure'

/** jsdom doesn't toggle <details> on summary click reliably — set .open and
 *  fire the toggle event the component listens for. */
function expand() {
  const details = screen.getByText(/view the prompt/i).closest('details')!
  details.open = true
  fireEvent(details, new Event('toggle'))
}

describe('PromptDisclosure (story 03m)', () => {
  it('is collapsed by default and calls onOpen only on first expand', () => {
    const onOpen = vi.fn()
    render(<PromptDisclosure label="View the prompt sent to the AI" onOpen={onOpen} />)
    expect(onOpen).not.toHaveBeenCalled()
    expand()
    expand()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('renders prompt and system as collapsed sub-sections', () => {
    render(
      <PromptDisclosure
        label="View the prompt sent to the AI"
        onOpen={() => {}}
        prompt="THE PROMPT TEXT"
        system="THE SYSTEM TEXT"
      />,
    )
    expand()
    expect(screen.getByText('Prompt')).toBeInTheDocument()
    expect(screen.getByText('System instruction')).toBeInTheDocument()
    expect(screen.getByText('THE PROMPT TEXT')).toBeInTheDocument()
    expect(screen.getByText('THE SYSTEM TEXT')).toBeInTheDocument()
  })

  it('shows the not-available fallback for old runs', () => {
    render(
      <PromptDisclosure label="View the prompt sent to the AI" onOpen={() => {}} loaded />,
    )
    expand()
    expect(screen.getByText(/not available for this run/i)).toBeInTheDocument()
  })

  it('shows a muted error line on fetch failure', () => {
    render(
      <PromptDisclosure label="View the prompt sent to the AI" onOpen={() => {}} error />,
    )
    expand()
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/Studio/PromptDisclosure.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/Studio/PromptDisclosure.tsx`:

```tsx
import { useState } from 'react'
import { useLazyGetStudioJobQuery } from '../../store/studioApi'

type Props = {
  label: string
  /** Fired once, on the first expand — the connected wrapper fetches here. */
  onOpen: () => void
  loading?: boolean
  /** True once a fetch has resolved — distinguishes "no prompt stored" (old
   *  runs, show the fallback) from "not fetched yet". */
  loaded?: boolean
  error?: boolean
  prompt?: string | null
  system?: string | null
}

/**
 * The low-key "what did we actually tell the AI" disclosure (story 03m).
 * Collapsed by default — it's for the curious, not in your face. The prompt is
 * fetched on first expand (never persisted client-side; the job row owns it).
 */
export function PromptDisclosure({ label, onOpen, loading, loaded, error, prompt, system }: Props) {
  const [opened, setOpened] = useState(false)
  return (
    <details
      className="border rule bg-paper-deep/30 px-4 py-2.5"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && !opened) {
          setOpened(true)
          onOpen()
        }
      }}
    >
      <summary className="cursor-pointer text-[12.5px] text-ink-mute">{label}</summary>
      <div className="mt-2 flex flex-col gap-2">
        {loading && <p className="text-[12.5px] text-ink-mute">Loading…</p>}
        {error && (
          <p className="text-[12.5px] text-ink-mute">Couldn't load the prompt for this run.</p>
        )}
        {!loading && !error && loaded && !prompt && !system && (
          <p className="text-[12.5px] text-ink-mute">Not available for this run.</p>
        )}
        {prompt && (
          <details>
            <summary className="cursor-pointer text-[12.5px] text-ink-soft">Prompt</summary>
            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink-soft">
              {prompt}
            </pre>
          </details>
        )}
        {system && (
          <details>
            <summary className="cursor-pointer text-[12.5px] text-ink-soft">System instruction</summary>
            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink-soft">
              {system}
            </pre>
          </details>
        )}
      </div>
    </details>
  )
}

/** Connected wrapper: fetches the job row on first expand. Renders nothing at
 *  all without a job id (old persisted sessions degrade gracefully). */
export function JobPromptDisclosure({ jobId, label }: { jobId?: string | null; label: string }) {
  const [fetchJob, { data, isFetching, isError, isSuccess }] = useLazyGetStudioJobQuery()
  if (!jobId) return null
  return (
    <PromptDisclosure
      label={label}
      onOpen={() => void fetchJob(jobId)}
      loading={isFetching}
      loaded={isSuccess}
      error={isError}
      prompt={data?.prompt}
      system={data?.system}
    />
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/Studio/PromptDisclosure.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Place the director disclosure (both views)**

In `src/pages/Studio.tsx`, add the import:

```tsx
import { JobPromptDisclosure } from '../components/Studio/PromptDisclosure'
```

Prep right column (~line 472) — inside the existing scenes block, after `SynopsisCard`:

```tsx
                    {pipe.scenes.length > 0 && (
                      <div className="mt-6 flex flex-col gap-4">
                        {pipe.synopsis && <SynopsisCard synopsis={pipe.synopsis} />}
                        <JobPromptDisclosure
                          jobId={pipe.directorPromptJobId}
                          label="View the prompt the director was sent"
                        />
                        <div className="border rule bg-paper-deep/30 p-4">
```

Build view (~line 537) — replace:

```tsx
                {pipe.synopsis && <SynopsisCard synopsis={pipe.synopsis} />}
```

with:

```tsx
                {pipe.synopsis && <SynopsisCard synopsis={pipe.synopsis} />}
                <JobPromptDisclosure
                  jobId={pipe.directorPromptJobId}
                  label="View the prompt the director was sent"
                />
```

- [ ] **Step 6: Place the scene disclosure**

In `src/components/Studio/SceneRefinePanel.tsx`, add the import:

```tsx
import { JobPromptDisclosure } from './PromptDisclosure'
```

After the `{error && <p …>…</p>}` line (before the `{hasSheets && …}` sheets preview), add:

```tsx
      {scene.promptJobId && (
        <div className="mt-3">
          <JobPromptDisclosure
            jobId={scene.promptJobId}
            label="View the prompt sent for this scene"
          />
        </div>
      )}
```

- [ ] **Step 7: Verify and commit**

Run: `npm run build && npm run test:run` — Expected: PASS.

```bash
git add src/components/Studio/PromptDisclosure.tsx src/components/Studio/PromptDisclosure.test.tsx src/pages/Studio.tsx src/components/Studio/SceneRefinePanel.tsx
git commit -m "feat(studio): 03m — collapsed PromptDisclosure for director + scene runs"
```

---

### Task 5: DirectorPanel extraction + confirm-gated re-run (TDD)

**Files:**
- Create: `src/components/Studio/DirectorPanel.tsx` (extracted from `Studio.tsx:657-702`)
- Test: `src/components/Studio/DirectorPanel.test.tsx` (new)
- Modify: `src/pages/Studio.tsx` (delete the inline `DirectorPanel`, import the new one, widen the render gate, add `rerunStep`)

- [ ] **Step 1: Write the failing tests**

Create `src/components/Studio/DirectorPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DirectorPanel } from './DirectorPanel'

const noop = () => {}

function renderPanel(extra: Partial<Parameters<typeof DirectorPanel>[0]> = {}) {
  return render(
    <DirectorPanel
      value=""
      onChange={noop}
      onSubmit={noop}
      sheetCount={3}
      wordCount={1200}
      {...extra}
    />,
  )
}

describe('DirectorPanel rerun (story 03m)', () => {
  it('normal mode submits directly', () => {
    const onSubmit = vi.fn()
    renderPanel({ onSubmit })
    fireEvent.click(screen.getByRole('button', { name: /send to the ai director/i }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('rerun mode asks for confirmation instead of submitting', () => {
    const onSubmit = vi.fn()
    renderPanel({ onSubmit, rerun: true, sceneCount: 4 })
    fireEvent.click(screen.getByRole('button', { name: /re-run the ai director/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/replaces your 4 scenes and any build work/i)).toBeInTheDocument()
  })

  it('cancel backs out without submitting', () => {
    const onSubmit = vi.fn()
    renderPanel({ onSubmit, rerun: true, sceneCount: 2 })
    fireEvent.click(screen.getByRole('button', { name: /re-run the ai director/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.queryByText(/replaces your/i)).not.toBeInTheDocument()
  })

  it('replace & re-run fires onSubmit', () => {
    const onSubmit = vi.fn()
    renderPanel({ onSubmit, rerun: true, sceneCount: 2 })
    fireEvent.click(screen.getByRole('button', { name: /re-run the ai director/i }))
    fireEvent.click(screen.getByRole('button', { name: /replace & re-run/i }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/Studio/DirectorPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the extracted component**

Create `src/components/Studio/DirectorPanel.tsx` — the existing JSDoc + JSX from `Studio.tsx:650-702` moves over verbatim, plus the rerun variant:

```tsx
import { useState } from 'react'

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  busy?: boolean
  sheetCount: number
  wordCount: number
  /** Re-run mode (story 03m): the director already ran — submitting replaces
   *  every scene and its build work, so it's confirm-gated. */
  rerun?: boolean
  sceneCount?: number
}

/**
 * The headline prep step: hand the cut to the AI master director. Shown in the
 * right column when the director step is current — and again, in `rerun` mode,
 * once it's done (story 03m), so the producer can tweak the direction and try
 * again. The free-text direction is optional — an aside to the AI ("keep the
 * demo at 12:30", "punchier intro") — so the button works empty too.
 */
export function DirectorPanel({
  value,
  onChange,
  onSubmit,
  busy,
  sheetCount,
  wordCount,
  rerun,
  sceneCount = 0,
}: Props) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="mb-6 border-l-2 border-terracotta bg-terracotta/5 p-5">
      <p className="meta-label">
        {rerun ? 'Done · the master director' : 'Final prep step · the master director'}
      </p>
      <h3 className="mt-1 font-serif text-[22px] leading-tight text-ink">
        {rerun ? 'Re-run the AI director' : 'Send it to the AI director'}
      </h3>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
        {rerun
          ? 'Tweak your direction and send it again — the director re-cuts the whole video into fresh scenes.'
          : `Gemini reads your ${wordCount.toLocaleString()}-word transcript and ${sheetCount} contact sheet${sheetCount === 1 ? '' : 's'} together, then returns a one-line synopsis and your scenes — each with a tightened script, the original-video span, and the footage to cut.`}
      </p>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="meta-label">Your direction · optional</span>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
          rows={3}
          placeholder="e.g. Keep the live demo around 12:30. Make the intro punchy and drop the throat-clearing."
          className="w-full resize-y rounded-md border border-paper-line bg-paper p-3 text-[14px] leading-relaxed text-ink disabled:opacity-60"
        />
      </label>

      {rerun && confirming ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-terracotta-ink">
            This replaces your {sceneCount} scene{sceneCount === 1 ? '' : 's'} and any build
            work on them.
          </p>
          <button
            type="button"
            className="pill-cta"
            disabled={busy}
            onClick={() => {
              setConfirming(false)
              onSubmit()
            }}
          >
            Replace &amp; re-run
          </button>
          <button
            type="button"
            className="pill-ghost"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="pill-cta mt-4"
          disabled={busy}
          onClick={() => (rerun ? setConfirming(true) : onSubmit())}
        >
          {busy ? 'Directing…' : rerun ? 'Re-run the AI director →' : 'Send to the AI director →'}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/Studio/DirectorPanel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Rewire Studio.tsx**

a. Delete the inline `DirectorPanel` function (lines ~650-702, including its JSDoc) and add the import:

```tsx
import { DirectorPanel } from '../components/Studio/DirectorPanel'
```

b. Add `rerunStep` next to `runStep` (mirrors its clip-rehydration, drives the redo):

```tsx
  // Re-run the master director (story 03m) — confirm already happened in the
  // panel. Same clip-rehydration dance as runStep, but drives the director step
  // directly instead of whatever stage is current.
  async function rerunStep() {
    if (file && url) {
      void pipe.rerunDirector({ file, src: url, duration })
      return
    }
    const f = await rehydrateClip()
    if (!f) return
    const tmpUrl = URL.createObjectURL(f)
    try {
      await pipe.rerunDirector({ file: f, src: tmpUrl, duration })
    } finally {
      URL.revokeObjectURL(tmpUrl)
    }
  }
```

c. Widen the render gate (~line 456). Derive, near the other `pipe` reads:

```tsx
  const directorDone =
    pipe.stages.find((s) => s.id === 'director')?.status === 'done' && pipe.scenes.length > 0
```

Replace:

```tsx
                    {pipe.currentStageId === 'director' && (
                      <div className="mt-6">
                        <DirectorPanel
                          value={direction}
                          onChange={(v) => dispatch(setDirection(v))}
                          onSubmit={runStep}
                          busy={pipe.running || rehydrating}
                          sheetCount={pipe.contactSheets.length}
                          wordCount={pipe.words.length}
                        />
                      </div>
                    )}
```

with:

```tsx
                    {(pipe.currentStageId === 'director' || directorDone) && (
                      <div className="mt-6">
                        <DirectorPanel
                          value={direction}
                          onChange={(v) => dispatch(setDirection(v))}
                          onSubmit={directorDone ? rerunStep : runStep}
                          busy={pipe.running || rehydrating}
                          sheetCount={pipe.contactSheets.length}
                          wordCount={pipe.words.length}
                          rerun={directorDone}
                          sceneCount={pipe.scenes.length}
                        />
                      </div>
                    )}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run build && npm run test:run` — Expected: PASS.

```bash
git add src/components/Studio/DirectorPanel.tsx src/components/Studio/DirectorPanel.test.tsx src/pages/Studio.tsx
git commit -m "feat(studio): 03m — extract DirectorPanel + confirm-gated re-run"
```

---

### Task 6: Front-end gates

- [ ] **Step 1: Run all three**

Run: `npm run build && npm run lint && npm run test:run`
Expected: build + tests PASS; lint shows ONLY the two pre-existing `ChatPanel.tsx` errors (zero findings in 03m files). Fix anything new, re-run until clean, commit fixes.

---

### Task 7: Backend — schema fields, createJob stores, poll returns

**REQUIRED SUB-SKILL: invoke the `bffless-pipeline` skill before touching the rules.** Three small, additive edits — do NOT restructure anything else. Back up each rule's pre-edit JSON to `.bffless-backups/2026-06-11-03m-<name>.json` (gitignored — local safety net, the 03k/03l convention).

- [ ] **Step 1: Add the schema fields**

`mcp__bffless-j5s__update_pipeline_schema` on schema `acdca97c-f9cc-4469-90a3-676a242924cb` (`studio_jobs`): fields become the existing five **plus** `{ name: 'prompt', type: 'string', required: false }` and `{ name: 'system', type: 'string', required: false }`. (Fetch with `get_pipeline_schema` first and pass the full updated field list if the tool replaces wholesale.)

- [ ] **Step 2: Both AI rules' createJob stores the prep output**

For rule `138f27fb-…` (`/api/scenes`) and rule `afacb572-dc8a-4e9c-bfb6-8369fb36ddc2` (`/api/refine-scene`): fetch with `get_proxy_rule`, back up, then `update_proxy_rule` with the full `pipelineConfig` where the ONLY change is the `createJob` step's fields:

```json
{
  "kind": "'scenes'",          // (or "'refine'" — keep the existing value)
  "status": "'pending'",
  "request": "request.body",
  "prompt": "steps.prep.prompt",
  "system": "steps.prep.system"
}
```

(Both rules' `prep` outputs are verified to be named `out.prompt` / `out.system`.)

- [ ] **Step 3: Poll rule returns them**

Rule `a486eb93-7d17-46e7-a28f-b3ccc2fc97b7` (`GET /api/studio/job`): in the `shape` function-handler, the returned object gains two lines —

```js
  return {
    status: (typeof q.status === 'string') ? q.status : 'pending',
    kind: (typeof q.kind === 'string') ? q.kind : '',
    result: asObj(q.result),
    error: (typeof q.error === 'string' && q.error) ? q.error : null,
    prompt: (typeof q.prompt === 'string' && q.prompt) ? q.prompt : null,
    system: (typeof q.system === 'string' && q.system) ? q.system : null,
  }
```

- [ ] **Step 4: Verify live (no Gemini needed — the prompt is stored at ENQUEUE)**

```bash
curl -s -X POST https://j5s.dev/api/refine-scene -H 'Content-Type: application/json' -d '{
  "start": 10, "end": 20, "transcript": "[0:10] hello world", "draftText": "hello world",
  "cuts": [], "sheetUrls": [],
  "audioUrl": "/api/uploads/audio/2026-06-11/does-not-exist-03m-verify.wav",
  "direction": "scene steer", "directorDirection": "global steer"
}'
# → { "jobId": "<id>", "status": "pending" }
curl -s "https://j5s.dev/api/studio/job?id=<id>"
```

Expected: the poll response contains a `prompt` string with BOTH 03l labels ("THE CREATOR'S OVERALL DIRECTION…", "THE CREATOR'S INSTRUCTIONS FOR THIS SCENE…") and a non-empty `system`. Also poll one PRE-03m job id if known — `prompt`/`system` must come back `null`, not an error.

- [ ] **Step 5: Record in the story + commit**

Add a `## Built` section to `stories/inprogress/studio/03m-prompt-transparency-and-redo.md`: schema fields added, the three rule edits (ids + what changed), backup paths, the curl verification.

```bash
git add stories/inprogress/studio/03m-prompt-transparency-and-redo.md
git commit -m "feat(studio): 03m — jobs rows store prompt/system; poll returns them"
```

---

### Task 8: Story bookkeeping + final gates + push

**Files:**
- Modify: `stories/inprogress/studio/03m-prompt-transparency-and-redo.md` (status → ✅, acceptance boxes)
- Modify: `stories/inprogress/studio/README.md` (03m row + tree line → ✅)

- [ ] **Step 1:** Check off every acceptance criterion that's true; flip status to `✅ shipped` (note: redo + disclosure are fully verified at the code level; the prompt CONTENT shown is whatever prep built — already debug-log-verified in 03l/03m).

- [ ] **Step 2:** Run `npm run build && npm run lint && npm run test:run` — all green (modulo ChatPanel).

- [ ] **Step 3:** Commit and push (same branch → PR #20 updates):

```bash
git add stories/inprogress/studio/03m-prompt-transparency-and-redo.md stories/inprogress/studio/README.md
git commit -m "docs(studio): mark story 03m shipped"
git push
```

**Orchestrator note (not for subagents):** after completion, the session owner updates the auto-memory and the PR #20 description to cover both stories.
