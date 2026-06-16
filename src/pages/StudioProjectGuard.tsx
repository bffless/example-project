import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { openProject, selectActiveProjectId } from '../store/studioSlice'
import { resolvePhase } from '../lib/studioRoute'
import { Studio } from './Studio'

/**
 * Owns the URL→state contract for a single project:
 * - unknown/stale :projectId → back to the list,
 * - syncs Redux `activeProjectId` from the URL (so the slice's active() write-
 *   routing keeps working) and waits for it before mounting the workspace,
 * - resolves/clamps :phase against the project's readiness ladder.
 * The workspace is keyed by projectId so switching projects remounts it (resets
 * transient in-memory clip state).
 */
export function StudioProjectGuard() {
  const { projectId, phase } = useParams()
  const dispatch = useAppDispatch()
  const working = useAppSelector((s) => (projectId ? s.studio.working[projectId] : undefined))
  const activeProjectId = useAppSelector(selectActiveProjectId)

  useEffect(() => {
    if (projectId && working && activeProjectId !== projectId) dispatch(openProject(projectId))
  }, [projectId, working, activeProjectId, dispatch])

  if (!projectId || !working) return <Navigate to="/studio" replace />

  const resolved = resolvePhase(working, phase)
  if ('redirectTo' in resolved) {
    return <Navigate to={`/studio/project/${projectId}/${resolved.redirectTo}`} replace />
  }
  // Wait one render for the sync effect to point the active project at the URL,
  // so the workspace's selectActive reads the right project from its first render.
  if (activeProjectId !== projectId) return null
  return <Studio key={projectId} projectId={projectId} phase={resolved.phase} />
}
