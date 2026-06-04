import { Link } from 'react-router-dom'
import { Dot } from '../components/Section'
import { VideoEmbed } from '../components/VideoEmbed'
import { EPISODES } from '../lib/episodes'

type Capability = {
  to: string
  tag: string
  title: string
  body: string
  points: string[]
}

const CAPABILITIES: Capability[] = [
  {
    to: '/forms',
    tag: 'EP 05 · 07',
    title: 'Forms & uploads',
    body: 'A contact form that posts to a Pipeline — validation, storage, and email, no server code. Signed-in visitors can attach files.',
    points: ['Pipeline handlers', 'File uploads to storage', 'Auth-gated fields'],
  },
  {
    to: '/comments',
    tag: 'EP 08',
    title: 'Comments',
    body: 'A live comment wall backed by a BFFless Data Table through the useBffState hook — guest IDs, loading states, optimistic posts.',
    points: ['useBffState', 'Data Tables', 'Guest identity'],
  },
  {
    to: '/chat',
    tag: 'Walkthrough',
    title: 'AI chat',
    body: 'A streaming assistant built on the Vercel AI SDK, proxied through BFFless with conversation history persisted for you.',
    points: ['Streaming', 'Message persistence', 'Skills'],
  },
  {
    to: '/auth',
    tag: 'EP 14 · 15 · 17',
    title: 'Auth & roles',
    body: 'Cookie-based sessions via the built-in admin login relay, with roles, permissions, and onboarding automation.',
    points: ['Cross-domain login', 'Roles & permissions', 'Onboarding pipelines'],
  },
]

export function Home() {
  return (
    <>
      {/* Hero */}
      <header className="border-b rule">
        <div className="container-page py-20 md:py-28">
          <div className="mb-6 flex items-center justify-between">
            <span className="meta-label">A live BFFless playground</span>
            <span className="hidden meta-label sm:inline">Static build · No backend</span>
          </div>
          <h1 className="max-w-5xl font-serif text-[44px] leading-[0.98] tracking-[-0.015em] text-ink md:text-[72px]">
            <span className="font-sans font-bold">Forms, comments, chat,</span>{' '}
            <em className="font-medium not-italic">and auth</em>
            <Dot />
            <br />
            <em className="italic">No backend to run.</em>
          </h1>
          <p className="mt-7 max-w-2xl text-[17px] leading-relaxed text-ink-soft md:text-[19px]">
            Every section below is a real, working component on this static site — wired to
            BFFless for storage, proxying, and auth. Open one, try it, then watch the episode
            that builds it.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link to="/forms" className="pill-cta">
              Explore the demos
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <a href="https://github.com/bffless/ce" className="pill-ghost">
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
                />
              </svg>
              Source on GitHub
            </a>
          </div>
        </div>
      </header>

      {/* Capability grid */}
      <section className="border-b rule">
        <div className="container-page py-14 md:py-20">
          <div className="mb-8 flex items-end justify-between md:mb-12">
            <div>
              <p className="mb-4 meta-label">— Four capabilities</p>
              <h2 className="font-serif text-3xl leading-[1.05] tracking-[-0.01em] text-ink md:text-[40px]">
                Pick a primitive<Dot /> Try it live<Dot />
              </h2>
            </div>
          </div>

          <div className="grid border-l border-t border-paper-line sm:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <Link
                key={c.to}
                to={c.to}
                className="group flex flex-col border-b border-r border-paper-line bg-paper p-7 transition-colors hover:bg-paper-deep/40 md:p-9"
              >
                <div className="mb-5 flex items-center justify-between">
                  <span className="meta-label">{c.tag}</span>
                  <svg
                    className="h-4 w-4 text-ink-faint transition-all group-hover:translate-x-0.5 group-hover:text-terracotta"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h3 className="font-serif text-[24px] leading-[1.1] text-ink md:text-[26px]">
                  {c.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{c.body}</p>
                <ul className="mt-5 space-y-1.5 border-t border-paper-line pt-4">
                  {c.points.map((p) => (
                    <li key={p} className="font-mono text-[12px] text-ink-mute">
                      <span className="text-terracotta">›</span> {p}
                    </li>
                  ))}
                </ul>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured video */}
      <section>
        <div className="container-page py-14 md:py-20">
          <div className="mb-8 md:mb-12">
            <p className="mb-4 meta-label">— Start here</p>
            <h2 className="max-w-3xl font-serif text-3xl leading-[1.05] tracking-[-0.01em] text-ink md:text-[40px]">
              See the whole thing come together<Dot />
            </h2>
          </div>
          <VideoEmbed episodes={EPISODES.chat} label="Featured" />
        </div>
      </section>
    </>
  )
}
