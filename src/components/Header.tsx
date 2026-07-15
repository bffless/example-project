import { useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useSession } from '../lib/useSession'
import { getLoginUrl, logout } from '../lib/auth'
import { ScheduleDemoDialog } from './ScheduleDemoDialog'

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/forms', label: 'Forms' },
  { to: '/comments', label: 'Comments' },
  { to: '/chat', label: 'Chat' },
  { to: '/auth', label: 'Auth' },
  { to: '/studio', label: 'Studio' },
]

export function Header() {
  const { session, loading } = useSession()
  const [demoOpen, setDemoOpen] = useState(false)
  const isAuthed = session?.authenticated === true
  const userLabel = isAuthed ? (session.user.email ?? session.user.id) : null

  return (
    <header className="sticky top-0 z-40 border-b rule bg-paper/85 backdrop-blur">
      <div className="container-page flex h-14 items-center justify-between gap-4">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="font-serif text-[18px] font-medium text-ink">
            BFFless<span className="text-terracotta">.</span>
          </span>
          <span className="meta-label hidden sm:inline">Playground</span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'rounded-md px-2.5 py-1.5 text-[14px] transition-colors sm:px-3',
                  isActive
                    ? 'text-terracotta'
                    : 'text-ink-soft hover:text-ink',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}

          <button
            type="button"
            onClick={() => setDemoOpen(true)}
            className="cursor-pointer rounded-full border border-terracotta px-3.5 py-1.5 font-mono text-[13px] text-terracotta transition-colors hover:bg-terracotta hover:text-paper"
          >
            Schedule a demo
          </button>

          <span className="mx-1 hidden h-5 w-px bg-paper-line sm:inline-block" aria-hidden="true" />

          {loading ? (
            <span
              aria-hidden="true"
              className="inline-block h-7 w-16 rounded-md bg-ink/10"
            />
          ) : isAuthed ? (
            <div className="flex items-center gap-2">
              <span
                title={session.user.id}
                className="hidden max-w-[18ch] truncate font-mono text-[13px] text-ink-mute md:inline"
              >
                {userLabel}
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                className="cursor-pointer rounded-full border border-ink px-3.5 py-1.5 font-mono text-[13px] text-ink transition-colors hover:bg-ink hover:text-paper"
              >
                Log out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                window.location.href = getLoginUrl()
              }}
              className="cursor-pointer rounded-full bg-terracotta px-3.5 py-1.5 font-mono text-[13px] text-paper transition-colors hover:bg-terracotta-hover"
            >
              Log in
            </button>
          )}
        </nav>
      </div>

      <ScheduleDemoDialog open={demoOpen} onClose={() => setDemoOpen(false)} />
    </header>
  )
}
