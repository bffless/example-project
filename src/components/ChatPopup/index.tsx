import { useState, useCallback } from 'react'
import { ChatPanel } from './ChatPanel'

const STORAGE_KEY = 'chat_conversation_id'

export function ChatPopup() {
  const [isOpen, setIsOpen] = useState(false)
  const [chatKey, setChatKey] = useState(() => Date.now())

  const handleNewChat = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setChatKey(Date.now())
  }, [])

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open chat"
          className="fixed right-6 bottom-6 z-[70] flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700 hover:shadow-xl dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {isOpen && (
        <div className="fixed right-4 bottom-4 z-[80] h-[600px] w-[400px] max-h-[80vh] animate-slide-up max-sm:inset-2 max-sm:h-auto max-sm:w-auto">
          <ChatPanel
            key={chatKey}
            onClose={() => setIsOpen(false)}
            onNewChat={handleNewChat}
          />
        </div>
      )}
    </>
  )
}
