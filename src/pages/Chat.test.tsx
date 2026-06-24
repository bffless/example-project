import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Chat } from './Chat'

// Stub ChatPanel so the page test doesn't depend on the AI SDK.
vi.mock('../components/ChatPopup/ChatPanel', () => ({
  ChatPanel: ({ onClose, onNewChat }: { onClose: () => void; onNewChat: () => void }) => (
    <div data-testid="chat-panel">
      <button type="button" onClick={onClose}>
        minimize
      </button>
      <button type="button" onClick={onNewChat}>
        new
      </button>
    </div>
  ),
}))

describe('Chat page', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the hero and feature grid with the panel visible', () => {
    render(<Chat />)
    expect(screen.getByText('Walkthrough — AI chat')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Streaming' })).toBeInTheDocument()
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
  })

  it('minimizes the assistant and can reopen it', () => {
    render(<Chat />)
    fireEvent.click(screen.getByRole('button', { name: 'minimize' }))
    expect(screen.queryByTestId('chat-panel')).toBeNull()
    expect(screen.getByText('The assistant is minimized.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open the assistant' }))
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
  })

  it('clears the stored conversation id when a new chat is started', () => {
    localStorage.setItem('chat_conversation_id', 'conv-1')
    render(<Chat />)
    fireEvent.click(screen.getByRole('button', { name: 'new' }))
    expect(localStorage.getItem('chat_conversation_id')).toBeNull()
  })
})
