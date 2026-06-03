import { useEffect, useState } from 'react'
import {
  readMockAuth,
  writeMockAuth,
  onMockAuthChange,
  type MockAuthState,
} from '../mocks/authState'

export function DevAuthPanel() {
  const [state, setState] = useState<MockAuthState>(() => readMockAuth())
  const [collapsed, setCollapsed] = useState(true)

  useEffect(() => onMockAuthChange(() => setState(readMockAuth())), [])

  function update(patch: Partial<MockAuthState>) {
    const next: MockAuthState = {
      ...state,
      ...patch,
      user: { ...state.user, ...(patch.user ?? {}) },
    }
    setState(next)
    writeMockAuth(next)
  }

  function updateUser(key: string, value: string) {
    update({ user: { ...state.user, [key]: value } })
  }

  const badge = !state.enabled ? 'off' : state.authenticated ? 'on' : 'guest'
  const badgeTone =
    !state.enabled
      ? 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
      : state.authenticated
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'

  return (
    <div className="fixed bottom-3 left-3 z-[9999] w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-zinc-200 bg-white text-zinc-900 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold"
      >
        <span>🔐 Mock auth</span>
        <span
          className={
            'ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ' +
            badgeTone
          }
        >
          {badge}
        </span>
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 px-3 pb-3 pt-2 text-xs dark:border-zinc-800">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={state.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            Intercept network calls
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={state.authenticated}
              disabled={!state.enabled}
              onChange={(e) => update({ authenticated: e.target.checked })}
            />
            Authenticated
          </label>
          <div className="mt-1 flex flex-col gap-2">
            {(['id', 'email', 'role'] as const).map((field) => (
              <label
                key={field}
                className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
              >
                {field}
                <input
                  type={field === 'email' ? 'email' : 'text'}
                  value={String(state.user[field] ?? '')}
                  onChange={(e) => updateUser(field, e.target.value)}
                  className="rounded border border-zinc-300 bg-white px-1.5 py-1 font-mono text-[13px] normal-case tracking-normal text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            Toggling updates{' '}
            <code className="font-mono">/_bffless/auth/*</code> via MSW. Disable
            to hit the real backend.
          </p>
        </div>
      )}
    </div>
  )
}
