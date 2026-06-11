import type { Scene } from '../../lib/scenes'
import { ContactSheetPreview } from './ContactSheetPreview'

type Props = {
  scene: Scene
  slicing: boolean
  sheeting: boolean
  refining: boolean
  error?: string | null
  onSlice: () => void
  onGenerateSheets: () => void
  onRefine: () => void
  onClear: () => void
}

/**
 * The per-scene refiner controls (story 03c) — two explicit, manual steps:
 * (1) generate the dense scene contact sheets, then (2) refine. Neither
 * auto-runs (both are paid/expensive). Minimal UI for now; the segmented diff
 * viewer that consumes `scene.refined` is 03d.
 */
export function SceneRefinePanel({
  scene,
  slicing,
  sheeting,
  refining,
  error,
  onSlice,
  onGenerateSheets,
  onRefine,
  onClear,
}: Props) {
  const sheetCount = scene.sheets?.length ?? 0
  const hasSheets = sheetCount > 0
  const refined = scene.refined ?? null
  const hasClip = !!scene.clipUrl
  const hasAudio = !!scene.clipAudioUrl
  const busy = slicing || sheeting || refining

  return (
    <div className="border rule bg-paper p-5">
      <p className="meta-label">Refine this scene</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
        First cut this scene out of the raw into its own short clip — then everything
        below (and the preview above) works on that clip, not the whole film. After
        that it's a zoomed-in second pass: capture a dense contact sheet for just
        this scene, then ask the AI to place the new script and tighten the cuts.
        Your original draft is kept — refining never overwrites it.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {/* Step 0 — cut this scene out of the raw into its own clip (story 03g),
            so everything downstream works on a short clip, not the whole film. */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13.5px] text-ink">
            0 · Cut this scene
            {hasClip && (
              <span className="ml-2 font-mono text-[12px] text-ink-mute">
                {hasAudio ? 'clip + audio ready' : 'clip ready — re-cut to save audio'}
              </span>
            )}
          </span>
          <button
            type="button"
            className="pill-ghost"
            disabled={busy}
            onClick={onSlice}
          >
            {slicing ? 'Cutting…' : hasClip ? 'Re-cut' : 'Cut scene'}
          </button>
        </div>

        {/* Step 1 — dense scene contact sheets */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13.5px] text-ink">
            1 · Scene contact sheets
            {hasSheets && (
              <span className="ml-2 font-mono text-[12px] text-ink-mute">
                {sheetCount} sheet{sheetCount === 1 ? '' : 's'} ready
              </span>
            )}
          </span>
          <button
            type="button"
            className="pill-ghost"
            disabled={busy}
            onClick={onGenerateSheets}
          >
            {sheeting ? 'Capturing…' : hasSheets ? 'Regenerate' : 'Generate'}
          </button>
        </div>

        {/* Step 2 — refine */}
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13.5px] text-ink">
            2 · Refine cuts &amp; placement
            {refined && (
              <span className="ml-2 font-mono text-[12px] text-ink-mute">
                {refined.segments.length} segment{refined.segments.length === 1 ? '' : 's'} ·{' '}
                {refined.cuts.length} cut{refined.cuts.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {refined && (
              <button type="button" className="pill-ghost" disabled={busy} onClick={onClear}>
                Revert
              </button>
            )}
            <button
              type="button"
              className="pill-cta"
              disabled={busy || !hasSheets || !hasAudio}
              onClick={onRefine}
              title={
                !hasAudio
                  ? 'Cut this scene first'
                  : hasSheets
                    ? undefined
                    : 'Generate scene contact sheets first'
              }
            >
              {refining ? 'Refining…' : refined ? 'Re-refine' : 'Refine scene'}
            </button>
          </div>
        </div>
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-soft">
        Then voice each run right in the diff viewer below — record it yourself or
        AI-generate it, per segment.
      </p>

      {error && <p className="mt-3 text-[13px] text-terracotta-ink">{error}</p>}

      {/* Show the captured sheets so the producer can see exactly what the
          refiner is handed for this scene. */}
      {hasSheets && (
        <div className="mt-4">
          <ContactSheetPreview
            sheets={scene.sheets ?? []}
            title="Scene contact sheets"
            caption="The dense frames for this scene handed to the refiner — tighter spacing than the whole-clip director sheets, so it can place the new narration and tune the cuts more precisely."
          />
        </div>
      )}
    </div>
  )
}
