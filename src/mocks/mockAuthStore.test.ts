import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CHANGE_EVENT,
  MOCK_ROLES,
  STORAGE_KEY,
  readMockAuth,
  writeMockAuth,
  type MockAuthState,
} from './mockAuthStore'

describe('mockAuthStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('readMockAuth', () => {
    it('returns the default state when nothing is stored', () => {
      expect(readMockAuth()).toEqual({
        enabled: true,
        authenticated: false,
        user: { id: 'dev-user-1', email: 'dev@example.com', role: 'user' },
      })
    })

    it('merges a stored partial state over the defaults', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ authenticated: true, user: { id: 'someone', role: 'admin' } }),
      )
      const state = readMockAuth()
      expect(state.authenticated).toBe(true)
      expect(state.user.id).toBe('someone')
      expect(state.user.role).toBe('admin')
      // email falls back to the default since it wasn't overridden
      expect(state.user.email).toBe('dev@example.com')
    })

    it('falls back to the default role when an invalid role is stored', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ user: { id: 'x', role: 'superadmin' } }),
      )
      expect(readMockAuth().user.role).toBe('user')
    })

    it('returns the default state on malformed JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not json')
      expect(readMockAuth().user.id).toBe('dev-user-1')
    })

    it('exposes the known role set', () => {
      expect(MOCK_ROLES).toEqual(['admin', 'user', 'member'])
    })
  })

  describe('writeMockAuth', () => {
    it('persists the state and dispatches a change event with the new state', () => {
      const next: MockAuthState = {
        enabled: true,
        authenticated: true,
        user: { id: 'w-1', email: 'w@e.co', role: 'member' },
      }
      const listener = vi.fn()
      window.addEventListener(CHANGE_EVENT, listener)

      writeMockAuth(next)

      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(next)
      expect(listener).toHaveBeenCalledTimes(1)
      const evt = listener.mock.calls[0][0] as CustomEvent<MockAuthState>
      expect(evt.detail).toEqual(next)

      window.removeEventListener(CHANGE_EVENT, listener)
    })

    it('round-trips through readMockAuth', () => {
      const next: MockAuthState = {
        enabled: false,
        authenticated: true,
        user: { id: 'rt', email: 'rt@e.co', role: 'admin' },
      }
      writeMockAuth(next)
      expect(readMockAuth()).toEqual(next)
    })
  })
})
