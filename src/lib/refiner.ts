/**
 * The per-scene refiner — the second pass (story 03c).
 *
 * The master director (story 03) sees the whole talk and returns a flat
 * `draftText` + `cuts` per scene with **no placement** for the new words. The
 * refiner zooms into ONE scene: it spends the whole image budget on that scene
 * (a much denser contact sheet) and *refines* the first-pass suggestion, handing
 * back where the new script actually lands — `segments` anchored on the
 * original-video timeline (more than one when there's kept dead air between
 * runs) — plus better `cuts`.
 *
 * Like `director.ts`, this is the *pure* half: request shaping + response
 * coercion, shared by the MSW mock and the real `/api/refine-scene` pipeline (the
 * pipeline clamps server-side too; this mirrors it client-side). The
 * authoritative prompt/system-instruction live in the BFFless pipeline.
 *
 * **Non-destructive:** `toRefinement` produces a `SceneRefinement` that lives in
 * `scene.refined` — it never touches the director's `draftText`/`cuts`, so the
 * producer can always revert by clearing `refined`.
 */

import { WORDS_PER_SECOND, type Cut, type NarrationSegment, type Scene, type SceneRefinement } from './scenes'
import type { TWord } from './transcriptGrid'

/** A segment as the model returns it, before we coerce/clamp it. */
export type RefineSegment = { text?: string; start?: number; end?: number }

/** The refiner's raw response: the new segments + the refined cuts. */
export type RefineSceneRaw = { segments?: RefineSegment[]; cuts?: Cut[] }

/** The request body the front end POSTs to `/api/refine-scene`. */
export type RefineSceneRequest = {
  /** The scene's original-video span — the bounds the model works within. */
  start: number
  end: number
  /** Timestamped transcript for just this scene (see `director.timedTranscript`). */
  transcript: string
  /** The master director's first-pass script — passed in to refine, not regen. */
  draftText: string
  /** The master director's first-pass cuts — the suggestion to refine. */
  cuts: Cut[]
  /** Bucket serve paths of the scene's dense contact sheets, in order. */
  sheetUrls: string[]
  /** Optional free-text direction from the user. */
  direction: string
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Clamp a cut span to `[lo, hi]`, returning null if it collapses to nothing. */
function clampSpan(start: number, end: number, lo: number, hi: number): { start: number; end: number } | null {
  const s = Math.min(Math.max(start, lo), hi)
  const e = Math.min(Math.max(end, lo), hi)
  if (e - s <= 0.05) return null
  return { start: s, end: e }
}

/**
 * Coerce the refiner's raw response into a `SceneRefinement`, clamped to the
 * scene: every segment and cut snapped into `[scene.start, scene.end]`, segments
 * sorted ascending and forced non-overlapping (gaps between them are fine — that's
 * kept dead air), empty/zero-length spans dropped. The server validates too; this
 * guarantees the UI never sees a segment or cut outside the scene even if the
 * model slips. `source` is always `'ai'` here — hand-edits set `'manual'`.
 */
export function toRefinement(raw: RefineSceneRaw, scene: Scene): SceneRefinement {
  const lo = scene.start
  const hi = scene.end

  const rawSegments = Array.isArray(raw?.segments) ? raw.segments : []
  const sorted = [...rawSegments].sort((a, b) => num(a?.start) - num(b?.start))
  const segments: NarrationSegment[] = []
  let cursor = lo
  for (const seg of sorted) {
    const text = str(seg?.text).trim()
    if (!text) continue
    const span = clampSpan(Math.max(num(seg?.start), cursor), num(seg?.end), lo, hi)
    if (!span) continue
    segments.push({ text, start: span.start, end: span.end })
    cursor = span.end
  }

  const cuts: Cut[] = (Array.isArray(raw?.cuts) ? raw.cuts : [])
    .map((c) => clampSpan(num(c?.start), num(c?.end), lo, hi))
    .filter((c): c is Cut => c !== null)

  return { segments, cuts, source: 'ai' }
}

/**
 * Merge a cut list into a clean, sorted, non-overlapping set: drop sub-cell
 * slivers, sort by start, and coalesce spans that touch or overlap (within the
 * 0.05s float tolerance). Both hand-edit primitives below funnel through this so
 * the stored `refined.cuts` is always tidy — e.g. adding the dead air between two
 * adjacent cuts collapses all three into one.
 */
export function normalizeCuts(cuts: Cut[]): Cut[] {
  const sorted = [...cuts]
    .filter((c) => c.end - c.start > 0.05)
    .sort((a, b) => a.start - b.start)
  const out: Cut[] = []
  for (const c of sorted) {
    const last = out[out.length - 1]
    if (last && c.start <= last.end + 0.05) last.end = Math.max(last.end, c.end)
    else out.push({ start: c.start, end: c.end })
  }
  return out
}

/**
 * Hand-edit: add a cut span (clamped to the scene), merging it into any cut it
 * touches. Covers both **add a new cut** (span over kept footage) and **extend a
 * cut** (span adjacent to an existing one — the merge grows it).
 */
export function addCut(cuts: Cut[], span: Cut, scene: Pick<Scene, 'start' | 'end'>): Cut[] {
  const clamped = clampSpan(span.start, span.end, scene.start, scene.end)
  if (!clamped) return normalizeCuts(cuts)
  return normalizeCuts([...cuts, clamped])
}

/**
 * Hand-edit: remove a span from the cut set — **contract a cut** from its edge,
 * or carve out the middle (which splits one cut into two). Spans the removal
 * doesn't touch pass through untouched.
 */
export function removeCut(cuts: Cut[], span: Cut): Cut[] {
  const out: Cut[] = []
  for (const c of cuts) {
    if (span.end <= c.start || span.start >= c.end) {
      out.push(c) // no overlap — keep whole
      continue
    }
    if (c.start < span.start) out.push({ start: c.start, end: span.start }) // left remainder
    if (c.end > span.end) out.push({ start: span.end, end: c.end }) // right remainder
    // fully covered → dropped
  }
  return normalizeCuts(out)
}

/**
 * The narration segments to render for a scene: the refiner's if present, else a
 * single segment spanning the whole scene from the director's `draftText` (the
 * old even-spread fallback). Lets the diff viewer read one shape regardless.
 */
export function effectiveSegments(scene: Scene): NarrationSegment[] {
  if (scene.refined?.segments?.length) return scene.refined.segments
  const text = str(scene.draftText).trim()
  return text ? [{ text, start: scene.start, end: scene.end }] : []
}

/** The cuts to apply for a scene: the refiner's if refined, else the director's. */
export function effectiveCuts(scene: Scene): Cut[] {
  return scene.refined ? scene.refined.cuts : (scene.cuts ?? [])
}

/**
 * Lay segments' words onto the timeline for the diff viewer's right pane.
 *
 * - **Voiced** segments (have a real `audioSeconds`): spread the words evenly
 *   across that measured length, so they line up with — and end exactly where —
 *   the generated/recorded audio does (the green "voiced" span).
 * - **Un-voiced** segments: flow at the estimated speaking `wordsPerSecond`, just
 *   a placeholder until you voice them.
 *
 * Either way each segment starts at its own anchor, so the gaps between segments
 * stay as real pauses.
 */
export function segmentsToTimedWords(
  segments: NarrationSegment[],
  wordsPerSecond = WORDS_PER_SECOND,
): TWord[] {
  const wps = wordsPerSecond > 0 ? wordsPerSecond : WORDS_PER_SECOND
  const out: TWord[] = []
  for (const seg of segments) {
    const words = str(seg.text).trim().split(/\s+/).filter(Boolean)
    if (!words.length) continue
    const step = seg.audioSeconds && seg.audioSeconds > 0 ? seg.audioSeconds / words.length : 1 / wps
    words.forEach((text, i) => {
      const start = seg.start + i * step
      out.push({ text, start, end: start + step })
    })
  }
  return out
}
