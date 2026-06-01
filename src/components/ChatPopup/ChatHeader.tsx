import type { ChatStatus } from './types'

interface ChatHeaderProps {
  status: ChatStatus
  hasMessages: boolean
  onNewChat: () => void
  onClose: () => void
}

function getStatusText(status: ChatStatus): string {
  switch (status) {
    case 'streaming':
      return 'Responding'
    case 'submitted':
      return 'Thinking'
    case 'error':
      return 'Error'
    default:
      return 'Online'
  }
}

function getStatusColor(status: ChatStatus): string {
  switch (status) {
    case 'streaming':
    case 'submitted':
      return 'bg-amber-500'
    case 'error':
      return 'bg-red-500'
    default:
      return 'bg-emerald-500'
  }
}

export function ChatHeader({ status, hasMessages, onNewChat, onClose }: ChatHeaderProps) {
  const isActive = status === 'streaming' || status === 'submitted'
  const dotColor = getStatusColor(status)

  return (
    <div className="flex items-center justify-between border-b border-zinc-200/80 bg-white/80 px-4 py-3 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="flex items-center gap-3">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm shadow-blue-600/30 dark:from-blue-400 dark:to-blue-600">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div className="leading-tight">
          <h3 className="text-[13px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Chat Assistant
          </h3>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              {isActive && (
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${dotColor}`}
                />
              )}
              <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotColor}`} />
            </span>
            <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              {getStatusText(status)}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {hasMessages && (
          <button
            type="button"
            onClick={onNewChat}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            New chat
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Minimize chat"
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
        </button>
      </div>
    </div>
  )
}
