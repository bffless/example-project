import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Forms } from './Forms'

vi.mock('../lib/useSession', () => ({
  useSession: () => ({ session: { authenticated: false }, loading: false, refetch: vi.fn() }),
}))

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '')
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open')
    }
  }
})

describe('Forms page', () => {
  it('renders the hero and the how-it-works steps', () => {
    render(<Forms />)
    expect(screen.getByText('EP 05 · 07 — Forms & uploads')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /A proxy rule forwards \/api\/contact/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /A Pipeline handles the submission/ }),
    ).toBeInTheDocument()
  })

  it('opens the contact dialog from the hero CTA', () => {
    render(<Forms />)
    expect(screen.queryByLabelText('Name')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open the contact form' })[0])
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('opens the contact dialog from the live-demo CTA', () => {
    render(<Forms />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Open the contact form' })[1])
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })
})
