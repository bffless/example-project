# 03i — Scene preview player (flipbook + stitched narration, no ffmpeg)

> Read `00-architecture-and-state.md` first.

**Status:** ✅ implemented (build/lint/tests green; pending PR review) ·
**Frontend-only — no new `/api/*`, no Redux/persistence changes. The ffmpeg
assembler (`src/lib/export/assemble.ts`) and the MP4 path are untouched; this is
the cheap path beside them.**

## Why

In Build you can play each segment's audio one by one and read the script, but
the only way to see the **assembled result** — narration stitched over the kept
footage, cuts dropped, dead space silent — is to run the ffmpeg.wasm assemble,
which is heavy (32 MB wasm, full re-encode) and slow to iterate against. The
producer wants a **lightweight preview**: press play, hear the narration clips
stitched in output order, and watch the already-captured contact-sheet frames
flip by like a flipbook, synced to the audio clock. Edit → preview → edit, with
zero render cost; assemble only when happy.

## The model (decided in brainstorming)

- **The preview simulates the assemble plan, so it's faithful by construction.**
  It is built directly on the existing pure `planScene()` (`src/lib/export/
  assemble.ts`) — the same `{ slices, video, audio, duration }` plan ffmpeg
  renders. Cuts dropped, narration clips at their kept-video offsets clamped to
  their slots (the `apad`/`atrim` behavior), unvoiced segments silent, trailing
  dead space honored. If the preview sounds right, the render will too.
- **Audio engine: Web Audio scheduling with a decoded-buffer cache.** Considered
  and rejected: *pre-stitched WAV* (every edit invalidates the artifact — any
  cut paint shifts the silence gaps and forces a re-render + re-encode + blob
  lifecycle) and *sequential `<audio>` src-swapping* (gaps at joins, clock
  drift, scrubbing across pieces stalls on network). Instead: fetch +
  `decodeAudioData` each clip **once, cached by `audioUrl`** (re-voicing changes
  the URL → automatic invalidation; cut edits re-fetch nothing), then schedule
  one `AudioBufferSourceNode` per clip at its plan offset. Silence is just…
  nothing scheduled. Clock = `AudioContext.currentTime` math — sample-accurate,
  runs even with zero nodes (an all-silent scene previews fine).
- **Flipbook frames: reuse the sprite filmstrip, no new image work.** The same
  `buildFilmstrip([...scene.sheets, ...globalSheets])` / `frameAt()` /
  `spriteStyle()` machinery as the diff gutter (story 03e), looked up at the
  output clock mapped back to original-video seconds. Per-scene 1 s-interval
  sheets win inside the scene, so the flipbook is dense where it matters.
- **Per-scene first, generic underneath.** The dialog previews the selected
  scene, but every pure piece takes an `AssemblePlan`, so a future full-movie
  preview just feeds a concatenated plan. Not built now.
- **Modal player** (producer's choice): a native `<dialog>` lightbox, same
  `showModal()` pattern as `ContactDialog.tsx`. All state transient — nothing in
  Redux, nothing persisted, no object URLs to manage.

## Scope of changes

### 1. Pure timeline lib — `src/lib/export/preview.ts` (+ `preview.test.ts`)

No DOM or Web Audio imports; pure functions over `AssemblePlan`:

- **`audioEvents(plan, segments)`** → `{ segmentIndex, audioUrl, offset,
  duration }[]`. Walk `plan.audio` in order accumulating output-time offsets:
  silence pieces just advance the clock; clip pieces emit an event at the
  current offset with `duration = piece.audioSeconds` (already clamped ≤ the
  slot by `planAssembly`) and `audioUrl` from `segments[piece.segmentIndex]`.
  Pieces whose segment has no `audioUrl` never occur (`planAssembly` already
  emits silence for them).
- **`sourceTimeAt(plan, t, sceneStart)`** → original-video seconds for the
  filmstrip. Walk `plan.video` accumulating piece lengths; when `t` lands in a
  piece, return `sceneStart + piece.start + (t − acc)`. `t` clamps to
  `[0, plan.duration]`; an empty plan returns `sceneStart`.
- **`scheduleFrom(events, offset)`** → the seek math, shaped for
  `AudioBufferSourceNode.start(when, bufferOffset, duration)`: events starting
  later get `{ when: event.offset − offset, bufferOffset: 0, duration }`;
  mid-flight events get `{ when: 0, bufferOffset: offset − event.offset,
  duration: event.duration − bufferOffset }`; events already finished are
  dropped.

### 2. Audio transport — `src/components/Studio/usePreviewTransport.ts`

The ~40 lines of transport we own (thin shell; the math above is the tested
part):

- **Module-level cache** `Map<audioUrl, Promise<AudioBuffer>>`: fetch →
  `decodeAudioData` on a lazily-created shared `AudioContext`. A clip that
  fails to fetch/decode resolves to `null` → plays as silence (matches the
  assembler's "never reference a missing input") and is counted so the UI can
  show a small warning.
- **`play(offset)`**: await the needed buffers (cached after first open),
  `resume()` the context, schedule nodes per `scheduleFrom`, remember
  `startedAt = ctx.currentTime − offset`. **`clock()`** =
  `ctx.currentTime − startedAt`, clamped to `plan.duration`; reaching the end
  stops and fires `onEnded`.
- **`pause()` / `seek(t)`**: stop all live nodes (ignore the already-stopped
  throw), remember the offset; seek while playing = stop + reschedule from `t`.
- Unmount/close stops everything. The context is created on first play (after a
  user gesture), never on mount.

### 3. Flipbook dialog — `src/components/Studio/ScenePreviewDialog.tsx`

Native `<dialog>` + `showModal()` (the `ContactDialog` pattern), Tailwind only:

- On open, compute `plan = planScene({ segments: effectiveSegments(scene),
  cuts: effectiveCuts(scene), start, end })` and the filmstrip
  `buildFilmstrip([...(scene.sheets ?? []), ...globalSheets])` (memoized).
- An rAF loop while playing reads `transport.clock()` → `sourceTimeAt` →
  `frameAt()` → `spriteStyle(frame, ~640px)` renders the big flipbook frame.
- **Controls:** play/pause, a scrub track (click/drag → `seek`) with narration
  spans tinted the grid's voiced **green** and silence neutral (bands computed
  from `audioEvents` over `plan.duration`), and a `0:12 / 1:01` readout.
- **Notes row:** "N segment(s) not voiced — silent in preview" when applicable;
  decode-failure count if any.
- **Edge cases:** no usable sheets → placeholder panel ("no frames captured
  yet") with audio still playable; `plan.duration ≤ 0` (everything cut) →
  disabled play + message; closing (✕ / Esc / backdrop) pauses the transport
  and cancels the rAF.

The name avoids the existing `PreviewPlayer.tsx` (the cut-skipping `<video>` at
the top of the workspace), which is unrelated and unchanged.

### 4. Wiring — `SceneAssembleBar.tsx` (+ `src/pages/Studio.tsx`)

A **Preview** button beside Assemble/Re-assemble — the instant path next to the
render — opens the dialog. `SceneAssembleBar` renders the dialog and receives
the global contact sheets from `Studio.tsx` (already in the studio slice).
Preview is **not** gated on overlaps or built status (it's how you find
problems); the 03h assemble gate is unchanged.

## Out of scope (YAGNI)

- **Full-movie preview** — the pure layer is plan-generic on purpose; the
  concat-of-plans dialog is a later story.
- **Smooth video** — this is a flipbook of sampled frames (1 s interval inside
  a refined scene, 5 s outside), not decoded video. That's the point.
- **Playing the original (non-narration) audio in dead space** — dead space is
  silent, exactly like the export.
- **Persisting anything** — no stitched artifact, no Redux state, no uploads.

## Testing

- `preview.test.ts`: `audioEvents` (offsets across silence/clip runs, clamp via
  `audioSeconds`), `sourceTimeAt` (identity with no cuts, jump across a cut,
  boundary + clamp + empty plan), `scheduleFrom` (future / mid-flight /
  finished events).
- Transport math is covered by `scheduleFrom`; the Web Audio shell stays thin.
- A light `ScenePreviewDialog` test with the transport mocked (jsdom has no
  `AudioContext`): opens, shows the unvoiced note, play calls the transport.
- `npm run build`, `npm run lint`, `npm run test:run` green. One PR.
