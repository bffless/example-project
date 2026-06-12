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

/** A segment as the model returns it, before we coerce/clamp it. On the wire
 *  the per-segment voicing suggestion is `source` (simplest for the model);
 *  `toRefinement` maps it to `NarrationSegment.suggestedSource` so it can't be
 *  confused with the refinement-level `source: 'ai' | 'manual'`, which is
 *  client-assigned and never on the wire. */
export type RefineSegment = {
  text?: string
  start?: number
  end?: number
  source?: 'original' | 'revoice'
}

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
  /** Serve path of the scene's cut soundtrack (`scene.clipAudioUrl`) — required;
   *  the pipeline signs it like the sheets and Gemini listens to align cut and
   *  segment boundaries to the natural flow of speech (story 03k). */
  audioUrl: string
  /** The creator's per-scene instruction (`scene.refinePrompt`, trimmed). */
  direction: string
  /** The creator's global director prompt, forwarded as whole-video context
   *  while the scene's include-checkbox is on (story 03l); `''` when the
   *  checkbox is off or the prompt is empty. */
  directorDirection: string
}

/**
 * The two creator-prompt fields of a refine request (story 03l): the scene's own
 * `refinePrompt`, plus the global director prompt — forwarded only while the
 * scene's include-checkbox is on (absent = on). Both trimmed and never
 * undefined, so the wire shape stays stable for mock and real alike.
 */
export function refineDirections(
  scene: Pick<Scene, 'refinePrompt' | 'includeDirection'>,
  direction: string,
): { direction: string; directorDirection: string } {
  return {
    direction: (scene.refinePrompt ?? '').trim(),
    directorDirection: scene.includeDirection === false ? '' : direction.trim(),
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Lowercase + strip punctuation → the word sequence both sides of the
 *  verbatim check are compared in (tolerant of case/punctuation drift between
 *  the model's echo and the WhisperX words, strict about the words themselves). */
function normWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'") // curly → straight apostrophe
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .split(' ')
    .filter(Boolean)
}

/** Clamp a cut span to `[lo, hi]`, returning null if it collapses to nothing. */
function clampSpan(start: number, end: number, lo: number, hi: number): { start: number; end: number } | null {
  const s = Math.min(Math.max(start, lo), hi)
  const e = Math.min(Math.max(end, lo), hi)
  if (e - s <= 0.05) return null
  return { start: s, end: e }
}

/** One normalized token of a scene word, pointing back at its word — the
 *  search space for verbatim matching and boundary snapping (story 03n). */
type WordToken = { token: string; wi: number }

/**
 * Find where `targetTokens` occurs as a CONTIGUOUS word-run in the scene's
 * words, returning the matched words' REAL span. Among multiple occurrences
 * (repeated takes say the same words) the one whose start is closest to
 * `claimedStart` wins; runs that would overlap the previous segment
 * (start < minStart) are skipped. Null = the text exists nowhere verbatim.
 */
function findVerbatimRun(
  tokens: WordToken[],
  sceneWords: TWord[],
  targetTokens: string[],
  minStart: number,
  claimedStart: number,
): Cut | null {
  if (!targetTokens.length) return null
  let best: Cut | null = null
  for (let i = 0; i + targetTokens.length <= tokens.length; i++) {
    let ok = true
    for (let k = 0; k < targetTokens.length; k++) {
      if (tokens[i + k].token !== targetTokens[k]) {
        ok = false
        break
      }
    }
    if (!ok) continue
    const start = sceneWords[tokens[i].wi].start
    const end = sceneWords[tokens[i + targetTokens.length - 1].wi].end
    if (start < minStart - 0.05 || end - start <= 0.05) continue
    if (!best || Math.abs(start - claimedStart) < Math.abs(best.start - claimedStart)) {
      best = { start, end }
    }
  }
  return best
}

/**
 * Coerce the refiner's raw response into a `SceneRefinement`, clamped to the
 * scene: every segment and cut snapped into `[scene.start, scene.end]`, segments
 * sorted ascending and forced non-overlapping (gaps between them are fine — that's
 * kept dead air), empty/zero-length spans dropped. The server validates too; this
 * guarantees the UI never sees a segment or cut outside the scene even if the
 * model slips. `source` is always `'ai'` here — hand-edits set `'manual'`.
 *
 * `words` is the WhisperX transcript for the whole talk. An `'original'` tag
 * means the span's raw audio plays AS-IS, so the segment's text must be exactly
 * the span's words. The model's tag is authoritative; its CLOCK POSITIONS are
 * not (it only sees line-granular times) — so on a mismatch we SNAP the span to
 * the contiguous word-run that actually says the text (story 03n), instead of
 * the old 03j downgrade. Snapping keeps the model's intent and fixes the
 * numbers: displaced junk-word slivers become cuts, cuts a snapped span expands
 * into are shrunk, and segments never overlap. Only when the text exists
 * nowhere verbatim (a genuine rewrite/omission) — or no `words` are passed —
 * does the tag still downgrade to `'revoice'`.
 */
export function toRefinement(raw: RefineSceneRaw, scene: Scene, words: TWord[] = []): SceneRefinement {
  const lo = scene.start
  const hi = scene.end

  // The scene's words flattened to normalized tokens (one entry per token,
  // pointing back at its word) — shared by the verbatim check and the snap.
  const sceneWords = words.filter(
    (w) => typeof w.start === 'number' && w.start >= lo && w.start < hi,
  )
  const tokens: WordToken[] = []
  sceneWords.forEach((w, wi) => {
    for (const token of normWords(w.text)) tokens.push({ token, wi })
  })

  const rawSegments = Array.isArray(raw?.segments) ? raw.segments : []
  const sorted = [...rawSegments].sort((a, b) => num(a?.start) - num(b?.start))
  const segments: NarrationSegment[] = []
  // Cut fixups from snapped boundaries, applied after the cuts are clamped:
  // the kept span must not stay under a cut (assemble's cut-wins rule would
  // silence it), and displaced junk words must not survive as kept footage.
  const snapFixups: { span: Cut; slivers: Cut[] }[] = []
  let cursor = lo
  for (const seg of sorted) {
    const text = str(seg?.text).trim()
    if (!text) continue
    const span = clampSpan(Math.max(num(seg?.start), cursor), num(seg?.end), lo, hi)
    if (!span) continue
    let suggestedSource =
      seg?.source === 'original' || seg?.source === 'revoice' ? seg.source : undefined
    let finalSpan = span
    if (suggestedSource === 'original') {
      const targetTokens = normWords(text)
      const spanText = sceneWords
        .filter((w) => w.start >= span.start && w.start < span.end)
        .map((w) => w.text)
        .join(' ')
      if (targetTokens.join(' ') !== normWords(spanText).join(' ')) {
        const snapped = findVerbatimRun(tokens, sceneWords, targetTokens, cursor, span.start)
        if (snapped) {
          finalSpan = snapped
          // Slivers the snap displaced: cut them ONLY when they hold words (the
          // junk the model believed it had excluded); wordless slivers stay as
          // kept dead air, matching the model's gaps-are-intentional semantics.
          const slivers = [
            { start: span.start, end: snapped.start },
            { start: snapped.end, end: span.end },
          ].filter(
            (s) =>
              s.end - s.start > 0.05 &&
              sceneWords.some((w) => w.start >= s.start && w.start < s.end),
          )
          snapFixups.push({ span: snapped, slivers })
        } else {
          suggestedSource = 'revoice'
        }
      }
    }
    segments.push({
      text,
      start: finalSpan.start,
      end: finalSpan.end,
      ...(suggestedSource ? { suggestedSource } : {}),
    })
    cursor = finalSpan.end
  }

  let cuts: Cut[] = (Array.isArray(raw?.cuts) ? raw.cuts : [])
    .map((c) => clampSpan(num(c?.start), num(c?.end), lo, hi))
    .filter((c): c is Cut => c !== null)
  for (const fixup of snapFixups) {
    cuts = removeCut(cuts, fixup.span)
    for (const sliver of fixup.slivers) cuts = addCut(cuts, sliver, scene)
  }

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
 * The empty spans on a scene's New timeline — the complement of its narration
 * segments within `[scene.start, scene.end]`. These are the "gaps" (kept dead
 * air) an original-audio clip can be dropped into. Sub-0.05s slivers are dropped.
 */
export function gaps(segments: NarrationSegment[], scene: Pick<Scene, 'start' | 'end'>): Cut[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const out: Cut[] = []
  let cursor = scene.start
  for (const seg of sorted) {
    if (seg.start - cursor > 0.05) out.push({ start: cursor, end: seg.start })
    cursor = Math.max(cursor, seg.end)
  }
  if (scene.end - cursor > 0.05) out.push({ start: cursor, end: scene.end })
  return out
}

/**
 * Would a clip of `duration` seconds land clean at `dropStart` — i.e. does
 * `[dropStart, dropStart + duration]` sit entirely inside a single gap? Since
 * story 03h this is a **hint, not a gate**: drops land anywhere in the scene
 * (overlap allowed); the diff viewer only uses this to tint the footprint
 * preview lands-clean vs will-overlap.
 */
export function fitsGap(
  segments: NarrationSegment[],
  scene: Pick<Scene, 'start' | 'end'>,
  dropStart: number,
  duration: number,
): boolean {
  if (duration <= 0) return false
  const end = dropStart + duration
  return gaps(segments, scene).some((g) => dropStart >= g.start - 0.05 && end <= g.end + 0.05)
}

/**
 * Clamp a drop so `[dropStart, dropStart + duration]` stays inside the scene
 * (story 03h "drop anywhere"): shift the start left if the tail would pass
 * `scene.end`, floor it at `scene.start`. Overlap with existing runs is fine —
 * the within-scene clamp is the only constraint left on a drop.
 */
export function clampDropStart(
  scene: Pick<Scene, 'start' | 'end'>,
  dropStart: number,
  duration: number,
): number {
  return Math.max(scene.start, Math.min(dropStart, scene.end - duration))
}

/**
 * Move the run at `index` to `newStart`, keeping its duration (story 03h). The
 * start is clamped to `[scene.start, scene.end - duration]` so the run's end
 * never passes the scene — the New side never grows. Returns the list re-sorted
 * ascending by start; out-of-range index is a no-op. Pure: the caller snaps
 * `newStart` to the grid.
 */
export function moveRun(
  segments: NarrationSegment[],
  index: number,
  newStart: number,
  scene: Pick<Scene, 'start' | 'end'>,
): NarrationSegment[] {
  const run = segments[index]
  if (!run) return segments
  const duration = run.end - run.start
  const start = clampDropStart(scene, newStart, duration)
  return segments
    .map((seg, i) => (i === index ? { ...seg, start, end: start + duration } : seg))
    .sort((a, b) => a.start - b.start)
}

/**
 * The overlapping spans on a scene's New timeline (story 03h) — where two or
 * more runs sit on the same footage. Overlap is a legal in-progress state the
 * producer resolves by moving (or deleting) a run; the diff paints these spans
 * and assemble is blocked while any remain. Exactly-touching runs
 * (`a.end === b.start`) don't overlap; sub-0.05s slivers are ignored
 * (consistent with `gaps()`). Piled-up overlaps are merged via `normalizeCuts`.
 */
export function overlaps(segments: NarrationSegment[]): Cut[] {
  const spans: Cut[] = []
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const start = Math.max(segments[i].start, segments[j].start)
      const end = Math.min(segments[i].end, segments[j].end)
      if (end - start > 0.05) spans.push({ start, end })
    }
  }
  return normalizeCuts(spans)
}

/** Insert a segment and keep the list sorted ascending by start. */
export function insertSegment(segments: NarrationSegment[], seg: NarrationSegment): NarrationSegment[] {
  return [...segments, seg].sort((a, b) => a.start - b.start)
}

/** Drop the segment at `index` (no-op if out of range). */
export function removeSegment(segments: NarrationSegment[], index: number): NarrationSegment[] {
  return segments.filter((_, i) => i !== index)
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

/**
 * The SceneMeta "Voicing" line (story 03j): the director's coarse plan until
 * the scene is refined, then the real segment mix. Each refined segment counts
 * by what ACTUALLY happened to it (`audioSource`), falling back to the AI's
 * suggestion. Null = nothing to show (old data, no plan).
 */
export function voicingSummary(scene: Scene): string | null {
  const segs = scene.refined?.segments
  if (segs?.length) {
    const original = segs.filter((s) => (s.audioSource ?? s.suggestedSource) === 'original').length
    const revoice = segs.length - original
    if (!original) return 're-voice'
    if (!revoice) return 'original audio'
    return `${original} original · ${revoice} re-voice`
  }
  if (scene.voicing === 'original') return 'original audio'
  if (scene.voicing === 'revoice') return 're-voice'
  if (scene.voicing === 'mixed') return 'partial'
  return null
}

/** The auto-adopt work list (story 03j): segments the refiner wants voiced from
 *  the clip's own audio that aren't voiced yet. */
export function suggestedOriginalIndices(segments: NarrationSegment[]): number[] {
  return segments.flatMap((s, i) => (s.suggestedSource === 'original' && !s.audioUrl ? [i] : []))
}

/**
 * Fold uploaded original-audio clips back onto their segments (story 03j).
 * `clips[k]` belongs to `segments[indices[k]]`; null = that slice/upload failed
 * and the segment stays unvoiced (it keeps its "Use original" chip). A voiced
 * run's `end` snaps to its measured length, mirroring `setSegmentAudio`.
 */
export function applyOriginalClips(
  segments: NarrationSegment[],
  indices: number[],
  clips: ({ url: string; seconds: number } | null)[],
): { segments: NarrationSegment[]; failed: number } {
  const out = [...segments]
  let failed = 0
  indices.forEach((segIndex, k) => {
    const clip = clips[k]
    const seg = out[segIndex]
    if (!clip || !seg) {
      failed += 1
      return
    }
    out[segIndex] = {
      ...seg,
      audioUrl: clip.url,
      audioSeconds: clip.seconds,
      end: seg.start + clip.seconds,
      audioSource: 'original',
    }
  })
  return { segments: out, failed }
}
