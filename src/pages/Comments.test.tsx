import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Comments } from './Comments'

vi.mock('@bffless/use-bff-state', () => ({
  useBffState: () => ({
    data: { comments: [] },
    update: vi.fn(),
    error: null,
    isUninitialized: false,
    isFetching: false,
    isUpdating: false,
  }),
}))

describe('Comments page', () => {
  it('renders the hero and feature grid', () => {
    render(<Comments />)
    expect(screen.getByText('EP 08 — Comments')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'useBffState' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Data Tables' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Guest identity' })).toBeInTheDocument()
  })

  it('embeds the live comments section', () => {
    render(<Comments />)
    expect(screen.getByText('No comments yet. Be the first.')).toBeInTheDocument()
  })
})
