# 04 — Wire voice clone + per-scene re-voice (stage ⑥ + scene TTS)

> Read `00-architecture-and-state.md` first.

**Status:** ⏳ queued · **Backend: BFFless `replicate` (voice clone + TTS).**

## Goal

Replace two mocks: (⑥) build a reusable **voice model** from the user's audio,
and the per-scene **"Generate voice"** action that synthesizes a scene's
narration text in that cloned voice. The narration audio is what the assemble
step (05) lays under the footage.

## Backend

1. `/api/voice/clone` — `replicate` voice-clone/TTS model (e.g. XTTS-v2, F5-TTS,
   or a MiniMax speech model — pick on quality/latency). Input = the extracted
   audio (or a clean span). Persist the voice id/ref (a Data Table keyed to the
   user) so it's reused across scenes and across runs.
2. `/api/voice/say` — input = a scene's `draftText` + the stored voice ref →
   returns narration audio (URL/Blob) and its real duration.
3. Validators: `auth_required` + `rate_limit` on both.

## Front-end

- Mock both in MSW (clone → fake voice id; say → short canned audio + a duration
  derived from word count, matching today's `narrationSeconds` estimate).
- In `useScenePipeline.ts`: the `clone` prep stage calls `/api/voice/clone`;
  `generateVoice(sceneId)` calls `/api/voice/say` and stores the **real**
  `narrationSeconds` (+ audio URL) on the scene. The `SceneEditor` alignment
  readout already keys off `scene.narrationSeconds` — no UI rewrite.
- Let the scene editor play the returned narration so the producer can hear it
  before marking the scene built.

## Acceptance criteria

- [ ] Real clone produces a reusable voice ref (persists across runs); real say
      returns narration audio + duration for a scene's text.
- [ ] Editing a scene's text + regenerating updates the real narration length and
      the alignment readout; mock and real share shapes.
- [ ] `auth_required` + `rate_limit`; build/lint/tests pass.

## Risks

The narration is shorter than the footage span — that's expected and handled at
assemble (05). Scope to screen-recording narration (no talking-head lip-sync).
