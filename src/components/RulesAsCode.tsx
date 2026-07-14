const RECIPE_URL = 'https://docs.bffless.app/recipes/proxy-rules-as-code/'
const SET_URL =
  'https://github.com/bffless/example-project/tree/main/.bffless/proxy-rules'

/**
 * The shared footer of every implementation section: where these files live and
 * how they reach production. Same story on all four pages, told once.
 */
export function RulesAsCode({ setName }: { setName: string }) {
  return (
    <div className="mt-8 border border-paper-line bg-paper-deep/30 p-6 md:p-7">
      <p className="mb-3 meta-label">— Proxy rules as code</p>
      <p className="max-w-3xl text-[15px] leading-relaxed text-ink-soft">
        The files above aren't a description of the backend — they{' '}
        <em className="not-italic text-ink">are</em> the backend. They live in the{' '}
        <code className="font-mono text-[13.5px] text-ink">{setName}</code> rule set under{' '}
        <a
          href={SET_URL}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[13.5px] text-terracotta underline decoration-terracotta/30 underline-offset-2 hover:decoration-terracotta"
        >
          .bffless/proxy-rules/
        </a>
        , get reviewed in the pull request alongside the React that calls them, and are synced
        to BFFless by <code className="font-mono text-[13.5px] text-ink">deploy-proxy-rules</code>{' '}
        on merge — before the new bundle goes live, so a route never lands after the code that
        needs it.
      </p>
      <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] text-ink-mute">
        <span>
          <span className="text-terracotta">›</span> bffless rules test
        </span>
        <span>
          <span className="text-terracotta">›</span> bffless rules diff
        </span>
        <span>
          <span className="text-terracotta">›</span> bffless rules push
        </span>
      </p>
      <a
        href={RECIPE_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex items-center gap-2 text-[14px] font-semibold text-terracotta hover:text-terracotta-hover"
      >
        Read the recipe
        <svg
          className="h-3 w-3"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </div>
  )
}
