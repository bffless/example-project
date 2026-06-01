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
          className="group fixed right-6 bottom-6 z-[70] flex h-13 w-13 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-[0_10px_30px_-5px_rgba(37,99,235,0.5)] ring-1 ring-white/10 transition-all hover:-translate-y-0.5 hover:shadow-[0_15px_40px_-5px_rgba(37,99,235,0.6)] active:translate-y-0 dark:from-blue-400 dark:to-blue-600"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform group-hover:scale-110"
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
