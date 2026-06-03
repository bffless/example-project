import { useSession } from '../lib/useSession'
import './SiteHeader.css'

type Props = {
  onContactClick: () => void
}

const ADMIN_LOGIN_URL =
  (import.meta.env.VITE_ADMIN_LOGIN_URL as string | undefined) ??
  'https://admin.j5s.dev/login'

const ADMIN_LOGOUT_URL = ADMIN_LOGIN_URL.replace(/\/login(\?.*)?$/, '/logout')

export function SiteHeader({ onContactClick }: Props) {
  const { session, loading } = useSession()
  const authenticated = session?.authenticated === true
  const user = authenticated ? session.user : null

  async function handleLogin() {
    const params = new URLSearchParams({
      customDomainRelay: 'true',
      targetDomain: window.location.host,
      redirect: window.location.pathname,
    })
    window.location.href = `${ADMIN_LOGIN_URL}?${params.toString()}`
  }

  async function handleLogout() {
    // Clear bffless_access/refresh cookies that live on this domain
    // (no-op on workspace subdomains, required for custom domains).
    try {
      await fetch('/_bffless/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // ignore — the admin bounce below is the source of truth
    }
    // Bounce through admin to revoke the SuperTokens session, then come back.
    const redirect = window.location.origin + window.location.pathname
    const params = new URLSearchParams({ redirect })
    window.location.href = `${ADMIN_LOGOUT_URL}?${params.toString()}`
  }

  return (
    <header className="site-header">
      <a className="site-header__brand" href="/">
        BFFless demo
      </a>
      <nav className="site-header__nav">
        {!loading && authenticated && (
          <span
            className="text-[13px] text-zinc-600 dark:text-zinc-300"
            title={String(user?.id ?? '')}
          >
            Signed in as{' '}
            <strong className="font-semibold text-zinc-900 dark:text-zinc-50">
              {String(user?.email ?? user?.id ?? 'user')}
            </strong>
            {user?.role ? (
              <span className="ml-1 opacity-70">({String(user.role)})</span>
            ) : null}
          </span>
        )}
        <button
          type="button"
          className="site-header__contact"
          onClick={onContactClick}
        >
          Contact
        </button>
        {!loading && !authenticated && (
          <button
            type="button"
            onClick={handleLogin}
            className="rounded-md border border-zinc-300 px-3.5 py-1.5 font-mono text-[15px] text-zinc-700 transition-colors hover:border-zinc-900 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-100 dark:hover:text-zinc-50"
          >
            Log in
          </button>
        )}
        {!loading && authenticated && (
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md border border-zinc-300 px-3.5 py-1.5 font-mono text-[15px] text-zinc-700 transition-colors hover:border-zinc-900 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-100 dark:hover:text-zinc-50"
          >
            Log out
          </button>
        )}
      </nav>
    </header>
  )
}
