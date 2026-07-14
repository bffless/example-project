import type { ReactNode } from 'react'

const METHOD_CLASS: Record<string, string> = {
  GET: 'bg-voice/15 text-voice-ink',
  POST: 'bg-terracotta/15 text-terracotta-ink',
}

export type EndpointSpec = {
  method: 'GET' | 'POST'
  path: string
  /** What the route does, in one line. */
  summary: ReactNode
  /** e.g. "auth required" — rendered as a mono tag on the right. */
  tag?: string
}

/** The API surface of a page, as a table of routes. */
export function Endpoints({ endpoints }: { endpoints: EndpointSpec[] }) {
  return (
    <ul className="list-none border-t border-paper-line">
      {endpoints.map((e) => (
        <li
          key={`${e.method} ${e.path}`}
          className="flex flex-col gap-2 border-b border-paper-line py-4 md:flex-row md:items-baseline md:gap-5"
        >
          <span
            className={[
              'inline-flex flex-shrink-0 items-center rounded-sm px-2 py-1 font-mono text-[11px] font-semibold tracking-wider',
              METHOD_CLASS[e.method],
            ].join(' ')}
          >
            {e.method}
          </span>
          <code className="flex-shrink-0 font-mono text-[13.5px] text-ink md:w-[19rem]">
            {e.path}
          </code>
          <span className="flex-1 text-[14.5px] leading-relaxed text-ink-soft">{e.summary}</span>
          {e.tag && (
            <span className="meta-label flex-shrink-0 text-terracotta">{e.tag}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

export type ChainStep = {
  /** The BFFless handler type, e.g. `form_handler`. */
  handler: string
  detail: ReactNode
}

/** The handler chain a request runs through, in order. */
export function HandlerChain({ steps, note }: { steps: ChainStep[]; note?: ReactNode }) {
  return (
    <div>
      {/* This site loads Tailwind without preflight, so a bare <ol> still gets
          native markers — which would double up with the step numbers below. */}
      <ol className="grid list-none border-l border-t border-paper-line md:grid-cols-2">
        {steps.map((s, i) => (
          <li
            key={s.handler + i}
            className="flex gap-4 border-b border-r border-paper-line bg-paper p-5"
          >
            <span className="font-serif text-[22px] leading-none text-terracotta">{i + 1}</span>
            <div>
              <code className="font-mono text-[13px] text-ink">{s.handler}</code>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      {note && <p className="mt-4 text-[14px] leading-relaxed text-ink-mute">{note}</p>}
    </div>
  )
}
