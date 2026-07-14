import { PageHero } from '../components/PageHero'
import { Section, Dot } from '../components/Section'
import { VideoEmbed } from '../components/VideoEmbed'
import { CodeFile } from '../components/CodeFile'
import { Endpoints, type EndpointSpec } from '../components/Endpoint'
import { RulesAsCode } from '../components/RulesAsCode'
import { AUTH_PROXY_RULE, SERVE_ATTACHMENT_RULE, UPLOAD_RULE, USE_SESSION } from '../lib/ruleFiles'
import { useSession } from '../lib/useSession'
import { getLoginUrl, logout } from '../lib/auth'
import { EPISODES } from '../lib/episodes'

const AUTH_ENDPOINTS: EndpointSpec[] = [
  {
    method: 'GET',
    path: '/api/auth/session',
    summary: 'Who is this visitor? Returns the canonical BFFless user — id, email, role.',
    tag: 'primary',
  },
  {
    method: 'POST',
    path: '/api/auth/session/refresh',
    summary: 'Renews an expired session. SuperTokens rotates the refresh token here.',
    tag: 'primary',
  },
  {
    method: 'POST',
    path: '/api/auth/signout',
    summary: 'Actually revokes the session — the only endpoint that does.',
    tag: 'primary',
  },
  {
    method: 'GET',
    path: '/_bffless/auth/session',
    summary: 'The built-in relay. Authenticates cross-origin custom domains, where the above cannot.',
    tag: 'fallback',
  },
]

const PIECES = [
  {
    tag: 'EP 15',
    title: 'Authentication',
    body: 'An admin login relay handles the cross-domain dance. A proxy rule puts SuperTokens on this origin, and your static site reads a cookie-backed session — no auth server to stand up.',
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
            <span className="meta-label">/api/auth/session</span>
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

      <Section eyebrow="— The implementation" title={<>One rule makes auth work<Dot /></>}>
        <p className="mb-8 max-w-3xl text-[16px] leading-relaxed text-ink-soft">
          Auth on a static site rests on a single, unglamorous proxy rule: it reverse-proxies{' '}
          <code className="font-mono text-[15px] text-ink">/api/auth/*</code> to the BFFless
          backend, putting SuperTokens' own endpoints on <em>this</em> origin. Without it, nothing
          below works — and it fails in a way that's easy to miss, which is the interesting part.
        </p>

        <Endpoints endpoints={AUTH_ENDPOINTS} />

        <div className="mt-12 grid items-start gap-6 lg:grid-cols-2">
          <CodeFile
            file={AUTH_PROXY_RULE}
            collapseAfter={13}
            caption="The rule that makes SuperTokens same-origin. forwardCookies is what carries the session cookie through — it's off by default."
          />
          <div className="border border-terracotta/30 bg-terracotta/[0.06] p-6 md:p-7">
            <p className="mb-3 meta-label text-terracotta">— Why /api/auth and not /auth</p>
            <p className="text-[15px] leading-relaxed text-ink-soft">
              SuperTokens path-scopes the refresh-token cookie to exactly{' '}
              <code className="font-mono text-[13.5px] text-ink">/api/auth/session/refresh</code>.
              Mount the proxy anywhere else and the browser simply won't send that cookie — so
              reading a session still works (the access-token cookie is scoped to{' '}
              <code className="font-mono text-[13.5px] text-ink">/</code>), but{' '}
              <em className="not-italic text-ink">refreshing one silently fails</em>. The site looks
              fine, then quietly logs people out an hour later.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
              <code className="font-mono text-[13.5px] text-ink">/auth</code> is SuperTokens'{' '}
              <em>website</em> base path — the login page, a client route. It is not where the
              endpoints live.
            </p>
          </div>
        </div>

        <h3 className="mt-12 mb-5 font-serif text-[26px] leading-[1.1] text-ink">
          The relay is a fallback, not the front door
        </h3>
        <p className="mb-6 max-w-3xl text-[15px] leading-relaxed text-ink-soft">
          BFFless also ships built-in{' '}
          <code className="font-mono text-[14px] text-ink">/_bffless/auth/*</code> endpoints, and
          it's tempting to just use those — they need no rule at all. But they exist for the case
          where the proxy <em>can't</em> work: a cross-origin custom domain, where SuperTokens'
          cookies never reach the origin. On your primary domain they under-hydrate the user (no{' '}
          <code className="font-mono text-[13.5px] text-ink">role</code>), can't refresh the real
          session, and can't revoke it on logout. So: proxied first, relay second — which is exactly
          what the hook below does.
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
            caption="The client half. Note the single-flight refresh mutex: SuperTokens rotates the refresh token on every call, so two concurrent refreshes race on the same cookie — the loser can trip token-theft detection."
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
