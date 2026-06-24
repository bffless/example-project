import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// MOCKS_ENABLED is resolved at module-eval time, so each case re-imports the
// module fresh after arranging the environment.
async function loadFlag(): Promise<boolean> {
  vi.resetModules()
  const mod = await import('./config')
  return mod.MOCKS_ENABLED
}

describe('MOCKS_ENABLED resolution', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllEnvs()
    window.history.replaceState({}, '', '/')
  })

  it('defaults to on with no override or env', async () => {
    expect(await loadFlag()).toBe(true)
  })

  it('honours ?mocks=off and persists it to localStorage', async () => {
    window.history.replaceState({}, '', '/?mocks=off')
    expect(await loadFlag()).toBe(false)
    expect(localStorage.getItem('mocks')).toBe('off')
  })

  it('honours ?mocks=on and persists it', async () => {
    window.history.replaceState({}, '', '/?mocks=on')
    expect(await loadFlag()).toBe(true)
    expect(localStorage.getItem('mocks')).toBe('on')
  })

  it('reads a previously persisted off value', async () => {
    localStorage.setItem('mocks', 'off')
    expect(await loadFlag()).toBe(false)
  })

  it('reads a previously persisted on value', async () => {
    localStorage.setItem('mocks', 'on')
    expect(await loadFlag()).toBe(true)
  })

  it('falls back to off when VITE_MOCKS is "false"', async () => {
    vi.stubEnv('VITE_MOCKS', 'false')
    expect(await loadFlag()).toBe(false)
  })
})
