import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { VideoEmbed } from '../components/VideoEmbed'
import { CodeFile } from '../components/CodeFile'
import { Endpoints, type EndpointSpec } from '../components/Endpoint'
import { RulesAsCode } from '../components/RulesAsCode'
import { SERVE_ATTACHMENT_RULE, UPLOAD_RULE, USE_SESSION } from '../lib/ruleFiles'
import { useSession } from '../lib/useSession'
import { getLoginUrl, logout } from '../lib/auth'
import { EPISODES } from '../lib/episodes'

const RELAY_ENDPOINTS: EndpointSpec[] = [
  {
    method: 'GET',
    path: '/_bffless/auth/session',
    summary: 'Who is this visitor? Returns { authenticated, user } from the session cookie.',
    tag: 'built in',
  },
  {
    method: 'POST',
    path: '/_bffless/auth/refresh',
    summary: 'Renews an expired session without a round-trip through the login page.',
    tag: 'built in',
  },
  {
    method: 'POST',
    path: '/_bffless/auth/logout',
    summary: 'Clears the session cookie, then the admin bounce completes the sign-out.',
    tag: 'built in',
  },
]

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

      <Section eyebrow="— The implementation" title={<>Where auth actually happens<Dot /></>}>
        <p className="mb-8 max-w-3xl text-[16px] leading-relaxed text-ink-soft">
          This page is the odd one out: it has no proxy rule of its own. The session endpoints are
          built into BFFless — nothing to define, nothing to deploy. What you <em>do</em> write is
          where a session is <em>required</em>, and that's a line of YAML in the rule set.
        </p>

        <Endpoints endpoints={RELAY_ENDPOINTS} />

        <p className="mt-6 max-w-3xl text-[15px] leading-relaxed text-ink-mute">
          Logging in bounces through the admin origin (
          <code className="font-mono text-[13.5px] text-ink">admin.j5s.dev/login?redirect=…</code>)
          and comes back with a cookie scoped to this site — the cross-domain dance, handled for
          you. The panel above is that cookie, read through the relay.
        </p>

        <h3 className="mt-12 mb-5 font-serif text-[26px] leading-[1.1] text-ink">
          Gating a route: one validator
        </h3>
        <p className="mb-6 max-w-3xl text-[15px] leading-relaxed text-ink-soft">
          The contact form's attachments are the demo's protected resource. Both the upload and the
          download carry an{' '}
          <code className="font-mono text-[14px] text-ink">auth_required</code> validator, so an
          anonymous request is refused at the edge — before the pipeline runs, and regardless of
          what the frontend chose to render.
        </p>

        <div className="grid gap-6 lg:grid-cols-2">
          <CodeFile
            file={SERVE_ATTACHMENT_RULE}
            caption="Reading an attachment requires a session. Guessing the URL isn't enough — this is why uploaded files aren't quietly public."
          />
          <CodeFile
            file={UPLOAD_RULE}
            collapseAfter={14}
            caption="Writing one requires a session too. allowApiKey lets CI and agents authenticate with a key instead of a cookie."
          />
        </div>

        <h3 className="mt-12 mb-5 font-serif text-[26px] leading-[1.1] text-ink">
          Reading the session from React
        </h3>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <CodeFile
            file={USE_SESSION}
            collapseAfter={16}
            caption="The client half: one hook over /_bffless/auth/session, with a module-level promise so a page full of auth-aware components still only asks once."
          />
          <div className="border border-paper-line bg-paper-deep/20 p-6 md:p-7">
            <p className="mb-3 meta-label">— The rule of thumb</p>
            <p className="text-[15px] leading-relaxed text-ink-soft">
              Treat what the browser knows about a session as a <em>hint</em>, good for deciding
              what to render. It is never what keeps a file private — the validator on the rule is.
              A static site can't enforce anything, and with BFFless it doesn't have to.
            </p>
          </div>
        </div>

        <RulesAsCode setName="api-backend" />
      </Section>

      <Section eyebrow="— Watch" title={<>Auth, end to end<Dot /></>} divider={false}>
        <VideoEmbed
          episodes={[EPISODES.authentication, EPISODES.authorization, EPISODES.onboarding]}
        />
      </Section>
    </>
  )
}
