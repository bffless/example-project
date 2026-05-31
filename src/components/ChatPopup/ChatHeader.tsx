import type { ChatStatus } from './types'

interface ChatHeaderProps {
  status: ChatStatus
  hasMessages: boolean
  onNewChat: () => void
  onClose: () => void
  rounded?: boolean
}

function getStatusText(status: ChatStatus): string {
  switch (status) {
    case 'streaming':
      return 'Responding...'
    case 'submitted':
      return 'Thinking...'
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
      return 'bg-green-500'
  }
}

export function ChatHeader({
  status,
  hasMessages,
  onNewChat,
  onClose,
  rounded = true,
}: ChatHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900${
        rounded ? ' rounded-t-2xl' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
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
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
            Chat Assistant
          </h3>
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${getStatusColor(status)}`} />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {getStatusText(status)}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {hasMessages && (
          <button
            type="button"
            onClick={onNewChat}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            New Chat
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="16" x2="16" y2="16" />
          </svg>
        </button>
      </div>
    </div>
  )
}
