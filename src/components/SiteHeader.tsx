import { useSession } from '../lib/useSession'
import { getLoginUrl, logout } from '../lib/auth'
import './SiteHeader.css'

type Props = {
  onContactClick: () => void
}

export function SiteHeader({ onContactClick }: Props) {
  const { session, loading } = useSession()

  const handleLogin = () => {
    window.location.href = getLoginUrl()
  }

  const handleLogout = () => {
    void logout()
  }

  const isAuthed = session?.authenticated === true
  const userLabel = isAuthed
    ? session.user.email ?? session.user.id
    : null

  return (
    <header className="site-header">
      <a className="site-header__brand" href="/">
        BFFless demo
      </a>
      <nav className="site-header__nav">
        <button
          type="button"
          className="site-header__contact"
          onClick={onContactClick}
        >
          Contact
        </button>
        {loading ? (
          <span
            aria-hidden="true"
            className="inline-block h-7 w-16 rounded-md bg-[var(--accent-bg)] opacity-40"
          />
        ) : isAuthed ? (
          <>
            <span
              title={session.user.id}
              className="max-w-[18ch] truncate font-mono text-[var(--text)] opacity-75"
            >
              {userLabel}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="cursor-pointer rounded-md border border-[var(--border)] bg-transparent px-3.5 py-1.5 font-mono text-[var(--text)] transition-colors hover:border-[var(--accent-border)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Log out
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleLogin}
            className="cursor-pointer rounded-md border-2 border-transparent bg-[var(--accent-bg)] px-3.5 py-1.5 font-mono text-[var(--accent)] transition-colors hover:border-[var(--accent-border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Log in
          </button>
        )}
      </nav>
    </header>
  )
}
