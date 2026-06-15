/**
 * Pure project-model helpers (story 11a). The studio slice holds a keyed
 * collection of projects; these helpers derive the dashboard metadata (phase,
 * thumbnail) from a project's working state and name new projects. They are pure
 * — NO id minting lives here (that's impure and belongs in the reducer).
 *
 * Type-only import from the slice avoids a runtime module cycle: `projects.ts`
 * imports the `ProjectWorkingState` TYPE (erased at runtime) while the slice
 * imports these runtime helpers + the `ProjectMeta` type back.
 */

import type { ProjectWorkingState } from '../store/studioSlice'
import { GLOBAL_STAGES, PER_VIDEO_STAGES, studioPhase, type StudioPhase } from './pipeline'

/** Lightweight per-project metadata for the dashboard index (no heavy working state). */
export type ProjectMeta = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  phase: StudioPhase
  thumbnailUrl: string | null
}

export const DEFAULT_PROJECT_NAME = 'Untitled project'

/** Which macro phase a project is in, derived purely from its working state. */
export function phaseOf(w: ProjectWorkingState): StudioPhase {
  const hasSource = w.sources.length > 0
  const allBuilt = w.scenes.length > 0 && w.scenes.every((s) => s.status === 'built')
  const sourcesReady =
    w.sources.length > 0 &&
    w.sources.every((s) => PER_VIDEO_STAGES.every((id) => s.stageProgress[id]?.status === 'done'))
  const ready = sourcesReady && GLOBAL_STAGES.every((id) => w.stageProgress[id]?.status === 'done')
  return studioPhase({ hasSource, ready, allBuilt })
}

/** The dashboard-facing derived fields (phase + thumbnail) for one project. */
export function deriveProjectMeta(w: ProjectWorkingState): Pick<ProjectMeta, 'phase' | 'thumbnailUrl'> {
  return { phase: phaseOf(w), thumbnailUrl: w.contactSheets.find((s) => s.url)?.url ?? null }
}

/** The next collision-free "Untitled project" name given the existing names. */
export function nextUntitledName(existing: string[]): string {
  if (!existing.includes(DEFAULT_PROJECT_NAME)) return DEFAULT_PROJECT_NAME
  let n = 2
  while (existing.includes(`${DEFAULT_PROJECT_NAME} ${n}`)) n++
  return `${DEFAULT_PROJECT_NAME} ${n}`
}
