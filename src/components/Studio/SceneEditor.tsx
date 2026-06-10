import { formatTime } from '../../lib/edl'
import {
  alignment,
  narrationSeconds,
  sceneVideoSeconds,
  wordCount,
  type Scene,
} from '../../lib/scenes'

type Props = {
  scene: Scene
  voicing: boolean
  onDraftChange: (text: string) => void
  onGenerateVoice: () => void
  onMarkBuilt: () => void
  onPlayScene: () => void
}

/**
 * Build one scene: review the AI-shortened script, regenerate the cloned-voice
 * narration, and see how its length sits against the scene's footage span. The
 * footage gets fit to the narration when assembled; text-edit + regenerate is
 * the first alignment tool (time-stretch comes later).
 */
export function SceneEditor({
  scene,
  voicing,
  onDraftChange,
  onGenerateVoice,
  onMarkBuilt,
  onPlayScene,
}: Props) {
  const videoLen = sceneVideoSeconds(scene)
  const estimate = narrationSeconds(scene.draftText) // live, from current text

  return (
    <div className="flex flex-col gap-4 border rule bg-paper p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="meta-label">Now building</p>
          <h3 className="mt-1 font-serif text-[22px] leading-tight text-ink">{scene.title}</h3>
          <p className="mt-1 font-mono text-[12px] text-ink-mute">
            {formatTime(scene.start)}–{formatTime(scene.end)} · scene video {formatTime(videoLen)}
          </p>
          {scene.cuts && scene.cuts.length > 0 && (
            <p className="mt-1 font-mono text-[11.5px] text-terracotta-ink">
              director cuts:{' '}
              {scene.cuts.map((c, i) => (
                <span key={i}>
                  {i > 0 ? ', ' : ''}
                  {formatTime(c.start)}–{formatTime(c.end)}
                </span>
              ))}
            </p>
          )}
        </div>
        <button type="button" className="pill-ghost flex-shrink-0" onClick={onPlayScene}>
          ▶ Play scene
        </button>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="meta-label">AI-shortened narration — re-voiced in your cloned voice</span>
        <textarea
          value={scene.draftText}
          onChange={(e) => onDraftChange(e.target.value)}
          rows={6}
          className="w-full resize-y rounded-md border border-paper-line bg-paper-deep/20 p-3 text-[14px] leading-relaxed text-ink"
        />
        <span className="font-mono text-[11px] text-ink-mute">
          {wordCount(scene.draftText)} words · ~{formatTime(estimate)} spoken
        </span>
      </label>

      {/* Alignment readout (from the last generated voice) */}
      <AlignBar videoLen={videoLen} scene={scene} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="pill-cta"
          disabled={voicing || wordCount(scene.draftText) === 0}
          onClick={onGenerateVoice}
        >
          {voicing ? 'Generating voice…' : scene.narrationSeconds == null ? 'Generate voice' : 'Regenerate voice'}
        </button>
        <button
          type="button"
          className="pill-ghost"
          disabled={scene.narrationSeconds == null}
          onClick={onMarkBuilt}
        >
          {scene.status === 'built' ? 'Built ✓' : 'Mark scene built'}
        </button>
      </div>
    </div>
  )
}

function AlignBar({ videoLen, scene }: { videoLen: number; scene: Scene }) {
  const align = alignment(scene)
  if (!align || scene.narrationSeconds == null) {
    return (
      <p className="text-[13px] text-ink-mute">
        Generate the voice to see how it sits against the {formatTime(videoLen)} footage span.
      </p>
    )
  }

  const narr = scene.narrationSeconds
  const max = Math.max(videoLen, narr, 0.1)
  const tone =
    align.status === 'aligned'
      ? 'text-terracotta-ink'
      : 'text-ink'
  const verb =
    align.status === 'aligned'
      ? '≈ matches the footage'
      : align.status === 'short'
        ? `footage is ${formatTime(-align.deltaSeconds)} longer — it’ll be tightened to your narration`
        : `runs ${formatTime(align.deltaSeconds)} past the footage — trim the script or widen the span`

  return (
    <div className="flex flex-col gap-1.5">
      <Bar label="Footage span" value={videoLen} max={max} accent="bg-ink/40" />
      <Bar
        label="Your narration"
        value={narr}
        max={max}
        accent={align.status === 'aligned' ? 'bg-terracotta' : 'bg-terracotta/60'}
      />
      <p className={`font-mono text-[12px] ${tone}`}>
        narration {formatTime(narr)} vs video {formatTime(videoLen)} — {verb}
      </p>
    </div>
  )
}

function Bar({
  label,
  value,
  max,
  accent,
}: {
  label: string
  value: number
  max: number
  accent: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 flex-shrink-0 text-[12px] text-ink-soft">{label}</span>
      <div className="h-3 flex-1 rounded bg-paper-deep/50">
        <div className={`h-full rounded ${accent}`} style={{ width: `${(value / max) * 100}%` }} />
      </div>
    </div>
  )
}
