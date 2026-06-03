const DEFAULT_ADMIN_URL = 'https://admin.j5s.dev'

function adminBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_BFFLESS_ADMIN_URL as string | undefined
  return (fromEnv ?? DEFAULT_ADMIN_URL).replace(/\/$/, '')
}

export function getLoginUrl(redirectPath = window.location.pathname): string {
  const params = new URLSearchParams({
    customDomainRelay: 'true',
    targetDomain: window.location.host,
    redirect: redirectPath,
  })
  return `${adminBaseUrl()}/login?${params.toString()}`
}

export async function logout(
  redirectPath = window.location.pathname,
): Promise<void> {
  try {
    await fetch('/_bffless/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // ignored — the admin bounce below is the source of truth
  }

  const redirect = window.location.origin + redirectPath
  const params = new URLSearchParams({ redirect })
  window.location.href = `${adminBaseUrl()}/logout?${params.toString()}`
}
