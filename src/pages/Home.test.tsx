import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Home } from './Home'

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  )
}

describe('Home', () => {
  it('renders the hero heading', () => {
    renderHome()
    expect(screen.getByText(/No backend to run\./)).toBeInTheDocument()
  })

  it('renders a card for each capability linking to its route', () => {
    renderHome()
    expect(screen.getByRole('heading', { name: 'Forms & uploads' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Comments' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI chat' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Auth & roles' })).toBeInTheDocument()

    const explore = screen.getByRole('link', { name: /Explore the demos/ })
    expect(explore).toHaveAttribute('href', '/forms')
  })

  it('links to the GitHub source', () => {
    renderHome()
    expect(screen.getByRole('link', { name: /Source on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/bffless/ce',
    )
  })

  it('renders the featured video embed', () => {
    renderHome()
    expect(screen.getByText(/Featured/)).toBeInTheDocument()
  })
})
