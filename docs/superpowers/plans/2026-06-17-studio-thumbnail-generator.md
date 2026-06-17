# Studio Export-phase Thumbnail Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Export-phase YouTube-thumbnail generator that drafts a nano-banana prompt via a skill-driven AI handler (editable), renders the image with `google/nano-banana`, and saves it to the bucket + project record.

**Architecture:** Two `/api/*` endpoints — `/api/thumbnail/draft` (an `ai_handler` with the `image-prompts` skill selected; returns `{ prompt }`) and `/api/thumbnail/render` (a `replicate` `google/nano-banana` call that stores the image to the bucket; returns `{ imageUrl }` serve path). Mock-first (MSW, `MOCK_STUDIO`), one pure `thumbnail.ts` shape layer shared by mock and real, RTK Query mutations, durable `youtubeThumbnail` field on the project working state (url-only), and a `ThumbnailStudio` component in the Export step.

**Tech Stack:** React 19 + TypeScript, Redux Toolkit + RTK Query, redux-persist, MSW, Vitest, Tailwind v4, BFFless pipelines (Replicate).

**Spec:** `docs/superpowers/specs/2026-06-17-studio-thumbnail-generator-design.md`

---

## File structure

- **Create** `src/lib/thumbnail.ts` — pure request-shaping + tolerant response coercion (mirror of `describe.ts`). One responsibility: the `/api/thumbnail/*` data shapes.
- **Create** `src/lib/thumbnail.test.ts` — unit tests for the above.
- **Modify** `src/lib/describe.ts` — extract a tiny `youtubeDescription()` helper (DRY: used by both `ExportSummary` and `ThumbnailStudio`).
- **Modify** `src/mocks/handlers.ts` — MSW mocks for both endpoints (gated by `MOCK_STUDIO`).
- **Modify** `src/store/studioApi.ts` — `thumbnailDraft` + `thumbnailRender` mutations; add `'youtube-thumbnail'` to `UploadKind`; export hooks.
- **Modify** `src/store/studioSlice.ts` — `youtubeThumbnail` field + `setYoutubeThumbnail` reducer + `freshWorkingState` default + action export.
- **Modify** `src/components/Studio/useScenePipeline.ts` — draft/render actions, in-flight flags, expose `signFor` + thumbnail state.
- **Create** `src/components/Studio/ThumbnailStudio.tsx` — the Export-step UI.
- **Modify** `src/components/Studio/ExportSummary.tsx` — use the shared `youtubeDescription()` helper.
- **Modify** `src/pages/Studio.tsx` — mount `ThumbnailStudio` in the Export phase.
- **Modify** `stories/inprogress/studio/06-thumbnail-nano-banana.md` — rewrite to match this design.
- **Commit (untracked)** `.bffless/skills/image-prompts/` — so the skill deploys with the bundle.

> **Note on real backend:** the live `/api/thumbnail/draft` + `/api/thumbnail/render` BFFless rules (and selecting the `image-prompts` skill on the draft handler) are configured via the BFFless MCP/console as the swap step at the end — NOT in this repo's code. This plan ships the mock + FE so the flow works end-to-end with `MOCK_STUDIO = true`; flipping to live is the final task and needs the project Replicate token set.

---

## Task 1: Pure `thumbnail.ts` shape layer

**Files:**
- Create: `src/lib/thumbnail.ts`
- Test: `src/lib/thumbnail.test.ts`
- Modify: `src/lib/describe.ts`

- [ ] **Step 1: Add the shared `youtubeDescription()` helper to `describe.ts`**

Add at the end of `src/lib/describe.ts` (it's the exact string `ExportSummary` builds inline today — centralizing it so `ThumbnailStudio` reuses it):

```ts
/**
 * The YouTube-ready description block: the AI summary, then the chapter lines
 * ("0:00 Title") YouTube turns into chapters. Either part may be empty. Shared by
 * the Export summary view and the thumbnail generator (which feeds it to the
 * prompt-drafting handler as DESCRIPTION).
 */
export function youtubeDescription(summary: string | null | undefined, chapters: Chapter[]): string {
  return [summary, formatChapters(chapters)].filter(Boolean).join('\n\n')
}
```

- [ ] **Step 2: Write the failing test for `thumbnail.ts`**

Create `src/lib/thumbnail.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Scene } from './scenes'
import {
  buildThumbnailDraftRequest,
  toThumbnailPrompt,
  toThumbnailImage,
} from './thumbnail'

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    index: 0,
    sourceId: 'source-1',
    title: 'Scene 1',
    start: 0,
    end: 60,
    transcript: 'original transcript words',
    status: 'built',
    narrationSeconds: null,
    refined: { segments: [{ text: 'Hello there.', start: 0, end: 2 }], cuts: [], source: 'ai' },
    ...over,
  }
}

describe('buildThumbnailDraftRequest', () => {
  it('assembles title/description/script/notes, trimming and using the final script', () => {
    const req = buildThumbnailDraftRequest(
      [scene()],
      '  My Great Video  ',
      '  A summary.\n\n0:00 Scene 1  ',
      '  bold, dark navy  ',
    )
    expect(req).toEqual({
      title: 'My Great Video',
      description: 'A summary.\n\n0:00 Scene 1',
      script: 'Hello there.',
      notes: 'bold, dark navy',
    })
  })

  it('produces an empty script when no scene has narration', () => {
    const req = buildThumbnailDraftRequest([scene({ refined: null, transcript: '' })], 'T', 'D', '')
    expect(req.script).toBe('')
  })
})

describe('toThumbnailPrompt', () => {
  it('extracts and trims the prompt string', () => {
    expect(toThumbnailPrompt({ prompt: '  a 16:9 thumbnail  ' })).toEqual({ prompt: 'a 16:9 thumbnail' })
  })
  it('falls back to empty string on a malformed reply', () => {
    expect(toThumbnailPrompt(null)).toEqual({ prompt: '' })
    expect(toThumbnailPrompt({ nope: 1 })).toEqual({ prompt: '' })
  })
})

describe('toThumbnailImage', () => {
  it('extracts imageUrl from { imageUrl }', () => {
    expect(toThumbnailImage({ imageUrl: '/api/uploads/youtube-thumbnail/x.png' }))
      .toEqual({ imageUrl: '/api/uploads/youtube-thumbnail/x.png' })
  })
  it('falls back to empty string on a malformed reply', () => {
    expect(toThumbnailImage(undefined)).toEqual({ imageUrl: '' })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/thumbnail.test.ts`
Expected: FAIL — `Failed to resolve import "./thumbnail"`.

- [ ] **Step 4: Implement `src/lib/thumbnail.ts`**

```ts
/**
 * Thumbnail generator (Export-phase YouTube thumbnail).
 *
 * Two steps: `/api/thumbnail/draft` drafts a nano-banana image prompt from the
 * video's title/description/final-script + the creator's notes (the AI handler
 * loads the `image-prompts` skill to do the actual prompt-craft), and
 * `/api/thumbnail/render` calls `google/nano-banana` with the (edited) prompt and
 * stores the image to the bucket. This is the pure half — request shaping + the
 * tolerant response coercion shared by the MSW mock and the real pipeline (which
 * also coerces server-side; this is the client mirror, like `describe.ts`).
 */

import type { Scene } from './scenes'
import { videoScript } from './describe'

/** POSTed to `/api/thumbnail/draft`: everything the prompt-drafting handler needs. */
export type ThumbnailDraftRequest = {
  /** The video's recommended title. */
  title: string
  /** The YouTube-ready description block (summary + chapters). */
  description: string
  /** The FINAL kept spoken script — evidence for topic + house-style routing. */
  script: string
  /** The creator's free-text wishes; overrides style routing when present. */
  notes: string
}

/** The draft handler's output: the ready-to-paste image prompt. */
export type ThumbnailPrompt = { prompt: string }

/** The render step's output: the persisted `/api/uploads/...` serve path. */
export type ThumbnailImage = { imageUrl: string }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Build the `/api/thumbnail/draft` request from the project's Export-page data. */
export function buildThumbnailDraftRequest(
  scenes: Scene[],
  title: string,
  description: string,
  notes: string,
): ThumbnailDraftRequest {
  return {
    title: title.trim(),
    description: description.trim(),
    script: videoScript(scenes),
    notes: notes.trim(),
  }
}

/** Coerce the draft handler's raw reply into `{ prompt }`; never throws. */
export function toThumbnailPrompt(raw: unknown): ThumbnailPrompt {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return { prompt: str(o.prompt) }
}

/** Coerce the render step's raw reply into `{ imageUrl }`; never throws. */
export function toThumbnailImage(raw: unknown): ThumbnailImage {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return { imageUrl: str(o.imageUrl) }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/thumbnail.test.ts src/lib/describe.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/lib/thumbnail.ts src/lib/thumbnail.test.ts src/lib/describe.ts
git commit -m "feat(studio): thumbnail.ts shape layer + youtubeDescription helper"
```

---

## Task 2: MSW mocks for both endpoints

**Files:**
- Modify: `src/mocks/handlers.ts`

- [ ] **Step 1: Add a 1×1 placeholder PNG constant**

Near the top of `src/mocks/handlers.ts` (after the imports / `MOCK_STUDIO` line), add a tiny opaque PNG used as the stand-in rendered thumbnail (base64 here is mock-only test data — the no-base64 rule is about Redux/localStorage persistence, not mocks):

```ts
// A 1×1 PNG (mock stand-in for the rendered nano-banana thumbnail). Stored in
// objectStore so the /api/uploads/* serve route hands real bytes back to <img>.
const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
```

- [ ] **Step 2: Add both handlers inside the `studioHandlers` array**

Place these next to the `/api/describe` handler (inside the same array, gated by `MOCK_STUDIO`):

```ts
  // Thumbnail — step 1: draft the nano-banana prompt (Export phase). The real
  // handler loads the `image-prompts` skill; the mock just echoes a plausible
  // multi-section prompt derived from the title/notes so the editable textarea has
  // realistic content. Same shape as the real pipeline: { prompt }.
  http.post('/api/thumbnail/draft', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      title?: string
      notes?: string
    }
    const title = (body.title ?? 'Your Video').trim()
    const notes = (body.notes ?? '').trim()
    const headline = title.split(/\s+/).slice(0, 5).join(' ').toUpperCase()
    const prompt = [
      'A 16:9 YouTube thumbnail, modern-dev-tool house style: dark navy #0B1226 flat',
      'background with a faint dot grid.',
      `Headline in heavy white sans-serif: "${headline}".`,
      'Small "WATCH ME CODE" pill top-left; a tilted code-editor mock on the right',
      'with a thin cyan #22D3EE outline.',
      notes ? `Creator notes: ${notes}.` : '',
      'Colors: navy #0B1226, off-white #F8FAFC, cyan #22D3EE. 3 colors max.',
      'Avoid: photorealistic humans, generic cloud icons, drop shadows, gradient mesh.',
    ].filter(Boolean).join(' ')
    return HttpResponse.json({ prompt })
  }),

  // Thumbnail — step 2: render the image with the (edited) prompt. The real
  // handler calls google/nano-banana and stores the result to the bucket; the
  // mock stashes a placeholder PNG in objectStore and returns its serve path, so
  // the same sign→<img> path works offline. Same shape as the real pipeline:
  // { imageUrl }.
  http.post('/api/thumbnail/render', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { projectId?: string }
    const pid = body.projectId ?? 'unknown-project'
    const keyPath = `projects/${pid}/youtube-thumbnail/mock-${Date.now()}.png`
    try {
      const binaryStr = atob(PLACEHOLDER_PNG_BASE64)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
      objectStore.set(keyPath, { body: bytes.buffer as ArrayBuffer, type: 'image/png' })
    } catch {
      // Non-fatal — serve route will 404 but the flow (persist + sign) still runs.
    }
    return HttpResponse.json({ imageUrl: `/api/uploads/${keyPath}` })
  }),
```

- [ ] **Step 3: Verify build/lint pass (handlers are types-only-checked, no unit test)**

Run: `npm run lint && npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/mocks/handlers.ts
git commit -m "test(studio): MSW mocks for /api/thumbnail/draft + render"
```

---

## Task 3: RTK Query mutations

**Files:**
- Modify: `src/store/studioApi.ts`

- [ ] **Step 1: Add `'youtube-thumbnail'` to `UploadKind`**

Change line 24:

```ts
export type UploadKind = 'source' | 'audio' | 'thumbnails' | 'voice' | 'export' | 'scene-clip' | 'youtube-thumbnail'
```

- [ ] **Step 2: Import the thumbnail types**

Add near the other `../lib/*` type imports (around line 20):

```ts
import type { ThumbnailDraftRequest } from '../lib/thumbnail'
```

- [ ] **Step 3: Add both mutations**

Add inside `endpoints: (builder) => ({ ... })`, right after the `describe` mutation (around line 150). Both are sync text/image calls (no jobs flow), coerced at the call site like `describe`:

```ts
    // Thumbnail draft (story 06): one sync call to the prompt-drafting handler
    // (which loads the `image-prompts` skill) → a ready-to-paste nano-banana
    // prompt. Raw blob goes through `toThumbnailPrompt` at the call site.
    thumbnailDraft: builder.mutation<unknown, ThumbnailDraftRequest>({
      query: (body) => ({
        url: 'api/thumbnail/draft',
        method: 'POST',
        body,
      }),
    }),

    // Thumbnail render (story 06): call google/nano-banana with the (edited)
    // prompt; the pipeline stores the image to the bucket and returns a serve
    // path. Raw blob goes through `toThumbnailImage` at the call site.
    thumbnailRender: builder.mutation<unknown, { prompt: string; projectId: string }>({
      query: (body) => ({
        url: 'api/thumbnail/render',
        method: 'POST',
        body,
      }),
    }),
```

- [ ] **Step 4: Export the hooks**

Add to the `export const { ... } = studioApi` block (around line 246):

```ts
  useThumbnailDraftMutation,
  useThumbnailRenderMutation,
```

- [ ] **Step 5: Verify type-check passes**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/studioApi.ts
git commit -m "feat(studio): RTK Query thumbnailDraft + thumbnailRender mutations"
```

---

## Task 4: Redux slice — durable `youtubeThumbnail`

**Files:**
- Modify: `src/store/studioSlice.ts`

- [ ] **Step 1: Add the field to `ProjectWorkingState`**

Add after the `description` field (around line 196), before `sources`:

```ts
  /**
   * The Export page's generated YouTube thumbnail (story 06): the creator's notes,
   * the (edited) image prompt it was rendered from, and the persisted
   * `/api/uploads/youtube-thumbnail/...` serve path. URL-only — the PNG bytes are
   * never persisted; the path is re-signed on load for display/download. Null
   * until rendered; re-rendering overwrites it. Cleared when working state resets.
   */
  youtubeThumbnail: { notes: string; prompt: string; url: string } | null
```

- [ ] **Step 2: Add the default to `freshWorkingState()`**

Add after `description: null,` (around line 238):

```ts
    youtubeThumbnail: null,
```

- [ ] **Step 3: Add the reducer**

Add next to `setDescription` in the `reducers: { ... }` block:

```ts
    /** The rendered YouTube thumbnail (story 06): notes + prompt + serve path. */
    setYoutubeThumbnail(
      state,
      action: PayloadAction<{ notes: string; prompt: string; url: string } | null>,
    ) {
      const w = active(state); if (!w) return
      w.youtubeThumbnail = action.payload
    },
```

- [ ] **Step 4: Export the action**

Add to the `export const { ... } = studioSlice.actions` block (near `setDescription`):

```ts
  setYoutubeThumbnail,
```

- [ ] **Step 5: Verify type-check passes**

Run: `npx tsc -b`
Expected: no errors. (`freshWorkingState` now matches `ProjectWorkingState`; old persisted sessions rehydrate without the key and fall back to `null` via the top-level persist merge — no migration, like `direction`.)

- [ ] **Step 6: Commit**

```bash
git add src/store/studioSlice.ts
git commit -m "feat(studio): persist youtubeThumbnail on project working state"
```

---

## Task 5: Wire actions into `useScenePipeline`

**Files:**
- Modify: `src/components/Studio/useScenePipeline.ts`

- [ ] **Step 1: Add imports**

Add to the `../../lib/*` imports near line 5:

```ts
import { buildThumbnailDraftRequest, toThumbnailPrompt, toThumbnailImage } from '../../lib/thumbnail'
```

Add to the `studioApi` hook imports (near line 44):

```ts
  useThumbnailDraftMutation,
  useThumbnailRenderMutation,
```

Add to the slice action imports (near line 69):

```ts
  setYoutubeThumbnail,
```

- [ ] **Step 2: Read state + create the mutation hooks**

Near the `description` selector (line 210) add:

```ts
  const youtubeThumbnail = useAppSelector((s) => selectActive(s).youtubeThumbnail)
```

Near `const [describeReq] = useDescribeMutation()` (line 233) add:

```ts
  const [thumbnailDraftReq] = useThumbnailDraftMutation()
  const [thumbnailRenderReq] = useThumbnailRenderMutation()
```

Near `const [describing, setDescribing] = useState(false)` (line 264) add:

```ts
  const [draftingThumbnail, setDraftingThumbnail] = useState(false)
  const [renderingThumbnail, setRenderingThumbnail] = useState(false)
```

- [ ] **Step 3: Add the draft + render callbacks**

Add right after the `editDescriptionTitle` callback (around line 1572):

```ts
  // ---- Export: YouTube thumbnail (story 06) ---------------------------------

  // Draft a nano-banana prompt from the finished video's title + YouTube
  // description + final script + the creator's notes. One sync call; the handler
  // loads the `image-prompts` skill to do the prompt-craft. Returns the drafted
  // prompt for the editable textarea (we don't persist until it's rendered).
  const draftThumbnailPrompt = useCallback(
    async (title: string, description: string, notes: string): Promise<string | null> => {
      const req = buildThumbnailDraftRequest(scenes, title, description, notes)
      if (!req.script) {
        setSceneError('Build at least one scene before generating a thumbnail.')
        return null
      }
      setDraftingThumbnail(true)
      setSceneError(null)
      try {
        const raw = await thumbnailDraftReq(req).unwrap()
        return toThumbnailPrompt(raw).prompt
      } catch (e) {
        setSceneError(stageError(e))
        return null
      } finally {
        setDraftingThumbnail(false)
      }
    },
    [scenes, thumbnailDraftReq],
  )

  // Render the thumbnail with the (edited) prompt: nano-banana → bucket → serve
  // path, persisted on the project (url-only) so it survives reload + rides
  // server-sync. Stores notes + prompt alongside so the UI can repopulate.
  const renderThumbnail = useCallback(
    async (notes: string, prompt: string) => {
      if (!prompt.trim()) {
        setSceneError('Draft a prompt before generating the image.')
        return
      }
      setRenderingThumbnail(true)
      setSceneError(null)
      try {
        const raw = await thumbnailRenderReq({ prompt, projectId: activeProjectId ?? '' }).unwrap()
        const { imageUrl } = toThumbnailImage(raw)
        dispatch(setYoutubeThumbnail({ notes, prompt, url: imageUrl }))
      } catch (e) {
        setSceneError(stageError(e))
      } finally {
        setRenderingThumbnail(false)
      }
    },
    [thumbnailRenderReq, activeProjectId, dispatch],
  )
```

- [ ] **Step 4: Expose the new values + `signFor` in the returned object**

Add to the big return object (the block ending around line 1680, near `describing,`):

```ts
    signFor,
    youtubeThumbnail,
    draftingThumbnail,
    renderingThumbnail,
    draftThumbnailPrompt,
    renderThumbnail,
```

- [ ] **Step 5: Verify type-check + existing tests pass**

Run: `npx tsc -b && npm run test:run`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/Studio/useScenePipeline.ts
git commit -m "feat(studio): wire thumbnail draft/render into useScenePipeline"
```

---

## Task 6: `ThumbnailStudio` component

**Files:**
- Create: `src/components/Studio/ThumbnailStudio.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useEffect, useState } from 'react'

type Props = {
  /** The recommended title (from the Export description). */
  title: string
  /** The YouTube-ready description block (summary + chapters). */
  description: string
  /** Persisted thumbnail (notes + prompt + serve path), or null. */
  thumbnail: { notes: string; prompt: string; url: string } | null
  drafting: boolean
  rendering: boolean
  /** Draft a prompt; resolves to the drafted text (or null on failure). */
  onDraft: (title: string, description: string, notes: string) => Promise<string | null>
  /** Render the image from the (edited) prompt + notes. */
  onRender: (notes: string, prompt: string) => void
  /** Sign a serve path into a displayable direct URL. */
  signFor: (url: string) => Promise<string>
}

/**
 * Export-step YouTube thumbnail generator (story 06). The creator writes free-text
 * notes → Draft prompt (an AI handler that loads the `image-prompts` skill) →
 * edit the prompt → Generate → google/nano-banana renders the image, saved to the
 * bucket + project. The saved serve path is re-signed for display + download.
 */
export function ThumbnailStudio({
  title,
  description,
  thumbnail,
  drafting,
  rendering,
  onDraft,
  onRender,
  signFor,
}: Props) {
  const [notes, setNotes] = useState(thumbnail?.notes ?? '')
  const [prompt, setPrompt] = useState(thumbnail?.prompt ?? '')
  const [signedUrl, setSignedUrl] = useState<string | null>(null)

  // Re-sign the persisted thumbnail for <img>/download whenever its serve path
  // changes (new render or a restored session). Serve paths can't be shown
  // directly — big media must go through a signed direct-bucket URL.
  useEffect(() => {
    let cancelled = false
    if (!thumbnail?.url) {
      setSignedUrl(null)
      return
    }
    signFor(thumbnail.url)
      .then((u) => { if (!cancelled) setSignedUrl(u) })
      .catch(() => { if (!cancelled) setSignedUrl(null) })
    return () => { cancelled = true }
  }, [thumbnail?.url, signFor])

  async function handleDraft() {
    const drafted = await onDraft(title, description, notes)
    if (drafted != null) setPrompt(drafted)
  }

  return (
    <div className="flex flex-col gap-4 border rule bg-paper p-5">
      <div>
        <p className="meta-label">YouTube thumbnail</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Describe what you want, draft a prompt, tweak it, then generate the image.
        </p>
      </div>

      {/* Creator notes */}
      <div>
        <label htmlFor="thumb-notes" className="meta-label">
          What should the thumbnail be like?
        </label>
        <textarea
          id="thumb-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. bold, dark navy, show the terminal — excited energy"
          className="mt-1 w-full resize-y rounded-md border border-paper-line bg-paper-deep/20 p-3 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
        />
        <button type="button" className="pill-ghost mt-2" disabled={drafting} onClick={handleDraft}>
          {drafting ? 'Drafting…' : 'Draft prompt'}
        </button>
      </div>

      {/* Editable drafted prompt */}
      <div>
        <label htmlFor="thumb-prompt" className="meta-label">
          Image prompt — edit before generating
        </label>
        <textarea
          id="thumb-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={8}
          placeholder={drafting ? 'Drafting a prompt…' : 'Draft a prompt, or paste your own.'}
          className="mt-1 w-full resize-y rounded-md border border-paper-line bg-paper-deep/20 p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="button"
          className="pill-cta mt-2"
          disabled={rendering || !prompt.trim()}
          onClick={() => onRender(notes, prompt)}
        >
          {rendering ? 'Generating…' : thumbnail ? 'Regenerate' : 'Generate'}
        </button>
      </div>

      {/* Result */}
      {signedUrl && (
        <div className="flex flex-col gap-2">
          <img
            src={signedUrl}
            alt="Generated YouTube thumbnail"
            className="w-full max-w-2xl rounded-md border border-paper-line"
          />
          <a href={signedUrl} download="thumbnail.png" className="pill-ghost w-fit">
            Download
          </a>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify type-check + lint pass**

Run: `npx tsc -b && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Studio/ThumbnailStudio.tsx
git commit -m "feat(studio): ThumbnailStudio export-step component"
```

---

## Task 7: Mount in the Export phase

**Files:**
- Modify: `src/pages/Studio.tsx`

- [ ] **Step 1: Import the component + the description helper**

Add near the `ExportSummary` import (line 32):

```ts
import { ThumbnailStudio } from '../components/Studio/ThumbnailStudio'
```

Ensure `videoChapters` and `youtubeDescription` are imported from `../lib/describe` (add them to the existing describe import, or add a new import line):

```ts
import { videoChapters, youtubeDescription } from '../lib/describe'
```

- [ ] **Step 2: Mount `ThumbnailStudio` after `FinalCutBar`**

In the `displayPhase === 'export'` block, after the `<FinalCutBar ... />` (line 738), add:

```tsx
                <ThumbnailStudio
                  title={pipe.description?.title ?? ''}
                  description={youtubeDescription(pipe.description?.summary, videoChapters(pipe.scenes))}
                  thumbnail={pipe.youtubeThumbnail}
                  drafting={pipe.draftingThumbnail}
                  rendering={pipe.renderingThumbnail}
                  onDraft={pipe.draftThumbnailPrompt}
                  onRender={pipe.renderThumbnail}
                  signFor={pipe.signFor}
                />
```

- [ ] **Step 3: Verify build + lint + tests**

Run: `npm run build && npm run lint && npm run test:run`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Studio.tsx
git commit -m "feat(studio): mount ThumbnailStudio in the Export phase"
```

---

## Task 8: Story doc + deploy the skill

**Files:**
- Modify: `stories/inprogress/studio/06-thumbnail-nano-banana.md`
- Add: `.bffless/skills/image-prompts/` (currently untracked)

- [ ] **Step 1: Rewrite `06-thumbnail-nano-banana.md`**

Replace its body to match the shipped design: Export-phase placement; **text-only** (no reference frame); **two endpoints** `/api/thumbnail/draft` (ai_handler, JSON, one-time, **`image-prompts` skill selected**, lean system prompt that directs it to load the skill) + `/api/thumbnail/render` (replicate `google/nano-banana` → bucket → `{ imageUrl }`); the editable-prompt flow; **no variations**; the thumbnail saved to the bucket + project record (url-only, re-signed via `/api/uploads/sign`); validators off until story 07. Paste the draft handler's **system prompt** (from the spec) verbatim into the story so the BFFless rule author has the exact text. Mark status `✅ shipped (FE + mock)` / `⏳ live rule pending`.

- [ ] **Step 2: Commit the story + the skill**

```bash
git add stories/inprogress/studio/06-thumbnail-nano-banana.md .bffless/skills/image-prompts
git commit -m "docs(studio): rewrite story 06 + commit image-prompts skill for deploy"
```

- [ ] **Step 3: Final full verification**

Run: `npm run build && npm run lint && npm run test:run`
Expected: all green.

---

## Task 9 (swap step — outside this repo): go live

> Not a code change in this repo. Do this in the BFFless console/MCP once the FE+mock is merged and the Replicate token is set (Settings → AI).

- [ ] **Step 1:** Create proxy/pipeline rule for `POST /api/thumbnail/draft`: an `ai_handler` step, Response Format **JSON**, **one-time completion**, **Skills Mode: Select Skills → `image-prompts`** (Skills Path `.bffless/skills`), system prompt = the text from the spec, user message templated from `{{ }}` body vars (title/description/script/notes). `response_handler` returns `{ prompt }`.
- [ ] **Step 2:** Create proxy/pipeline rule for `POST /api/thumbnail/render`: a `replicate` step (`google/nano-banana`, `input.prompt = {{steps.form.prompt}}`), a `file_upload` step storing the output under `projects/<id>/youtube-thumbnail/`, `response_handler` returns `{ imageUrl }` serve path. Validators (`auth_required` + `rate_limit`) **off** (story 07).
- [ ] **Step 3:** Attach the rules to the studio rule set / alias (see memory `project_studio_rule_set_alias`). Set `MOCK_STUDIO = false` and smoke-test the real flow.

---

## Self-review notes

- **Spec coverage:** draft+render endpoints (T2/T3/T9), skill-selected handler + system prompt (T8/T9), lean system prompt (spec + T8), dynamic user message (T1/T5), final-script as SCRIPT (T1), text-only/no-variations (component T6), bucket+project persistence url-only (T4/T5), re-sign on load (T6), distinct `youtube-thumbnail` kind (T3), mock-first same-shape (T1/T2), validators off until 07 (T9), commit the skill (T8). All mapped.
- **Type consistency:** `ThumbnailDraftRequest`/`ThumbnailPrompt`/`ThumbnailImage` defined in T1, consumed unchanged in T3/T5. `youtubeThumbnail: { notes; prompt; url }` defined in T4, consumed identically in T5/T6/T7. `draftThumbnailPrompt(title, description, notes)` and `renderThumbnail(notes, prompt)` signatures match between T5 (definition) and T6/T7 (callers).
- **No placeholders:** every code step is complete and copy-pasteable; the only deferred work is the out-of-repo BFFless rule config (T9), which is inherently console/MCP work, with exact settings listed.
