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
import { sourceOffsets } from './sources'
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
 * Coerce the director's raw scenes into the app's `Scene[]`: assign ids/index,
 * default the editable + status fields, and **defensively clamp** timestamps —
 * snap each span into `[0, duration]`, force the scenes ascending and
 * non-overlapping (so the chapter list is monotonic), and keep every cut inside
 * its own scene. The server validates too; this guarantees the UI never sees a
 * scene running past the clip or a cut outside its span even if the model slips.
 */
export function toScenes(raw: DirectorScene[], duration: number): Scene[] {
  if (!Array.isArray(raw)) return []
  const bound = Number.isFinite(duration) && duration > 0 ? duration : Infinity
  const sorted = [...raw].sort((a, b) => num(a?.start) - num(b?.start))

  const scenes: Scene[] = []
  let cursor = 0
  sorted.forEach((s, i) => {
    const start = Math.min(Math.max(num(s?.start), cursor), bound)
    let end = Math.min(Math.max(num(s?.end), start), bound)
    if (end <= start) end = Math.min(start + 0.05, bound) // never zero-length
    cursor = end

    const transcript = str(s?.transcript).trim()
    const refinePrompt = str(s?.refinePrompt).trim()
    const title = str(s?.title).trim() || (leadWords(transcript) ? `${leadWords(transcript)}…` : `Scene ${i + 1}`)

    const cuts = (Array.isArray(s?.cuts) ? s.cuts : [])
      .map((c) => clampCut(c, start, end))
      .filter((c): c is Cut => c !== null)

    const voicing = toVoicing(s?.voicing)

    scenes.push({
      id: `scene-${i + 1}`,
      index: i,
      sourceId: 'source-1',
      title,
      start,
      end,
      transcript,
      status: 'pending',
      narrationSeconds: null,
      cuts,
      ...(voicing ? { voicing } : {}),
      ...(refinePrompt ? { refinePrompt } : {}),
    })
  })
  return scenes
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
