import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { openProject, hydrateProject, selectActiveProjectId } from '../store/studioSlice'
import { useLazyGetProjectQuery } from '../store/studioApi'
import { fromServerRecord } from '../lib/projectSync'
import { resolvePhase } from '../lib/studioRoute'
import { Studio } from './Studio'

/**
 * Owns the URL→state contract for a single project (server-sync aware):
 * - working present locally → syncs Redux `activeProjectId` from the URL (so the
 *   slice's active() write-routing keeps working) and waits for it before mounting,
 * - working missing → hydrate-or-redirect: fetch the project from the server, show
 *   a load state, hydrate on success, and fall back to the list only when the
 *   project is truly unknown (not in the local index AND the server has no record),
 * - resolves/clamps :phase against the project's readiness ladder.
 * The workspace is keyed by projectId so switching projects remounts it (resets
 * transient in-memory clip state).
 */
export function StudioProjectGuard() {
  const { projectId, phase } = useParams()
  const dispatch = useAppDispatch()
  const working = useAppSelector((s) => (projectId ? s.studio.working[projectId] : undefined))
  const knownMeta = useAppSelector((s) => (projectId ? s.studio.index[projectId] : undefined))
  const activeProjectId = useAppSelector(selectActiveProjectId)
  const [fetchProject, { isError: fetchFailed }] = useLazyGetProjectQuery()
  // The GET resolves with `{ id: null, data: null }` on a server miss, which the
  // query treats as a success — so a falsy id can't surface via `fetchFailed`.
  // Track an explicit "resolved but empty" miss to allow the redirect.
  const [notFound, setNotFound] = useState(false)

  // Sync the active pointer once working is present.
  useEffect(() => {
    if (projectId && working && activeProjectId !== projectId) dispatch(openProject(projectId))
  }, [projectId, working, activeProjectId, dispatch])

  // Hydrate from the server when working is missing locally.
  useEffect(() => {
    if (!projectId || working) return
    let cancelled = false
    fetchProject(projectId)
      .unwrap()
      .then(
        (rec) => {
          if (cancelled) return
          if (rec && (rec as { id?: unknown }).id) {
            const { working: w } = fromServerRecord(rec)
            dispatch(hydrateProject({ id: projectId, working: w }))
          } else {
            setNotFound(true)
          }
        },
        () => {},
      )
    return () => {
      cancelled = true
    }
  }, [projectId, working, fetchProject, dispatch])

  if (!projectId) return <Navigate to="/studio" replace />
  if (!working) {
    // Truly unknown (not in the local index AND the server fetch failed/empty) → list.
    if (!knownMeta && (fetchFailed || notFound)) return <Navigate to="/studio" replace />
    return <div className="container-page py-16 text-ink-soft">Loading project…</div>
  }

  const resolved = resolvePhase(working, phase)
  if ('redirectTo' in resolved) {
    return <Navigate to={`/studio/project/${projectId}/${resolved.redirectTo}`} replace />
  }
  // Wait one render for the sync effect to point the active project at the URL,
  // so the workspace's selectActive reads the right project from its first render.
  if (activeProjectId !== projectId) return null
  return <Studio key={projectId} projectId={projectId} phase={resolved.phase} />
}
