import { useEffect, useState } from 'react'
import {
  CHANGE_EVENT,
  MOCK_ROLES,
  readMockAuth,
  writeMockAuth,
  type MockAuthState,
  type MockRole,
} from '../mocks/mockAuthStore'

const REFETCH_EVENT = 'bffless:auth:refetch'

function dispatchRefetch() {
  window.dispatchEvent(new CustomEvent(REFETCH_EVENT))
}

export function DevAuthPanel() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<MockAuthState>(() => readMockAuth())

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<MockAuthState>).detail
      if (detail) setState(detail)
      else setState(readMockAuth())
    }
    window.addEventListener(CHANGE_EVENT, onChange)
    return () => window.removeEventListener(CHANGE_EVENT, onChange)
  }, [])

  const apply = (patch: Partial<MockAuthState>) => {
    const next: MockAuthState = {
      ...state,
      ...patch,
      user: { ...state.user, ...(patch.user ?? {}) },
    }
    setState(next)
    writeMockAuth(next)
    dispatchRefetch()
  }

  const reset = () => {
    localStorage.removeItem('bffless:mockAuth')
    const fresh = readMockAuth()
    setState(fresh)
    dispatchRefetch()
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 font-mono text-sm">
      {open ? (
        <div className="w-80 rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-[var(--shadow)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <span className="font-semibold text-[var(--text-h)]">
              Dev auth
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close dev auth panel"
              className="cursor-pointer rounded px-2 text-[var(--text)] hover:text-[var(--accent)]"
            >
              ×
            </button>
          </div>

          <div className="flex flex-col gap-3 px-3 py-3">
            <label className="flex items-center justify-between gap-2 text-[var(--text)]">
              <span>MSW enabled</span>
              <input
                type="checkbox"
                checked={state.enabled}
                onChange={(e) => apply({ enabled: e.target.checked })}
                className="accent-[var(--accent)]"
              />
            </label>

            <label className="flex items-center justify-between gap-2 text-[var(--text)]">
              <span>Authenticated</span>
              <input
                type="checkbox"
                checked={state.authenticated}
                onChange={(e) => apply({ authenticated: e.target.checked })}
                disabled={!state.enabled}
                className="accent-[var(--accent)] disabled:opacity-40"
              />
            </label>

            <Field
              label="User id"
              value={state.user.id}
              onChange={(v) => apply({ user: { ...state.user, id: v } })}
              disabled={!state.enabled}
            />
            <Field
              label="Email"
              value={state.user.email ?? ''}
              onChange={(v) => apply({ user: { ...state.user, email: v } })}
              disabled={!state.enabled}
            />
            <label className="flex flex-col gap-1 text-[var(--text)]">
              <span className="text-xs uppercase tracking-wide opacity-70">
                Role
              </span>
              <select
                value={state.user.role}
                disabled={!state.enabled}
                onChange={(e) =>
                  apply({
                    user: { ...state.user, role: e.target.value as MockRole },
                  })
                }
                className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text-h)] outline-none focus:border-[var(--accent-border)] disabled:opacity-40"
              >
                {MOCK_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
              <button
                type="button"
                onClick={reset}
                className="cursor-pointer rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)] hover:text-[var(--accent)]"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={dispatchRefetch}
                className="cursor-pointer rounded border border-transparent bg-[var(--accent-bg)] px-2.5 py-1 text-[var(--accent)] hover:border-[var(--accent-border)]"
              >
                Refetch session
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] shadow-[var(--shadow)] hover:text-[var(--accent)]"
          title="Dev auth panel"
        >
          {state.enabled
            ? state.authenticated
              ? `👤 ${state.user.email ?? state.user.id}`
              : '👤 guest'
            : '👤 real auth'}
        </button>
      )}
    </div>
  )
}

type FieldProps = {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}

function Field({ label, value, onChange, disabled }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-[var(--text)]">
      <span className="text-xs uppercase tracking-wide opacity-70">
        {label}
      </span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text-h)] outline-none focus:border-[var(--accent-border)] disabled:opacity-40"
      />
    </label>
  )
}
