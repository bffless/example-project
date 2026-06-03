import type { SessionUser } from '../lib/useSession'

const STORAGE_KEY = 'bffless:mockAuth'
const CHANGE_EVENT = 'bffless:mockauth:change'

export type MockAuthState = {
  enabled: boolean
  authenticated: boolean
  user: SessionUser
}

const DEFAULT_USER: SessionUser = {
  id: 'mock-user-1',
  email: 'mock@example.com',
  role: 'admin',
}

export const DEFAULT_MOCK_AUTH: MockAuthState = {
  enabled: true,
  authenticated: true,
  user: DEFAULT_USER,
}

export function readMockAuth(): MockAuthState {
  if (typeof window === 'undefined') return DEFAULT_MOCK_AUTH
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_MOCK_AUTH
    const parsed = JSON.parse(raw) as Partial<MockAuthState>
    return {
      enabled: parsed.enabled ?? DEFAULT_MOCK_AUTH.enabled,
      authenticated: parsed.authenticated ?? DEFAULT_MOCK_AUTH.authenticated,
      user: { ...DEFAULT_USER, ...(parsed.user ?? {}) },
    }
  } catch {
    return DEFAULT_MOCK_AUTH
  }
}

export function writeMockAuth(next: MockAuthState): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

export function onMockAuthChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = () => handler()
  window.addEventListener(CHANGE_EVENT, listener)
  return () => window.removeEventListener(CHANGE_EVENT, listener)
}
