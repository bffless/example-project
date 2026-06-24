import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { UIMessage } from '@ai-sdk/react'
import { ChatMessages } from './ChatMessages'
import type { SuggestionItem } from './types'

beforeAll(() => {
  // jsdom doesn't implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn()
})

const suggestions: SuggestionItem[] = [
  { label: 'Help?', prompt: 'What can you help me with?' },
  { label: 'Site?', prompt: 'Tell me about this site.' },
]

function msg(id: string, role: 'user' | 'assistant', text: string): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] } as UIMessage
}

describe('ChatMessages', () => {
  it('renders the empty state with suggestions when there are no messages', () => {
    const onSuggestionClick = vi.fn()
    render(
      <ChatMessages
        messages={[]}
        status="ready"
        suggestions={suggestions}
        onSuggestionClick={onSuggestionClick}
      />,
    )
    expect(screen.getByText('Hi there')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Help\?/ }))
    expect(onSuggestionClick).toHaveBeenCalledWith('What can you help me with?')
  })

  it('renders user and assistant messages', () => {
    render(
      <ChatMessages
        messages={[msg('1', 'user', 'hello'), msg('2', 'assistant', 'hi back')]}
        status="ready"
        suggestions={suggestions}
        onSuggestionClick={vi.fn()}
      />,
    )
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('hi back')).toBeInTheDocument()
  })

  it('renders assistant markdown as formatted html', () => {
    render(
      <ChatMessages
        messages={[msg('1', 'assistant', '**bold text**')]}
        status="ready"
        suggestions={suggestions}
        onSuggestionClick={vi.fn()}
      />,
    )
    expect(screen.getByText('bold text').tagName).toBe('STRONG')
  })

  it('shows a typing indicator while streaming after a user message', () => {
    const { container } = render(
      <ChatMessages
        messages={[msg('1', 'user', 'waiting…')]}
        status="streaming"
        suggestions={suggestions}
        onSuggestionClick={vi.fn()}
      />,
    )
    // Three bouncing dots
    expect(container.querySelectorAll('.animate-bounce')).toHaveLength(3)
  })

  it('does not show a typing indicator when the last message is from the assistant', () => {
    const { container } = render(
      <ChatMessages
        messages={[msg('1', 'user', 'q'), msg('2', 'assistant', 'a')]}
        status="streaming"
        suggestions={suggestions}
        onSuggestionClick={vi.fn()}
      />,
    )
    expect(container.querySelectorAll('.animate-bounce')).toHaveLength(0)
  })

  it('renders an empty string for a message with no parts', () => {
    render(
      <ChatMessages
        messages={[{ id: '1', role: 'user', parts: [] } as UIMessage]}
        status="ready"
        suggestions={suggestions}
        onSuggestionClick={vi.fn()}
      />,
    )
    // No crash; the empty-state heading should not appear since there is a message.
    expect(screen.queryByText('Hi there')).toBeNull()
  })
})
