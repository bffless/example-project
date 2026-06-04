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
    <div className="flex flex-col px-4 pt-6 pb-4 text-left">
      <div className="mb-5">
        <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Hi there
        </h3>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          Ask anything about this site.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="mb-1 px-0.5 text-[10px] font-semibold tracking-[0.08em] text-zinc-400 uppercase dark:text-zinc-500">
          Suggested
        </p>
        {suggestions.map((s) => (
          <button
            type="button"
            key={s.prompt}
            onClick={() => onSuggestionClick(s.prompt)}
            className="group flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-left text-sm text-zinc-700 transition-all hover:-translate-y-px hover:border-terracotta/50 hover:text-zinc-900 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            <span>{s.label}</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-zinc-300 transition-all group-hover:translate-x-0.5 group-hover:text-terracotta dark:text-zinc-600"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
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
    <div className="flex flex-col gap-3 px-4 py-4 text-left">
      {messages.map((message) => {
        const text = getMessageText(message)
        const isUser = message.role === 'user'

        return (
          <div
            key={message.id}
            className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={
                isUser
                  ? 'max-w-[85%] rounded-2xl rounded-br-md bg-terracotta px-3.5 py-2 text-paper shadow-sm shadow-terracotta/20'
                  : 'max-w-[85%] rounded-2xl rounded-bl-md border border-zinc-200/80 bg-white px-3.5 py-2 text-zinc-900 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'
              }
            >
              {isUser ? (
                <p className="text-[13.5px] leading-snug whitespace-pre-wrap">{text}</p>
              ) : (
                <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none text-left text-[13.5px] leading-snug [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] dark:[&_code]:bg-zinc-800 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-zinc-900 [&_pre]:p-2.5 [&_pre]:text-[12px] [&_pre]:text-zinc-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )
      })}
      {status === 'streaming' && messages[messages.length - 1]?.role === 'user' && (
        <div className="flex justify-start">
          <div className="rounded-2xl rounded-bl-md border border-zinc-200/80 bg-white px-3.5 py-2.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s] dark:bg-zinc-500" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s] dark:bg-zinc-500" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" />
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  )
}
