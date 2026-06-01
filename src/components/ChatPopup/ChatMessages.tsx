import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { UIMessage } from '@ai-sdk/react'
import type { ChatStatus, SuggestionItem } from './types'

interface ChatMessagesProps {
  messages: UIMessage[]
  status: ChatStatus
  suggestions: SuggestionItem[]
  onSuggestionClick: (prompt: string) => void
}

function getMessageText(message: UIMessage): string {
  if (!message.parts || message.parts.length === 0) return ''
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function EmptyState({
  suggestions,
  onSuggestionClick,
}: {
  suggestions: SuggestionItem[]
  onSuggestionClick: (prompt: string) => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="mb-6 text-center">
        <div className="mb-3 flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-blue-600 dark:text-blue-400"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
        </div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Hi there!</h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">How can I help you?</p>
      </div>
      <div className="w-full space-y-2">
        {suggestions.map((s) => (
          <button
            type="button"
            key={s.prompt}
            onClick={() => onSuggestionClick(s.prompt)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-left text-sm text-zinc-700 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-blue-500 dark:hover:bg-zinc-700"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ChatMessages({
  messages,
  status,
  suggestions,
  onSuggestionClick,
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return <EmptyState suggestions={suggestions} onSuggestionClick={onSuggestionClick} />
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {messages.map((message) => {
        const text = getMessageText(message)
        const isUser = message.role === 'user'

        return (
          <div
            key={message.id}
            className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                isUser
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
              }`}
            >
              {isUser ? (
                <p className="text-sm whitespace-pre-wrap">{text}</p>
              ) : (
                <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_pre]:bg-zinc-800 [&_pre]:text-zinc-100 [&_pre]:rounded-md [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:text-xs">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )
      })}
      {status === 'streaming' && messages[messages.length - 1]?.role === 'user' && (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-2 dark:bg-zinc-800">
            <div className="flex gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" />
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  )
}
