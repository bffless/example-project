import { Link } from 'react-router-dom'

const LINKS = [
  { label: 'Docs', href: 'https://docs.bffless.app' },
  { label: 'GitHub', href: 'https://github.com/bffless/ce' },
  { label: 'YouTube', href: 'https://www.youtube.com/@bffless' },
]

export function Footer() {
  return (
    <footer className="border-t rule">
      <div className="container-page flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/" className="font-serif text-[18px] font-medium text-ink">
            BFFless<span className="text-terracotta">.</span>
          </Link>
          <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-ink-soft">
            A static site with forms, comments, AI chat, and auth — and no backend to run.
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-5">
          {LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="meta-label transition-colors hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  )
}
