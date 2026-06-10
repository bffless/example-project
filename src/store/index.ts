/**
 * The Redux store. The `studio` slice is wrapped in redux-persist so its state
 * is mirrored to localStorage and rehydrated on load — that's what lets a hard
 * reload resume mid-pipeline. The RTK Query `studioApi` cache is intentionally
 * NOT persisted (it's transient request state).
 */

import { configureStore, combineReducers } from '@reduxjs/toolkit'
import {
  persistStore,
  persistReducer,
  createMigrate,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
  type WebStorage,
} from 'redux-persist'
import studioReducer, { freshProgress } from './studioSlice'
import { studioApi } from './studioApi'

/**
 * A localStorage-backed redux-persist storage, defined inline rather than
 * imported from `redux-persist/lib/storage`. That package is CJS and, under
 * Vite's ESM interop, its default export can resolve to a module namespace
 * (so `storage.getItem` is undefined → "storage.getItem is not a function").
 * Implementing the tiny async interface here avoids the interop entirely and
 * stays SSR/non-browser safe via a noop fallback.
 */
const noopStorage: WebStorage = {
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
}

const storage: WebStorage =
  typeof window !== 'undefined' && window.localStorage
    ? {
        getItem: (key) => Promise.resolve(window.localStorage.getItem(key)),
        setItem: (key, value) => Promise.resolve(window.localStorage.setItem(key, value)),
        removeItem: (key) => Promise.resolve(window.localStorage.removeItem(key)),
      }
    : noopStorage

/**
 * v2 drops the legacy `stages` blob: the board's static content (titles, notes,
 * labels) no longer lives in state — only per-step `stageProgress` does, and the
 * board is rebuilt from `STAGE_DEFS` in the hook. This strips the obsolete key
 * from pre-v2 localStorage so nothing stale lingers (a sessions's progress is
 * preserved if it already had `stageProgress`, else reset to fresh).
 */
const migrations = {
  2: (state: Record<string, unknown> | undefined) => {
    if (!state) return state
    const next = { ...state }
    delete next.stages // legacy: board content is static STAGE_DEFS now
    if (!next.stageProgress) next.stageProgress = freshProgress()
    return next
  },
}

const persistConfig = {
  key: 'studio',
  version: 2,
  storage,
  migrate: createMigrate(migrations as never),
}

const rootReducer = combineReducers({
  studio: persistReducer(persistConfig, studioReducer),
  [studioApi.reducerPath]: studioApi.reducer,
})

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // redux-persist dispatches these non-serializable lifecycle actions.
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }).concat(studioApi.middleware),
})

export const persistor = persistStore(store)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
