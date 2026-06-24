import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { UIMessage } from '@ai-sdk/react'
import { ChatPanel } from './ChatPanel'

const STORAGE_KEY = 'chat_conversation_id'

// Controllable useChat mock.
type ChatState = {
  messages: UIMessage[]
  status: string
  id?: string
  error?: Error
}
const chat: ChatState = { messages: [], status: 'ready', id: undefined, error: undefined }
const setMessages = vi.fn()
const stop = vi.fn()
const sendMessage = vi.fn().mockResolvedValue(undefined)

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: chat.messages,
    setMessages,
    status: chat.status,
    stop,
    sendMessage,
    id: chat.id,
    error: chat.error,
  }),
}))

vi.mock('ai', () => ({
  DefaultChatTransport: class {
    opts: unknown
    constructor(opts: unknown) {
      this.opts = opts
    }
  },
}))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  chat.messages = []
  chat.status = 'ready'
  chat.id = undefined
  chat.error = undefined
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ChatPanel', () => {
  it('renders the empty state for a fresh conversation', () => {
    render(<ChatPanel onClose={vi.fn()} onNewChat={vi.fn()} />)
    expect(screen.getByText('Hi there')).toBeInTheDocument()
  })

  it('sends a trimmed message and clears the input', async () => {
    render(<ChatPanel onClose={vi.fn()} onNewChat={vi.fn()} />)
    const textarea = screen.getByPlaceholderText('Type a message') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ text: 'hello world' }))
    expect(textarea.value).toBe('')
  })

  it('does not send when the input is only whitespace', () => {
    render(<ChatPanel onClose={vi.fn()} onNewChat={vi.fn()} />)
    const textarea = screen.getByPlaceholderText('Type a message')
    fireEvent.change(textarea, { target: { value: '   ' } })
    // Send button is disabled, so clicking does nothing.
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('populates the input when a suggestion is clicked', () => {
    render(<ChatPanel onClose={vi.fn()} onNewChat={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /What can you help me with\?/ }))
    expect((screen.getByPlaceholderText('Type a message') as HTMLTextAreaElement).value).toBe(
      'What can you help me with?',
    )
  })

  it('forwards onClose and onNewChat through the header', () => {
    chat.messages = [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as UIMessage]
    const onClose = vi.fn()
    const onNewChat = vi.fn()
    render(<ChatPanel onClose={onClose} onNewChat={onNewChat} />)
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(onNewChat).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Minimize chat' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('persists a new chat id assigned by useChat', async () => {
    chat.id = 'conv-xyz'
    render(<ChatPanel onClose={vi.fn()} onNewChat={vi.fn()} />)
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('conv-xyz'))
  })

  it('loads conversation history for a stored conversation id', async () => {
    localStorage.setItem(STORAGE_KEY, 'conv-1')
    chat.id = 'conv-1'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            { id: 'm2', role: 'assistant', content: 'second', created_at: '2024-02-01T00:00:00Z' },
            { id: 'm1', role: 'user', content: 'first', created_at: '2024-01-01T00:00:00Z' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ChatPanel onClose={vi.fn()} onNewChat={vi.fn()} />)

    await waitFor(() => expect(setMessages).toHaveBeenCalled())
    const loaded = setMessages.mock.calls[0][0] as UIMessage[]
    // Sorted ascending by created_at: user(first) then assistant(second).
    expect(loaded.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(fetchMock).toHaveBeenCalledWith('/api/chat?conversationId=conv-1')
  })

  it('shows a loading screen while history is being fetched', async () => {
    localStorage.setItem(STORAGE_KEY, 'conv-1')
    chat.id = 'conv-1'
    let resolveFetch: (r: Response) => void = () => {}
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ChatPanel onClose={vi.fn()} onNewChat={vi.fn()} />)
    expect(await screen.findByText('Loading conversation')).toBeInTheDocument()

    resolveFetch(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await waitFor(() => expect(screen.queryByText('Loading conversation')).toBeNull())
  })

  it('silently recovers when history fetch rejects', async () => {
    localStorage.setItem(STORAGE_KEY, 'conv-err')
    chat.id = 'conv-err'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))

    render(<ChatPanel onClose={vi.fn()} onNewChat={vi.fn()} />)
    // Falls back to the live (empty) conversation view.
    await waitFor(() => expect(screen.getByText('Hi there')).toBeInTheDocument())
  })

  it('seeds and counts down the rate-limit timer from an error', async () => {
    vi.useFakeTimers()
    try {
      render(<ChatPanel onClose={vi.fn()} onNewChat={vi.fn()} />)

      // Surface a new rate-limit error, then force a re-render via an input change.
      chat.error = new Error(
        'failure: {"error":{"code":"RATE_LIMIT_EXCEEDED","message":"slow down","details":{"retryAfter":3}}}',
      )
      fireEvent.change(screen.getByPlaceholderText('Type a message'), { target: { value: 'x' } })

      expect(screen.getByText(/Rate limited — try again in 3s/)).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByText(/Rate limited — try again in 2s/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses a custom container class when provided', () => {
    const { container } = render(
      <ChatPanel onClose={vi.fn()} onNewChat={vi.fn()} containerClassName="my-panel" />,
    )
    expect(container.querySelector('.my-panel')).toBeInTheDocument()
  })
})
