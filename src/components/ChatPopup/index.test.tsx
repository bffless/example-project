import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatPopup } from './index'

// Stub the panel so this test focuses on the open/close shell behavior.
vi.mock('./ChatPanel', () => ({
  ChatPanel: ({ onClose, onNewChat }: { onClose: () => void; onNewChat: () => void }) => (
    <div data-testid="chat-panel">
      <button type="button" onClick={onClose}>
        panel-close
      </button>
      <button type="button" onClick={onNewChat}>
        panel-new
      </button>
    </div>
  ),
}))

describe('ChatPopup', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows only the launcher button initially', () => {
    render(<ChatPopup />)
    expect(screen.getByRole('button', { name: 'Open chat' })).toBeInTheDocument()
    expect(screen.queryByTestId('chat-panel')).toBeNull()
  })

  it('opens the panel when the launcher is clicked', () => {
    render(<ChatPopup />)
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open chat' })).toBeNull()
  })

  it('closes the panel and restores the launcher', () => {
    render(<ChatPopup />)
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'panel-close' }))
    expect(screen.getByRole('button', { name: 'Open chat' })).toBeInTheDocument()
  })

  it('clears the stored conversation id when starting a new chat', () => {
    localStorage.setItem('chat_conversation_id', 'conv-1')
    render(<ChatPopup />)
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'panel-new' }))
    expect(localStorage.getItem('chat_conversation_id')).toBeNull()
  })
})
