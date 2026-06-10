# 04 — Voice step: clone your own voice OR pick a preset (stage ⑥)

> Read `00-architecture-and-state.md` first.

**Status:** ✅ done (clone step intentionally **disabled** — see below) ·
**Backend: BFFless `replicate` (clone disabled / TTS preview live).**

## Goal

Replace the mocked "Clone your voice" board button with a real **voice step**:
the last prep step where the producer sets the one narration voice every scene
gets re-voiced in (Build, a later story). Two mutually exclusive paths:

1. **Clone my voice** — record a short mic sample (live level meter), upload it,
   and run **MiniMax voice-cloning** → a reusable `voice_id`.
2. **Use a saved ID** — paste/pick a previously-cloned `voice_id` (MiniMax stores
   them). No recording, no cost.
3. **Use a preset** — pick one of MiniMax's built-in voices. No recording, no
   upload, no cost.

After a voice is set, **"Generate a sample"** speaks a short canned line in it
(live **`minimax/speech-2.8-turbo`**) so the producer can hear it.

## 💸 Cost guard — built disabled-first, then enabled

`minimax/voice-cloning` costs **$3 per call**, so it shipped first with the
`sign` + `clone` Replicate steps **`isEnabled:false`** (returning the preset stub
`Friendly_Person`) to prove the path with no spend. **Now enabled** (2026-06-07):
input `{ voice_file, model:'speech-02-turbo', accuracy:0.7,
need_noise_reduction:false, need_volume_normalization:false }`, output
`{ model, preview, voice_id }`. **To disable again:** set `sign`+`clone`
`isEnabled:false` and point `respond` at `{{steps.prep.voiceId}}`.

⚠️ MiniMax only accepts **mp3/m4a/wav** — the recorder gives webm/mp4, so the FE
re-encodes the take to a 24 kHz mono WAV (`extractAudioWav`) before upload.

**Reuse without re-paying:** every clone is auto-saved to a persisted
`savedVoices` list (kept across "Start over"); the ready state has a "Copy voice
ID", and the "Use a saved ID" path reuses one for free.

## Backend (BFFless `studio` rule set `cf413ff6-…`)

All auth-off (TEMP, restore in story 07), mirroring source/audio/thumbnails:

- Presigned **voice upload**: `POST /api/uploads/voice/prepare` (`2416b2ff`),
  `/register` (`491b17c9`), `GET /api/uploads/voice/*` (`2b431b17`) — reuse
  schema `studio_source` `8afd205a`, `subDir:"voice"`, `audio/*`.
- `POST /api/voice/clone` (`b4673310`) — **clone ENABLED** ($3/call):
  `prep`→`sign`→`clone`→`pickVoice`→`respond { voiceId, previewUrl }`, 120 s
  timeout. (Disable → preset stub via `prep`.)
- `POST /api/voice/say` (`9998f0dc`) — **live** `minimax/speech-2.8-turbo`,
  returns `{ audioUrl, durationSeconds }`. Needs the Replicate token.

## Front-end

- State: `voice: VoiceChoice` in the Redux `studio` slice (persisted).
- Data: `'voice'` `UploadKind`, `voiceClone` + `voiceSay` mutations in
  `studioApi.ts`.
- Orchestration (`useScenePipeline.ts`): the clone stage left `next()`; new
  `cloneFromRecording` / `pickPresetVoice` / `clearVoice` / `generateSample`.
- UI: `VoiceStudio.tsx` (bottom resource, under the scenes/chapters) +
  `MicMeter.tsx` (live mic level) + `useRecorder.ts` (MediaRecorder wrapper).
  The board's "Choose your voice" action reveals the resource; preset catalog in
  `src/lib/voices.ts` (unit-tested).
- MSW (`MOCK_STUDIO`): `/api/voice/clone` → `Friendly_Person`; `/api/voice/say`
  → a short tone WAV data URL.

## Acceptance criteria

- [x] Picking a preset sets the voice with no network/upload.
- [x] Recording → upload → clone returns a usable `voice_id` with **no $3 spend**
      (clone step disabled, returns preset stub).
- [x] "Generate a sample" plays audible narration (live TTS) for both paths.
- [x] Voice persists across reload; build/lint/tests pass.

## Out of scope (next stories)

- **Per-scene** "Generate voice" that voices each scene's script + stores
  `narrationSeconds` (Build).
- Turning on the real $3 clone step; re-enabling `auth_required`/`rate_limit`
  (story 07).
