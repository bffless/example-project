/**
 * Assemble — the pure plan for the final cut (story 05).
 *
 * The whole render is **one walk of the original timeline**. There is one source
 * video and two flat lists (gathered across every scene's effective layer):
 * `cuts[]` (footage spans to drop) and `segments[]` (the re-voiced narration
 * clips, each anchored to original-video seconds). Every slice of the timeline is
 * in exactly one of three states, and that state decides what it contributes:
 *
 *   | state   | the slice is…                       | video   | audio          |
 *   |---------|-------------------------------------|---------|----------------|
 *   | cut     | inside a `cuts[]` span              | dropped | —              |
 *   | segment | inside a `segments[]` span, not cut | kept    | that clip      |
 *   | dead    | neither cut nor segment             | kept    | silence        |
 *
 * **Cut wins on overlap** — where a segment and a cut overlap, the cut removes
 * that footage, so a segment's kept video is its span minus the cuts inside it.
 *
 * Because the video track (kept footage) and the audio track (segment clips +
 * silence) are built from the **same walk**, they come out the same length and in
 * sync automatically — no footage-fit, no stretching (the edit UI already keeps
 * each kept span's audio ≤ its video). The one robustness step we DO take is
 * per-segment: pad (or, rarely, trim) the audio clip to its kept-video length so
 * the two tracks line up to the millisecond.
 *
 * **Trailing dead space is honored, not trimmed.** Whatever footage the producer
 * left uncut past the last segment is kept as silent video, so the export matches
 * what the diff grid shows. We walk `[0, duration]` regardless of where the
 * scenes/segments stop, so a tail with no narration just becomes a `dead` slice.
 *
 * This module is **pure** (no ffmpeg import) and unit-tested. ffmpeg.wasm is a
 * dumb executor of the command this builds — see `./ffmpeg.ts`.
 */

import type { Cut } from '../scenes'

/** Float slop for boundary/zero-length comparisons (matches the refiner's). */
const EPS = 0.001

/** A segment as assemble needs it: its span plus, once voiced, the audio clip. */
export type AssembleSegment = {
  start: number
  end: number
  /** Serve path / data URL of this run's audio, once voiced. Absent → silence. */
  audioUrl?: string
  /** Real measured length of that audio clip, in seconds. */
  audioSeconds?: number
}

export type AssembleInput = {
  /** Every scene's effective narration segments, flat and in timeline order. */
  segments: AssembleSegment[]
  /** Every scene's effective cuts, flat. */
  cuts: Cut[]
  /** Source clip length in seconds — the timeline we walk is `[0, duration]`. */
  duration: number
}

/** One slice of the original timeline, tagged with the state that owns it. */
export type Slice =
  | { kind: 'cut'; start: number; end: number }
  | { kind: 'dead'; start: number; end: number }
  | { kind: 'segment'; start: number; end: number; segmentIndex: number }

/** A piece of kept source footage to concat into the video track. */
export type VideoPiece = { start: number; end: number }

/** A piece of the audio track: a segment's clip (padded to `length`) or silence. */
export type AudioPiece =
  | { kind: 'clip'; segmentIndex: number; length: number }
  | { kind: 'silence'; length: number }

export type AssemblePlan = {
  slices: Slice[]
  /** Kept footage, in order — each a `trim` of the source. Sums to `duration`. */
  video: VideoPiece[]
  /** The audio track, in order. Sums to the same `duration` as the video. */
  audio: AudioPiece[]
  /** Total output length: the source minus all cut footage. */
  duration: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * Walk the original timeline `[0, duration]` and tag every slice cut / segment /
 * dead. Boundaries are the clip ends plus every cut and segment edge; between two
 * adjacent boundaries the state is constant, so we classify each slice by its
 * midpoint. **Cut wins**: a midpoint inside any cut is `cut` even if a segment
 * also covers it. Adjacent slices of the same state (same segment, for segments)
 * are coalesced so the plan stays tidy.
 */
export function buildSlices({ segments, cuts, duration }: AssembleInput): Slice[] {
  if (!Number.isFinite(duration) || duration <= 0) return []

  const segs = segments
    .map((s) => ({ start: clamp(s.start, 0, duration), end: clamp(s.end, 0, duration) }))
    .filter((s) => s.end - s.start > EPS)
  const drops = cuts
    .map((c) => ({ start: clamp(c.start, 0, duration), end: clamp(c.end, 0, duration) }))
    .filter((c) => c.end - c.start > EPS)

  const bounds = new Set<number>([0, duration])
  for (const s of segs) {
    bounds.add(s.start)
    bounds.add(s.end)
  }
  for (const c of drops) {
    bounds.add(c.start)
    bounds.add(c.end)
  }
  const sorted = [...bounds].sort((a, b) => a - b)

  const out: Slice[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i]
    const end = sorted[i + 1]
    if (end - start <= EPS) continue
    const mid = (start + end) / 2

    let slice: Slice
    if (drops.some((c) => mid >= c.start && mid <= c.end)) {
      slice = { kind: 'cut', start, end }
    } else {
      // Segments don't overlap, so at most one owns the midpoint.
      const idx = segs.findIndex((s) => mid >= s.start && mid <= s.end)
      slice = idx === -1 ? { kind: 'dead', start, end } : { kind: 'segment', start, end, segmentIndex: idx }
    }

    const last = out[out.length - 1]
    const sameRun =
      last &&
      last.kind === slice.kind &&
      (slice.kind !== 'segment' || last.kind !== 'segment' || last.segmentIndex === slice.segmentIndex)
    if (sameRun) last.end = end
    else out.push(slice)
  }
  return out
}

/**
 * Turn an input into the ordered video + audio pieces ffmpeg concatenates.
 *
 * - **Video** = every non-cut slice as its own source `trim`. A segment split by
 *   an internal cut keeps its two kept sub-spans as two separate trims (they're
 *   discontinuous in the source), which become contiguous once the cut is removed.
 * - **Audio** = walk the same kept slices: a `dead` slice → silence of its length;
 *   consecutive slices of one segment → a single clip piece whose `length` is
 *   their total kept-video length (so the clip, padded to that, covers the
 *   segment's whole kept region). A segment with no `audioUrl` (not voiced) →
 *   silence, so the graph never references a missing input.
 *
 * Both tracks sum to the same `duration`, so they're equal length by construction.
 */
export function planAssembly(input: AssembleInput): AssemblePlan {
  const slices = buildSlices(input)
  const kept = slices.filter((s) => s.kind !== 'cut')

  const video: VideoPiece[] = kept.map((s) => ({ start: s.start, end: s.end }))

  const audio: AudioPiece[] = []
  for (let i = 0; i < kept.length; ) {
    const s = kept[i]
    if (s.kind === 'dead') {
      audio.push({ kind: 'silence', length: s.end - s.start })
      i++
      continue
    }
    // s.kind === 'segment' — gather consecutive kept slices of this same segment.
    const idx = s.segmentIndex
    let length = 0
    while (i < kept.length) {
      const k = kept[i]
      if (k.kind !== 'segment' || k.segmentIndex !== idx) break
      length += k.end - k.start
      i++
    }
    const seg = input.segments[idx]
    const voiced = !!seg?.audioUrl
    audio.push(voiced ? { kind: 'clip', segmentIndex: idx, length } : { kind: 'silence', length })
  }

  const duration = video.reduce((n, v) => n + (v.end - v.start), 0)
  return { slices, video, audio, duration }
}

/** Trim trailing zeros off a fixed-precision seconds value for the filter graph. */
function secs(v: number): string {
  return Number(v.toFixed(3)).toString()
}

export type FfmpegCommand = {
  /** The `filter_complex` graph string. */
  filterComplex: string
  /** The full ffmpeg argv (source is input 0, clips follow in `audioInputs` order). */
  args: string[]
  /** The segment index behind each extra audio input, in `-i` order. The executor
   *  provides one file per entry (`a0.wav`, `a1.wav`, …). */
  audioInputs: number[]
}

/** Common output audio format — every clip is resampled to this before concat. */
const SAMPLE_RATE = 48000

/**
 * Build the ffmpeg invocation from a plan. The video track trims + concats the
 * kept footage; the audio track resamples each clip to a common format, pads it
 * to its piece length (silence fills any tail where the kept video runs longer
 * than the narration), and concats those with generated silence for dead space.
 *
 * Single-threaded-friendly (libx264 `ultrafast`); no loudnorm/crossfades yet —
 * those are the tracked follow-up.
 */
export function buildFfmpegCommand(
  plan: AssemblePlan,
  opts: { source?: string; output?: string } = {},
): FfmpegCommand {
  const source = opts.source ?? 'source.mp4'
  const output = opts.output ?? 'out.mp4'
  const parts: string[] = []

  plan.video.forEach((v, i) => {
    parts.push(`[0:v]trim=${secs(v.start)}:${secs(v.end)},setpts=PTS-STARTPTS[v${i}]`)
  })
  const vlabels = plan.video.map((_, i) => `[v${i}]`).join('')
  parts.push(`${vlabels}concat=n=${plan.video.length}:v=1:a=0[vout]`)

  const audioInputs: number[] = []
  let inputIdx = 1 // input 0 is the source video
  plan.audio.forEach((a, i) => {
    if (a.kind === 'silence') {
      parts.push(`anullsrc=r=${SAMPLE_RATE}:cl=mono,atrim=0:${secs(a.length)},asetpts=PTS-STARTPTS[a${i}]`)
    } else {
      const j = inputIdx++
      audioInputs.push(a.segmentIndex)
      parts.push(
        `[${j}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=mono,` +
          `apad,atrim=0:${secs(a.length)},asetpts=PTS-STARTPTS[a${i}]`,
      )
    }
  })
  const alabels = plan.audio.map((_, i) => `[a${i}]`).join('')
  parts.push(`${alabels}concat=n=${plan.audio.length}:v=0:a=1[aout]`)

  const filterComplex = parts.join(';')
  const args = [
    '-i',
    source,
    ...audioInputs.flatMap((_, k) => ['-i', `a${k}.wav`]),
    '-filter_complex',
    filterComplex,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    output,
  ]
  return { filterComplex, args, audioInputs }
}
