import { useId, useState } from 'react'
import { tokenizeYaml, type TokenKind } from '../lib/highlight'
import { githubUrl, type SourceFile } from '../lib/ruleFiles'

const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: 'text-ink-mute italic',
  key: 'text-terracotta-ink',
  punct: 'text-ink-faint',
  string: 'text-voice-ink',
  plain: '',
}

type Props = {
  file: SourceFile
  /** Clamp to this many lines, with a toggle to reveal the rest. */
  collapseAfter?: number
  /** One line explaining why this file is worth looking at. */
  caption?: string
}

/**
 * Renders a real repo file — the bytes CI deploys, not a transcription of them.
 * YAML gets light syntax colouring; everything else renders as plain monospace.
 */
export function CodeFile({ file, collapseAfter, caption }: Props) {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()

  const lines = file.source.replace(/\n$/, '').split('\n')
  const clamped = collapseAfter !== undefined && !expanded && lines.length > collapseAfter
  const shown = clamped ? lines.slice(0, collapseAfter) : lines

  const yaml = file.lang === 'yaml' ? tokenizeYaml(shown.join('\n')) : null

  return (
    <figure className="m-0 border border-paper-line bg-paper">
      <figcaption className="flex items-center justify-between gap-4 border-b border-paper-line bg-paper-deep/40 px-4 py-2.5">
        <code className="truncate font-mono text-[11.5px] text-ink-soft">{file.path}</code>
        <a
          href={githubUrl(file.path)}
          target="_blank"
          rel="noreferrer"
          className="meta-label flex-shrink-0 transition-colors hover:text-terracotta"
        >
          GitHub ↗
        </a>
      </figcaption>

      <div className="relative">
        <pre
          id={bodyId}
          className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.65] text-ink-soft"
        >
          <code>
            {yaml
              ? yaml.map((tokens, i) => (
                  <span key={i}>
                    {tokens.map((t, j) => (
                      <span key={j} className={TOKEN_CLASS[t.kind]}>
                        {t.text}
                      </span>
                    ))}
                    {'\n'}
                  </span>
                ))
              : shown.join('\n')}
          </code>
        </pre>
        {clamped && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-paper to-transparent"
          />
        )}
      </div>

      {collapseAfter !== undefined && lines.length > collapseAfter && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="w-full border-t border-paper-line px-4 py-2.5 text-left font-mono text-[11.5px] text-ink-mute transition-colors hover:bg-paper-deep/40 hover:text-terracotta"
        >
          {expanded ? '− Collapse' : `+ Show all ${lines.length} lines`}
        </button>
      )}

      {caption && (
        <p className="border-t border-paper-line px-4 py-3 text-[13.5px] leading-relaxed text-ink-mute">
          {caption}
        </p>
      )}
    </figure>
  )
}
