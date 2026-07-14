const DEFAULT_ADMIN_URL = 'https://admin.j5s.dev'

/** BFFless primary domain. Hosts at or under it share the SuperTokens cookie. */
const PRIMARY_DOMAIN = 'j5s.dev'

function adminBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_BFFLESS_ADMIN_URL as string | undefined
  return (fromEnv ?? DEFAULT_ADMIN_URL).replace(/\/$/, '')
}

/**
 * True on the primary domain or one of its subdomains, where `sAccessToken`
 * reaches this origin directly. Anywhere else — localhost dev, a cross-origin
 * custom domain — the shared cookie can't arrive, so login has to go through
 * the custom-domain relay instead.
 */
function isUnderPrimaryDomain(): boolean {
  const host = window.location.hostname
  return host === PRIMARY_DOMAIN || host.endsWith('.' + PRIMARY_DOMAIN)
}

export function getLoginUrl(redirectPath = window.location.pathname): string {
  if (isUnderPrimaryDomain()) {
    // Primary domain (+ subdomains): a full-page bounce carries the shared
    // cookie back, so `redirect` is an ABSOLUTE URL — admin returns us to this
    // origin rather than stranding us on its own.
    const params = new URLSearchParams({ redirect: window.location.origin + redirectPath })
    return `${adminBaseUrl()}/login?${params.toString()}`
  }

  // Off the primary domain (localhost dev, cross-origin custom domains): the
  // shared cookie can't reach this origin, so relay a per-domain `bffless_access`
  // in via the admin. Match CE's `POST /api/auth/domain-token` contract:
  //   - `targetDomain` must be a bare host (no port) — its validator rejects a
  //     `:port`, and it's matched against the registered domain mapping.
  //   - `redirect` is a PATH; admin passes it through as `redirectPath`.
  const params = new URLSearchParams({
    customDomainRelay: 'true',
    targetDomain: window.location.hostname,
    redirect: redirectPath,
  })
  // The port can't live in `targetDomain`, so on localhost it rides in
  // `targetOrigin` instead — CE only honours that override when targetDomain is
  // exactly localhost/127.0.0.1, and builds the callback URL from it (keeping
  // the dev port). Real custom domains have no port, so they don't need it.
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    params.set('targetOrigin', window.location.origin)
  }
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
