import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CodeFile } from './CodeFile'
import type { SourceFile } from '../lib/ruleFiles'

const yaml: SourceFile = {
  path: '.bffless/proxy-rules/api-backend/rules/api/contact/post.rule.yaml',
  source: ['# a comment', 'description: hello', 'pipeline:', '  name: Contact', '  steps: []'].join(
    '\n',
  ),
  lang: 'yaml',
}

describe('CodeFile', () => {
  it('renders the file verbatim', () => {
    render(<CodeFile file={yaml} />)
    // Highlighting must never change the bytes a visitor reads.
    expect(screen.getByRole('figure').querySelector('pre')?.textContent?.trim()).toBe(
      yaml.source.trim(),
    )
  })

  it('labels the file with its repo path and links to it on GitHub', () => {
    render(<CodeFile file={yaml} />)
    expect(screen.getByText(yaml.path)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /github/i })).toHaveAttribute(
      'href',
      `https://github.com/bffless/example-project/blob/main/${yaml.path}`,
    )
  })

  it('clamps a long file until asked to expand it', () => {
    render(<CodeFile file={yaml} collapseAfter={2} />)

    const toggle = screen.getByRole('button', { name: '+ Show all 5 lines' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('figure').textContent).not.toContain('steps: []')

    fireEvent.click(toggle)

    expect(screen.getByRole('figure').textContent).toContain('steps: []')
    expect(screen.getByRole('button', { name: '− Collapse' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('does not offer a toggle for a file shorter than the clamp', () => {
    render(<CodeFile file={yaml} collapseAfter={10} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders a non-YAML file as plain text', () => {
    render(<CodeFile file={{ path: 'notes.md', source: '# Title\n\nBody.', lang: 'markdown' }} />)
    expect(screen.getByRole('figure').textContent).toContain('# Title')
  })

  it('shows the caption when given one', () => {
    render(<CodeFile file={yaml} caption="Why this file matters." />)
    expect(screen.getByText('Why this file matters.')).toBeInTheDocument()
  })
})
