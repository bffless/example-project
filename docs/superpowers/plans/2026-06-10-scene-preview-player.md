# Scene Preview Player (story 03i) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A modal flipbook preview that plays a scene's stitched narration (Web Audio scheduling, no ffmpeg) while flipping the already-captured contact-sheet frames in sync, simulating the exact `planScene()` plan the assembler renders.

**Architecture:** Three layers. (1) Pure, unit-tested timeline math in `src/lib/export/preview.ts` over the existing `AssemblePlan` — clip offsets on the output timeline, output-time → source-time mapping for frames, and seek math shaped for `AudioBufferSourceNode.start()`. (2) A thin Web Audio transport hook (`usePreviewTransport`) with a module-level decoded-buffer cache keyed by `audioUrl` (re-voicing changes the URL → automatic invalidation). (3) A native `<dialog>` component (`ScenePreviewDialog`) that runs an rAF loop: transport clock → `sourceTimeAt` → `frameAt` → `spriteStyle`. Wired in via a Preview button in `SceneAssembleBar`.

**Tech Stack:** React 19 + TypeScript (strict: `verbatimModuleSyntax`, `noUnusedLocals/Parameters`, `erasableSyntaxOnly`), Vitest + Testing Library (jsdom), Tailwind v4 utilities (no custom CSS), Web Audio API. No new dependencies, no `/api/*`, no Redux changes.

**Spec:** `stories/inprogress/studio/03i-scene-preview-player.md`. Branch: `feat/studio-scene-preview` (already created, design committed).

**Existing building blocks (read these signatures, don't re-derive):**
- `planScene({segments, cuts, start, end})` → `AssemblePlan { slices, video: VideoPiece[], audio: AudioPiece[], duration }` in `src/lib/export/assemble.ts:318`. Video pieces are clip-local `{start, end}` source spans; audio pieces are `{kind:'clip', segmentIndex, length, audioSeconds}` or `{kind:'silence', length}`, both tracks sum to `duration`. `planAssembly` already clamps `audioSeconds ≤ length` and emits silence for unvoiced segments.
- `effectiveSegments(scene)` / `effectiveCuts(scene)` in `src/lib/refiner.ts` (see `SceneAssembleBar.tsx:62-66` for usage).
- `buildFilmstrip(sheets)` / `frameAt(frames, time)` / `spriteStyle(frame, width)` in `src/lib/filmstrip.ts` — `frameAt` is nearest-by-time over original-video seconds; `spriteStyle` returns a complete `CSSProperties` crop of one sheet cell scaled to `width`.
- Dialog pattern: `src/components/ContactDialog.tsx:20-54` (`showModal()` on `open`, `cancel`/`close` listeners, backdrop click closes).

---

### Task 1: Pure lib — `audioEvents` (where each clip lands on the output timeline)

**Files:**
- Create: `src/lib/export/preview.ts`
- Test: `src/lib/export/preview.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/export/preview.test.ts
import { describe, it, expect } from 'vitest'
import { planScene, type AssemblePlan } from './assemble'
import { audioEvents } from './preview'

/** A voiced segment (has an audio clip) over `[start, end]`, original-video seconds. */
function seg(start: number, end: number, audioSeconds = end - start) {
  return { start, end, audioUrl: `clip-${start}-${end}.wav`, audioSeconds }
}

describe('audioEvents — clip offsets on the output timeline', () => {
  it('a clip after leading dead space starts at the dead-space length', () => {
    // Scene [0,10]: dead 0–4, segment 4–8 (4s clip), dead 8–10.
    const segments = [seg(4, 8)]
    const plan = planScene({ segments, cuts: [], start: 0, end: 10 })
    expect(audioEvents(plan, segments)).toEqual([
      { segmentIndex: 0, audioUrl: 'clip-4-8.wav', offset: 4, duration: 4 },
    ])
  })

  it('a cut before a clip pulls its offset earlier (cut footage is dropped)', () => {
    // Cut 0–3, segment 4–8 → output: dead 3–4 (1s), then the clip at offset 1.
    const segments = [seg(4, 8)]
    const plan = planScene({ segments, cuts: [{ start: 0, end: 3 }], start: 0, end: 10 })
    expect(audioEvents(plan, segments)).toEqual([
      { segmentIndex: 0, audioUrl: 'clip-4-8.wav', offset: 1, duration: 4 },
    ])
  })

  it('clip duration is the plan audioSeconds (already clamped to the slot)', () => {
    // 6s slot but only a 2.5s clip → plays 2.5s, the rest of the slot is silent padding.
    const segments = [seg(0, 6, 2.5)]
    const plan = planScene({ segments, cuts: [], start: 0, end: 6 })
    expect(audioEvents(plan, segments)).toEqual([
      { segmentIndex: 0, audioUrl: 'clip-0-6.wav', offset: 0, duration: 2.5 },
    ])
  })

  it('unvoiced segments produce no event (planAssembly already made them silence)', () => {
    const segments = [{ start: 0, end: 4 }, seg(6, 10)]
    const plan = planScene({ segments, cuts: [], start: 0, end: 10 })
    expect(audioEvents(plan, segments)).toEqual([
      { segmentIndex: 1, audioUrl: 'clip-6-10.wav', offset: 6, duration: 4 },
    ])
  })

  it('defensive: a clip piece whose segment lost its url is skipped, offsets intact', () => {
    // Hand-built plan (not via planScene) — the url lookup must not throw.
    const plan: AssemblePlan = {
      slices: [],
      video: [{ start: 0, end: 10 }],
      audio: [
        { kind: 'clip', segmentIndex: 0, length: 4, audioSeconds: 4 },
        { kind: 'clip', segmentIndex: 1, length: 6, audioSeconds: 6 },
      ],
      duration: 10,
    }
    const segments = [{ start: 0, end: 4 }, seg(4, 10)]
    expect(audioEvents(plan, segments)).toEqual([
      { segmentIndex: 1, audioUrl: 'clip-4-10.wav', offset: 4, duration: 6 },
    ])
  })

  it('scene-rebased plans keep working (planScene shifts to clip-local time)', () => {
    // Scene [100,110], segment 102–106 → clip-local: dead 0–2, clip at offset 2.
    const segments = [seg(102, 106)]
    const plan = planScene({ segments, cuts: [], start: 100, end: 110 })
    expect(audioEvents(plan, segments)).toEqual([
      { segmentIndex: 0, audioUrl: 'clip-102-106.wav', offset: 2, duration: 4 },
    ])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/export/preview.test.ts`
Expected: FAIL — `Cannot find module './preview'` (or "audioEvents is not a function").

- [ ] **Step 3: Implement `preview.ts` with `audioEvents`**

```typescript
// src/lib/export/preview.ts
/**
 * Preview — pure timeline math for the scene preview player (story 03i).
 *
 * The preview SIMULATES an `AssemblePlan` (the same pure plan ffmpeg renders —
 * see ./assemble.ts) with zero rendering: narration clips are scheduled on a
 * Web Audio clock at their output-timeline offsets, and the flipbook maps the
 * output clock back to original-video seconds to pick a contact-sheet frame.
 * This module is pure (no DOM, no Web Audio) and unit-tested; the transport
 * hook and the dialog are thin shells over it.
 */

import type { AssemblePlan } from './assemble'

/** A segment as the preview needs it — just the voiced clip, if any. */
export type PreviewSegment = { audioUrl?: string }

/** One narration clip placed on the output timeline. */
export type AudioEvent = {
  segmentIndex: number
  audioUrl: string
  /** Output-timeline second this clip starts at. */
  offset: number
  /** Seconds of the clip that play (planAssembly already clamped ≤ its slot). */
  duration: number
}

/**
 * Walk `plan.audio` accumulating output time: silence pieces just advance the
 * clock; clip pieces emit an event at the current offset. A clip piece whose
 * segment has no `audioUrl` is skipped (planAssembly never emits those, but a
 * hand-built or stale plan must degrade to silence, not throw — the same
 * "never reference a missing input" rule the assembler follows).
 */
export function audioEvents(plan: AssemblePlan, segments: PreviewSegment[]): AudioEvent[] {
  const events: AudioEvent[] = []
  let t = 0
  for (const piece of plan.audio) {
    if (piece.kind === 'clip') {
      const audioUrl = segments[piece.segmentIndex]?.audioUrl
      if (audioUrl) {
        events.push({ segmentIndex: piece.segmentIndex, audioUrl, offset: t, duration: piece.audioSeconds })
      }
    }
    t += piece.length
  }
  return events
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/export/preview.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/preview.ts src/lib/export/preview.test.ts
git commit -m "feat(studio): preview timeline lib — audioEvents (story 03i)"
```

---

### Task 2: Pure lib — `sourceTimeAt` (output clock → original-video seconds)

**Files:**
- Modify: `src/lib/export/preview.ts`
- Test: `src/lib/export/preview.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/lib/export/preview.test.ts` (add `sourceTimeAt` to the existing `./preview` import):

```typescript
describe('sourceTimeAt — output clock → original-video seconds for the flipbook', () => {
  it('with no cuts the mapping is identity (plus the scene offset)', () => {
    const plan = planScene({ segments: [seg(0, 10)], cuts: [], start: 0, end: 10 })
    expect(sourceTimeAt(plan, 3, 0)).toBe(3)
    expect(sourceTimeAt(plan, 3, 100)).toBe(103)
  })

  it('jumps across a cut: output time past the first kept piece lands after the cut', () => {
    // Kept 0–5, cut 5–8, kept 8–10 → output [0,7]; t=5 is the cut boundary → source 8.
    const plan = planScene({ segments: [seg(0, 10)], cuts: [{ start: 5, end: 8 }], start: 0, end: 10 })
    expect(sourceTimeAt(plan, 4, 0)).toBe(4)
    expect(sourceTimeAt(plan, 5, 0)).toBe(5) // boundary belongs to the earlier piece's end
    expect(sourceTimeAt(plan, 6, 0)).toBe(9) // 1s into the second kept piece (starts at 8)
  })

  it('clamps t to [0, duration]', () => {
    const plan = planScene({ segments: [seg(0, 10)], cuts: [{ start: 5, end: 8 }], start: 0, end: 10 })
    expect(sourceTimeAt(plan, -1, 0)).toBe(0)
    expect(sourceTimeAt(plan, 99, 0)).toBe(10) // end of the last kept piece
  })

  it('an empty plan returns the scene start', () => {
    const plan = planScene({ segments: [], cuts: [{ start: 0, end: 10 }], start: 0, end: 10 })
    expect(sourceTimeAt(plan, 0, 100)).toBe(100)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/export/preview.test.ts`
Expected: FAIL — `sourceTimeAt` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/export/preview.ts`:

```typescript
/**
 * Map an output-timeline second to ORIGINAL-VIDEO seconds, for the filmstrip
 * lookup. Walks `plan.video` (kept source spans, clip-local time) accumulating
 * piece lengths; `sceneStart` lifts the clip-local result back to the original
 * timeline (`planScene` rebased everything by subtracting it). `t` clamps to
 * `[0, plan.duration]`; an all-cut plan (no video) returns `sceneStart`.
 */
export function sourceTimeAt(plan: AssemblePlan, t: number, sceneStart: number): number {
  const last = plan.video[plan.video.length - 1]
  if (!last) return sceneStart
  const clamped = Math.min(Math.max(t, 0), plan.duration)
  let acc = 0
  for (const piece of plan.video) {
    const len = piece.end - piece.start
    if (clamped <= acc + len) return sceneStart + piece.start + (clamped - acc)
    acc += len
  }
  return sceneStart + last.end
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/export/preview.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/preview.ts src/lib/export/preview.test.ts
git commit -m "feat(studio): preview timeline lib — sourceTimeAt (story 03i)"
```

---

### Task 3: Pure lib — `scheduleFrom` (the seek math)

**Files:**
- Modify: `src/lib/export/preview.ts`
- Test: `src/lib/export/preview.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/lib/export/preview.test.ts` (add `scheduleFrom` and `type AudioEvent` to the `./preview` import):

```typescript
describe('scheduleFrom — which clips play (and from where) when starting at an offset', () => {
  const events: AudioEvent[] = [
    { segmentIndex: 0, audioUrl: 'a.wav', offset: 2, duration: 4 }, // plays [2,6]
    { segmentIndex: 1, audioUrl: 'b.wav', offset: 8, duration: 3 }, // plays [8,11]
  ]

  it('offset 0: everything is in the future, untouched', () => {
    expect(scheduleFrom(events, 0)).toEqual([
      { event: events[0], when: 2, bufferOffset: 0, duration: 4 },
      { event: events[1], when: 8, bufferOffset: 0, duration: 3 },
    ])
  })

  it('mid-flight: a clip already playing starts now, partway into its buffer', () => {
    expect(scheduleFrom(events, 4)).toEqual([
      { event: events[0], when: 0, bufferOffset: 2, duration: 2 },
      { event: events[1], when: 4, bufferOffset: 0, duration: 3 },
    ])
  })

  it('finished clips are dropped (including exactly-at-end)', () => {
    expect(scheduleFrom(events, 6)).toEqual([
      { event: events[1], when: 2, bufferOffset: 0, duration: 3 },
    ])
  })

  it('a clip starting exactly at the offset plays immediately from its top', () => {
    expect(scheduleFrom(events, 8)).toEqual([
      { event: events[1], when: 0, bufferOffset: 0, duration: 3 },
    ])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/export/preview.test.ts`
Expected: FAIL — `scheduleFrom` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/export/preview.ts`:

```typescript
/** An event ready for `AudioBufferSourceNode.start(base + when, bufferOffset, duration)`. */
export type ScheduledEvent = {
  event: AudioEvent
  /** Seconds from "now" until this clip starts (0 = immediately). */
  when: number
  /** Seconds into the clip's buffer to start from (mid-flight seek). */
  bufferOffset: number
  /** Seconds of the buffer to play. */
  duration: number
}

/**
 * The seek math: given playback starting at output-second `offset`, future
 * events keep their relative delay, an event already underway starts now but
 * partway into its buffer, and an event that already finished is dropped.
 */
export function scheduleFrom(events: AudioEvent[], offset: number): ScheduledEvent[] {
  const out: ScheduledEvent[] = []
  for (const event of events) {
    if (event.offset >= offset) {
      out.push({ event, when: event.offset - offset, bufferOffset: 0, duration: event.duration })
    } else {
      const into = offset - event.offset
      if (into < event.duration) {
        out.push({ event, when: 0, bufferOffset: into, duration: event.duration - into })
      }
    }
  }
  return out
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/export/preview.test.ts`
Expected: 14 passed.

- [ ] **Step 5: Run the full unit suite (no regressions)**

Run: `npm run test:run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/export/preview.ts src/lib/export/preview.test.ts
git commit -m "feat(studio): preview timeline lib — scheduleFrom seek math (story 03i)"
```

---

### Task 4: Web Audio transport — `usePreviewTransport`

The thin shell over the tested math. No unit test for this file (jsdom has no `AudioContext`; the schedule math it leans on is covered by Task 3) — keep it free of logic beyond node lifecycle.

**Files:**
- Create: `src/components/Studio/usePreviewTransport.ts`

- [ ] **Step 1: Write the hook**

```typescript
// src/components/Studio/usePreviewTransport.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { scheduleFrom, type AudioEvent } from '../../lib/export/preview'

/**
 * Decoded narration clips, cached for the whole session by serve URL. Voicing a
 * segment again mints a NEW url, so stale entries are simply never asked for
 * again — no invalidation logic. Cut/move edits change only offsets (pure math),
 * so re-opening the preview after an edit re-fetches nothing.
 */
const bufferCache = new Map<string, Promise<AudioBuffer | null>>()

/** One lazily-created context for every preview (browsers cap the count). */
let sharedCtx: AudioContext | null = null
function audioCtx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext()
  return sharedCtx
}

/** Fetch + decode one clip; a failure resolves to null → that clip is silence
 *  in the preview (the assembler's "never reference a missing input" rule). */
function loadBuffer(url: string): Promise<AudioBuffer | null> {
  let p = bufferCache.get(url)
  if (!p) {
    p = fetch(url, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.arrayBuffer()
      })
      .then((bytes) => audioCtx().decodeAudioData(bytes))
      .catch(() => null)
    bufferCache.set(url, p)
  }
  return p
}

export type PreviewTransport = {
  playing: boolean
  /** Buffers are being fetched/decoded (first play of new clips only). */
  loading: boolean
  /** Clips that failed to fetch/decode — they play as silence. */
  failed: number
  /** Current output-timeline position, in seconds. Safe to call every rAF. */
  clock: () => number
  /** Play from the current position (or restart from 0 when at the end) / pause. */
  toggle: () => void
  /** Jump to output-second `t`; keeps playing if playing, else just re-positions. */
  seek: (t: number) => void
  /** Hard stop — close/unmount. Keeps the position. */
  stop: () => void
}

/**
 * Schedules `events` (from `audioEvents`) on the shared AudioContext and owns
 * the transport clock. The context clock runs even with zero nodes scheduled,
 * so an all-silent scene previews fine. All state is transient.
 */
export function usePreviewTransport(events: AudioEvent[], duration: number): PreviewTransport {
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(0)

  const playingRef = useRef(false)
  const offsetRef = useRef(0)
  const startedAtRef = useRef(0)
  const nodesRef = useRef<AudioBufferSourceNode[]>([])
  const endTimerRef = useRef<number | null>(null)
  /** Bumped to cancel an in-flight async play (pause/seek/unmount raced it). */
  const tokenRef = useRef(0)

  const setIsPlaying = (v: boolean) => {
    playingRef.current = v
    setPlaying(v)
  }

  const stopNodes = () => {
    for (const node of nodesRef.current) {
      try {
        node.stop()
      } catch {
        /* already stopped/never started — fine */
      }
    }
    nodesRef.current = []
    if (endTimerRef.current !== null) {
      clearTimeout(endTimerRef.current)
      endTimerRef.current = null
    }
  }

  const clock = useCallback(() => {
    if (!playingRef.current || !sharedCtx) return offsetRef.current
    return Math.min(Math.max(sharedCtx.currentTime - startedAtRef.current, 0), duration)
  }, [duration])

  const halt = useCallback(() => {
    tokenRef.current++
    offsetRef.current = clock()
    stopNodes()
    setIsPlaying(false)
    setLoading(false)
  }, [clock])

  const play = useCallback(
    async (offset: number) => {
      const token = ++tokenRef.current
      setLoading(true)
      const pairs = await Promise.all(
        events.map(async (e) => [e.audioUrl, await loadBuffer(e.audioUrl)] as const),
      )
      if (token !== tokenRef.current) return
      setLoading(false)
      setFailed(pairs.filter(([, buf]) => !buf).length)
      const buffers = new Map(pairs)

      const ctx = audioCtx()
      await ctx.resume()
      if (token !== tokenRef.current) return

      // A small lead so every node's start time is still in the future when set.
      const base = ctx.currentTime + 0.05
      for (const s of scheduleFrom(events, offset)) {
        const buffer = buffers.get(s.event.audioUrl)
        if (!buffer) continue
        const node = ctx.createBufferSource()
        node.buffer = buffer
        node.connect(ctx.destination)
        node.start(base + s.when, s.bufferOffset, s.duration)
        nodesRef.current.push(node)
      }
      startedAtRef.current = base - offset
      offsetRef.current = offset
      setIsPlaying(true)

      const remaining = Math.max(0, duration - offset)
      endTimerRef.current = window.setTimeout(
        () => {
          stopNodes()
          offsetRef.current = duration
          setIsPlaying(false)
        },
        remaining * 1000 + 100,
      )
    },
    [events, duration],
  )

  const toggle = useCallback(() => {
    if (playingRef.current) {
      halt()
      return
    }
    const from = offsetRef.current >= duration ? 0 : offsetRef.current
    void play(from)
  }, [duration, halt, play])

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.min(Math.max(t, 0), duration)
      if (playingRef.current) {
        tokenRef.current++
        stopNodes()
        setIsPlaying(false)
        void play(clamped)
      } else {
        offsetRef.current = clamped
      }
    },
    [duration, play],
  )

  // Hard stop on unmount (dialog closed) so nothing keeps playing.
  const stop = halt
  useEffect(() => () => halt(), [halt])

  return { playing, loading, failed, clock, toggle, seek, stop }
}
```

- [ ] **Step 2: Verify it compiles + lints**

Run: `npx tsc -b && npm run lint`
Expected: clean (`noUnusedLocals` is strict — everything above is used).

- [ ] **Step 3: Commit**

```bash
git add src/components/Studio/usePreviewTransport.ts
git commit -m "feat(studio): Web Audio preview transport with decoded-buffer cache (story 03i)"
```

---

### Task 5: Flipbook dialog — `ScenePreviewDialog`

**Files:**
- Create: `src/components/Studio/ScenePreviewDialog.tsx`
- Test: `src/components/Studio/ScenePreviewDialog.test.tsx`

- [ ] **Step 1: Write the failing component test (transport mocked — jsdom has no AudioContext)**

```typescript
// src/components/Studio/ScenePreviewDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Scene } from '../../lib/scenes'
import type { ContactSheet } from '../../lib/frames'
import { ScenePreviewDialog } from './ScenePreviewDialog'

const toggle = vi.fn()
const seek = vi.fn()
const stop = vi.fn()

vi.mock('./usePreviewTransport', () => ({
  usePreviewTransport: () => ({
    playing: false,
    loading: false,
    failed: 0,
    clock: () => 0,
    toggle,
    seek,
    stop,
  }),
}))

function sheet(times: number[]): ContactSheet {
  return {
    dataUrl: '',
    url: 'sheet.jpg',
    times,
    interval: 1,
    width: 104,
    height: 32,
    cols: 2,
    rows: 1,
    cellWidth: 48,
    cellHeight: 27,
    gap: 2,
    count: times.length,
    bytes: 0,
    index: 0,
    total: 1,
  }
}

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    index: 0,
    title: 'Intro',
    start: 0,
    end: 10,
    transcript: 'hello there',
    draftText: 'hello',
    status: 'pending',
    narrationSeconds: null,
    cuts: [],
    refined: {
      source: 'manual',
      cuts: [],
      segments: [
        { text: 'hello', start: 0, end: 4, audioUrl: 'a.mp3', audioSeconds: 4 },
        { text: 'there', start: 6, end: 10 }, // unvoiced
      ],
    },
    ...over,
  }
}

describe('ScenePreviewDialog', () => {
  beforeEach(() => {
    toggle.mockClear()
    seek.mockClear()
  })

  it('opens as a modal with the scene title and flags unvoiced runs', () => {
    render(<ScenePreviewDialog open onClose={() => {}} scene={scene()} sheets={[sheet([0, 5])]} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(/Intro/)).toBeInTheDocument()
    expect(screen.getByText(/1 run unvoiced/)).toBeInTheDocument()
  })

  it('play button drives the transport', () => {
    render(<ScenePreviewDialog open onClose={() => {}} scene={scene()} sheets={[sheet([0, 5])]} />)
    fireEvent.click(screen.getByRole('button', { name: /play/i }))
    expect(toggle).toHaveBeenCalledOnce()
  })

  it('with no usable sheets it shows the no-frames placeholder (audio still previews)', () => {
    render(<ScenePreviewDialog open onClose={() => {}} scene={scene()} sheets={[]} />)
    expect(screen.getByText(/no frames captured/i)).toBeInTheDocument()
  })

  it('an all-cut scene disables play', () => {
    const s = scene({ refined: { source: 'manual', cuts: [{ start: 0, end: 10 }], segments: [] } })
    render(<ScenePreviewDialog open onClose={() => {}} scene={s} sheets={[sheet([0, 5])]} />)
    expect(screen.getByRole('button', { name: /play/i })).toBeDisabled()
  })
})
```

Note: if `Scene`/`ContactSheet` have required fields beyond these, satisfy the type rather than `as` casting — check `src/lib/scenes.ts` / `src/lib/frames.ts` while implementing.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/Studio/ScenePreviewDialog.test.tsx`
Expected: FAIL — module `./ScenePreviewDialog` not found.

- [ ] **Step 3: Implement the dialog**

```tsx
// src/components/Studio/ScenePreviewDialog.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Scene } from '../../lib/scenes'
import type { ContactSheet } from '../../lib/frames'
import { effectiveCuts, effectiveSegments } from '../../lib/refiner'
import { planScene } from '../../lib/export/assemble'
import { audioEvents, sourceTimeAt } from '../../lib/export/preview'
import { buildFilmstrip, frameAt, spriteStyle } from '../../lib/filmstrip'
import { usePreviewTransport } from './usePreviewTransport'

type Props = {
  open: boolean
  onClose: () => void
  scene: Scene
  /** The whole-clip prep contact sheets; the scene's own denser sheets win inside it. */
  sheets: ContactSheet[]
}

const FRAME_WIDTH = 640

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

/**
 * The lightweight preview (story 03i): the assemble plan, simulated — narration
 * stitched on the Web Audio clock, contact-sheet frames flipped in sync. No
 * ffmpeg, nothing rendered, nothing persisted; edit → preview → edit for free.
 */
export function ScenePreviewDialog({ open, onClose, scene, sheets }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    else if (!open && dlg.open) dlg.close()
  }, [open])

  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    const cancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    dlg.addEventListener('cancel', cancel)
    return () => dlg.removeEventListener('cancel', cancel)
  }, [onClose])

  const segments = useMemo(() => effectiveSegments(scene), [scene])
  const plan = useMemo(
    () => planScene({ segments, cuts: effectiveCuts(scene), start: scene.start, end: scene.end }),
    [segments, scene],
  )
  const events = useMemo(() => audioEvents(plan, segments), [plan, segments])
  const frames = useMemo(
    () => buildFilmstrip([...(scene.sheets ?? []), ...sheets]),
    [scene.sheets, sheets],
  )
  const unvoiced = segments.filter((s) => !s.audioUrl).length

  const transport = usePreviewTransport(events, plan.duration)
  const { stop } = transport

  // Pause the audio whenever the dialog closes (✕ / Esc / backdrop).
  useEffect(() => {
    if (!open) stop()
  }, [open, stop])

  // The playhead, advanced by an rAF loop while the dialog is open. clock() is
  // just arithmetic on the AudioContext clock, so polling it every frame is free.
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!open) return
    let raf = 0
    const tick = () => {
      setNow(transport.clock())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, transport])

  const frame = frameAt(frames, sourceTimeAt(plan, now, scene.start))

  // Scrub: pointer-drag anywhere on the track seeks (capture keeps the drag).
  const trackRef = useRef<HTMLDivElement>(null)
  const seekTo = (clientX: number) => {
    const track = trackRef.current
    if (!track || plan.duration <= 0) return
    const rect = track.getBoundingClientRect()
    const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    transport.seek(frac * plan.duration)
  }

  const playable = plan.duration > 0

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-[min(92vw,720px)] rounded-lg border border-paper-line bg-paper p-0 shadow-xl backdrop:bg-ink/70"
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose()
      }}
    >
      <div className="flex items-center justify-between border-b border-paper-line px-5 py-3">
        <p className="meta-label">
          Preview · {scene.title} <span className="text-ink-mute">· instant, no render</span>
        </p>
        <button type="button" className="pill-ghost" onClick={onClose} aria-label="Close preview">
          ✕
        </button>
      </div>

      <div className="flex aspect-video w-full items-center justify-center overflow-hidden bg-ink">
        {frame ? (
          <div style={spriteStyle(frame, FRAME_WIDTH)} />
        ) : (
          <p className="px-6 text-center text-[13px] text-paper">
            No frames captured for this scene yet — the audio still previews.
          </p>
        )}
      </div>

      <div className="px-5 py-4">
        <div
          ref={trackRef}
          className="relative h-6 cursor-pointer overflow-hidden rounded bg-paper-deep"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            seekTo(e.clientX)
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) seekTo(e.clientX)
          }}
        >
          {playable &&
            events.map((ev) => (
              <div
                key={`${ev.segmentIndex}-${ev.offset}`}
                className="absolute inset-y-0 bg-moss/50"
                style={{
                  left: `${(ev.offset / plan.duration) * 100}%`,
                  width: `${(ev.duration / plan.duration) * 100}%`,
                }}
              />
            ))}
          {playable && (
            <div
              className="absolute inset-y-0 w-0.5 bg-terracotta"
              style={{ left: `${(now / plan.duration) * 100}%` }}
            />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="pill-cta"
            disabled={!playable || transport.loading}
            onClick={transport.toggle}
          >
            {transport.loading ? 'Loading audio…' : transport.playing ? 'Pause' : 'Play'}
          </button>
          <span className="font-mono text-[12px] text-ink-mute">
            {fmtTime(now)} / {fmtTime(plan.duration)}
          </span>
          {!playable && (
            <span className="text-[12.5px] text-terracotta-ink">
              Everything in this scene is cut — nothing to preview.
            </span>
          )}
          {unvoiced > 0 && (
            <span className="text-[12.5px] text-terracotta-ink">
              {unvoiced} run{unvoiced === 1 ? '' : 's'} unvoiced → silent here
            </span>
          )}
          {transport.failed > 0 && (
            <span className="text-[12.5px] text-amber-700">
              {transport.failed} clip{transport.failed === 1 ? '' : 's'} failed to load → silent
            </span>
          )}
        </div>
      </div>
    </dialog>
  )
}
```

Implementation notes for the engineer:
- `bg-moss/50` is the voiced-green family used by the diff grid; check `src/index.css` `@theme` for the exact token names (`moss`, `terracotta`, `ink`, `paper-deep`, `paper-line`) and use whatever the grid's voiced/cut paints use — match `TranscriptDiff.tsx`'s class names rather than inventing new ones.
- `spriteStyle(frame, FRAME_WIDTH)` returns the full crop (width, height, background-*) — render it on a bare `div`, centered by the flex parent; the `overflow-hidden` parent clips any rounding overflow.
- Keep the rAF `setNow` as is — the dialog subtree is tiny; do not add throttling machinery.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/components/Studio/ScenePreviewDialog.test.tsx`
Expected: 4 passed. If `showModal` is missing in your jsdom, mirror how `ContactDialog.test.tsx` handles it (it tests the same element) rather than polyfilling ad-hoc.

- [ ] **Step 5: Commit**

```bash
git add src/components/Studio/ScenePreviewDialog.tsx src/components/Studio/ScenePreviewDialog.test.tsx
git commit -m "feat(studio): flipbook scene preview dialog (story 03i)"
```

---

### Task 6: Wire in — Preview button in `SceneAssembleBar`, sheets from `Studio.tsx`

**Files:**
- Modify: `src/components/Studio/SceneAssembleBar.tsx` (props at :7-14, actions row at :168-194)
- Modify: `src/pages/Studio.tsx:570-577` (the `<SceneAssembleBar … />` instance)

- [ ] **Step 1: Add the prop, state, button, and dialog to `SceneAssembleBar.tsx`**

Add to the imports:

```typescript
import type { ContactSheet } from '../../lib/frames'
import { ScenePreviewDialog } from './ScenePreviewDialog'
```

Extend `Props`:

```typescript
type Props = {
  /** The scene whose tab is selected — this bar assembles ONLY this scene. */
  scene: Scene
  /** True while this scene's assembled cut is uploading. */
  saving: boolean
  /** Upload the assembled scene blob → bucket; resolves to its serve URL. */
  onSave: (blob: Blob) => Promise<string>
  /** Whole-clip prep contact sheets, for the preview flipbook. */
  sheets: ContactSheet[]
}
```

In the component (destructure `sheets` too: `{ scene, saving, onSave, sheets }`), add transient dialog state next to the other `useState` calls (the bar is keyed by `scene.id`, so this resets on tab switch):

```typescript
const [previewOpen, setPreviewOpen] = useState(false)
```

In the actions row (`<div className="mt-4 flex flex-wrap items-center gap-3">`), add a Preview button BEFORE the assemble button. Preview needs no clip and ignores the overlap gate — it's how you find problems before paying for a render; it only needs a non-empty plan:

```tsx
<button
  type="button"
  className="pill-ghost"
  disabled={plan.video.length === 0}
  onClick={() => setPreviewOpen(true)}
>
  Preview
</button>
```

At the end of the returned JSX (just inside the closing `</div>` of the bar), render the dialog:

```tsx
<ScenePreviewDialog
  open={previewOpen}
  onClose={() => setPreviewOpen(false)}
  scene={scene}
  sheets={sheets}
/>
```

- [ ] **Step 2: Pass the sheets in `src/pages/Studio.tsx`**

```tsx
<SceneAssembleBar
  key={selected.id}
  scene={selected}
  saving={pipe.savingSceneCutId === selected.id}
  onSave={(blob) => pipe.saveSceneCut(selected.id, blob)}
  sheets={pipe.contactSheets}
/>
```

- [ ] **Step 3: Verify build + lint + full tests**

Run: `npm run build && npm run lint && npm run test:run`
Expected: all green (the build catches any missed prop site since `tsc -b` covers the whole app).

- [ ] **Step 4: Commit**

```bash
git add src/components/Studio/SceneAssembleBar.tsx src/pages/Studio.tsx
git commit -m "feat(studio): Preview button opens the scene preview dialog (story 03i)"
```

---

### Task 7: Story bookkeeping + final verification

**Files:**
- Modify: `stories/inprogress/studio/03i-scene-preview-player.md` (status line)
- Modify: `stories/inprogress/studio/README.md` (03i row)

- [ ] **Step 1: Flip the story status**

In `03i-scene-preview-player.md`, change the status line:

```markdown
**Status:** ✅ implemented (build/lint/tests green; pending PR review) ·
```

In `README.md`, change the 03i row's status cell from `▶ designed, in progress` to `✅ implemented (pending PR)`.

- [ ] **Step 2: Full verification sweep**

Run: `npm run build && npm run lint && npm run test:run`
Expected: all green. (Per repo rules: no browser pixel-polish pass during prototyping.)

- [ ] **Step 3: Commit**

```bash
git add stories/inprogress/studio/03i-scene-preview-player.md stories/inprogress/studio/README.md
git commit -m "docs(studio): mark story 03i implemented"
```

---

## Out of scope (do not build)

- Full-movie preview (the lib is plan-generic on purpose; later story).
- Smooth/decoded video — the flipbook of sampled frames IS the feature.
- Original audio in dead space (dead space is silent, like the export).
- Any persistence, Redux state, MSW mock, or `/api/*` — there is none here.
- Gating preview on overlaps/built status — previewing problems is the point.
