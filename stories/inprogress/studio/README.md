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
each clip's real length with the words fit to it. **Story 03e shipped the sprite
filmstrip gutter**: a fixed ~150px column down the left of the diff viewer showing
the contact-sheet frame nearest each row's time — reusing the already-captured
sheets as CSS sprites (`src/lib/filmstrip.ts`, `cellWidth/cellHeight/gap` now
persisted on `ContactSheet`), row-aligned to the grid (incl. segment spacers) so
it scrolls in lockstep. **The diff grid now draws out to the full clip
`duration`** (not just the last transcript word/cut), so trailing footage where the
talk ends before the clip does (e.g. speech stops ~0:50 on a 0:53 clip) renders as
**editable** rows the producer can hand-cut — it was previously invisible. **Story
05 shipped the ffmpeg assemble MVP**: the export step is now a single **walk of the
original timeline** — pure, unit-tested `src/lib/export/assemble.ts` (`buildSlices`
→ `planAssembly` → `buildFfmpegCommand`) tags every slice **cut** (drop) /
**segment** (keep + that clip's audio) / **dead** (keep + silence), **cut wins on
overlap**, and emits the `filter_complex` that trims+concats the kept footage
against the resampled narration clips + generated silence (one common 48 kHz mono
format; no loudnorm/crossfades yet). `src/lib/export/ffmpeg.ts` lazy-loads the
**single-threaded** ESM wasm core on first assemble (bundled locally from the
`@ffmpeg/core` npm package via Vite `?url` — no CDN; the 32 MB wasm is a hashed
asset fetched only on first assemble — no COOP/COEP needed), and `AssembleBar` drives it
from the Build view's **Export** step once every scene is built: progress bar,
errors surfaced, inline `<video>` preview + **Download MP4**. Trailing dead space
is **honored** (kept silent) so export = what the grid shows. The cut also **saves
like every other resource**: **Save to my library** uploads the MP4 via a new
presigned `export` flow (rules `2ec4f942`/`7459fb60`/`bea10a3d`) and persists only
the serve URL (`finalCutUrl`), so a refresh brings the saved cut back to
play/download — re-assemble + save overwrites it. Scenes carry a manual **Mark
built / re-open** toggle (tab ✓ + readiness line; never auto-set). **Story 05
optimizations are slated next but NOT done**: audio polish (per-segment `loudnorm`
+ short `acrossfade`), a stream-copy/no-re-encode speed path, and — **parked** —
multithreaded ffmpeg.wasm (`core-mt` is incompatible with `@ffmpeg/ffmpeg@0.12.15`'s
module worker + classic pthread workers; reverted to single-threaded). See story 05's
"Optimizations — slated next". **Next up overall: manual cut editing (03d phase) —
let the user add/remove cuts directly in the diff viewer** — then the wps knob.
(Per-scene scope shipped: the Build diff is now windowed to the selected scene tab
via `windowLines`, instead of rendering the whole talk.)

```
done/        ✅ 00-scene-producer-prototype  ✅ 01-wire-upload-bucket
             ✅ 05 ffmpeg assemble (timeline walk → MP4 + save + loudnorm/fades)
inprogress/  ✅ 01b-wire-audio-bucket (stepper + manual prep + audio→bucket)
             ✅ 02-wire-transcription (WhisperX; needs Replicate token)
             ✅ 02b-transcript-editor (time-grid diff view + dev mocks)
             ✅ 03 master director (Gemini 3.1 Pro → synopsis + scenes + cuts)
             ✅ 04 voice step (clone enabled / preset + live TTS preview)
             🔨 03c refiner + diff-viewer (segments + cuts, per-segment voice, green/fit)
                 ↳ ✅ 03e sprite filmstrip · ✅ per-scene scope (diff windowed to the selected tab) · ▶ next: manual cut editing · then wps knob
             🔨 03f refiner context+gating · ✅ Part 0 async fire-and-poll (jobs DB + postSteps + poll, no more timeouts) · ▶ next: Parts A–D (handoff · synopsis · prompt · gate)
             ·  06 · 07                                (queued)
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
| 03f | `03f-refiner-context-and-gating.md` | **async fire-and-poll** for director/refiner (jobs DB + `postSteps` + poll, no more timeouts) · director→refiner story-context handoff · per-scene synopsis · custom refine prompt · gate diff viewer behind sheets+refine | 🔨 Part 0 ✅ (async poll); Parts A–D next |
| 03h | `../../done/03h-free-segment-editing.md` | free segment editing — drop original audio **anywhere** (overlap flagged amber, not blocked) · drag a run's ⠿ handle to re-time it · assemble gated on overlaps | ✅ done |
| 03i | `../../done/03i-scene-preview-player.md` | scene preview player — flipbook of filmstrip frames + narration stitched via Web Audio scheduling, simulating `planScene()` with **no ffmpeg**; modal `<dialog>` opened from the sticky tabs + Assemble bar | ✅ done |
| 05 | `../../done/05-wire-ffmpeg-assemble.md` | assemble (timeline walk: cut/segment/dead) + save + audio polish | ✅ done† |
| 06 | `06-thumbnail-nano-banana.md` | side feature | ⏳ queued |
| 07 | `07-stripe-gating.md` | billing | ⏳ queued |

Legend: ✅ done · ▶ next up · 🔨 in progress · ⏳ queued. `*` = code done, needs
the Replicate API token in BFFless Settings → AI to run. `†` = shipped; open
non-blocking follow-ups (speed/smart-cut spike, encode-quality toggle). Finish a
story → set it ✅, move the file to `stories/done/`, promote the next to ▶.

## How to work it

1. Read `00-architecture-and-state.md`.
2. Each new `/api/*` gets an **MSW mock** in `src/mocks/handlers.ts` first;
   build/adjust the UI, then swap the stage's mock in
   `src/components/Studio/useScenePipeline.ts` for the real call.
3. One stage per PR — keep stories small and context cheap.

## Story 05 model (resolved — see `05-wire-ffmpeg-assemble.md`)

Assemble is a **walk of the original timeline** with three states per slice:
**cut** (drop video), **segment** (keep video + play that clip's audio), **dead
space** (keep video, silence). **Cut wins on overlap.** Video and audio build from
the same walk, so they're the same length and in sync — **no footage-fit step**
(the edit UI already prevents cutting more time than the audio occupies). The old
"speed up / trim to fit the narration" question is therefore moot.

**MVP first** (cut/keep/silence + plain concat + resample-to-common-format), then
sprinkle on loudness-normalization + crossfades. **First bug to fix:** trailing
dead space after the last segment leaks silent video onto the end of the export.
