# Studio — Speaker diarization + per-person voices

**Date:** 2026-06-14
**Branch:** `studio/diarization-cast-voices` (one long-lived branch, a commit per story — per the one-branch-per-refactor convention)
**Stories:** 10a → 10b → 10c → 10d

## Summary

Today `/studio` re-voices a recording in **one** cloned voice, and the prep plan
runs **thumbnails → director → voice**. This feature:

1. Turns on **speaker diarization** in the WhisperX transcribe step so every
   transcript word carries a `speaker` label.
2. **Reorders** the prep plan to **thumbnails → voice → director** (voice becomes
   step 2, director step 3). This works because by the voice step every video is
   already transcribed, so the speakers are known — and the director, now running
   last, can use the names the producer assigned.
3. Introduces a project **cast**: a small list of people (name + one voice each).
   Detected speaker labels are assigned to people. The common case (one narrator,
   any number of clips) is **zero per-video work** via a people-count shortcut.
4. Feeds **speaker-grouped, name-labelled** transcript to the AI director.
5. Makes voice a **per-segment** choice at Build: each narration segment defaults
   to its speaker's voice and can be overridden.

## Decisions (resolved during brainstorming)

- **Speaker → voice:** the speaker drives the *default* voice for a segment; the
  producer can override per segment. (Not fully independent, not a single global
  voice.)
- **Multi-video identity:** diarization labels are **per-file** — `SPEAKER_00` in
  one video is not necessarily the same person as in another. Reconciliation is
  **manual** (the producer assigns), never auto-matched by audio fingerprint.
- **Data model:** a project-level **cast** of people `{ id, name, voice }`, plus a
  per-`(videoId, speakerLabel)` assignment to a person. One voice per person.
- **Friction scales with complexity:** default cast is **one** person with **all**
  detected speakers (across all videos) auto-assigned to it. A single
  "People across all your videos: [N]" control is the master switch; the per-video
  assignment grid only appears when N ≥ 2.
- **Director gets speakers:** the transcript sent to the director groups
  consecutive words by speaker and labels each run with the cast name. Single
  speaker = one block (status quo).

## Story 10a — Diarization + `speaker` on every word

**Pipeline (WhisperX rule `972a6dc5`, rule set `cf413ff6`):**
- Set input mapping `diarization` → `true` (currently `false`).
- Add input mapping `huggingface_access_token` → `secrets.HF_TOKEN` (the
  back-end secret is already provisioned).
- Keep `align_output: true` — required for word timestamps the grid depends on.
- **Flatten step:** the existing map of WhisperX `words[{word,start,end}]` →
  `[{text,start,end}]` gains `speaker: w.speaker ?? null`.

**Data model:**
- `TranscriptWord` (`src/store/studioSlice.ts:21`) gains `speaker?: string`.
- The `TWord` mirror in `src/lib/transcriptGrid.ts` gains `speaker?: string`.
- The transcribe coercion in `useScenePipeline.ts` carries `speaker` through.

**Mock:** the `/api/transcribe` MSW fixture (`src/mocks/handlers.ts`, gated by
`MOCK_STUDIO`) gains `SPEAKER_00` / `SPEAKER_01` so dev exercises the path
without the paid model.

**✅ Live verification (done 2026-06-14):** a real run with
`align_output:true + diarization:true` returns a **word-level** `speaker` on every
word — `output.segments[].words[]` each carry
`{ word, start, end, score, speaker: "SPEAKER_00" }`, and each segment also carries
a top-level `speaker`. So the flatten maps `speaker: w.speaker ?? segment.speaker ??
null` (the segment value backstops any word a diarization gap missed). The
time-overlap fallback is **not** needed.

## Story 10b — Cast + reordered voice step + per-video assignment

**Reorder the global plan to thumbnails → voice → director:**
- `STAGE_DEFS` / `GLOBAL_STAGES` order in `src/lib/pipeline.ts` (move `clone`
  before `director`; renumber step labels).
- `PipelineBoard` render order.
- The `planRevealed` plan label (currently "thumbnails → director → voice").
- Verify `studioPhase()` still gates **Build** on the director finishing (not on
  voice), since voice now precedes the director.

**New Redux state (project-level, `studioSlice.ts`):**
```ts
type Person = { id: string; name: string; voice: VoiceChoice | null }
cast: Person[]
speakerAssignments: Record<string /*videoId*/, Record<string /*speakerLabel*/, string /*personId*/>>
```
- `savedVoices` stays as the cloned-id library (the pool people draw from).
- The legacy single `voice` field becomes "the first person's voice" via a
  back-compat shim, mirrored the way the multi-video legacy fields already are.

**Cast step UI (extends `VoiceStudio`):**
- A **"People across all your videos: [N ▾]"** control. Default **1**.
- For each person: name field + assign a voice through the existing
  clone / saved / preset panels + sample preview.
- **N = 1:** the per-video assignment grid never renders; every detected speaker
  in every video is auto-assigned to the one person. Single-narrator (even across
  10 clips) is one decision: set the voice.
- **N ≥ 2:** show that many people, plus a per-video grid mapping each detected
  speaker label → a cast person. **Pre-seed** by label (each video's `SPEAKER_00`
  → person 1, `SPEAKER_01` → person 2…), so consistent recording order needs no
  fixing; the producer only corrects mismatches.

**Selectors / pure logic (`src/lib/`, unit-tested):**
- Detect unique speaker labels per video from `words`.
- `resolveSpeakerVoice(videoId, speakerLabel) → VoiceChoice | null`.
- Cast/assignment selectors + the auto-assign-all default.

## Story 10c — Speaker-aware director transcript

The director now runs after the cast step, so it can use assigned names.

- In `src/lib/director.ts`, the transcript shaping (`timedTranscript()` /
  request shaping) groups **consecutive same-speaker words into one labelled
  block** instead of a flat word/line stream:
  ```
  James: in this session I'm going to go over onboarding rules …
  Guest: right, and that's where pipelines come in …
  ```
- Label resolution: `(videoId, speakerLabel)` → cast person name; fall back to the
  raw label if unassigned. Single-speaker → a single block (effectively today's
  behaviour).
- Pure, unit-tested in `director.ts`. The director rule (`138f27fb`) prompt/system
  gets a one-line note describing the `Name: …` block format if needed; no
  structural rule change.

## Story 10d — Per-segment voice at Build

- Each refiner narration segment (`NarrationSegment`) is anchored to words; those
  words carry `speaker`, and the scene knows its `sourceId`. Resolve
  **segment → dominant speaker → assignment → person → voiceId**; that is the
  segment's **default** voice.
- `SegmentVoiceControl` gains a compact voice picker (cast people + presets) so
  the producer can **override per segment**. The override persists on
  `scene.refined` (non-destructive, like every other Build edit).
- `/api/voice/narrate` already takes `{ text, voiceId }`; AI voicing passes the
  resolved id (`override ?? speakerDefault ?? fallback`).
- **Export needs no change** — `assemble.ts` already reads each segment's
  `audioUrl`.

## Data flow

```
transcribe (10a) ── words[{text,start,end,speaker}] ──► slice (per video)
                                                          │
voice/cast step (10b) ── cast[] + speakerAssignments ────┤
                                                          │
director (10c) ◄── speaker-grouped, name-labelled transcript
   └─► scenes[] (each with sourceId)
                                                          │
Build (10d): segment ──► dominant speaker ──► assignment ─┘──► person.voice
   └─► narrate({text, voiceId = override ?? default}) ──► segment.audioUrl
   └─► export reads audioUrl (unchanged)
```

## Testing

- **10a:** speaker coercion in the transcribe handler; mock fixture carries
  speakers.
- **10b:** unique-speaker detection, `resolveSpeakerVoice`, auto-assign-all
  default, pre-seed-by-label.
- **10c:** speaker-run grouping + name resolution in `director.ts`.
- **10d:** segment → dominant-speaker resolution; voice precedence
  (`override ?? default ?? fallback`).
- MSW mocks updated per story; `npm run build` / `lint` / `test:run` green per
  commit.

## Out of scope

- Auto-matching the same person across videos by voice fingerprint
  (reconciliation stays manual).
- Any change to how the director **splits** scenes beyond giving it speaker
  context (no per-speaker scene rules).

## Open items to verify during implementation

1. **10a:** word-level vs segment-level `speaker` from the live model (see ⚠️).
2. **10b:** `studioPhase()` does not assume voice is the last global stage.
3. **10d:** the scene → `sourceId` field name (confirm in the slice) used to fetch
   the right video's `words` for speaker resolution.
