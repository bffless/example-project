import { describe, it, expect } from 'vitest'
import { EPISODES, thumbHi, thumbLo, watchUrl } from './episodes'

describe('episodes', () => {
  it('builds the hi-res thumbnail url', () => {
    expect(thumbHi('abc123')).toBe('https://i.ytimg.com/vi/abc123/maxresdefault.jpg')
  })

  it('builds the lo-res thumbnail url', () => {
    expect(thumbLo('abc123')).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg')
  })

  it('builds the watch url', () => {
    expect(watchUrl('abc123')).toBe('https://www.youtube.com/watch?v=abc123')
  })

  it('exposes the expected episode entries', () => {
    expect(EPISODES.contactForm).toEqual({
      id: 'fERJjwsLnSI',
      ep: '05',
      title: 'Pipelines: Contact Form Handler',
    })
    expect(EPISODES.chat.ep).toBeNull()
    // Every entry has an id and title.
    for (const ep of Object.values(EPISODES)) {
      expect(typeof ep.id).toBe('string')
      expect(ep.id.length).toBeGreaterThan(0)
      expect(typeof ep.title).toBe('string')
    }
  })
})
