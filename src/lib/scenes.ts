/**
 * Scenes — the producer's unit of work. After transcription the AI splits the
 * talk into logical "micro-chapters" (target 2–5 min, but it shouldn't cut a
 * good continuous run just to hit a number). Each scene doubles as a YouTube
 * chapter and as a thing you build one at a time: edit its text, regenerate the
 * cloned-voice narration, and check the narration length lines up with the
 * scene's video length before moving on.
 *
 * Pure + unit-tested. The mock `buildScenes` here is replaced later by the real
 * AI segmentation response (same `Scene` shape).
 */

export type SceneStatus = 'pending' | 'built'

/**
 * A span of the scene's footage the director says to drop. Bounds are in
 * original-video seconds and always sit inside the owning scene's `start`–`end`.
 * The Build step applies these when it fits the footage to the narration.
 */
export type Cut = { start: number; end: number }

export type Scene = {
  id: string
  index: number
  title: string
  /** Original-timeline bounds, in seconds. */
  start: number
  end: number
  /** The words the AI heard in this scene (read-only reference). */
  transcript: string
  /** The editable, tightened script you'll actually re-voice. */
  draftText: string
  status: SceneStatus
  /** Length of the generated narration once voiced; null until voiced. */
  narrationSeconds: number | null
  /** Footage spans the director marked to drop (original-video seconds). */
  cuts?: Cut[]
  thumb?: string
}

/** How much the AI condenses each scene's words (mock). */
export const SHORTEN_RATIO = 0.6

/** Speaking rate used to estimate narration length from text. */
export const WORDS_PER_SECOND = 2.5
/** How far narration vs video can differ and still count as aligned. */
export const ALIGN_TOLERANCE = 1.5

export function wordCount(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

/** Estimated seconds to speak `text` in the cloned voice. */
export function narrationSeconds(text: string): number {
  return wordCount(text) / WORDS_PER_SECOND
}

export function sceneVideoSeconds(scene: Scene): number {
  return Math.max(0, scene.end - scene.start)
}

export type Alignment = { deltaSeconds: number; status: 'short' | 'long' | 'aligned' }

/** Compare voiced narration length to the scene's video length. */
export function alignment(scene: Scene): Alignment | null {
  if (scene.narrationSeconds == null) return null
  const delta = scene.narrationSeconds - sceneVideoSeconds(scene)
  const status =
    Math.abs(delta) <= ALIGN_TOLERANCE ? 'aligned' : delta < 0 ? 'short' : 'long'
  return { deltaSeconds: delta, status }
}

const FILLER =
  'so the idea here is pretty simple let me walk you through it step by step and show you exactly how it works in practice today'.split(
    ' ',
  )

/** Deterministic placeholder transcript of roughly `words` words. */
function fillerText(words: number): string {
  const out: string[] = []
  for (let i = 0; i < words; i++) out.push(FILLER[i % FILLER.length])
  if (out.length) out[0] = out[0][0].toUpperCase() + out[0].slice(1)
  return out.join(' ') + '.'
}

/**
 * Mock of the shorten + segment steps: break `duration` into a few logical
 * 2–5 min scenes (≈3.5 min target), never fewer than one. Each scene maps to an
 * original-video span (`start`–`end`) and carries the full span `transcript`
 * plus an AI-shortened `draftText` — so the re-voiced narration is shorter than
 * the footage, the way it will be in practice.
 */
export function buildScenes(duration: number, targetSceneSeconds = 210): Scene[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  const count = Math.max(1, Math.round(duration / targetSceneSeconds))
  const each = duration / count

  return Array.from({ length: count }, (_, i) => {
    const start = i * each
    const end = i === count - 1 ? duration : (i + 1) * each
    const spanWords = Math.round((end - start) * WORDS_PER_SECOND)
    const transcript = fillerText(spanWords)
    const draftText = fillerText(Math.max(1, Math.round(spanWords * SHORTEN_RATIO)))
    const firstWords = draftText.split(' ').slice(0, 4).join(' ')
    return {
      id: `scene-${i + 1}`,
      index: i,
      title: `Scene ${i + 1} — ${firstWords}…`,
      start,
      end,
      transcript,
      draftText,
      status: 'pending' as const,
      narrationSeconds: null,
    }
  })
}
