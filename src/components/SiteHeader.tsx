import './SiteHeader.css'

type Props = {
  onContactClick: () => void
}

export function SiteHeader({ onContactClick }: Props) {
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
      </nav>
    </header>
  )
}
