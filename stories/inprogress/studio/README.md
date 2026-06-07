# Studio — story backlog

`/studio` turns one long, rambly recording into a short video **re-voiced in the
user's own cloned voice**. The AI shortens the transcript and groups it into
scenes (chapters) with timestamps; the producer then builds each scene one at a
time. Each story is written to be picked up **with fresh context**: read
`00-architecture-and-state.md`, then the one story.

## 📍 Where we are now

**Prototype shipped + stories 01 / 01b / 02 done.** Prep is now a **manual,
step-by-step flow** under a top-level **stepper** (Import → Prep → Build →
Export) so it's clear where you are and what's next. Each real prep step has its
own button; the still-mocked downstream (shorten/segment/clone) is grouped behind
one "Finish prep" action. Story 01b added an **extract→upload-audio** step (the
WAV gets its own bucket upload so Replicate can transcribe it). Story 02 wired
**real transcription**: `/api/transcribe` mints a presigned audio URL and runs
Replicate **WhisperX** (`align_output:true` for word timestamps). ⚠️ Needs the
**Replicate API token** set in BFFless Settings → AI before it returns live.
Story 02b added the **transcript editor** (a GitHub-diff-style time grid under
the video) and **MSW dev mocks** (`MOCK_STUDIO`) so iterating never hits the
bucket or the paid model — `/api/transcribe` returns a real captured fixture.
**Story 03 shipped the AI master director**: `/api/scenes` (live, rule
`138f27fb`) signs each contact sheet and hands it + the timestamped transcript +
the creator's free-text direction to **`google/gemini-3.1-pro`**, which returns a
one-line **synopsis** plus **scenes** (tightened script, original-video span,
parseable `cuts`). The prep page got a **Director panel** (direction input + send
action), Build shows the synopsis + per-scene cuts, and the shortened script now
fills the 02b diff's right pane. **Story 04 shipped the voice step**: a
**VoiceStudio** resource at the bottom of prep where you either **clone your own
voice** (mic recorder + live level meter → `/api/voice/clone`), **reuse a saved
`voice_id`**, or **pick a MiniMax preset**, then **Generate a sample** to hear it
(live `/api/voice/say`, `speech-2.8-turbo`). The **$3 clone is now ENABLED**
(`minimax/voice-cloning`; recording re-encoded to WAV first; minted ids auto-saved
for free reuse) — built disabled-first behind a preset stub, flipped on after
verification. **Story 03c shipped the per-scene refiner + diff-viewer rework**: a
second, zoomed-in pass — `/api/refine-scene` (rule `afacb572`, Gemini 3.1 Pro fed
**dense per-scene** contact sheets) returns anchored narration **segments** +
refined **cuts**, written non-destructively to `scene.refined` (the director's
first pass is never overwritten; revert = clear it). The Build diff viewer is now
the edit surface: scene **tabs** + a `SceneMeta` panel beside the video, the
time-grid diff full-width below with **cuts as red cells**, equal-height panes,
and **per-segment inline voicing** — **record it yourself** (mic → WAV → bucket)
or **AI** (`/api/voice/narrate`, persisted mp3) — plus a **green** span showing
each clip's real length with the words fit to it. **Next up: manual cut editing
(03d phase) — let the user add/remove cuts directly in the diff viewer.** Then the
wps knob, per-scene scope, the 03e filmstrip, and Story 05 — ffmpeg assemble.

```
done/        ✅ 00-scene-producer-prototype  ✅ 01-wire-upload-bucket
inprogress/  ✅ 01b-wire-audio-bucket (stepper + manual prep + audio→bucket)
             ✅ 02-wire-transcription (WhisperX; needs Replicate token)
             ✅ 02b-transcript-editor (time-grid diff view + dev mocks)
             ✅ 03 master director (Gemini 3.1 Pro → synopsis + scenes + cuts)
             ✅ 04 voice step (clone enabled / preset + live TTS preview)
             🔨 03c refiner + diff-viewer (segments + cuts, per-segment voice, green/fit)
                 ↳ ▶ next: manual cut editing · then wps knob · per-scene scope · 03e filmstrip
             ·  05 ffmpeg assemble · 06 · 07           (queued)
```

## Order & status

| # | Story | Stage(s) wired | Status |
|---|-------|----------------|--------|
| — | `../../done/00-scene-producer-prototype.md` | board + scene UX | ✅ done |
| — | `00-architecture-and-state.md` | — | reference (read first) |
| 00c | `00c-redux-state-persistence.md` | Redux + localStorage persist · RTK Query · mocks on | ✅ done (infra) |
| 01 | `01-wire-upload-bucket.md` | ① bucket upload | ✅ done |
| 01b | `01b-wire-audio-bucket.md` | ② extract + audio→bucket · stepper | ✅ done |
| 02 | `02-wire-transcription.md` | ③ transcribe (WhisperX) | ✅ done* |
| 02b | `02b-transcript-editor.md` | transcript time-grid editor · dev mocks | ✅ done |
| 03 | `03-wire-shorten-segment.md` | ⑤⑥ master director (synopsis + scenes + script + cuts) | ✅ done |
| 04 | `../../done/04-wire-voice-clone.md` | ⑥ voice step (clone enabled · saved-id reuse · preset · TTS preview) | ✅ done |
| 03c | `03c-wire-scene-refiner.md` | per-scene refiner (`/api/refine-scene`) · diff-viewer rework · per-segment record/AI voice · narrate TTS | 🔨 in progress (next: **manual cut editing**, see the 03d phase in-file) |
| 05 | `05-wire-ffmpeg-assemble.md` | assemble (fit footage to voice) | ⏳ queued |
| 06 | `06-thumbnail-nano-banana.md` | side feature | ⏳ queued |
| 07 | `07-stripe-gating.md` | billing | ⏳ queued |

Legend: ✅ done · ▶ next up · 🔨 in progress · ⏳ queued. `*` = code done, needs
the Replicate API token in BFFless Settings → AI to run. Finish a story → set it
✅, move the file to `stories/done/`, promote the next to ▶.

## How to work it

1. Read `00-architecture-and-state.md`.
2. Each new `/api/*` gets an **MSW mock** in `src/mocks/handlers.ts` first;
   build/adjust the UI, then swap the stage's mock in
   `src/components/Studio/useScenePipeline.ts` for the real call.
3. One stage per PR — keep stories small and context cheap.

## Open design question (for story 05)

The AI-shortened narration is **shorter than the original footage span**, so the
footage must be fit to the narration on assemble. Decide: speed up the span,
trim it to the most relevant sub-clip, or have the AI return a tighter sub-span.
Not blocking earlier stories.
