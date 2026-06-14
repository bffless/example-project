# Studio Diarization + Per-Person Voices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on speaker diarization in transcription, let the producer name a project "cast" of people (each with one voice), reorder prep so voice precedes the director, feed speaker-labelled transcript to the director, and make narration voice a per-segment choice at Build that defaults from the speaker.

**Architecture:** Diarization rides on the existing WhisperX call (`align_output:true + diarization:true`), tagging every word with a `speaker`. A project-level **cast** (`Person[]`) plus per-`(videoId, speakerLabel)` **assignments** map speakers → people → one voice each. Pure resolution helpers live in `src/lib/speakers.ts`; durable state lives in the Redux `studio` slice; UI extends the existing `VoiceStudio` and `SegmentVoiceControl`. The common case (one narrator across N clips) stays a single decision via auto-assignment.

**Tech Stack:** React 19 + TypeScript, Redux Toolkit + redux-persist, RTK Query, Vitest, MSW, BFFless pipeline rules (via the `bffless-j5s` MCP).

**Branch:** `studio/diarization-cast-voices` (already created; spec at `docs/superpowers/specs/2026-06-14-studio-diarization-voices-design.md`). Frequent commits per task; the umbrella PR collects all four stories.

**Verified live (2026-06-14):** `align_output:true + diarization:true` returns word-level `speaker` at `output.segments[].words[].speaker`, with a segment-level `speaker` backstop. No time-overlap fallback needed.

---

## Story 10a — Diarization + `speaker` on every word

**File structure:**
- Modify: `src/store/studioSlice.ts:21` (`TranscriptWord`)
- Modify: `src/lib/transcriptGrid.ts:13` (`TWord`)
- Modify: `src/store/studioApi.ts:22` (`TranscribeResponse` — type only; `words` already flows through)
- Modify: `src/mocks/transcribeFixture.ts` (add `speaker` to fixture words)
- Modify: BFFless WhisperX rule `972a6dc5` (rule set `cf413ff6`) — pipeline config, via MCP
- Test: `src/lib/transcriptGrid.test.ts` (speaker preserved through the grid)

### Task 10a.1: Add `speaker` to the word types

- [ ] **Step 1: Write the failing test** — append to `src/lib/transcriptGrid.test.ts`:

```ts
import { buildTranscriptGrid, type TWord } from './transcriptGrid'

test('buildTranscriptGrid preserves a word speaker tag', () => {
  const words: TWord[] = [{ text: 'hi', start: 0.1, end: 0.4, speaker: 'SPEAKER_00' }]
  const grid = buildTranscriptGrid(words, 2, 0.1)
  const cell = grid[0].cells.find((c) => c.length > 0)
  expect(cell?.[0].speaker).toBe('SPEAKER_00')
})
```

- [ ] **Step 2: Run it, expect a TYPE error (fails to compile)**

Run: `npx vitest run src/lib/transcriptGrid.test.ts`
Expected: FAIL — `Object literal may only specify known properties, 'speaker' does not exist in type 'TWord'`.

- [ ] **Step 3: Add the optional field to both types**

In `src/lib/transcriptGrid.ts:13`:
```ts
export type TWord = { text: string; start: number; end: number; speaker?: string }
```
In `src/store/studioSlice.ts:21`:
```ts
/** A word with its time markers, as transcription returns them. `speaker` is the
 *  diarization label (story 10a), e.g. `SPEAKER_00`; absent on old transcripts. */
export type TranscriptWord = { text: string; start: number; end: number; speaker?: string }
```

- [ ] **Step 4: Run it, expect PASS**

Run: `npx vitest run src/lib/transcriptGrid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/transcriptGrid.ts src/lib/transcriptGrid.test.ts src/store/studioSlice.ts
git commit -m "feat(studio): carry a per-word speaker label through the transcript types (10a)"
```

### Task 10a.2: Carry `speaker` through the API response type + dev fixture

`TranscribeResponse.words` is already `TranscriptWord[]`, so once 10a.1 lands the speaker flows through `setWords(got)` and `patchSource({ words: got })` untouched. Only the dev mock needs speakers so `MOCK_STUDIO` exercises the path.

- [ ] **Step 1: Add a speaker to the mock fixture words.** Open `src/mocks/transcribeFixture.ts`. The fixture is a single-narrator clip, so tag every word `SPEAKER_00`. Add the field to each word object. If the file is long, do it with a one-time map at export instead of editing 82 lines — change the export to:

```ts
// at the bottom of transcribeFixture.ts, where TRANSCRIBE_FIXTURE is assembled:
const RAW_WORDS: { text: string; start: number; end: number }[] = [ /* …existing list… */ ]
export const TRANSCRIBE_FIXTURE = {
  words: RAW_WORDS.map((w) => ({ ...w, speaker: 'SPEAKER_00' })),
  text: /* …existing joined text… */,
}
```
(If the fixture is already shaped as one object literal, instead add `speaker: 'SPEAKER_00'` inline to each word — whichever is the smaller diff. To preview multi-speaker UI in dev, tag the back third of the words `'SPEAKER_01'` — optional.)

- [ ] **Step 2: Verify the mock still type-checks and tests pass**

Run: `npm run test:run`
Expected: PASS (no test asserts the fixture shape; this is a type-safe data edit).

- [ ] **Step 3: Commit**

```bash
git add src/mocks/transcribeFixture.ts
git commit -m "feat(studio): tag mock transcript words with a speaker for dev (10a)"
```

### Task 10a.3: Turn diarization on in the WhisperX pipeline rule (infra, MCP)

This edits the live BFFless pipeline, not code — no unit test. The HF token is already a project secret (`secrets.HF_TOKEN`).

- [ ] **Step 1: Read the current rule + its whisper step config.** Use the MCP:
  - `mcp__bffless-j5s__get_proxy_rule` for rule `972a6dc5` (confirm the rule set `cf413ff6`).
  - `mcp__bffless-j5s__get_pipeline_schema` / `get_pipeline_log_step` as needed to find the WhisperX predict step and its **input mappings** (the screenshot shows: `debug`, `audio_file=steps.sign.url`, `batch_size=64`, `diarization`, `temperature`, `align_output`).

- [ ] **Step 2: Update the WhisperX step input mappings** via `mcp__bffless-j5s__update_pipeline_step`:
  - `diarization` → `true` (was `false`).
  - Add `huggingface_access_token` → `secrets.HF_TOKEN`.
  - Leave `align_output` → `true` and `audio_file` → `steps.sign.url` unchanged.

- [ ] **Step 3: Update the flatten step to carry `speaker`.** The flatten step maps the model output into our `[{ text, start, end }]`. The live output nests words under `segments[].words[]`, each word `{ word, start, end, score, speaker }`, and each segment has a top-level `speaker`. Adjust the flatten mapping so each emitted word is:

```js
// per word w inside each segment seg:
{ text: w.word, start: w.start, end: w.end, speaker: w.speaker ?? seg.speaker ?? null }
```
Keep the existing segments→words flattening; only add the `speaker` field. Use `update_pipeline_step` on the flatten step.

- [ ] **Step 4: Smoke-test live.** Enable debug (`mcp__bffless-j5s__enable_pipeline_debug`) and run one transcription end-to-end from the app (a short clip), or re-run the captured prediction. Confirm the app receives `words[].speaker`. Check `get_pipeline_log` for the run.

- [ ] **Step 5: Note the change in the story file.** Append a line to `stories/inprogress/studio/README.md` status table referencing story 10a (diarization on; rule `972a6dc5`; HF token from `secrets.HF_TOKEN`). Commit:

```bash
git add stories/inprogress/studio/README.md
git commit -m "feat(studio): enable WhisperX diarization + carry word speaker in flatten (10a)"
```

---

## Story 10b — Cast, reordered voice step, per-video assignment

**File structure:**
- Modify: `src/lib/pipeline.ts:79-134` (move `clone` before `director`; reword notes/labels)
- Create: `src/lib/speakers.ts` + `src/lib/speakers.test.ts` (pure cast/speaker resolution)
- Modify: `src/store/studioSlice.ts` (add `Person`, `cast`, `speakerAssignments` + actions)
- Modify: `src/store/studioSlice.test.ts` (reducer tests) — create if absent
- Create: `src/components/Studio/CastStudio.tsx` (cast list + people-count + per-video grid; wraps `VoiceStudio` per person)
- Modify: `src/pages/Studio.tsx` (render `CastStudio` in the `clone` board slot; pass cast state/handlers)
- Modify: `src/components/Studio/useScenePipeline.ts` (cast handlers; seed default person)

### Task 10b.1: Reorder the prep plan (voice → director)

- [ ] **Step 1: Write the failing test.** Create `src/lib/pipeline.test.ts` (or append if it exists):

```ts
import { STAGE_DEFS, GLOBAL_STAGES } from './pipeline'

test('voice (clone) comes before the director in the global plan', () => {
  expect(GLOBAL_STAGES).toEqual(['thumbnails', 'clone', 'director'])
  const ids = STAGE_DEFS.map((s) => s.id)
  expect(ids.indexOf('clone')).toBeLessThan(ids.indexOf('director'))
})
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `npx vitest run src/lib/pipeline.test.ts`
Expected: FAIL — current order is `['thumbnails', 'director', 'clone']`.

- [ ] **Step 3: Move the `clone` stage def above the `director` stage def** in `STAGE_DEFS` (`src/lib/pipeline.ts`). Cut the entire `{ id: 'clone', … }` object and paste it immediately before the `{ id: 'director', … }` object. `GLOBAL_STAGES` is derived by `.filter(scope==='global')` so its order follows the array automatically. Update the `director` note's lead-in if it implies voice comes later, and update the `StageId` union comment ordering for clarity (optional).

- [ ] **Step 4: Run it, expect PASS; then full suite**

Run: `npx vitest run src/lib/pipeline.test.ts && npm run test:run`
Expected: PASS. (`ready = sourcesReady && globalReady` and `globalReady = GLOBAL_STAGES.every(done)` are order-independent; `currentStageId` = first non-done global, so voice becomes the active step before director.)

- [ ] **Step 5: Update the plan-reveal copy.** In `src/store/studioSlice.ts` the `planRevealed` doc comment says "(thumbnails → director → voice)"; change to "(thumbnails → voice → director)". Grep the codebase for any user-facing "director → voice" / "→ voice" plan label and flip it:

Run: `grep -rn "director → voice\|thumbnails → director" src`
Fix each hit to read "voice → director" / "thumbnails → voice".

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline.ts src/lib/pipeline.test.ts src/store/studioSlice.ts
git commit -m "feat(studio): run the voice step before the director in prep (10b)"
```

### Task 10b.2: Cast + assignment state in the slice

- [ ] **Step 1: Write failing reducer tests.** Create `src/store/studioSlice.test.ts` (append if it exists):

```ts
import reducer, {
  setPeopleCount, renamePerson, setPersonVoice, assignSpeaker, removePerson,
} from './studioSlice'
import type { StudioState } from './studioSlice'

const init = () => reducer(undefined, { type: '@@init' }) as StudioState

test('setPeopleCount pads up and truncates down, min 1', () => {
  let s = init()
  s = reducer(s, setPeopleCount(3))
  expect(s.cast.map((p) => p.name)).toEqual(['Me', 'Person 2', 'Person 3'])
  s = reducer(s, setPeopleCount(1))
  expect(s.cast).toHaveLength(1)
  s = reducer(s, setPeopleCount(0))
  expect(s.cast).toHaveLength(1)
})

test('renamePerson and setPersonVoice update a person; cast[0] mirrors legacy voice', () => {
  let s = reducer(init(), setPeopleCount(1))
  const id = s.cast[0].id
  s = reducer(s, renamePerson({ id, name: 'James' }))
  expect(s.cast[0].name).toBe('James')
  const voice = { voiceId: 'v1', source: 'clone' as const, label: 'mine' }
  s = reducer(s, setPersonVoice({ id, voice }))
  expect(s.cast[0].voice).toEqual(voice)
  expect(s.voice).toEqual(voice) // legacy mirror so old readers keep working
})

test('assignSpeaker records a per-video mapping; removePerson strips its assignments', () => {
  let s = reducer(init(), setPeopleCount(2))
  const [a, b] = s.cast.map((p) => p.id)
  s = reducer(s, assignSpeaker({ videoId: 'src-1', label: 'SPEAKER_00', personId: a }))
  s = reducer(s, assignSpeaker({ videoId: 'src-1', label: 'SPEAKER_01', personId: b }))
  expect(s.speakerAssignments['src-1']['SPEAKER_01']).toBe(b)
  s = reducer(s, removePerson(b))
  expect(s.speakerAssignments['src-1']['SPEAKER_01']).toBeUndefined()
  expect(s.cast).toHaveLength(1)
})
```

- [ ] **Step 2: Run, expect FAIL** (`setPeopleCount` etc. are not exported).

Run: `npx vitest run src/store/studioSlice.test.ts`
Expected: FAIL — module has no exported member 'setPeopleCount'.

- [ ] **Step 3: Add the types, state, and reducers.** In `src/store/studioSlice.ts`:

Add the type near `VoiceChoice`:
```ts
/** A person in the project cast (story 10b): a name + the one voice their lines
 *  are narrated in. Detected speaker labels are assigned to a person per video. */
export type Person = { id: string; name: string; voice: VoiceChoice | null }
```

Add to `StudioState`:
```ts
  /** Project cast (story 10b). Default seeds one person ('Me'); the legacy
   *  top-level `voice` mirrors cast[0].voice for back-compat readers. */
  cast: Person[]
  /** Per-video speaker→person map: speakerAssignments[videoId][speakerLabel] = personId.
   *  Absent entry + single-person cast resolves to that person (see speakers.ts). */
  speakerAssignments: Record<string, Record<string, string>>
```

Add to `initialState`:
```ts
  cast: [],
  speakerAssignments: {},
```

Add a stable-id counter helper at module scope (avoid `Math.random`/`Date.now` — those are fine in app code but a simple counter keeps tests deterministic):
```ts
let personSeq = 0
const newPersonId = () => `person-${++personSeq}`
const defaultPersonName = (i: number) => (i === 0 ? 'Me' : `Person ${i + 1}`)
```

Add reducers inside `reducers: { … }`:
```ts
    /** Grow/shrink the cast to exactly `n` people (min 1). New people get a default
     *  name + no voice; removing trims from the end and drops their assignments. */
    setPeopleCount(state, action: PayloadAction<number>) {
      const n = Math.max(1, Math.floor(action.payload))
      while (state.cast.length < n)
        state.cast.push({ id: newPersonId(), name: defaultPersonName(state.cast.length), voice: null })
      if (state.cast.length > n) {
        const removed = state.cast.slice(n).map((p) => p.id)
        state.cast = state.cast.slice(0, n)
        for (const vid of Object.keys(state.speakerAssignments))
          for (const label of Object.keys(state.speakerAssignments[vid]))
            if (removed.includes(state.speakerAssignments[vid][label]))
              delete state.speakerAssignments[vid][label]
      }
      state.voice = state.cast[0]?.voice ?? null
    },
    renamePerson(state, action: PayloadAction<{ id: string; name: string }>) {
      const p = state.cast.find((x) => x.id === action.payload.id)
      if (p) p.name = action.payload.name
    },
    setPersonVoice(state, action: PayloadAction<{ id: string; voice: VoiceChoice | null }>) {
      const p = state.cast.find((x) => x.id === action.payload.id)
      if (!p) return
      p.voice = action.payload.voice
      if (state.cast[0]?.id === p.id) state.voice = p.voice // legacy mirror
    },
    removePerson(state, action: PayloadAction<string>) {
      state.cast = state.cast.filter((p) => p.id !== action.payload)
      if (state.cast.length === 0)
        state.cast = [{ id: newPersonId(), name: defaultPersonName(0), voice: null }]
      for (const vid of Object.keys(state.speakerAssignments))
        for (const label of Object.keys(state.speakerAssignments[vid]))
          if (state.speakerAssignments[vid][label] === action.payload)
            delete state.speakerAssignments[vid][label]
      state.voice = state.cast[0]?.voice ?? null
    },
    assignSpeaker(state, action: PayloadAction<{ videoId: string; label: string; personId: string }>) {
      const { videoId, label, personId } = action.payload
      ;(state.speakerAssignments[videoId] ??= {})[label] = personId
    },
```

Export the new actions in the `export const { … } = studioSlice.actions` block: `setPeopleCount, renamePerson, setPersonVoice, removePerson, assignSpeaker`.

In `resetStudio`, preserve nothing new (cast/assignments reset to `initialState` defaults; `savedVoices` already preserved). Confirm the return keeps `savedVoices` only.

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/store/studioSlice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/studioSlice.ts src/store/studioSlice.test.ts
git commit -m "feat(studio): project cast + per-video speaker assignments in the slice (10b)"
```

### Task 10b.3: Pure speaker/cast resolution helpers

- [ ] **Step 1: Write failing tests.** Create `src/lib/speakers.test.ts`:

```ts
import {
  uniqueSpeakers, resolvePerson, resolveSpeakerVoice, seedAssignmentsByLabel,
} from './speakers'
import type { Person } from '../store/studioSlice'
import type { TWord } from './transcriptGrid'

const words = (...labels: string[]): TWord[] =>
  labels.map((s, i) => ({ text: 'w', start: i, end: i + 0.5, speaker: s }))

test('uniqueSpeakers returns labels in first-seen order, ignoring undefined', () => {
  expect(uniqueSpeakers(words('SPEAKER_01', 'SPEAKER_00', 'SPEAKER_01'))).toEqual([
    'SPEAKER_01', 'SPEAKER_00',
  ])
})

test('resolvePerson: explicit assignment wins; single-person cast is the fallback', () => {
  const cast: Person[] = [{ id: 'p1', name: 'Me', voice: null }]
  expect(resolvePerson('v1', 'SPEAKER_00', cast, {})?.id).toBe('p1') // 1-person fallback
  const two: Person[] = [...cast, { id: 'p2', name: 'Guest', voice: null }]
  expect(resolvePerson('v1', 'SPEAKER_00', two, {})).toBeNull() // ambiguous, unassigned
  const asg = { v1: { SPEAKER_00: 'p2' } }
  expect(resolvePerson('v1', 'SPEAKER_00', two, asg)?.id).toBe('p2')
})

test('resolveSpeakerVoice returns the resolved person voice or null', () => {
  const voice = { voiceId: 'v', source: 'preset' as const, label: 'x' }
  const cast: Person[] = [{ id: 'p1', name: 'Me', voice }]
  expect(resolveSpeakerVoice('v1', 'SPEAKER_00', cast, {})).toEqual(voice)
})

test('seedAssignmentsByLabel maps the Nth label to the Nth person', () => {
  const cast: Person[] = [
    { id: 'p1', name: 'Me', voice: null },
    { id: 'p2', name: 'Guest', voice: null },
  ]
  const seeded = seedAssignmentsByLabel('v1', ['SPEAKER_00', 'SPEAKER_01'], cast, {})
  expect(seeded).toEqual({ SPEAKER_00: 'p1', SPEAKER_01: 'p2' })
})
```

- [ ] **Step 2: Run, expect FAIL** (module not found).

Run: `npx vitest run src/lib/speakers.test.ts`
Expected: FAIL — cannot find module './speakers'.

- [ ] **Step 3: Implement `src/lib/speakers.ts`:**

```ts
/**
 * Pure resolution between diarization speaker labels and the project cast
 * (story 10b). Labels are per-video (WhisperX diarizes each file on its own), so
 * everything here is keyed by `(videoId, speakerLabel)`. Shared by the cast UI,
 * the director transcript shaping (10c), and per-segment voicing (10d).
 */
import type { TWord } from './transcriptGrid'
import type { Person, VoiceChoice } from '../store/studioSlice'

export type SpeakerAssignments = Record<string, Record<string, string>>

/** Distinct speaker labels in `words`, in first-seen order; undefined dropped. */
export function uniqueSpeakers(words: TWord[]): string[] {
  const seen: string[] = []
  for (const w of words) {
    const s = w.speaker
    if (s && !seen.includes(s)) seen.push(s)
  }
  return seen
}

/**
 * The cast person a `(videoId, label)` resolves to: an explicit assignment wins;
 * otherwise a single-person cast is the implicit answer (the common "just me"
 * case needs no per-video work); otherwise null (ambiguous + unassigned).
 */
export function resolvePerson(
  videoId: string,
  label: string,
  cast: Person[],
  assignments: SpeakerAssignments,
): Person | null {
  const id = assignments[videoId]?.[label]
  if (id) return cast.find((p) => p.id === id) ?? null
  if (cast.length === 1) return cast[0]
  return null
}

/** Voice for a `(videoId, label)`, via `resolvePerson`. Null if unresolved/unvoiced. */
export function resolveSpeakerVoice(
  videoId: string,
  label: string,
  cast: Person[],
  assignments: SpeakerAssignments,
): VoiceChoice | null {
  return resolvePerson(videoId, label, cast, assignments)?.voice ?? null
}

/**
 * Pre-seed a video's assignments by ordinal: the Nth detected label → the Nth
 * cast person. Existing assignments for the video are preserved (only fills gaps).
 */
export function seedAssignmentsByLabel(
  videoId: string,
  labels: string[],
  cast: Person[],
  assignments: SpeakerAssignments,
): Record<string, string> {
  const out = { ...(assignments[videoId] ?? {}) }
  labels.forEach((label, i) => {
    if (!out[label] && cast[i]) out[label] = cast[i].id
  })
  return out
}

/**
 * The dominant speaker over a local time window `[start, end)` of a source's
 * words — the label whose words cover the most time in the window (story 10d).
 * Null if no word overlaps. Ties break to the first-seen label.
 */
export function dominantSpeaker(words: TWord[], start: number, end: number): string | null {
  const totals = new Map<string, number>()
  for (const w of words) {
    if (!w.speaker) continue
    const o = Math.min(end, w.end) - Math.max(start, w.start)
    if (o > 0) totals.set(w.speaker, (totals.get(w.speaker) ?? 0) + o)
  }
  let best: string | null = null
  let bestO = 0
  for (const [label, o] of totals) if (o > bestO) { bestO = o; best = label }
  return best
}
```

(Note: `dominantSpeaker` is needed by 10d; it's added here so `speakers.ts` is one module. Add a test for it now too:)

```ts
import { dominantSpeaker } from './speakers'
test('dominantSpeaker picks the label covering the most of the window', () => {
  const ws = [
    { text: 'a', start: 0, end: 2, speaker: 'SPEAKER_00' },
    { text: 'b', start: 2, end: 2.4, speaker: 'SPEAKER_01' },
  ]
  expect(dominantSpeaker(ws, 0, 3)).toBe('SPEAKER_00')
  expect(dominantSpeaker(ws, 1.9, 2.5)).toBe('SPEAKER_01')
  expect(dominantSpeaker(ws, 10, 12)).toBeNull()
})
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/lib/speakers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/speakers.ts src/lib/speakers.test.ts
git commit -m "feat(studio): pure speaker→cast resolution helpers (10b)"
```

### Task 10b.4: Cast UI + wiring

This replaces the single-voice `VoiceStudio` slot with a cast-aware panel. No new unit logic (it's all in `speakers.ts` + reducers); this is component wiring. Per `feedback_no_pixel_perfect_prototyping`, gate on build/lint/test, not pixel polish.

- [ ] **Step 1: Add cast handlers to `useScenePipeline.ts`.** Near the existing voice handlers (`cloneFromRecording` ~line 700), read cast state and expose dispatchers + a seeding effect:

```ts
const cast = useAppSelector((s) => s.studio.cast)
const speakerAssignments = useAppSelector((s) => s.studio.speakerAssignments)

// Seed one person on first entry to the voice step (back-compat: adopt the legacy
// single `voice` if present), so the "just me" path is one decision.
const ensureCast = useCallback(() => {
  if (cast.length === 0) {
    dispatch(setPeopleCount(1))
    if (voice) dispatch(setPersonVoice({ id: /* cast[0].id after add */ '', voice }))
  }
}, [cast.length, voice, dispatch])
```
Because the new person's id isn't known synchronously, prefer doing the seed inside the slice: extend `setPeopleCount` is overkill — instead add a tiny thunk-free pattern: dispatch `setPeopleCount(1)`, then in a `useEffect([cast.length])` if `cast.length === 1 && !cast[0].voice && voice` dispatch `setPersonVoice({ id: cast[0].id, voice })`. Implement that effect in the hook.

Expose from the hook's return object: `cast`, `speakerAssignments`, and bound handlers:
```ts
setPeopleCount: (n: number) => dispatch(setPeopleCount(n)),
renamePerson: (id: string, name: string) => dispatch(renamePerson({ id, name })),
removePerson: (id: string) => dispatch(removePerson(id)),
assignSpeaker: (videoId: string, label: string, personId: string) =>
  dispatch(assignSpeaker({ videoId, label, personId })),
```
Per-person cloning/preset/saved reuse must target a specific person. Add person-aware variants beside the existing ones, e.g. `cloneForPerson(personId, blob)`, `pickPresetForPerson(personId, voiceId)`, `reuseForPerson(personId, voiceId)`, `sampleForPerson(personId)`. Each mirrors the existing function body (`cloneFromRecording` etc.) but ends in `dispatch(setPersonVoice({ id: personId, voice }))` instead of `setVoice(...)` (and still `addSavedVoice` for minted/reused ids). Keep the `patch('clone', …)` status writes.

- [ ] **Step 2: Build `src/components/Studio/CastStudio.tsx`.** Props:

```ts
import type { Person } from '../../store/studioSlice'
import type { VideoSource, SavedVoice } from '../../store/studioSlice'
import type { SpeakerAssignments } from '../../lib/speakers'

type Props = {
  cast: Person[]
  sources: VideoSource[]
  savedVoices: SavedVoice[]
  assignments: SpeakerAssignments
  cloning: boolean
  samplingVoice: boolean
  onPeopleCount: (n: number) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onAssign: (videoId: string, label: string, personId: string) => void
  onCloneForPerson: (personId: string, blob: Blob) => void
  onPickPresetForPerson: (personId: string, voiceId: string) => void
  onReuseForPerson: (personId: string, voiceId: string) => void
  onSampleForPerson: (personId: string) => Promise<string | null>
}
```
Render, top to bottom:
  1. A header + a **"People across all your videos"** number control (`<select>` 1–6 or − / + steppers) → `onPeopleCount`.
  2. For each `person` in `cast`: a row with an editable name (`onRename`) and a per-person voice picker. Reuse the existing `VoiceStudio` panels by extracting the inner clone/saved/preset selector into a small `<PersonVoicePicker person={person} … />` — easiest path: render the existing `VoiceStudio` once per person, passing that person's `voice` and person-scoped handlers (`onClone={(b)=>onCloneForPerson(person.id,b)}`, etc.). `VoiceStudio`'s current `Props` already matches if you adapt the callback signatures.
  3. **Only when `cast.length >= 2`:** a per-video assignment grid. For each `source` in `sources` with `uniqueSpeakers(source.words).length > 0`, list each label with a `<select>` of cast people (value = `assignments[source.id]?.[label] ?? ''`) → `onAssign(source.id, label, personId)`. On first render of the grid (or when people count changes), call the seeding helper: dispatch assignments from `seedAssignmentsByLabel(source.id, labels, cast, assignments)` for any unfilled label (do this in the page/hook effect, not in render).

- [ ] **Step 3: Wire it into `src/pages/Studio.tsx`.** Replace the `clone:` board slot (currently rendering `<VoiceStudio … />` at ~lines 575-588) with `<CastStudio … />`, passing `pipe.cast`, `pipe.sources`, `pipe.savedVoices`, `pipe.speakerAssignments`, and the handlers from Step 1. Keep the `showVoiceStudio || pipe.voice` reveal gate, but base it on `pipe.cast.some(p=>p.voice) || showVoiceStudio` so a configured cast keeps the panel open. The `onBoardAction` `clone` branch (line 233-239) still just `setShowVoiceStudio(true)`.

- [ ] **Step 4: Build, lint, test**

Run: `npm run build && npm run lint && npm run test:run`
Expected: all PASS. Fix type errors at the call sites (callback signatures) rather than casting.

- [ ] **Step 5: Commit**

```bash
git add src/components/Studio/CastStudio.tsx src/components/Studio/useScenePipeline.ts src/pages/Studio.tsx
git commit -m "feat(studio): cast UI — name people, assign voices, map speakers per video (10b)"
```

---

## Story 10c — Speaker-aware director transcript

**File structure:**
- Modify: `src/lib/director.ts` (`combinedTimedTranscript` gains an optional name resolver; group consecutive same-speaker words into labelled blocks)
- Modify: `src/lib/director.test.ts` (speaker-labelled output)
- Modify: `src/components/Studio/useScenePipeline.ts:659` (pass a name resolver built from cast + assignments)
- Modify (infra, MCP): director rule `138f27fb` prompt/system — one line documenting the `Name:` block format

### Task 10c.1: Speaker-grouped transcript in `director.ts`

- [ ] **Step 1: Write failing tests.** Append to `src/lib/director.test.ts`:

```ts
import { combinedTimedTranscript, type TranscriptSource } from './director'

const src = (id: string, fileName: string, duration: number, words: any[]): TranscriptSource =>
  ({ id, fileName, duration, words })

test('combinedTimedTranscript labels speaker runs with resolved names', () => {
  const words = [
    { text: 'hello', start: 0, end: 0.5, speaker: 'SPEAKER_00' },
    { text: 'there', start: 0.6, end: 1.0, speaker: 'SPEAKER_00' },
    { text: 'hi', start: 1.2, end: 1.6, speaker: 'SPEAKER_01' },
  ]
  const out = combinedTimedTranscript([src('v1', 'a.mov', 2, words)], (videoId, label) =>
    videoId === 'v1' && label === 'SPEAKER_00' ? 'James' : 'Guest',
  )
  expect(out).toContain('James: hello there')
  expect(out).toContain('Guest: hi')
})

test('combinedTimedTranscript without a resolver is unchanged (no speaker labels)', () => {
  const words = [{ text: 'hello', start: 0, end: 0.5, speaker: 'SPEAKER_00' }]
  const out = combinedTimedTranscript([src('v1', 'a.mov', 2, words)])
  expect(out).not.toContain('SPEAKER_00')
  expect(out).toContain('hello')
})
```

- [ ] **Step 2: Run, expect FAIL** (resolver arg + labels not implemented).

Run: `npx vitest run src/lib/director.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `src/lib/director.ts`:

Add a resolver type + a speaker-grouping transcript builder, and thread an optional resolver through `combinedTimedTranscript`. Keep `timedTranscript` (no speakers) intact for back-compat; add the labelled variant used when a resolver is present:

```ts
/** Resolve a `(videoId, speakerLabel)` to a display name for the director prompt. */
export type SpeakerNamer = (videoId: string, speakerLabel: string) => string

/**
 * Like `timedTranscript`, but when words carry a `speaker`, group consecutive
 * same-speaker runs and prefix each emitted line with `Name:` (story 10c). A run
 * is broken by either a speaker change or the time window rolling over, so the
 * `[m:ss]` anchors are preserved. Single-speaker input yields the same name on
 * every line (cheap, and the director ignores it) — effectively today's output
 * plus a name.
 */
export function speakerTimedTranscript(
  words: TWord[],
  name: (label: string) => string,
  secondsPerLine = 8,
): string {
  if (!words.length || secondsPerLine <= 0) return ''
  const lines: { bucket: number; speaker: string | undefined; words: string[] }[] = []
  let curBucket = -1
  let curSpeaker: string | undefined
  for (const w of words) {
    const text = str(w?.text).trim()
    if (!text) continue
    const start = typeof w?.start === 'number' && Number.isFinite(w.start) ? w.start : null
    const bucket = start == null ? Math.max(0, curBucket) : Math.floor(start / secondsPerLine)
    const speaker = w?.speaker
    const rollover = start != null && (bucket !== curBucket || speaker !== curSpeaker)
    if (rollover || lines.length === 0) {
      lines.push({ bucket, speaker, words: [] })
      curBucket = bucket
      curSpeaker = speaker
    }
    lines[lines.length - 1].words.push(text)
  }
  return lines
    .map((l) => {
      const who = l.speaker ? `${name(l.speaker)}: ` : ''
      return `[${clockLabel(l.bucket * secondsPerLine)}] ${who}${l.words.join(' ')}`
    })
    .join('\n')
}
```

Change `combinedTimedTranscript` to accept an optional `namer?: SpeakerNamer` and use `speakerTimedTranscript` per source when given, else the existing `timedTranscript`:

```ts
export function combinedTimedTranscript(sources: TranscriptSource[], namer?: SpeakerNamer): string {
  const spans = sourceOffsets(sources)
  return sources
    .map((s, i) => {
      const offset = spans[i].start
      const shifted: TWord[] = s.words.map((w) => ({
        ...w,
        start: typeof w.start === 'number' ? w.start + offset : w.start,
        end: typeof w.end === 'number' ? w.end + offset : w.end,
      }))
      const body = namer
        ? speakerTimedTranscript(shifted, (label) => namer(s.id, label))
        : timedTranscript(shifted)
      const header = `--- VIDEO ${i + 1}: ${s.fileName} (starts ${clockLabel(offset)}) ---`
      return i === 0 ? `${header}\n${body}` : `\n${header}\n${body}`
    })
    .join('\n')
}
```

- [ ] **Step 4: Run, expect PASS; full suite**

Run: `npx vitest run src/lib/director.test.ts && npm run test:run`
Expected: PASS (existing `combinedTimedTranscript` callers pass no namer → unchanged output).

- [ ] **Step 5: Commit**

```bash
git add src/lib/director.ts src/lib/director.test.ts
git commit -m "feat(studio): speaker-labelled transcript for the director (10c)"
```

### Task 10c.2: Feed cast names to the director at request time

- [ ] **Step 1: Build the namer at the director call site.** In `src/components/Studio/useScenePipeline.ts` near line 659 where `combinedTimedTranscript(...)` builds the transcript, construct a resolver from cast + assignments and pass it:

```ts
import { resolvePerson } from '../../lib/speakers'
// …
const namer = (videoId: string, label: string) =>
  resolvePerson(videoId, label, cast, speakerAssignments)?.name ?? label
const transcript = combinedTimedTranscript(/* the existing sources arg */, namer)
```
`cast` and `speakerAssignments` are already read in the hook (added in 10b.4). The resolver falls back to the raw label when a speaker is unassigned (or single-person cast → that person's name), so it's safe even if the producer skipped naming.

- [ ] **Step 2: Build + lint + test**

Run: `npm run build && npm run lint && npm run test:run`
Expected: PASS.

- [ ] **Step 3: (Infra, MCP, optional) Note the format in the director rule.** If the director rule `138f27fb` prompt should explain the new lines, add one sentence to its system/prompt via `mcp__bffless-j5s__update_pipeline_step`: that transcript lines may be prefixed `Name:` indicating who is speaking, and the model should use this to attribute scenes but must still return spans/cuts as before. Smoke-test one live director run if the Replicate token is set; otherwise leave a TODO note in the story file (the client already sends names; the rule note is non-blocking).

- [ ] **Step 4: Commit**

```bash
git add src/components/Studio/useScenePipeline.ts
git commit -m "feat(studio): pass assigned speaker names to the director (10c)"
```

---

## Story 10d — Per-segment voice at Build

**File structure:**
- Modify: `src/lib/scenes.ts` (`NarrationSegment` gains `voiceId?`)
- Modify: `src/components/Studio/SegmentVoiceControl.tsx` (`SegmentControl` gains voice fields; add a voice picker)
- Modify: `src/components/Studio/TranscriptDiff.tsx` (thread a voice-pick handler + options)
- Modify: `src/pages/Studio.tsx` (map resolved default voice + cast options into `segmentControls`)
- Modify: `src/components/Studio/useScenePipeline.ts` (`generateSegmentNarration` uses the resolved voice; add `setSegmentVoice`)
- Test: `src/lib/speakers.test.ts` already covers `dominantSpeaker`; add a small resolution test here if a new helper is introduced.

### Task 10d.1: Per-segment voice override on the model

- [ ] **Step 1: Add the field.** In `src/lib/scenes.ts` `NarrationSegment` (after `suggestedSource`):

```ts
  /** Producer's per-segment voice override (story 10d). Absent = use the segment's
   *  speaker-derived default. Persists on `scene.refined` like every Build edit. */
  voiceId?: string
```

- [ ] **Step 2: Add the persistence path in the hook.** In `useScenePipeline.ts`, the existing `setSegmentAudio` writes into `scene.refined.segments[i]`. Add a sibling `setSegmentVoice(sceneId, segIndex, voiceId)` that patches `refined.segments[i].voiceId` (mirror `setSegmentAudio`'s find-scene / clone-refined / patchScene structure). Expose it from the hook return.

- [ ] **Step 3: Resolve the default + override at voicing time.** Change `generateSegmentNarration` (lines ~1227-1246) so the voice id is resolved, not hard-read from `voice`:

```ts
const scene = scenes.find((s) => s.id === sceneId)
const seg = scene && effectiveSegments(scene)[segIndex]
if (!seg) return
const src = scene && sourceForScene(sources, scene)
const label = src ? dominantSpeaker(src.words, seg.start, seg.end) : null
const speakerVoice = label && scene
  ? resolveSpeakerVoice(scene.sourceId, label, cast, speakerAssignments)
  : null
const voiceId = seg.voiceId ?? speakerVoice?.voiceId ?? voice?.voiceId
if (!voiceId) { setSceneError('Pick a voice for this speaker first.'); return }
// …
const { audioUrl } = await narrateReq({ text: seg.text, voiceId }).unwrap()
```
Update the guard at the top (`if (voicingSegKey || !voice) return`) to `if (voicingSegKey) return` since voice now resolves per-segment. Add `cast`, `speakerAssignments`, `sources` to the `useCallback` deps. Import `dominantSpeaker`, `resolveSpeakerVoice` from `../../lib/speakers`.

- [ ] **Step 4: Build + lint + test**

Run: `npm run build && npm run lint && npm run test:run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scenes.ts src/components/Studio/useScenePipeline.ts
git commit -m "feat(studio): resolve per-segment narration voice from the speaker (10d)"
```

### Task 10d.2: Per-segment voice picker UI

- [ ] **Step 1: Extend `SegmentControl`** in `src/components/Studio/SegmentVoiceControl.tsx`:

```ts
export type SegmentControl = {
  // …existing fields…
  /** The segment's default voice label (from its speaker), shown when no override. */
  speakerName?: string
  defaultVoiceId?: string
  /** The producer's override (story 10d); falls back to defaultVoiceId. */
  voiceId?: string
  busy: boolean
}
```
Add to `Props`:
```ts
  voiceOptions?: { voiceId: string; label: string }[]
  onPickVoice?: (voiceId: string) => void
```
In the row JSX (where the AI / Record buttons render), add a compact `<select>` when `voiceOptions?.length`:
```tsx
{voiceOptions && voiceOptions.length > 0 && (
  <select
    className="border rule bg-paper px-1 text-[11px]"
    value={segment.voiceId ?? segment.defaultVoiceId ?? ''}
    onChange={(e) => onPickVoice?.(e.target.value)}
    title={segment.speakerName ? `Speaker: ${segment.speakerName}` : 'Voice'}
  >
    {!segment.defaultVoiceId && <option value="">choose voice…</option>}
    {voiceOptions.map((o) => (
      <option key={o.voiceId} value={o.voiceId}>{o.label}</option>
    ))}
  </select>
)}
```
The "✨ AI" button stays; `canAI` should be true when a voice resolves (default or override).

- [ ] **Step 2: Thread through `TranscriptDiff.tsx`.** Add to `Props`: `onPickSegmentVoice?: (sceneId: string, index: number) => void` is not enough — it needs the chosen id; use `onPickSegmentVoice?: (sceneId: string, index: number, voiceId: string) => void`. Pass `voiceOptions` via the existing `controls` object (the same object that carries `onGenerateAI` etc. — extend its type where it's defined in `TranscriptDiff`), and in the `<SegmentVoiceControl … />` render (lines ~1317-1338) add:
```tsx
voiceOptions={controls.voiceOptions}
onPickVoice={(vid) => controls.onPickVoice?.(seg.sceneId, seg.index, vid)}
```

- [ ] **Step 3: Supply options + defaults from `Studio.tsx`.** Where `segmentControls` is built (lines 290-307), enrich each segment with its speaker-derived default and add the cast options to the `controls` object:

```ts
import { dominantSpeaker, resolveSpeakerVoice, resolvePerson } from '../lib/speakers'
import { presetLabel, PRESET_VOICES } from '../lib/voices'
// …
const src = selected && pipe.sources.find((s) => s.id === selected.sourceId)
// per segment:
const label = src ? dominantSpeaker(src.words, seg.start, seg.end) : null
const def = label && selected
  ? resolveSpeakerVoice(selected.sourceId, label, pipe.cast, pipe.speakerAssignments)
  : null
// add to the mapped object:
speakerName: label
  ? (resolvePerson(selected!.sourceId, label, pipe.cast, pipe.speakerAssignments)?.name ?? label)
  : undefined,
defaultVoiceId: def?.voiceId,
voiceId: seg.voiceId,
```
Build `voiceOptions` once from the cast + presets:
```ts
const voiceOptions = useMemo(
  () => [
    ...pipe.cast.filter((p) => p.voice).map((p) => ({ voiceId: p.voice!.voiceId, label: `${p.name} (${p.voice!.label})` })),
    ...PRESET_VOICES.map((v) => ({ voiceId: v.id, label: presetLabel(v.id) })),
  ],
  [pipe.cast],
)
```
Add `voiceOptions` and `onPickVoice: (sceneId, index, vid) => pipe.setSegmentVoice(sceneId, index, vid)` to the `controls` object passed to `TranscriptDiff`.

- [ ] **Step 4: Build + lint + test**

Run: `npm run build && npm run lint && npm run test:run`
Expected: PASS. Manually sanity-check in `npm run dev` with `MOCK_STUDIO` if multi-speaker fixture words were added (optional, not required).

- [ ] **Step 5: Commit**

```bash
git add src/components/Studio/SegmentVoiceControl.tsx src/components/Studio/TranscriptDiff.tsx src/pages/Studio.tsx
git commit -m "feat(studio): per-segment voice picker, defaulted from the speaker (10d)"
```

### Task 10d.3: Story bookkeeping

- [ ] **Step 1: Update `stories/inprogress/studio/README.md`** — add rows for stories 10a–10d (status, one-line each), matching the existing table style. Move nothing yet (these stay in `inprogress`).

- [ ] **Step 2: Commit**

```bash
git add stories/inprogress/studio/README.md
git commit -m "docs(studio): log stories 10a–10d in the backlog table"
```

---

## Final verification

- [ ] `npm run build` — clean (tsc -b + vite build)
- [ ] `npm run lint` — clean
- [ ] `npm run test:run` — all green
- [ ] Manual smoke (optional, `npm run dev`): the prep plan reads thumbnails → voice → director; the voice step shows the cast with a people-count control; bumping to 2 reveals the per-video grid; a Build segment shows a voice dropdown defaulted to its speaker.
- [ ] Open the umbrella PR for branch `studio/diarization-cast-voices` referencing the spec; list stories 10a–10d.

## Notes / risks carried from the spec

1. **10a rule edit is live infra** — diarization adds ~speaker-model load; the live run measured ~5 s predict on a ~50 s clip. The HF token is `secrets.HF_TOKEN` (already provisioned). Validators stay off (story 07).
2. **Legacy `voice` mirror** — `cast[0].voice` mirrors the old top-level `voice` so any reader not yet migrated (e.g. `generateSample`, `VoiceReady`) keeps working. Don't delete `voice` in this branch.
3. **`dominantSpeaker` reads per-source `words`** — scenes carry `sourceId`; resolve via `sources.find(s => s.id === scene.sourceId)`. Old transcripts without `speaker` resolve to `null` → fall back to the legacy/global voice, so pre-diarization projects still voice fine.
