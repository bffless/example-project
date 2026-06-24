import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DevAuthPanel } from './DevAuthPanel'
import { CHANGE_EVENT, STORAGE_KEY, readMockAuth } from '../mocks/mockAuthStore'

describe('DevAuthPanel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('starts collapsed showing a guest toggle button', () => {
    render(<DevAuthPanel />)
    // Default state is enabled + not authenticated => "guest"
    expect(screen.getByRole('button', { name: /guest/ })).toBeInTheDocument()
  })

  it('opens the panel when the toggle is clicked', () => {
    render(<DevAuthPanel />)
    fireEvent.click(screen.getByRole('button', { name: /guest/ }))
    expect(screen.getByText('Dev auth')).toBeInTheDocument()
    expect(screen.getByText('MSW enabled')).toBeInTheDocument()
  })

  it('closes the panel via the close button', () => {
    render(<DevAuthPanel />)
    fireEvent.click(screen.getByRole('button', { name: /guest/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Close dev auth panel' }))
    expect(screen.queryByText('Dev auth')).toBeNull()
  })

  it('toggling Authenticated persists the change and fires a refetch event', () => {
    const refetch = vi.fn()
    window.addEventListener('bffless:auth:refetch', refetch)

    render(<DevAuthPanel />)
    fireEvent.click(screen.getByRole('button', { name: /guest/ }))

    const authedCheckbox = screen.getByRole('checkbox', { name: 'Authenticated' })
    fireEvent.click(authedCheckbox)

    expect(readMockAuth().authenticated).toBe(true)
    expect(refetch).toHaveBeenCalled()

    window.removeEventListener('bffless:auth:refetch', refetch)
  })

  it('disables the auth fields when MSW is turned off', () => {
    render(<DevAuthPanel />)
    fireEvent.click(screen.getByRole('button', { name: /guest/ }))

    const mswCheckbox = screen.getByRole('checkbox', { name: 'MSW enabled' })
    fireEvent.click(mswCheckbox)

    expect(readMockAuth().enabled).toBe(false)
    expect(screen.getByRole('checkbox', { name: 'Authenticated' })).toBeDisabled()
    expect(screen.getByLabelText('User id')).toBeDisabled()
  })

  it('edits the email field and persists it', () => {
    render(<DevAuthPanel />)
    fireEvent.click(screen.getByRole('button', { name: /guest/ }))

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@e.co' } })
    expect(readMockAuth().user.email).toBe('new@e.co')
  })

  it('changes the role via the select', () => {
    render(<DevAuthPanel />)
    fireEvent.click(screen.getByRole('button', { name: /guest/ }))

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'admin' } })
    expect(readMockAuth().user.role).toBe('admin')
  })

  it('resets back to defaults and dispatches a refetch', () => {
    const refetch = vi.fn()
    window.addEventListener('bffless:auth:refetch', refetch)

    render(<DevAuthPanel />)
    fireEvent.click(screen.getByRole('button', { name: /guest/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Authenticated' }))
    refetch.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(refetch).toHaveBeenCalled()

    window.removeEventListener('bffless:auth:refetch', refetch)
  })

  it('manually dispatches a refetch from the Refetch session button', () => {
    const refetch = vi.fn()
    window.addEventListener('bffless:auth:refetch', refetch)

    render(<DevAuthPanel />)
    fireEvent.click(screen.getByRole('button', { name: /guest/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Refetch session' }))
    expect(refetch).toHaveBeenCalled()

    window.removeEventListener('bffless:auth:refetch', refetch)
  })

  it('reacts to an external mock-auth change event', () => {
    render(<DevAuthPanel />)
    fireEvent.click(screen.getByRole('button', { name: /guest/ }))

    fireEvent(
      window,
      new CustomEvent(CHANGE_EVENT, {
        detail: {
          enabled: true,
          authenticated: true,
          user: { id: 'ext', email: 'ext@e.co', role: 'member' },
        },
      }),
    )

    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('ext@e.co')
  })

  it('shows the real-auth label when MSW is disabled and collapsed', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ enabled: false, authenticated: false, user: { id: 'x', role: 'user' } }),
    )
    render(<DevAuthPanel />)
    expect(screen.getByRole('button', { name: /real auth/ })).toBeInTheDocument()
  })
})
