import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatHeader } from './ChatHeader'

describe('ChatHeader', () => {
  it('shows Online status by default', () => {
    render(<ChatHeader status="ready" hasMessages={false} onNewChat={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Online')).toBeInTheDocument()
  })

  it('maps each status to its label', () => {
    const cases: Array<[Parameters<typeof ChatHeader>[0]['status'], string]> = [
      ['streaming', 'Responding'],
      ['submitted', 'Thinking'],
      ['error', 'Error'],
      ['ready', 'Online'],
    ]
    for (const [status, label] of cases) {
      const { unmount } = render(
        <ChatHeader status={status} hasMessages={false} onNewChat={vi.fn()} onClose={vi.fn()} />,
      )
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
  })

  it('hides the New chat button when there are no messages', () => {
    render(<ChatHeader status="ready" hasMessages={false} onNewChat={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull()
  })

  it('shows the New chat button and calls onNewChat when clicked', () => {
    const onNewChat = vi.fn()
    render(<ChatHeader status="ready" hasMessages={true} onNewChat={onNewChat} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(onNewChat).toHaveBeenCalled()
  })

  it('calls onClose when the minimize button is clicked', () => {
    const onClose = vi.fn()
    render(<ChatHeader status="ready" hasMessages={false} onNewChat={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Minimize chat' }))
    expect(onClose).toHaveBeenCalled()
  })
})
