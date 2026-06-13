import { useState, useEffect, useMemo, useCallback } from 'react'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { ChatHeader } from './ChatHeader'
import { ChatMessages } from './ChatMessages'
import { ChatInput } from './ChatInput'
import type { BackendMessage, ChatStatus, SuggestionItem } from './types'

const STORAGE_KEY = 'chat_conversation_id'

const suggestions: SuggestionItem[] = [
  { label: 'What can you help me with?', prompt: 'What can you help me with?' },
  { label: 'Tell me about this site', prompt: 'Tell me about this site.' },
  {
    label: 'How do I leave a comment?',
    prompt: 'How do I leave a comment on this site?',
  },
]

const DEFAULT_CONTAINER_CLASS =
  'flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white text-left shadow-[0_20px_60px_-15px_rgba(15,23,42,0.25)] ring-1 ring-black/[0.02] dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.6)] dark:ring-white/[0.04]'

interface ChatPanelProps {
  onClose: () => void
  onNewChat: () => void
  containerClassName?: string
}

export function ChatPanel({ onClose, onNewChat, containerClassName }: ChatPanelProps) {
  const containerClass = containerClassName ?? DEFAULT_CONTAINER_CLASS
  const [conversationId, setConversationId] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY)
  })
  const [input, setInput] = useState('')
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([])

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      }),
    [],
  )

  const {
    messages,
    setMessages,
    status: rawStatus,
    stop,
    sendMessage,
    id: chatId,
    error,
  } = useChat({
    ...(conversationId ? { id: conversationId } : {}),
    transport,
  })

  const status: ChatStatus = useMemo(() => {
    if (rawStatus === 'streaming') return 'streaming'
    if (rawStatus === 'submitted') return 'submitted'
    if (rawStatus === 'error') return 'error'
    return 'ready'
  }, [rawStatus])

  // useChat assigns an id when a fresh conversation starts; mirror it into our
  // persisted conversationId *during render* (React's sanctioned "adjust state
  // when a value changes" pattern) rather than in an effect that would cascade.
  if (chatId && chatId !== conversationId) {
    setConversationId(chatId)
  }

  // Persisting the active id so a reload resumes is a real external-system sync,
  // which is exactly what an effect is for — no setState here.
  useEffect(() => {
    if (chatId) localStorage.setItem(STORAGE_KEY, chatId)
  }, [chatId])

  useEffect(() => {
    const loadHistory = async () => {
      if (!conversationId) return

      setIsLoadingHistory(true)
      try {
        const response = await fetch(
          `/api/chat?conversationId=${encodeURIComponent(conversationId)}`,
        )
        if (response.ok) {
          const result = await response.json()
          if (result.success && Array.isArray(result.data) && result.data.length > 0) {
            const sortedMessages = [...result.data].sort(
              (a: BackendMessage, b: BackendMessage) =>
                new Date(a.created_at || '').getTime() -
                new Date(b.created_at || '').getTime(),
            )
            setInitialMessages(
              sortedMessages.map(
                (msg: BackendMessage): UIMessage => ({
                  id: msg.id,
                  role: msg.role,
                  parts: [{ type: 'text', text: msg.content }],
                }),
              ),
            )
          }
        }
      } catch {
        // Silently fail - start fresh conversation
      } finally {
        setIsLoadingHistory(false)
      }
    }

    loadHistory()
  }, [conversationId])

  useEffect(() => {
    if (initialMessages.length > 0 && messages.length === 0) {
      setMessages(initialMessages)
    }
  }, [initialMessages, messages.length, setMessages])

  const parseRateLimitError = useCallback((err: Error | undefined) => {
    if (!err) return null
    try {
      const match = err.message.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        const errorObj = parsed.error || parsed
        if (errorObj.code === 'RATE_LIMIT_EXCEEDED' && errorObj.details?.retryAfter) {
          return {
            retryAfter: errorObj.details.retryAfter,
            message: errorObj.message || 'Rate limit exceeded',
          }
        }
      }
    } catch {
      // Not a rate limit error
    }
    return null
  }, [])

  // When useChat surfaces a *new* error, seed the countdown from it during render
  // (adjust-on-change pattern) instead of in an effect; the timer effect below
  // then ticks it down.
  const [prevError, setPrevError] = useState(error)
  if (error !== prevError) {
    setPrevError(error)
    const rateLimitInfo = parseRateLimitError(error)
    if (rateLimitInfo) {
      setRateLimitCountdown(rateLimitInfo.retryAfter)
    }
  }

  useEffect(() => {
    if (rateLimitCountdown > 0) {
      const timer = setTimeout(() => {
        setRateLimitCountdown((prev) => prev - 1)
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [rateLimitCountdown])

  const handleSend = useCallback(async () => {
    if (!input.trim() || status === 'streaming' || rateLimitCountdown > 0) return

    const message = input
    setInput('')
    await sendMessage({ text: message })
  }, [input, status, rateLimitCountdown, sendMessage])

  const handleSuggestionClick = useCallback((prompt: string) => {
    setInput(prompt)
  }, [])

  if (isLoadingHistory) {
    return (
      <div className={containerClass}>
        <ChatHeader
          status="ready"
          hasMessages={false}
          onNewChat={onNewChat}
          onClose={onClose}
        />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-200 border-t-terracotta dark:border-zinc-800" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Loading conversation
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={containerClass}>
      <ChatHeader
        status={status}
        hasMessages={messages.length > 0}
        onNewChat={onNewChat}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto bg-zinc-50/50 dark:bg-zinc-900/40">
        <ChatMessages
          messages={messages}
          status={status}
          suggestions={suggestions}
          onSuggestionClick={handleSuggestionClick}
        />
      </div>
      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onStop={stop}
        status={status}
        disabled={rateLimitCountdown > 0}
        rateLimitCountdown={rateLimitCountdown}
      />
    </div>
  )
}
