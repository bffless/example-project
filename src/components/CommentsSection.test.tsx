import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CommentsSection } from './CommentsSection'

const useBffStateMock = vi.fn()
vi.mock('@bffless/use-bff-state', () => ({
  useBffState: (...args: unknown[]) => useBffStateMock(...args),
}))

type HookState = {
  data: { comments: unknown[] }
  update: ReturnType<typeof vi.fn>
  error?: { message: string } | null
  isUninitialized?: boolean
  isFetching?: boolean
  isUpdating?: boolean
}

function setHook(overrides: Partial<HookState> = {}) {
  const update = overrides.update ?? vi.fn().mockResolvedValue(undefined)
  useBffStateMock.mockReturnValue({
    data: overrides.data ?? { comments: [] },
    update,
    error: overrides.error ?? null,
    isUninitialized: overrides.isUninitialized ?? false,
    isFetching: overrides.isFetching ?? false,
    isUpdating: overrides.isUpdating ?? false,
  })
  return update
}

describe('CommentsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading row while uninitialized', () => {
    setHook({ isUninitialized: true })
    render(<CommentsSection />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows the empty state when there are no comments', () => {
    setHook()
    render(<CommentsSection />)
    expect(screen.getByText('No comments yet. Be the first.')).toBeInTheDocument()
  })

  it('renders comments sorted newest-first', () => {
    setHook({
      data: {
        comments: [
          { id: '1', name: 'Older', comment: 'first', guest_id: 'g', createdAt: '2024-01-01T00:00:00Z' },
          { id: '2', name: 'Newer', comment: 'second', guest_id: 'g', createdAt: '2024-02-01T00:00:00Z' },
        ],
      },
    })
    render(<CommentsSection />)
    const names = screen.getAllByText(/Older|Newer/).map((n) => n.textContent)
    expect(names[0]).toBe('Newer')
    expect(names[1]).toBe('Older')
  })

  it('does not submit when name or comment is blank', () => {
    const update = setHook()
    render(<CommentsSection />)
    fireEvent.submit(screen.getByRole('button', { name: 'Post comment' }).closest('form')!)
    expect(update).not.toHaveBeenCalled()
  })

  it('submits a trimmed payload and clears the fields on success', async () => {
    const update = setHook()
    render(<CommentsSection />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Ada  ' } })
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: '  hi there  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ name: 'Ada', comment: 'hi there' }))
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(''))
    expect((screen.getByLabelText('Comment') as HTMLTextAreaElement).value).toBe('')
  })

  it('shows a posting status while updating', () => {
    setHook({ isUpdating: true })
    render(<CommentsSection />)
    expect(screen.getByText('Posting…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post comment' })).toBeDisabled()
  })

  it('surfaces the hook error message', () => {
    setHook({ error: { message: 'boom' } })
    render(<CommentsSection />)
    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('surfaces a submit error when update rejects', async () => {
    const update = vi.fn().mockRejectedValue(new Error('post failed'))
    setHook({ update })
    render(<CommentsSection />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('post failed'))
  })

  it('renders a raw timestamp unchanged when it is not a valid date', () => {
    setHook({
      data: {
        comments: [
          { id: '1', name: 'X', comment: 'c', guest_id: 'g', createdAt: 'not-a-date' },
        ],
      },
    })
    render(<CommentsSection />)
    expect(screen.getByText('not-a-date')).toBeInTheDocument()
  })
})
