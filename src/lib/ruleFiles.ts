/**
 * The BFFless rule-set sources rendered on the demo pages.
 *
 * Each file is imported with Vite's `?raw`, so a page shows the *exact* bytes
 * that CI syncs to BFFless (`bffless/deploy-proxy-rules`, see
 * `.github/workflows/deploy.yml`). The documentation on this site therefore
 * cannot drift from the endpoint it documents: change the rule, and the page
 * that explains it changes with it.
 */
import contactRule from '../../.bffless/proxy-rules/api-backend/rules/api/contact/post.rule.yaml?raw'
import contactsSchema from '../../.bffless/proxy-rules/api-backend/schemas/contacts.schema.yaml?raw'
import uploadRule from '../../.bffless/proxy-rules/api-backend/rules/api/uploads/contact-attachments/post.rule.yaml?raw'
import serveAttachmentRule from '../../.bffless/proxy-rules/api-backend/rules/api/uploads/contact-attachments/[...path]/get.rule.yaml?raw'
import commentsGetRule from '../../.bffless/proxy-rules/api-backend/rules/api/comments/get.rule.yaml?raw'
import commentsPostRule from '../../.bffless/proxy-rules/api-backend/rules/api/comments/post.rule.yaml?raw'
import commentsSchema from '../../.bffless/proxy-rules/api-backend/schemas/comments.schema.yaml?raw'
import chatPostRule from '../../.bffless/proxy-rules/chat_pipelines/rules/api/chat/post.rule.yaml?raw'
import chatGetRule from '../../.bffless/proxy-rules/chat_pipelines/rules/api/chat/get.rule.yaml?raw'
import chatSkill from '../../.bffless/skills/site-overview/SKILL.md?raw'
import useSessionSource from './useSession.ts?raw'

export type Lang = 'yaml' | 'markdown' | 'typescript'

export type SourceFile = {
  /** Repo-relative path — also the label shown above the code. */
  path: string
  /** The file's contents, verbatim. */
  source: string
  lang: Lang
}

const REPO = 'https://github.com/bffless/example-project'

/** Link to a repo file on GitHub's default branch. */
export function githubUrl(path: string): string {
  return `${REPO}/blob/main/${path}`
}

const RULES = '.bffless/proxy-rules'

export const CONTACT_RULE: SourceFile = {
  path: `${RULES}/api-backend/rules/api/contact/post.rule.yaml`,
  source: contactRule,
  lang: 'yaml',
}

export const CONTACTS_SCHEMA: SourceFile = {
  path: `${RULES}/api-backend/schemas/contacts.schema.yaml`,
  source: contactsSchema,
  lang: 'yaml',
}

export const UPLOAD_RULE: SourceFile = {
  path: `${RULES}/api-backend/rules/api/uploads/contact-attachments/post.rule.yaml`,
  source: uploadRule,
  lang: 'yaml',
}

export const SERVE_ATTACHMENT_RULE: SourceFile = {
  path: `${RULES}/api-backend/rules/api/uploads/contact-attachments/[...path]/get.rule.yaml`,
  source: serveAttachmentRule,
  lang: 'yaml',
}

export const COMMENTS_GET_RULE: SourceFile = {
  path: `${RULES}/api-backend/rules/api/comments/get.rule.yaml`,
  source: commentsGetRule,
  lang: 'yaml',
}

export const COMMENTS_POST_RULE: SourceFile = {
  path: `${RULES}/api-backend/rules/api/comments/post.rule.yaml`,
  source: commentsPostRule,
  lang: 'yaml',
}

export const COMMENTS_SCHEMA: SourceFile = {
  path: `${RULES}/api-backend/schemas/comments.schema.yaml`,
  source: commentsSchema,
  lang: 'yaml',
}

export const CHAT_POST_RULE: SourceFile = {
  path: `${RULES}/chat_pipelines/rules/api/chat/post.rule.yaml`,
  source: chatPostRule,
  lang: 'yaml',
}

export const CHAT_GET_RULE: SourceFile = {
  path: `${RULES}/chat_pipelines/rules/api/chat/get.rule.yaml`,
  source: chatGetRule,
  lang: 'yaml',
}

export const CHAT_SKILL: SourceFile = {
  path: '.bffless/skills/site-overview/SKILL.md',
  source: chatSkill,
  lang: 'markdown',
}

export const USE_SESSION: SourceFile = {
  path: 'src/lib/useSession.ts',
  source: useSessionSource,
  lang: 'typescript',
}

/** Every file this site renders — the drift test in `ruleFiles.test.ts` walks it. */
export const ALL_SOURCE_FILES: SourceFile[] = [
  CONTACT_RULE,
  CONTACTS_SCHEMA,
  UPLOAD_RULE,
  SERVE_ATTACHMENT_RULE,
  COMMENTS_GET_RULE,
  COMMENTS_POST_RULE,
  COMMENTS_SCHEMA,
  CHAT_POST_RULE,
  CHAT_GET_RULE,
  CHAT_SKILL,
  USE_SESSION,
]
