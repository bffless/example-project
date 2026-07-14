const DEFAULT_ADMIN_URL = 'https://admin.j5s.dev'

function adminBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_BFFLESS_ADMIN_URL as string | undefined
  return (fromEnv ?? DEFAULT_ADMIN_URL).replace(/\/$/, '')
}

export function getLoginUrl(redirectPath = window.location.pathname): string {
  const redirect = window.location.origin + redirectPath
  const params = new URLSearchParams({ redirect })
  return `${adminBaseUrl()}/login?${params.toString()}`
}

export async function logout(
  redirectPath = window.location.pathname,
): Promise<void> {
  // Primary: SuperTokens' own signout, through the /api/auth/* proxy rule. This
  // is what actually *revokes* the session. The relay's logout below only clears
  // the relay's own cookies (`bffless_access`/`bffless_refresh`) — on the
  // primary domain those don't even exist, so calling it alone would leave the
  // real session alive: the classic BFFless logout footgun.
  try {
    await fetch('/api/auth/signout', {
      method: 'POST',
      credentials: 'include',
      headers: { rid: 'session' },
    })
  } catch {
    // ignored — the admin bounce below is still the source of truth
  }

  // Fallback: clear the relay cookies too, for cross-origin custom domains.
  try {
    await fetch('/_bffless/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // ignored
  }

  const redirect = window.location.origin + redirectPath
  const params = new URLSearchParams({ redirect })
  window.location.href = `${adminBaseUrl()}/logout?${params.toString()}`
}
