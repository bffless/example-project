import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHero } from './PageHero'

describe('PageHero', () => {
  it('renders the eyebrow and title', () => {
    render(<PageHero eyebrow="EP 08 · Comments" title="A title" />)
    expect(screen.getByText('EP 08 · Comments')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'A title' })).toBeInTheDocument()
  })

  it('renders the lead paragraph when provided', () => {
    render(<PageHero eyebrow="x" title="t" lead="a leading sentence" />)
    expect(screen.getByText('a leading sentence')).toBeInTheDocument()
  })

  it('omits the lead when not provided', () => {
    render(<PageHero eyebrow="x" title="t" />)
    expect(screen.queryByText('a leading sentence')).toBeNull()
  })

  it('renders children actions', () => {
    render(
      <PageHero eyebrow="x" title="t">
        <button type="button">Do it</button>
      </PageHero>,
    )
    expect(screen.getByRole('button', { name: 'Do it' })).toBeInTheDocument()
  })
})
