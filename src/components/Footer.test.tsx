import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Footer } from './Footer'

function renderFooter() {
  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  )
}

describe('Footer', () => {
  it('renders the tagline', () => {
    renderFooter()
    expect(
      screen.getByText(/A static site with forms, comments, AI chat, and auth/),
    ).toBeInTheDocument()
  })

  it('renders the external links with new-tab safety attributes', () => {
    renderFooter()
    const docs = screen.getByRole('link', { name: 'Docs' })
    expect(docs).toHaveAttribute('href', 'https://docs.bffless.app')
    expect(docs).toHaveAttribute('target', '_blank')
    expect(docs).toHaveAttribute('rel', 'noopener noreferrer')

    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/bffless/ce',
    )
    expect(screen.getByRole('link', { name: 'YouTube' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/@bffless',
    )
  })
})
