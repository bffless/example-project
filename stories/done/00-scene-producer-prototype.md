# ✅ DONE — Scene-producer prototype

**Completed.** `/studio` is a working, mostly-mocked prototype of the scene
producer. (Two earlier directions were built and **scrapped**: a manual
"iMovie-in-the-browser" editor, then a one-shot "auto-shorten" board. The user
wants neither — see `../inprogress/00-architecture-and-state.md` for the model.)

## What it does

Import one clip → a **prep board** of notes runs (each checks off with a result)
→ the clip is split into **scenes** → you build scenes **one at a time** in a
scene editor → built scenes form the chapter list / final cut.

## Prep stages (browser stages REAL; pipeline/AI stages MOCKED)

1. Save the clip to a bucket — *mock*
2. Extract the audio (16 kHz mono WAV) — **real** (`src/lib/audio.ts`)
3. Transcribe with timestamps — *mock*
4. Shorten the transcript — *mock*
5. Group into scenes with timestamps — *mock* (`buildScenes`) + **real** scene
   thumbnails (`src/lib/frames.ts` `captureFramesAt`)
6. Clone your voice — *mock*

## Scene workspace (per scene)

Each scene opens with an **AI-shortened draft** + its footage timestamps. Loop:
edit the script → **regenerate cloned-voice narration** (mock TTS = length from
word count) → alignment readout (narration length vs footage span) → **mark
built**. All-built → chapter list + a disabled "assemble with ffmpeg" CTA.

## Files

- `src/lib/scenes.ts` (+test) — `Scene` model, `buildScenes` (mock shorten+
  segment), `narrationSeconds`/`alignment`.
- `src/lib/pipeline.ts` (+test) — `STAGE_DEFS` (the 6 prep notes).
- `src/lib/audio.ts`, `src/lib/frames.ts` — real browser primitives.
- `src/lib/edl.ts` (+test) — `formatTime` and segment helpers, kept.
- `src/components/Studio/` — `useScenePipeline` (orchestrator + scene state),
  `PipelineBoard`/`StageCard`, `SceneList`, `SceneEditor`, `MediaImport`,
  `PreviewPlayer`. (`Waveform`, `Filmstrip` retained as primitives.)
- `src/pages/Studio.tsx` — composes it; route + nav already wired.

## Verified

`npm run build` ✓ · lint ✓ (new code) · 32/32 tests ✓. Behavior confirmed:
real audio extraction → WAV, real scene thumbnails, board checks off, scene
build loop (edit → regenerate → alignment "short/long/aligned" → mark built)
works. No browser/pixel-perfect verification (per user preference).
