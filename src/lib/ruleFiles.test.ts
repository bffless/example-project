import { describe, it, expect } from 'vitest'
import { ALL_SOURCE_FILES, githubUrl, CONTACT_RULE } from './ruleFiles'

/**
 * Every file on disk that a page is allowed to render, loaded independently of
 * `ruleFiles.ts` (root-relative glob, raw text, resolved by Vite at transform
 * time — no node:fs, so the app's tsconfig stays free of node globals).
 */
const ON_DISK = import.meta.glob(
  ['/.bffless/proxy-rules/**/*.yaml', '/.bffless/skills/**/*.md', '/src/lib/useSession.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

describe('ruleFiles', () => {
  it.each(ALL_SOURCE_FILES.map((f) => [f.path, f] as const))(
    'renders %s exactly as it exists on disk',
    (path, file) => {
      // The whole point of the ?raw imports: what a page shows IS the file CI
      // deploys. If a `path` label ever stopped matching its `source`, a page
      // would be documenting a file that isn't the one it names.
      expect(ON_DISK[`/${path}`]).toBe(file.source)
      expect(file.source.trim()).not.toBe('')
    },
  )

  it('links a repo path to GitHub', () => {
    expect(githubUrl(CONTACT_RULE.path)).toBe(
      'https://github.com/bffless/example-project/blob/main/.bffless/proxy-rules/api-backend/rules/api/contact/post.rule.yaml',
    )
  })
})
