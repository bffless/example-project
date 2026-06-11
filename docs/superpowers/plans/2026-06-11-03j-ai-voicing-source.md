# Story 03j — AI-Suggested Voicing Source: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The master director returns a per-scene `voicing` plan and the refiner tags each segment `original`/`revoice`; segments tagged `original` are auto-voiced from the clip's own audio right after refine.

**Architecture:** Both AI passes gain one output field, coerced client-side by the existing pure functions (`toScenes`, `toRefinement` — mock and real share the shape, swap-don't-rewrite). A verbatim-words guard in `toRefinement` downgrades hallucinated `original` tags. Auto-adopt happens inside `completeRefineJob` *before* the single `patchScene` commit (one decode of the whole-clip WAV, sequential uploads, per-segment failures non-fatal). The UI adds a "Use original" button per suggested segment and a Voicing line on `SceneMeta`. Everything is non-destructive: only `scene.refined` and the new optional fields are written.

**Tech Stack:** React 19 + TS, Redux Toolkit + redux-persist, RTK Query, MSW, Vitest, WebAudio, BFFless pipelines (Gemini 3.1 Pro via Replicate).

**Spec:** `stories/inprogress/studio/03j-ai-voicing-source.md` (approved). Work on branch `feat/studio-03j-ai-voicing-source`.

**Repo invariants (do not violate):**
- Never mutate the director baseline (`scene.draftText` / `scene.cuts`); only `scene.refined` and the new optional metadata fields are written.
- No base64 in Redux/localStorage — only serve URLs persist.
- Don't "fix" the missing `auth_required`/`rate_limit` validators on the pipeline rules (deferred to story 07).
- `npm run lint` currently has 2 pre-existing errors in `ChatPopup`/`ChatPanel.tsx` — those are known debt, not yours. Anything else must be clean.

---

## File structure

| File | Change |
|---|---|
| `src/lib/scenes.ts` | + `Scene.voicing`, + `NarrationSegment.suggestedSource` (types only) |
| `src/lib/director.ts` / `director.test.ts` | + `DirectorScene.voicing`, `toVoicing` coercion in `toScenes` |
| `src/lib/refiner.ts` / `refiner.test.ts` | + `RefineSegment.source`, verbatim guard in `toRefinement`, + `voicingSummary`, `suggestedOriginalIndices`, `applyOriginalClips` |
| `src/lib/audio.ts` | + `sliceManyAudioWav` (decode once, slice many); `sliceAudioWav` delegates |
| `src/mocks/handlers.ts` | `mockDirector` returns `voicing`; `mockRefiner` returns guard-passing `source` tags |
| `src/components/Studio/useScenePipeline.ts` | `sliceAndUploadSpans`, auto-adopt in `completeRefineJob`, + `adoptSegmentOriginal` |
| `src/components/Studio/SegmentVoiceControl.tsx` / `.test.tsx` (new) | `suggestedSource` on `SegmentControl`, "Use original" button |
| `src/components/Studio/TranscriptDiff.tsx` | thread `onUseOriginal` through `Controls` |
| `src/pages/Studio.tsx` | map `suggestedSource` into `segmentControls`, pass `onUseOriginal` |
| `src/components/Studio/SceneMeta.tsx` | "Voicing" stat from `voicingSummary` |
| BFFless rules `138f27fb` (director), `afacb572` (refiner) | prompt + parse-step passthrough (server-side, via MCP) |
| `stories/inprogress/studio/03j-ai-voicing-source.md`, `stories/inprogress/studio/README.md` | status bookkeeping |

Useful commands: `npm run test:run` (all), `npx vitest run src/lib/refiner.test.ts` (one file), `npm run build` (tsc -b + vite), `npm run lint`.

---

### Task 1: Scene model fields

**Files:**
- Modify: `src/lib/scenes.ts:31-44` (NarrationSegment) and `src/lib/scenes.ts:58-99` (Scene)

Type-only change — no behavior, so no test to write first. Both fields are optional, so old persisted localStorage state needs no migration.

- [ ] **Step 1: Add `suggestedSource` to `NarrationSegment`**

In `src/lib/scenes.ts`, inside `NarrationSegment` (after the `audioSource` field, line 43), add:

```ts
  /** The refiner's per-segment suggestion (story 03j): voice this run with the
   *  span's own ORIGINAL audio, or re-voice its (new) text. Pure provenance —
   *  it survives user overrides, so revert/re-open flows can still show what
   *  the AI wanted. `audioSource` above stays "what actually happened". */
  suggestedSource?: 'original' | 'revoice'
```

- [ ] **Step 2: Add `voicing` to `Scene`**

In the same file, inside `Scene` (after the `cuts` field, line 75), add:

```ts
  /** The master director's coarse voicing plan for this chapter (story 03j):
   *  'original' = ship this span in the creator's own audio, trims as cuts;
   *  'revoice' = tightened narration to be re-voiced (the pre-03j behavior);
   *  'mixed' = some of both — the refiner decides where. Absent = unknown
   *  (old persisted projects / old responses) — no badge. */
  voicing?: 'original' | 'revoice' | 'mixed'
```

- [ ] **Step 3: Verify the build type-checks**

Run: `npm run build`
Expected: PASS (tsc -b + vite build complete with no errors)

- [ ] **Step 4: Commit**

```bash
git add src/lib/scenes.ts
git commit -m "feat(studio): add voicing plan + suggested-source fields to the scene model (03j)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Director — coerce the per-scene `voicing` plan

**Files:**
- Modify: `src/lib/director.ts:29-40` (DirectorScene), `src/lib/director.ts:113-148` (toScenes)
- Test: `src/lib/director.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/lib/director.test.ts`, inside the existing `describe('toScenes', ...)` block, add:

```ts
  it('keeps a valid voicing plan and drops junk values (story 03j)', () => {
    const scenes = toScenes(
      [
        { start: 0, end: 30, draftText: 'a', voicing: 'original' },
        { start: 30, end: 60, draftText: 'b', voicing: 'mixed' },
        { start: 60, end: 90, draftText: 'c', voicing: 'shout it' as unknown as DirectorScene['voicing'] },
        { start: 90, end: 120, draftText: 'd' },
      ],
      120,
    )
    expect(scenes.map((s) => s.voicing)).toEqual(['original', 'mixed', undefined, undefined])
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/director.test.ts`
Expected: FAIL — the new test gets `[undefined, undefined, undefined, undefined]` (and TS complains `voicing` doesn't exist on `DirectorScene`).

- [ ] **Step 3: Implement**

In `src/lib/director.ts`, add to `DirectorScene` (after the `cuts` field, line 39):

```ts
  /** The director's voicing plan for this scene (story 03j): keep the creator's
   *  original audio, re-voice the tightened script, or some of both. */
  voicing?: 'original' | 'revoice' | 'mixed'
```

Add this helper next to `clampCut` (after line 103):

```ts
/** Validate the director's per-scene voicing plan; anything else → undefined. */
function toVoicing(v: unknown): Scene['voicing'] {
  return v === 'original' || v === 'revoice' || v === 'mixed' ? v : undefined
}
```

In `toScenes`, inside the `sorted.forEach` body, compute the value (next to the `cuts` mapping, line 130):

```ts
    const voicing = toVoicing(s?.voicing)
```

and add it to the pushed object — spread-conditionally so an invalid/missing value leaves the key absent (not `voicing: undefined`):

```ts
    scenes.push({
      id: `scene-${i + 1}`,
      index: i,
      title,
      start,
      end,
      transcript,
      draftText,
      status: 'pending',
      narrationSeconds: null,
      cuts,
      ...(voicing ? { voicing } : {}),
    })
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/director.test.ts`
Expected: PASS (all toScenes tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/lib/director.ts src/lib/director.test.ts
git commit -m "feat(studio): director scenes carry a coerced voicing plan (03j)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Refiner — per-segment `source` + the verbatim downgrade guard

**Files:**
- Modify: `src/lib/refiner.ts:26` (RefineSegment), `src/lib/refiner.ts:67-89` (toRefinement)
- Test: `src/lib/refiner.test.ts`

The guard is the safety core of this story: an `original` segment's audio slice plays **everything** spoken in its span, so the tag only survives if the segment's text is exactly the span's transcript words. Mismatch (rewritten text, an omitted um) → downgrade to `revoice` rather than auto-slice wrong audio.

- [ ] **Step 1: Write the failing tests**

In `src/lib/refiner.test.ts`, add `RefineSegment` to the type imports from `./refiner` (line 17 area), then add this describe block after the existing `toRefinement` block:

```ts
describe('toRefinement voicing source (story 03j)', () => {
  const words = [
    { text: 'So', start: 10, end: 10.3 },
    { text: 'the', start: 10.4, end: 10.6 },
    { text: 'idea', start: 10.7, end: 11.2 },
    { text: 'is', start: 11.3, end: 11.5 },
    { text: 'simple,', start: 11.6, end: 12.1 },
  ]

  it('keeps an original tag when the text matches the span words verbatim', () => {
    const r = toRefinement(
      { segments: [{ text: 'so the idea is simple', start: 10, end: 12.5, source: 'original' }] },
      scene(),
      words,
    )
    expect(r.segments[0].suggestedSource).toBe('original')
  })

  it('downgrades an original tag whose text was rewritten', () => {
    const r = toRefinement(
      { segments: [{ text: 'the idea is straightforward', start: 10, end: 12.5, source: 'original' }] },
      scene(),
      words,
    )
    expect(r.segments[0].suggestedSource).toBe('revoice')
  })

  it('downgrades an original tag when no transcript words are provided', () => {
    const r = toRefinement(
      { segments: [{ text: 'so the idea is simple', start: 10, end: 12.5, source: 'original' }] },
      scene(),
    )
    expect(r.segments[0].suggestedSource).toBe('revoice')
  })

  it('passes revoice through and drops junk source values', () => {
    const r = toRefinement(
      {
        segments: [
          { text: 'a new line', start: 0, end: 5, source: 'revoice' },
          { text: 'another line', start: 20, end: 25, source: 'shout' as unknown as RefineSegment['source'] },
        ],
      },
      scene(),
    )
    expect(r.segments[0].suggestedSource).toBe('revoice')
    expect(r.segments[1].suggestedSource).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/refiner.test.ts`
Expected: FAIL — `source` doesn't exist on `RefineSegment`, `suggestedSource` is always undefined.

- [ ] **Step 3: Implement**

In `src/lib/refiner.ts`:

Extend `RefineSegment` (line 26):

```ts
/** A segment as the model returns it, before we coerce/clamp it. On the wire
 *  the per-segment voicing suggestion is `source` (simplest for the model);
 *  `toRefinement` maps it to `NarrationSegment.suggestedSource` so it can't be
 *  confused with the refinement-level `source: 'ai' | 'manual'`, which is
 *  client-assigned and never on the wire. */
export type RefineSegment = {
  text?: string
  start?: number
  end?: number
  source?: 'original' | 'revoice'
}
```

Add the normalizer next to `clampSpan` (after line 57):

```ts
/** Lowercase + strip punctuation → the word sequence both sides of the
 *  verbatim check are compared in (tolerant of case/punctuation drift between
 *  the model's echo and the WhisperX words, strict about the words themselves). */
function normWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .split(' ')
    .filter(Boolean)
}
```

Change `toRefinement`'s signature (line 67) to accept the transcript words (defaults to `[]`, which downgrades every `original` tag — the conservative behavior when there's nothing to verify against):

```ts
export function toRefinement(raw: RefineSceneRaw, scene: Scene, words: TWord[] = []): SceneRefinement {
```

and replace the segment loop body (lines 75–82) with:

```ts
  for (const seg of sorted) {
    const text = str(seg?.text).trim()
    if (!text) continue
    const span = clampSpan(Math.max(num(seg?.start), cursor), num(seg?.end), lo, hi)
    if (!span) continue
    let suggestedSource =
      seg?.source === 'original' || seg?.source === 'revoice' ? seg.source : undefined
    if (suggestedSource === 'original') {
      // The slice plays EVERYTHING spoken in the span — the tag survives only if
      // the text is exactly the span's words. The model drops words by SPLITTING
      // segments around them (the gap carries the removal), never by omitting
      // them from the text; a mismatch here means a rewrite or an omission, so
      // downgrade rather than auto-slice the wrong audio (story 03j).
      const spanText = words
        .filter((w) => typeof w.start === 'number' && w.start >= span.start && w.start < span.end)
        .map((w) => w.text)
        .join(' ')
      if (normWords(text).join(' ') !== normWords(spanText).join(' ')) suggestedSource = 'revoice'
    }
    segments.push({
      text,
      start: span.start,
      end: span.end,
      ...(suggestedSource ? { suggestedSource } : {}),
    })
    cursor = span.end
  }
```

(`TWord` is already imported at line 23. `useScenePipeline`'s existing two-arg call keeps compiling via the default param; it's updated in Task 7.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/refiner.test.ts`
Expected: PASS — all new tests AND all pre-existing `toRefinement` tests (they pass no `words` and no `source`, so their segment objects are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/refiner.ts src/lib/refiner.test.ts
git commit -m "feat(studio): refiner segments carry a verbatim-guarded voicing suggestion (03j)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Pure helpers — `voicingSummary`, `suggestedOriginalIndices`, `applyOriginalClips`

**Files:**
- Modify: `src/lib/refiner.ts` (append after `segmentsToTimedWords`)
- Test: `src/lib/refiner.test.ts`

These keep Task 7's hook thin and unit-testable: the SceneMeta label, the auto-adopt work list, and the clip-attachment fold.

- [ ] **Step 1: Write the failing tests**

In `src/lib/refiner.test.ts`, add `voicingSummary`, `suggestedOriginalIndices`, `applyOriginalClips` to the imports from `./refiner`, then append:

```ts
describe('voicingSummary', () => {
  it('shows the director plan before refining', () => {
    expect(voicingSummary(scene({ voicing: 'original' }))).toBe('original audio')
    expect(voicingSummary(scene({ voicing: 'revoice' }))).toBe('re-voice')
    expect(voicingSummary(scene({ voicing: 'mixed' }))).toBe('partial')
    expect(voicingSummary(scene())).toBeNull()
  })

  it('derives the real mix from refined segments', () => {
    const refined = {
      segments: [
        { text: 'a', start: 0, end: 10, suggestedSource: 'original' as const },
        { text: 'b', start: 20, end: 30, suggestedSource: 'revoice' as const },
        { text: 'c', start: 40, end: 50 },
      ],
      cuts: [],
      source: 'ai' as const,
    }
    expect(voicingSummary(scene({ refined }))).toBe('1 original · 2 re-voice')
  })

  it('reads what actually happened over the suggestion', () => {
    const refined = {
      segments: [
        {
          text: 'a',
          start: 0,
          end: 10,
          suggestedSource: 'revoice' as const,
          audioUrl: '/x.wav',
          audioSeconds: 10,
          audioSource: 'original' as const,
        },
      ],
      cuts: [],
      source: 'ai' as const,
    }
    expect(voicingSummary(scene({ refined }))).toBe('original audio')
  })
})

describe('suggestedOriginalIndices', () => {
  it('lists unvoiced original-tagged segments only', () => {
    expect(
      suggestedOriginalIndices([
        { text: 'a', start: 0, end: 5, suggestedSource: 'original' },
        { text: 'b', start: 10, end: 15, suggestedSource: 'revoice' },
        { text: 'c', start: 20, end: 25, suggestedSource: 'original', audioUrl: '/x.wav' },
        { text: 'd', start: 30, end: 35 },
        { text: 'e', start: 40, end: 45, suggestedSource: 'original' },
      ]),
    ).toEqual([0, 4])
  })
})

describe('applyOriginalClips', () => {
  const segs: NarrationSegment[] = [
    { text: 'a', start: 0, end: 5, suggestedSource: 'original' },
    { text: 'b', start: 10, end: 15, suggestedSource: 'revoice' },
    { text: 'c', start: 20, end: 25, suggestedSource: 'original' },
  ]

  it('attaches clips, snapping each end to the measured length', () => {
    const { segments, failed } = applyOriginalClips(segs, [0, 2], [
      { url: '/api/uploads/voice/a.wav', seconds: 4.2 },
      { url: '/api/uploads/voice/c.wav', seconds: 5.5 },
    ])
    expect(failed).toBe(0)
    expect(segments[0]).toMatchObject({
      audioUrl: '/api/uploads/voice/a.wav',
      audioSeconds: 4.2,
      end: 4.2,
      audioSource: 'original',
      suggestedSource: 'original',
    })
    expect(segments[1]).toEqual(segs[1]) // untouched
    expect(segments[2]).toMatchObject({ audioSeconds: 5.5, end: 25.5 })
  })

  it('counts failed clips and leaves those segments unvoiced', () => {
    const { segments, failed } = applyOriginalClips(segs, [0, 2], [null, { url: '/c.wav', seconds: 5 }])
    expect(failed).toBe(1)
    expect(segments[0].audioUrl).toBeUndefined()
    expect(segments[2].audioUrl).toBe('/c.wav')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/refiner.test.ts`
Expected: FAIL — the three functions don't exist.

- [ ] **Step 3: Implement**

Append to `src/lib/refiner.ts` (after `segmentsToTimedWords`):

```ts
/**
 * The SceneMeta "Voicing" line (story 03j): the director's coarse plan until
 * the scene is refined, then the real segment mix. Each refined segment counts
 * by what ACTUALLY happened to it (`audioSource`), falling back to the AI's
 * suggestion. Null = nothing to show (old data, no plan).
 */
export function voicingSummary(scene: Scene): string | null {
  const segs = scene.refined?.segments
  if (segs?.length) {
    const original = segs.filter((s) => (s.audioSource ?? s.suggestedSource) === 'original').length
    const revoice = segs.length - original
    if (!original) return 're-voice'
    if (!revoice) return 'original audio'
    return `${original} original · ${revoice} re-voice`
  }
  if (scene.voicing === 'original') return 'original audio'
  if (scene.voicing === 'revoice') return 're-voice'
  if (scene.voicing === 'mixed') return 'partial'
  return null
}

/** The auto-adopt work list (story 03j): segments the refiner wants voiced from
 *  the clip's own audio that aren't voiced yet. */
export function suggestedOriginalIndices(segments: NarrationSegment[]): number[] {
  return segments.flatMap((s, i) => (s.suggestedSource === 'original' && !s.audioUrl ? [i] : []))
}

/**
 * Fold uploaded original-audio clips back onto their segments (story 03j).
 * `clips[k]` belongs to `segments[indices[k]]`; null = that slice/upload failed
 * and the segment stays unvoiced (it keeps its "Use original" chip). A voiced
 * run's `end` snaps to its measured length, mirroring `setSegmentAudio`.
 */
export function applyOriginalClips(
  segments: NarrationSegment[],
  indices: number[],
  clips: ({ url: string; seconds: number } | null)[],
): { segments: NarrationSegment[]; failed: number } {
  const out = [...segments]
  let failed = 0
  indices.forEach((segIndex, k) => {
    const clip = clips[k]
    const seg = out[segIndex]
    if (!clip || !seg) {
      failed += 1
      return
    }
    out[segIndex] = {
      ...seg,
      audioUrl: clip.url,
      audioSeconds: clip.seconds,
      end: seg.start + clip.seconds,
      audioSource: 'original',
    }
  })
  return { segments: out, failed }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/refiner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/refiner.ts src/lib/refiner.test.ts
git commit -m "feat(studio): voicing summary + auto-adopt fold helpers (03j)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Audio — decode once, slice many

**Files:**
- Modify: `src/lib/audio.ts:56-70`

`sliceAudioWav` fetches + decodes the **whole clip per call** — N auto-adopted segments would mean N full decodes. Add a batch variant and make the single-span function delegate to it. No unit test: this module is WebAudio-bound (`OfflineAudioContext` doesn't exist in jsdom) and has no test file today — the type-check and the callers' behavior cover it.

- [ ] **Step 1: Implement**

Replace `sliceAudioWav` (lines 56–70) with:

```ts
/**
 * Slice `[start, end]` (seconds) out of an already-uploaded audio clip and
 * re-encode it as a standalone WAV — used to "use the original audio here"
 * (story 03d): the source clip's own audio for a span becomes a real narration
 * clip we upload to the bucket, played like any other run. The whole-clip audio
 * was extracted 1:1 with the video timeline, so original-video seconds index
 * straight into it. Clamps the range to the decoded audio.
 */
export async function sliceAudioWav(
  url: string,
  start: number,
  end: number,
  targetRate = 16000,
): Promise<Blob> {
  const [blob] = await sliceManyAudioWav(url, [{ start, end }], targetRate)
  return blob
}

/**
 * The batch form (story 03j auto-adopt): fetch + decode the whole-clip audio
 * ONCE and slice every span from the same PCM — N segments cost one decode, not
 * N. Returns the WAVs in span order.
 */
export async function sliceManyAudioWav(
  url: string,
  spans: { start: number; end: number }[],
  targetRate = 16000,
): Promise<Blob[]> {
  if (!spans.length) return []
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`Couldn't load audio (${res.status})`)
  const blob = await res.blob()
  const file = new File([blob], 'audio.wav', { type: blob.type || 'audio/wav' })
  const samples = await decodeToMono(file, targetRate)
  return spans.map(({ start, end }) => {
    const lo = Math.max(0, Math.floor(Math.min(start, end) * targetRate))
    const hi = Math.min(samples.length, Math.ceil(Math.max(start, end) * targetRate))
    return encodeWav(samples.subarray(lo, Math.max(lo, hi)), targetRate)
  })
}
```

- [ ] **Step 2: Verify build + full test suite still green**

Run: `npm run build && npm run test:run`
Expected: PASS (no behavior change for existing callers)

- [ ] **Step 3: Commit**

```bash
git add src/lib/audio.ts
git commit -m "feat(studio): batch original-audio slicing — one decode, many spans (03j)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: MSW mocks return the new shapes (mock-first)

**Files:**
- Modify: `src/mocks/handlers.ts:110-130` (handlers), `:216-243` (mockRefiner), `:280-312` (mockDirector)

Mock and real must share the shape. The subtle part: the mock's `original` segment text must be **verbatim** transcript words with line-boundary anchors, or Task 3's guard will (correctly) downgrade it and auto-adopt never exercises under `MOCK_STUDIO`. The posted `transcript` is `timedTranscript` output — `[m:ss] words` lines on 8-second buckets — so splitting at a line boundary guarantees the words on each side are exactly the words whose `start` falls in that span.

- [ ] **Step 1: Pass the transcript into `mockRefiner`**

In the `/api/refine-scene` handler (line 121), extend the body cast and keep the rest:

```ts
  http.post('/api/refine-scene', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      start?: number
      end?: number
      transcript?: string
      draftText?: string
      cuts?: { start: number; end: number }[]
    }
    const jobId = enqueueJob('refine', mockRefiner(body))
    return HttpResponse.json({ jobId, status: 'pending' })
  }),
```

- [ ] **Step 2: Rewrite `mockRefiner`**

Replace the whole `mockRefiner` function (lines 209–243) with:

```ts
/**
 * A deterministic canned refiner response for one scene, now with voicing
 * sources (story 03j): the first half of the scene's spoken lines keep the
 * creator's own audio (`source: 'original'` — text VERBATIM from the posted
 * timed transcript, span snapped to the 8s line boundaries, so it survives
 * `toRefinement`'s word-sequence guard and auto-adopts), and the second half is
 * re-voiced from the draft (`source: 'revoice'`). The gap between them is the
 * refined cut. Falls back to the old draft-split when the transcript is too
 * short to halve.
 */
function mockRefiner(body: {
  start?: number
  end?: number
  transcript?: string
  draftText?: string
  cuts?: { start: number; end: number }[]
}) {
  const start = Number.isFinite(body.start) ? (body.start as number) : 0
  const end =
    Number.isFinite(body.end) && (body.end as number) > start ? (body.end as number) : start + 1

  // Parse the `[m:ss] words` lines back into (lineStart, words) pairs.
  const lines = (body.transcript ?? '')
    .split('\n')
    .map((l) => /^\[(\d+):(\d{2})\]\s*(.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ start: Number(m[1]) * 60 + Number(m[2]), text: m[3] }))

  if (lines.length >= 2) {
    const mid = Math.ceil(lines.length / 2)
    const splitAt = lines[mid].start // a line boundary — the halves' words split cleanly
    const pauseEnd = Math.min(splitAt + 2, end)
    const segments = [
      {
        text: lines.slice(0, mid).map((l) => l.text).join(' '),
        start,
        end: splitAt,
        source: 'original',
      },
      {
        text: (body.draftText ?? '').trim() || lines.slice(mid).map((l) => l.text).join(' '),
        start: pauseEnd,
        end,
        source: 'revoice',
      },
    ]
    return { segments, cuts: [{ start: splitAt, end: pauseEnd }] }
  }

  // Transcript too short to halve — the old draft-split, now tagged revoice.
  const span = end - start
  const first = body.cuts?.[0]
  const pauseStart = first ? first.start : start + span * 0.45
  const pauseEnd = first ? first.end : start + span * 0.62
  const words = (body.draftText ?? '').trim().split(/\s+/).filter(Boolean)
  const mid = Math.ceil(words.length / 2)
  const segments = [
    { text: words.slice(0, mid).join(' '), start, end: pauseStart, source: 'revoice' },
    { text: words.slice(mid).join(' '), start: pauseEnd, end, source: 'revoice' },
  ].filter((s) => s.text)
  const cuts = [{ start: pauseStart + 0.3, end: Math.max(pauseStart + 0.4, pauseEnd - 0.3) }]
  return { segments, cuts }
}
```

- [ ] **Step 3: Add `voicing` to `mockDirector`**

In `mockDirector` (line 280), add the heuristic and the per-scene field. After the `const count = ...` line, add:

```ts
  // "keep my voice / cut the ums" direction → an all-original plan (story 03j).
  const keepOriginal = /\b(um+s?|ah+s?|filler|keep my (own )?voice|original audio)\b/i.test(direction)
  const VOICINGS = ['revoice', 'original', 'mixed'] as const
```

and in the scene object inside `Array.from(...)`, add after `end,`:

```ts
      voicing: keepOriginal ? 'original' : VOICINGS[i % VOICINGS.length],
```

- [ ] **Step 4: Verify build/lint/tests**

Run: `npm run build && npm run lint && npm run test:run`
Expected: build + tests PASS; lint shows only the 2 pre-existing `ChatPopup`/`ChatPanel.tsx` errors.

- [ ] **Step 5: Commit**

```bash
git add src/mocks/handlers.ts
git commit -m "feat(studio): mock director/refiner return voicing plans + guard-passing source tags (03j)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Hook — auto-adopt on refine completion + the one-click adopt action

**Files:**
- Modify: `src/components/Studio/useScenePipeline.ts`

Three changes: a shared slice→upload→measure helper (sequential uploads — parallel registers reset the dev proxy's keep-alive sockets, same lesson as the contact-sheet loop at line 454), auto-adopt inside `completeRefineJob` **before its single `patchScene` commit** (no second patch racing user hand-edits), and `adoptSegmentOriginal` for the chip. No hook test file exists (repo pattern: pure logic lives tested in `src/lib/*`; Tasks 3–4 covered it).

- [ ] **Step 1: Update imports**

Line 5–15: add `suggestedOriginalIndices` and `applyOriginalClips` to the `../../lib/refiner` import list.
Line 16: change the audio import to:

```ts
import { extractAudio, extractAudioWav, sliceAudioWav, sliceManyAudioWav } from '../../lib/audio'
```

- [ ] **Step 2: Add `sliceAndUploadSpans`**

Insert after `pollJob` (line 278), before `completeDirectorJob`:

```ts
  /**
   * Voice a list of spans with the clip's OWN audio (story 03j): decode the
   * whole-clip WAV once, slice every span from the same PCM, then upload the
   * slices SEQUENTIALLY (parallel registers reset the dev proxy's keep-alive
   * sockets — same lesson as the contact-sheet uploads). One entry per span:
   * the uploaded clip + its measured length, or null if that span failed (the
   * caller leaves that segment unvoiced).
   */
  const sliceAndUploadSpans = useCallback(
    async (
      spans: { start: number; end: number }[],
    ): Promise<({ url: string; seconds: number } | null)[]> => {
      if (!audioUrl) throw new Error('No extracted audio to slice from.')
      const blobs = await sliceManyAudioWav(audioUrl, spans)
      const out: ({ url: string; seconds: number } | null)[] = []
      for (let i = 0; i < blobs.length; i++) {
        try {
          const { start, end } = spans[i]
          const file = new File(
            [blobs[i]],
            `original-${Math.round(start)}-${Math.round(end)}.wav`,
            { type: 'audio/wav' },
          )
          const { url } = await uploadReq({ file, kind: 'voice' }).unwrap()
          const measured = await measureAudioDuration(url)
          out.push({ url, seconds: measured > 0 ? measured : end - start })
        } catch {
          out.push(null)
        }
      }
      return out
    },
    [audioUrl, uploadReq],
  )
```

- [ ] **Step 3: Rewrite `completeRefineJob`**

Replace the whole `completeRefineJob` callback (lines 339–362) with:

```ts
  /**
   * Drive a per-scene refiner job to completion and write it into `scene.refined`
   * (non-destructive). Shared by the live `refineScene` and resume-on-reload;
   * `pollsInFlight` keeps the two from double-polling one job. Clears the scene's
   * `refineJobId` on any terminal status.
   *
   * Auto-adopt (story 03j): segments the refiner tagged `original` (and the
   * verbatim guard upheld) are voiced from the clip's own audio BEFORE the
   * refinement is committed — one decode, sequential uploads, per-segment
   * failures non-fatal (each keeps its one-click "Use original" chip).
   * Committing ONCE, after the audio work, means no second patch racing the
   * producer's hand-edits.
   */
  const completeRefineJob = useCallback(
    async (sceneId: string, jobId: string) => {
      if (pollsInFlight.has(jobId)) return
      pollsInFlight.add(jobId)
      setRefiningId(sceneId)
      setSceneError(null)
      try {
        const { result } = await pollJob(jobId)
        const scene = scenes.find((s) => s.id === sceneId)
        if (!scene) {
          patchScene(sceneId, { refineJobId: null })
          return
        }
        const refinement = toRefinement(result as RefineSceneRaw, scene, words)

        const idx = suggestedOriginalIndices(refinement.segments)
        let segments = refinement.segments
        let failed = 0
        if (idx.length) {
          let clips: ({ url: string; seconds: number } | null)[] = idx.map(() => null)
          try {
            clips = await sliceAndUploadSpans(
              idx.map((i) => ({ start: segments[i].start, end: segments[i].end })),
            )
          } catch {
            // No extracted audio / decode failed — every tagged segment keeps its chip.
          }
          ;({ segments, failed } = applyOriginalClips(segments, idx, clips))
        }
        const total = segments.reduce((n, s) => n + (s.audioSeconds ?? 0), 0)
        patchScene(sceneId, {
          refined: { ...refinement, segments },
          refineJobId: null,
          ...(total > 0 ? { narrationSeconds: total } : {}),
        })
        if (failed > 0) {
          setSceneError(
            `Couldn't reuse the original audio for ${failed} segment${failed === 1 ? '' : 's'} — use the run's "Use original" button to retry.`,
          )
        }
      } catch (e) {
        setSceneError(stageError(e))
        patchScene(sceneId, { refineJobId: null })
      } finally {
        pollsInFlight.delete(jobId)
        setRefiningId(null)
      }
    },
    [pollJob, scenes, words, patchScene, sliceAndUploadSpans],
  )
```

- [ ] **Step 4: Add `adoptSegmentOriginal`**

Insert after `recordSegmentNarration` (line 957):

```ts
  // One-click "Use original" (story 03j): voice THIS run with the slice of the
  // clip's own audio under its span — the manual completion of an AI 'original'
  // suggestion auto-adopt couldn't finish (or whose audio was later cleared).
  // Same per-segment busy key as the other voicing actions.
  const adoptSegmentOriginal = useCallback(
    async (sceneId: string, segIndex: number) => {
      if (voicingSegKey) return
      const scene = scenes.find((s) => s.id === sceneId)
      const seg = scene && effectiveSegments(scene)[segIndex]
      if (!seg) return
      setVoicingSegKey(`${sceneId}:${segIndex}`)
      setSceneError(null)
      try {
        const [clip] = await sliceAndUploadSpans([{ start: seg.start, end: seg.end }])
        if (!clip) throw new Error("Couldn't slice the original audio for this run.")
        setSegmentAudio(sceneId, segIndex, {
          audioUrl: clip.url,
          audioSeconds: clip.seconds,
          audioSource: 'original',
        })
      } catch (e) {
        setSceneError(stageError(e))
      } finally {
        setVoicingSegKey(null)
      }
    },
    [voicingSegKey, scenes, sliceAndUploadSpans, setSegmentAudio],
  )
```

- [ ] **Step 5: Export it**

In the hook's return object, add `adoptSegmentOriginal,` directly after `adoptOriginalAudio,` (line 1097).

- [ ] **Step 6: Verify**

Run: `npm run build && npm run test:run`
Expected: PASS. (`sliceAudioWav` stays imported for `adoptOriginalAudio` — untouched.)

- [ ] **Step 7: Commit**

```bash
git add src/components/Studio/useScenePipeline.ts
git commit -m "feat(studio): auto-adopt AI-suggested original audio after refine (03j)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: UI — the "Use original" chip, threaded through the diff viewer

**Files:**
- Modify: `src/components/Studio/SegmentVoiceControl.tsx`
- Create: `src/components/Studio/SegmentVoiceControl.test.tsx`
- Modify: `src/components/Studio/TranscriptDiff.tsx:34-38` (Props), `:141-149` (Controls), `:164-181` (destructure), `:580-589` (controls object), `:1316-1328` (call site)
- Modify: `src/pages/Studio.tsx:224-240` (segmentControls), `:586-608` (TranscriptDiff props)

The revoice path changes **nothing**: Record / ✨AI render exactly as today, no preselection.

- [ ] **Step 1: Write the failing component test**

Create `src/components/Studio/SegmentVoiceControl.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SegmentVoiceControl, type SegmentControl } from './SegmentVoiceControl'

// Mic + clip-player hooks are browser-bound; the chip logic doesn't need them.
vi.mock('./useRecorder', () => ({
  useRecorder: () => ({
    status: 'idle',
    blob: null,
    elapsed: 0,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  }),
}))
vi.mock('./clipPlayer', () => ({ useClipPlaying: () => false }))

function seg(partial: Partial<SegmentControl> = {}): SegmentControl {
  return {
    sceneId: 'scene-1',
    index: 0,
    start: 0,
    end: 10,
    text: 'a run of narration',
    busy: false,
    ...partial,
  }
}

const noop = () => {}

describe('SegmentVoiceControl — Use original (story 03j)', () => {
  it('offers Use original on an unvoiced AI-suggested-original run', () => {
    const onUseOriginal = vi.fn()
    render(
      <SegmentVoiceControl
        segment={seg({ suggestedSource: 'original' })}
        canAI
        onGenerateAI={noop}
        onRecord={noop}
        onPlay={noop}
        onDelete={noop}
        onUseOriginal={onUseOriginal}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /use original/i }))
    expect(onUseOriginal).toHaveBeenCalledTimes(1)
  })

  it('hides it once the run is voiced', () => {
    render(
      <SegmentVoiceControl
        segment={seg({
          suggestedSource: 'original',
          audioUrl: '/x.wav',
          audioSeconds: 5,
          audioSource: 'original',
        })}
        canAI
        onGenerateAI={noop}
        onRecord={noop}
        onPlay={noop}
        onDelete={noop}
        onUseOriginal={noop}
      />,
    )
    expect(screen.queryByRole('button', { name: /use original/i })).toBeNull()
  })

  it('hides it for revoice / untagged runs', () => {
    render(
      <SegmentVoiceControl
        segment={seg({ suggestedSource: 'revoice' })}
        canAI
        onGenerateAI={noop}
        onRecord={noop}
        onPlay={noop}
        onDelete={noop}
        onUseOriginal={noop}
      />,
    )
    expect(screen.queryByRole('button', { name: /use original/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/Studio/SegmentVoiceControl.test.tsx`
Expected: FAIL — `suggestedSource`/`onUseOriginal` don't exist; no such button.

- [ ] **Step 3: Implement `SegmentVoiceControl`**

In `SegmentVoiceControl.tsx`:

Add to the `SegmentControl` type (after `audioSource`, line 18):

```ts
  /** The refiner's voicing suggestion for this run (story 03j). */
  suggestedSource?: 'original' | 'revoice'
```

Add to `Props` (after `onRecord`):

```ts
  /** Voice this run with the clip's own audio (story 03j) — rendered only while
   *  the run is unvoiced and the AI suggested 'original'. Omit to hide. */
  onUseOriginal?: () => void
```

Add `onUseOriginal` to the function's destructured props, and in the final (idle) branch of the JSX, insert **before** the `● Record` button:

```tsx
          {!audioUrl && segment.suggestedSource === 'original' && onUseOriginal && (
            <button
              type="button"
              className={btn}
              onClick={onUseOriginal}
              title="The AI suggests keeping your own audio here — slice it straight from the clip"
            >
              ◉ Use original
            </button>
          )}
```

- [ ] **Step 4: Run the component test**

Run: `npx vitest run src/components/Studio/SegmentVoiceControl.test.tsx`
Expected: PASS

- [ ] **Step 5: Thread it through `TranscriptDiff`**

In `TranscriptDiff.tsx`:

1. `Props` (after `onRecord`, line 38): add

```ts
  onUseOriginal?: (sceneId: string, index: number) => void
```

2. `Controls` type (after `onRecord`, line 144): add

```ts
  /** Voice a run from the clip's own audio (story 03j). */
  onUseOriginal?: (sceneId: string, index: number) => void
```

3. Function destructure (after `onRecord,`, line 167): add `onUseOriginal,`

4. `controls` object (line 580–589): add `onUseOriginal,` after `onRecord,`:

```ts
  const controls: Controls | null = onGenerateAI && onRecord
    ? {
        canAI: canGenerateAI,
        onGenerateAI,
        onRecord,
        onUseOriginal,
        onPlay: toggleClip,
        onDelete: onDeleteSegment ?? (() => {}),
        onMoveStart: onMoveRun ? onMoveStart : undefined,
      }
    : null
```

5. The `<SegmentVoiceControl>` call site (line 1318): add after `onRecord={...}`:

```tsx
                      onUseOriginal={
                        controls.onUseOriginal
                          ? () => controls.onUseOriginal?.(seg.sceneId, seg.index)
                          : undefined
                      }
```

- [ ] **Step 6: Wire `Studio.tsx`**

1. `segmentControls` (line 224–240): add `suggestedSource: seg.suggestedSource,` after the `audioSource` line:

```ts
            audioSource: seg.audioSource,
            suggestedSource: seg.suggestedSource,
```

2. The `<TranscriptDiff>` block (line 587): add after `onRecord={pipe.recordSegmentNarration}`:

```tsx
                    onUseOriginal={pipe.adoptSegmentOriginal}
```

- [ ] **Step 7: Full verification**

Run: `npm run build && npm run test:run`
Expected: PASS (including the pre-existing `TranscriptDiff.test.tsx`)

- [ ] **Step 8: Commit**

```bash
git add src/components/Studio/SegmentVoiceControl.tsx src/components/Studio/SegmentVoiceControl.test.tsx src/components/Studio/TranscriptDiff.tsx src/pages/Studio.tsx
git commit -m "feat(studio): one-click Use-original chip on AI-suggested runs (03j)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: SceneMeta — the Voicing line

**Files:**
- Modify: `src/components/Studio/SceneMeta.tsx`

`voicingSummary` is already unit-tested (Task 4); this is presentation only, matching the existing `Stat` pattern. (SceneMeta has no test file today — keep it that way.)

- [ ] **Step 1: Implement**

1. Extend the import from `../../lib/refiner` (line 11):

```ts
import { effectiveCuts, effectiveSegments, normalizeCuts, voicingSummary } from '../../lib/refiner'
```

2. In the component body (next to the other derivations, after `silentRuns`, line 36):

```ts
  // The director's voicing plan pre-refine; the real segment mix after (03j).
  const voicing = voicingSummary(scene)
```

3. In the `<dl>`, after the "Narration clips" `Stat` (line 117), add:

```tsx
        {voicing && (
          <Stat label="Voicing">
            <span className="font-mono">{voicing}</span>
          </Stat>
        )}
```

- [ ] **Step 2: Verify**

Run: `npm run build && npm run test:run && npm run lint`
Expected: build + tests PASS; lint shows only the 2 pre-existing ChatPanel errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Studio/SceneMeta.tsx
git commit -m "feat(studio): show the scene's voicing plan / segment mix in SceneMeta (03j)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: BFFless director rule `138f27fb` — prompt + voicing passthrough

**Files:** server-side only (BFFless pipeline rule), via the `mcp__bffless-j5s__*` MCP tools.

**First invoke the `bffless-pipeline` skill** — it has the gotchas for editing pipeline rules. Do NOT add `auth_required`/`rate_limit` validators (story 07). The director runs in the rule's `postSteps` (async jobs flow, 03f Part 0) — the prompt lives in its `prep`-style step; the response clamp lives in its `parse`-style step.

- [ ] **Step 1: Fetch the rule**

Use `ToolSearch` (`select:mcp__bffless-j5s__get_proxy_rule,mcp__bffless-j5s__update_proxy_rule`) then `get_proxy_rule` with rule id `138f27fb` (full id starts with `138f27fb` — list rules in the `studio` rule set if the short id doesn't resolve). Locate, inside the step that builds the Gemini prompt/system-instruction, the strict-JSON output spec (it reads: `Output STRICT JSON only ... {"synopsis": string, "scenes": [{"title": string, "start": number, "end": number, "transcript": string, "draftText": string, "cuts": [{"start": number, "end": number}]}]}`).

- [ ] **Step 2: Update the output shape**

In that spec, extend the scene object so it reads:

```
{"synopsis": string, "scenes": [{"title": string, "start": number, "end": number, "transcript": string, "draftText": string, "voicing": "original"|"revoice"|"mixed", "cuts": [{"start": number, "end": number}]}]}
```

- [ ] **Step 3: Add the voicing instructions**

Immediately after the existing sentence that explains `draftText` ("...draftText is the new tightened narration to be re-voiced."), insert exactly:

```
For each scene also return voicing — your plan for whose voice ships that scene: "original" when the scene should keep the creator's own recorded audio and you are only trimming it, "revoice" when the tightened draftText should be re-voiced, "mixed" when parts keep the original audio and parts are re-voiced. When voicing is "original", draftText MUST be exactly the words from the transcript that survive your edit — verbatim, in order, no rewriting or paraphrasing — and everything to remove (filler words, ums, false starts, tangents) MUST be expressed as cuts instead. If the user's direction asks to keep their own voice or only remove filler ("just cut the ums"), prefer voicing "original" with many small precise cuts over rewriting.
```

- [ ] **Step 4: Pass `voicing` through the parse/clamp step**

Inspect the rule's parse step (the one that JSON-parses Gemini's output and clamps scene spans/cuts). If it rebuilds each scene object field-by-field, add `voicing` to the carried fields, passing it through only when it is exactly `"original"`, `"revoice"`, or `"mixed"` (else omit). If it passes unknown fields through untouched, no change. Apply with `update_proxy_rule`.

- [ ] **Step 5: Verify**

Re-fetch with `get_proxy_rule` and confirm both edits landed. If the project's Replicate token is configured, optionally run one live director call from the dev app (`MOCK_STUDIO` stays `false`) and check the job result includes `voicing` via `get_pipeline_log`; if the token isn't set, note that live verification is deferred — the FE handles an absent field gracefully either way.

---

### Task 11: BFFless refiner rule `afacb572` — prompt + segment-source passthrough

**Files:** server-side only, same tools and cautions as Task 10.

- [ ] **Step 1: Fetch the rule**

`get_proxy_rule` with rule id `afacb572` (full: `afacb572-dc8a-4e9c-bfb6-8369fb36ddc2`). Locate the prompt's output spec — segments currently shaped `{"segments": [{"text": string, "start": number, "end": number}], "cuts": [{"start": number, "end": number}]}`.

- [ ] **Step 2: Update the output shape**

Extend the segment object so the spec reads:

```
{"segments": [{"text": string, "start": number, "end": number, "source": "original"|"revoice"}], "cuts": [{"start": number, "end": number}]}
```

- [ ] **Step 3: Add the source instructions**

After the existing sentence describing the segments, insert exactly:

```
For each segment also return source: "original" when that segment should be voiced by the recording's own audio for its span, "revoice" when its text is new narration to be re-voiced. A segment may only be tagged "original" if its text is ALL of the words spoken inside its start–end span, verbatim and in order — that span's original audio will be played as-is. To drop words (an um, a false start, a stumble), do NOT omit them from a segment's text: end the segment before them and start the next segment after them, so the gap between segments carries the removal, and add a matching cut. If the user's direction asks to keep their own voice, prefer "original" segments wherever the words survive unchanged.
```

- [ ] **Step 4: Pass `source` through the parse/clamp step**

The rule's parse step clamps segments/cuts into the scene span (mirroring `toRefinement`). If it rebuilds segment objects, carry `source` through when it is exactly `"original"` or `"revoice"` (else omit). Apply with `update_proxy_rule`.

- [ ] **Step 5: Verify**

Re-fetch and confirm. Optional live check as in Task 10 Step 5 (requires the Replicate token; the client-side verbatim guard protects against any prompt slippage regardless).

---

### Task 12: Gates + story bookkeeping

**Files:**
- Modify: `stories/inprogress/studio/03j-ai-voicing-source.md` (status header + acceptance boxes)
- Modify: `stories/inprogress/studio/README.md` (ascii block + table row)

- [ ] **Step 1: Full gates**

Run: `npm run build && npm run lint && npm run test:run`
Expected: build PASS; tests all PASS; lint shows ONLY the 2 pre-existing ChatPanel errors.

- [ ] **Step 2: Tick the story's acceptance criteria**

In `03j-ai-voicing-source.md`, flip the Status line to:

```
**Status:** ✅ shipped (FE + prompts) · prompts updated on rules `138f27fb` / `afacb572`. (Note here if live-model verification was deferred pending the Replicate token.)
```

and check each `- [ ]` box that is genuinely done (all seven if Tasks 1–11 completed and gates pass; leave the live-pipeline parts of the last two boxes annotated if live verification was deferred).

- [ ] **Step 3: Update the README**

In `stories/inprogress/studio/README.md`: change the 03j ascii-block line's `⏳`/`spec ✅` to `✅`, and the table row's status from `⏳ queued (spec approved)` to `✅ done` (append `*` + a note if live-prompt verification is still pending the token).

- [ ] **Step 4: Commit**

```bash
git add stories/inprogress/studio/03j-ai-voicing-source.md stories/inprogress/studio/README.md
git commit -m "docs(studio): mark story 03j shipped

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Finish the branch**

All tasks committed on `feat/studio-03j-ai-voicing-source`. Use the superpowers:finishing-a-development-branch skill (one story = one PR, per repo convention).

---

## Acceptance criteria → task map (self-check)

| Spec criterion | Covered by |
|---|---|
| Director returns + persists `scene.voicing`; badge renders; `toScenes` coercion tested | Tasks 1, 2, 9, 10 |
| Refiner segments carry `source` → `suggestedSource`; verbatim guard tested | Tasks 1, 3, 11 |
| Auto-voice on refine completion (decode-once, sequential uploads); failures leave a working chip | Tasks 4, 5, 7, 8 |
| Ums-and-ahs flow end-to-end under `MOCK_STUDIO` | Task 6 (+ 7, 8) — flip `MOCK_STUDIO = true` locally to exercise; flip back before committing |
| Non-destructive invariants (baseline untouched, `clearRefinement` reverts, VOICE bar unchanged) | Tasks 7, 8 (no writes outside `refined` + optional metadata; revoice UI untouched) |
| Mock and real share both shapes; prompts updated on both rules | Tasks 6, 10, 11 |
| build / lint / test:run pass | Every task + Task 12 |
