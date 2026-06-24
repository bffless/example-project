import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { VideoEmbed } from './VideoEmbed'
import type { Episode } from '../lib/episodes'

const epA: Episode = { id: 'aaa', ep: '05', title: 'First Episode' }
const epB: Episode = { id: 'bbb', ep: null, title: 'Walkthrough Episode' }

describe('VideoEmbed', () => {
  it('renders a single episode with the default label and no episode list', () => {
    render(<VideoEmbed episodes={epA} />)
    expect(screen.getByText(/Watch · Episode 05/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Episodes' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'First Episode' })).toBeInTheDocument()
  })

  it('uses a custom label', () => {
    render(<VideoEmbed episodes={epA} label="Featured" />)
    expect(screen.getByText(/Featured · Episode 05/)).toBeInTheDocument()
  })

  it('renders a Walkthrough label when the episode has no number', () => {
    render(<VideoEmbed episodes={epB} />)
    // header span: "Watch" with no episode suffix
    expect(screen.getByText('Watch')).toBeInTheDocument()
    expect(screen.getAllByText('Walkthrough').length).toBeGreaterThan(0)
  })

  it('swaps the thumbnail to the player iframe when play is clicked', () => {
    render(<VideoEmbed episodes={epA} />)
    const playBtn = screen.getByRole('button', { name: 'Play First Episode' })
    fireEvent.click(playBtn)
    const iframe = screen.getByTitle('First Episode')
    expect(iframe).toHaveAttribute(
      'src',
      expect.stringContaining('youtube-nocookie.com/embed/aaa'),
    )
  })

  it('falls back to the lo-res thumbnail when the hi-res image errors', () => {
    render(<VideoEmbed episodes={epA} />)
    const img = screen.getByAltText('First Episode') as HTMLImageElement
    expect(img.src).toContain('maxresdefault.jpg')
    fireEvent.error(img)
    expect(img.src).toContain('hqdefault.jpg')
  })

  it('links out to YouTube for the active episode', () => {
    render(<VideoEmbed episodes={epA} />)
    expect(screen.getByRole('link', { name: /Watch on YouTube/ })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=aaa',
    )
  })

  describe('with multiple episodes', () => {
    it('renders the episode selector list', () => {
      render(<VideoEmbed episodes={[epA, epB]} />)
      const list = screen.getByRole('list', { name: 'Episodes' })
      expect(within(list).getByText('First Episode')).toBeInTheDocument()
      expect(within(list).getByText('Walkthrough Episode')).toBeInTheDocument()
    })

    it('marks the first episode as current initially', () => {
      render(<VideoEmbed episodes={[epA, epB]} />)
      const buttons = screen.getAllByRole('button')
      const current = buttons.find((b) => b.getAttribute('aria-current') === 'true')
      expect(current).toBeTruthy()
      expect(within(current!).getByText('First Episode')).toBeInTheDocument()
    })

    it('switches the active episode and resets the player when another is selected', () => {
      render(<VideoEmbed episodes={[epA, epB]} />)
      // Start playing the first episode.
      fireEvent.click(screen.getByRole('button', { name: 'Play First Episode' }))
      expect(screen.getByTitle('First Episode')).toBeInTheDocument()

      // Select the second episode from the list.
      const list = screen.getByRole('list', { name: 'Episodes' })
      fireEvent.click(within(list).getByText('Walkthrough Episode'))

      // Player resets back to the thumbnail for the new active episode.
      expect(screen.queryByTitle('First Episode')).toBeNull()
      expect(
        screen.getByRole('button', { name: 'Play Walkthrough Episode' }),
      ).toBeInTheDocument()
    })
  })
})
