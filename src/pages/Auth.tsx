import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { VideoEmbed } from '../components/VideoEmbed'
import { useSession } from '../lib/useSession'
import { getLoginUrl, logout } from '../lib/auth'
import { EPISODES } from '../lib/episodes'

const PIECES = [
  {
    tag: 'EP 15',
    title: 'Authentication',
    body: 'A built-in admin login relay handles the cross-domain dance. Your static site reads /_bffless/auth/session and gets a cookie-backed session — no auth server to stand up.',
  },
  {
    tag: 'EP 14',
    title: 'Authorization',
    body: 'Two levels of roles — global and per-project — gate what each visitor can see and do. Permissions are checked at the edge.',
  },
  {
    tag: 'EP 17',
    title: 'Onboarding',
    body: 'A Pipeline can run on signup to auto-grant access, send a welcome, or seed data — turning a new login into a ready-to-use account.',
  },
]

export function Auth() {
  const { session, loading, refetch } = useSession()
  const isAuthed = session?.authenticated === true

  return (
    <>
      <PageHero
        eyebrow="EP 14 · 15 · 17 — Auth & roles"
        title={
          <>
            Real auth on a static site<Dot />
          </>
        }
        lead="Cookie-based sessions through the BFFless admin login relay, with roles, permissions, and onboarding automation. The panel below reflects your actual session state."
      >
        {!loading &&
          (isAuthed ? (
            <button type="button" className="pill-ghost" onClick={() => void logout()}>
              Log out
            </button>
          ) : (
            <button
              type="button"
              className="pill-cta"
              onClick={() => {
                window.location.href = getLoginUrl('/auth')
              }}
            >
              Log in to try it
            </button>
          ))}
      </PageHero>

      <Section eyebrow="— Live session" title={<>Your session, right now<Dot /></>}>
        <div className="border border-paper-line bg-paper-deep/30 p-6 md:p-8">
          <div className="flex items-center justify-between">
            <span className="meta-label">/_bffless/auth/session</span>
            <button
              type="button"
              onClick={refetch}
              className="font-mono text-[12px] text-ink-mute transition-colors hover:text-terracotta"
            >
              Refetch
            </button>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span
              className={[
                'inline-block h-2.5 w-2.5 rounded-full',
                loading ? 'bg-ink-faint' : isAuthed ? 'bg-emerald-600' : 'bg-ink-faint',
              ].join(' ')}
              aria-hidden="true"
            />
            <span className="font-serif text-[22px] text-ink">
              {loading ? 'Checking…' : isAuthed ? 'Authenticated' : 'Not signed in'}
            </span>
          </div>
          <pre className="mt-5 overflow-x-auto rounded-md border border-paper-line bg-paper p-4 font-mono text-[12.5px] leading-relaxed text-ink-soft">
            {JSON.stringify(session ?? { authenticated: null }, null, 2)}
          </pre>
          {import.meta.env.DEV && (
            <p className="mt-4 text-[13.5px] leading-relaxed text-ink-mute">
              In dev, use the <span className="font-mono text-ink">Dev auth</span> panel
              (bottom-left) to toggle authentication, switch roles, and refetch the session
              against MSW — no real login required.
            </p>
          )}
        </div>
      </Section>

      <Section eyebrow="— The pieces" title={<>Login, roles, and onboarding<Dot /></>}>
        <div className="grid border-l border-t border-paper-line md:grid-cols-3">
          {PIECES.map((p) => (
            <div
              key={p.title}
              className="border-b border-r border-paper-line bg-paper p-7 md:p-8"
            >
              <span className="meta-label">{p.tag}</span>
              <h3 className="mt-4 font-serif text-[20px] leading-[1.15] text-ink">{p.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="— Watch" title={<>Auth, end to end<Dot /></>} divider={false}>
        <VideoEmbed
          episodes={[EPISODES.authentication, EPISODES.authorization, EPISODES.onboarding]}
        />
      </Section>
    </>
  )
}
