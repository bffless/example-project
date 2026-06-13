/**
 * The master director — the brain of the prep pipeline (story 03).
 *
 * One multimodal AI call (Gemini 3.1 Pro on Replicate) is handed three things:
 *
 *   1. the timestamped transcript (story 02),
 *   2. the director contact sheets — interval-sampled frames with the wall-clock
 *      burned on each (story 03 prep stage), as image input, and
 *   3. optional free-text *direction* the user types ("make it punchy", "keep the
 *      demo at 12:30", …).
 *
 * It returns, as strict JSON, a one-line **synopsis** of the whole talk plus the
 * **scenes**: each a logical chapter with a default `refinePrompt` (the director's
 * per-scene instruction to the second-pass refiner — story 03q; it no longer
 * drafts a script), the original-video span it maps to (`start`–`end`), and the
 * footage spans to drop (`cuts`).
 *
 * This module is the *pure* half — request shaping + response coercion — so it's
 * unit-tested and shared by the MSW mock and the real `/api/scenes` pipeline (the
 * pipeline does the same clamping server-side; this is the client-side mirror).
 * The authoritative prompt/system-instruction live in the BFFless pipeline.
 */

import { clockLabel } from './contactSheet'
import { sourceOffsets, type SourceLike } from './sources'
import type { Scene, Cut } from './scenes'
import type { TWord } from './transcriptGrid'

/** What the director returns per scene, before we coerce it to a `Scene`. */
export type DirectorScene = {
  title?: string
  /** Original-video span this scene maps to, in seconds. */
  start: number
  end: number
  /** The words the AI heard across this span (reference). */
  transcript?: string
  /** Footage spans to drop, in original-video seconds, inside this scene. */
  cuts?: Cut[]
  /** The director's voicing plan for this scene (story 03j): keep the creator's
   *  original audio, re-voice the tightened narration, or some of both. */
  voicing?: 'original' | 'revoice' | 'mixed'
  /** The director's default refine prompt for this scene (story 03q) — a short
   *  instruction the per-scene refiner follows; seeds `scene.refinePrompt`. */
  refinePrompt?: string
}

/** The director's full response: a logline plus the scene breakdown. */
export type DirectorResult = { synopsis: string; scenes: DirectorScene[] }

/** The request body the front end POSTs to `/api/scenes`. */
export type DirectorRequest = {
  /** Timestamped transcript text (see `timedTranscript`). */
  transcript: string
  /** Bucket serve paths of the contact sheets, in order. */
  sheetUrls: string[]
  /** Optional free-text direction from the user. */
  direction: string
  /** Source clip duration, so the model (and clamps) know the bounds. */
  duration: number
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Collapse a word-level transcript into compact timestamped lines for the
 * director's prompt — `[m:ss] words spoken in that window`, one line per
 * `secondsPerLine`-second window. Plain wall-clock (matching the contact-sheet
 * labels) so the model can line a moment it reads up with a frame it sees and
 * report back an original-video timestamp. Words without a timestamp ride along
 * with the current window.
 */
export function timedTranscript(words: TWord[], secondsPerLine = 8): string {
  if (!words.length || secondsPerLine <= 0) return ''
  const lines: { bucket: number; words: string[] }[] = []
  let current = -1
  for (const w of words) {
    const text = str(w?.text).trim()
    if (!text) continue
    const start = typeof w?.start === 'number' && Number.isFinite(w.start) ? w.start : null
    const bucket = start == null ? Math.max(0, current) : Math.floor(start / secondsPerLine)
    if (bucket !== current || lines.length === 0) {
      // New window — but keep null-timestamp words on the line we're already on.
      if (start != null || lines.length === 0) {
        lines.push({ bucket, words: [] })
        current = bucket
      }
    }
    lines[lines.length - 1].words.push(text)
  }
  return lines
    .map((l) => `[${clockLabel(l.bucket * secondsPerLine)}] ${l.words.join(' ')}`)
    .join('\n')
}

/** First few words of a script, for a fallback scene title. */
function leadWords(text: string, n = 5): string {
  const words = text.trim().split(/\s+/).filter(Boolean).slice(0, n)
  return words.join(' ')
}

/** Validate the director's per-scene voicing plan; anything else → undefined. */
function toVoicing(v: unknown): Scene['voicing'] {
  return v === 'original' || v === 'revoice' || v === 'mixed' ? v : undefined
}

/** Clamp a cut span to `[lo, hi]`, returning null if it collapses to nothing. */
function clampCut(cut: Cut, lo: number, hi: number): Cut | null {
  const start = Math.min(Math.max(num(cut?.start), lo), hi)
  const end = Math.min(Math.max(num(cut?.end), lo), hi)
  if (end - start <= 0.05) return null
  return { start, end }
}

/**
 * Coerce the director's raw scenes into the app's `Scene[]`, mapping from the
 * **global** (concatenated) timeline the director reasons over back to
 * **per-source local** coordinates. Each returned scene carries a `sourceId`
 * and local `start`/`end` within that source.
 *
 * Any scene whose global span crosses a source boundary is **auto-split** into
 * one scene per source it overlaps — so callers never see a scene that spans
 * two videos. Within each split/segment the cuts are re-expressed in local
 * coordinates and clamped to the (local) scene span.
 *
 * The global timeline is clamped and forced monotonic first (same defensive
 * logic as before), then each global span is intersected with every source's
 * `[start, end)` window; intersections shorter than 0.05 s are dropped.
 * Single-source projects behave identically to the old signature: local time
 * equals global time and every scene gets `sourceId = sources[0].id`.
 */
export function toScenes(raw: DirectorScene[], sources: SourceLike[]): Scene[] {
  if (!Array.isArray(raw) || sources.length === 0) return []
  const spans = sourceOffsets(sources)
  const bound = spans[spans.length - 1].end
  const sorted = [...raw].sort((a, b) => num(a?.start) - num(b?.start))

  // 1) clamp + monotonic on the GLOBAL timeline (the existing logic)
  const global: { start: number; end: number; raw: DirectorScene }[] = []
  let cursor = 0
  for (const s of sorted) {
    const start = Math.min(Math.max(num(s?.start), cursor), bound)
    let end = Math.min(Math.max(num(s?.end), start), bound)
    if (end <= start) end = Math.min(start + 0.05, bound)
    cursor = end
    global.push({ start, end, raw: s })
  }

  // 2) split each global scene at every boundary it crosses, convert to local
  const out: Scene[] = []
  for (const g of global) {
    for (const span of spans) {
      const segStart = Math.max(g.start, span.start)
      const segEnd = Math.min(g.end, span.end)
      if (segEnd - segStart <= 0.05) continue
      const localStart = segStart - span.start
      const localEnd = segEnd - span.start
      const i = out.length
      const transcript = str(g.raw?.transcript).trim()
      const refinePrompt = str(g.raw?.refinePrompt).trim()
      const title = str(g.raw?.title).trim() || (leadWords(transcript) ? `${leadWords(transcript)}…` : `Scene ${i + 1}`)
      const cuts = (Array.isArray(g.raw?.cuts) ? g.raw.cuts : [])
        .map((c) => clampCut({ start: num(c?.start) - span.start, end: num(c?.end) - span.start }, localStart, localEnd))
        .filter((c): c is Cut => c !== null)
      const voicing = toVoicing(g.raw?.voicing)
      out.push({
        id: `scene-${i + 1}`, index: i, sourceId: span.id, title,
        start: localStart, end: localEnd, transcript, status: 'pending', narrationSeconds: null, cuts,
        ...(voicing ? { voicing } : {}),
        ...(refinePrompt ? { refinePrompt } : {}),
      })
    }
  }
  return out.map((s, i) => ({ ...s, index: i, id: `scene-${i + 1}` }))
}

/** One source's transcript for the combined director request (story 09c). */
export type TranscriptSource = { id: string; fileName: string; duration: number; words: TWord[] }

/**
 * Build ONE timestamped transcript across all source videos for the master
 * director (story 09c): each source's words are offset onto the global timeline
 * (video A at [0,durA), B at [durA, ...], ...) via `sourceOffsets`, run through the
 * existing `timedTranscript`, and joined with a labeled boundary marker naming
 * the next video and its global start -- so the director sees one continuous talk
 * but knows where each video begins (and must not start a chapter in one video
 * and end it in another; the response coercion splits any that do).
 */
export function combinedTimedTranscript(sources: TranscriptSource[]): string {
  const spans = sourceOffsets(sources)
  return sources
    .map((s, i) => {
      const offset = spans[i].start
      const shifted: TWord[] = s.words.map((w) => ({
        ...w,
        start: typeof w.start === 'number' ? w.start + offset : w.start,
        end: typeof w.end === 'number' ? w.end + offset : w.end,
      }))
      const body = timedTranscript(shifted)
      const header = `--- VIDEO ${i + 1}: ${s.fileName} (starts ${clockLabel(offset)}) ---`
      return i === 0 ? `${header}\n${body}` : `\n${header}\n${body}`
    })
    .join('\n')
}
