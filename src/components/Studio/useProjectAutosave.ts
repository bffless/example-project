/**
 * Server-side autosave for the ACTIVE project's working state (story 11d, task 6).
 *
 * Mounted by the keyed-by-projectId Studio workspace (11b): each project gets its
 * own workspace instance, so LEAVING a project unmounts the workspace and fires
 * this hook's cleanup. Responsibilities:
 *  - debounce-save the working state to the server whenever it changes,
 *  - flush a final save on `beforeunload` and on unmount,
 *  - evict the heavy working state from local memory on unmount (the server is
 *    now the source of truth; re-opening hydrates from the server),
 *  - expose a `{ status, savedAt }` for a small "Saving…/Saved" UI indicator.
 *
 * Pitfalls handled here:
 *  - **No setState after unmount.** The unmount cleanup runs a final save but
 *    must not touch React state (the component is gone). A `mounted` ref gates
 *    every `setStatus`/`setSavedAt`; the cleanup sets `mounted.current = false`
 *    before saving so the save's `.then/.catch` stay silent. In-session
 *    (debounced) saves DO update status — the component is still mounted.
 *  - **Stale closures.** The freshest working/meta is read from a `latest` ref so
 *    the debounce/beforeunload/unmount saves always persist current state without
 *    re-subscribing the effects on every keystroke.
 *  - **No save on hydrate.** A `first` ref skips the initial render so opening a
 *    project doesn't immediately re-save it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { selectActive, evictWorking } from '../../store/studioSlice'
import { studioApi } from '../../store/studioApi'
import { toServerRecord } from '../../lib/projectSync'
import { deriveProjectMeta } from '../../lib/projects'

const DEBOUNCE_MS = 1500

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function useProjectAutosave(projectId: string): { status: SaveStatus; savedAt: number | null } {
  const dispatch = useAppDispatch()
  const working = useAppSelector(selectActive)
  const meta = useAppSelector((s) => s.studio.index[projectId])

  const [status, setStatus] = useState<SaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Always read the freshest working/meta from a ref so the debounce/unmount/
  // beforeunload saves persist current state without re-subscribing effects.
  // Refs must not be written during render (react-hooks/refs), so a no-deps
  // effect syncs them after every commit — that's still before any timer fires.
  const latest = useRef({ working, meta })
  useEffect(() => {
    latest.current = { working, meta }
  })

  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fire a save. Stable across renders (reads working/meta from `latest`, only
  // depends on the stable `dispatch`), so the effects below don't re-subscribe
  // on every keystroke. `updateStatus` is false on the unmount/unload paths so
  // we never call setState after the component has unmounted.
  const save = useCallback(
    (updateStatus: boolean) => {
      const { working: w, meta: m } = latest.current
      if (!m) return
      const record = toServerRecord({ ...m, ...deriveProjectMeta(w), updatedAt: Date.now() }, w)
      if (updateStatus && mounted.current) setStatus('saving')
      dispatch(studioApi.endpoints.saveProject.initiate(record))
        .unwrap()
        .then(
          () => {
            if (updateStatus && mounted.current) {
              setStatus('saved')
              setSavedAt(Date.now())
            }
          },
          () => {
            if (updateStatus && mounted.current) setStatus('error')
          },
        )
    },
    [dispatch],
  )

  // Debounce a save on every working-state change, skipping the hydrate render.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => save(true), DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [working, save])

  // Flush a final save when the tab/window is closing.
  useEffect(() => {
    const onUnload = () => save(false)
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [save])

  // On unmount (left the project — 11b remounts per projectId): flush a final
  // save, then evict the working state from local memory.
  useEffect(() => {
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
      save(false)
      dispatch(evictWorking(projectId))
    }
  }, [projectId, dispatch, save])

  return { status, savedAt }
}
