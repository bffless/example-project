import { useRef, useEffect } from 'react'
import type { KeyboardEvent } from 'react'
import type { ChatStatus } from './types'

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  status: ChatStatus
  disabled?: boolean
  rateLimitCountdown?: number
}

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  status,
  disabled,
  rateLimitCountdown,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px'
      const scrollHeight = textareaRef.current.scrollHeight
      textareaRef.current.style.height = `${Math.min(scrollHeight, 120)}px`
    }
  }, [value])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!disabled && value.trim() && status !== 'streaming') {
        onSend()
      }
    }
  }

  const isStreaming = status === 'streaming' || status === 'submitted'
  const canSend = !disabled && !!value.trim()
  const buttonDisabled = !isStreaming && !canSend

  return (
    <div className="border-t border-zinc-200/80 bg-white px-3 pt-2.5 pb-3 dark:border-zinc-800 dark:bg-zinc-950">
      {rateLimitCountdown !== undefined && rateLimitCountdown > 0 && (
        <p className="mb-2 text-center text-[11px] font-medium text-amber-600 dark:text-amber-400">
          Rate limited — try again in {rateLimitCountdown}s
        </p>
      )}
      <div className="flex items-end gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-1.5 transition-colors focus-within:border-terracotta focus-within:bg-white focus-within:ring-2 focus-within:ring-terracotta/20 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:bg-zinc-900">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message"
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[13.5px] leading-snug text-zinc-900 placeholder-zinc-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-50 dark:placeholder-zinc-500"
          style={{ minHeight: '40px', maxHeight: '120px' }}
        />
        <button
          type="button"
          onClick={isStreaming ? onStop : onSend}
          disabled={buttonDisabled}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-terracotta text-paper shadow-sm shadow-terracotta/30 transition-all hover:bg-terracotta-hover hover:shadow-md hover:shadow-terracotta/40 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
          aria-label={isStreaming ? 'Stop' : 'Send'}
        >
          {isStreaming ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
