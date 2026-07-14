# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Conventions

- For anything fetched from GitHub (files, PRs, issues, releases, raw content), use `gh` — not `curl`.
- Prefer Tailwind utility classes for new styles rather than writing custom CSS. Theme tokens are defined in `src/index.css` via `@theme` (Tailwind v4 CSS-first config — no `tailwind.config.js`).

## Commands

- `npm run dev` — Vite dev server with HMR
- `npm run build` — type-check (`tsc -b`) then `vite build` into `dist/`
- `npm run lint` — ESLint over the repo (`eslint.config.js`, flat config)
- `npm test` — Vitest in watch mode
- `npm run test:run` — single Vitest run (CI mode)
- `npm run test:coverage` — Vitest with v8 coverage; emits `coverage/lcov.info` consumed by the PR workflow
- Run a single Vitest file: `npx vitest run src/components/ContactDialog.test.tsx`
- Run one test by name: `npx vitest run -t "submits the form"`
- `npm run test:e2e` — Playwright; the config builds the app and starts `vite preview` on port 4173 itself, so no need to run `dev`/`preview` separately
- `npm run test:e2e:ui` — Playwright UI mode

## Architecture

Single-page React 19 + TypeScript app built with Vite 8, deployed as a static bundle to BFFless. There's no application *server* in this repo — but the API it calls does live here, as code: see below.

### The API is code in this repo (`.bffless/proxy-rules/`)

Every `/api/*` route the site calls is a BFFless proxy rule authored as files, per the [Proxy Rules as Code](https://docs.bffless.app/recipes/proxy-rules-as-code/) recipe (CE ≥ 0.2.0, `bffless` CLI ≥ 0.2.5, a devDependency here). Two rule sets, both attached to the `production` and `preview` aliases:

| Set | Routes |
| --- | --- |
| `.bffless/proxy-rules/api-backend/` | `POST /api/contact`, `POST`/`GET /api/uploads/contact-attachments*` (both `auth_required`), `GET`/`POST /api/comments`, `GET /install` |
| `.bffless/proxy-rules/chat_pipelines/` | `POST /api/chat` (streaming `ai_handler`), `GET /api/chat` (history) |

A rule's path and method come from **where its file sits**: `rules/api/contact/post.rule.yaml` is `POST /api/contact`; a `[...path]/` directory is a trailing `*`. Steps reference Data Tables by name (`$schema:contacts` → `schemas/contacts.schema.yaml`), never by UUID. The chat system prompt is a `$file:` ref to `system-prompt.md` beside the rule, so prose lives in a prose file.

```bash
npm run rules:validate   # lint manifests + handler code (no network)
npm run rules:test       # run *.fn.test.yaml fixtures in a node:vm harness
npm run rules:diff       # compare live vs. git — exits 1 on drift (needs BFFLESS_API_KEY)
npm run rules:build      # compile to dist/ (gitignored)
```

**Don't edit these rule sets in the BFFless dashboard.** Git is the source of truth: `deploy.yml` syncs them with `prune: true` on merge, so a dashboard edit gets overwritten on the next deploy. `rules-drift.yml` runs `rules diff` on a schedule and fails if live has drifted. To keep a dashboard change, `rules pull <set>` it back into the authoring layout first.

### Runtime integrations

- **`src/components/CommentsSection.tsx`** uses `useBffState` from `@bffless/use-bff-state` against `/api/comments`. The hook owns fetch/update/loading/error state; the component just renders and calls `update({...})` to append. PR-preview deployments resolve `/api/*` through the `api-backend` proxy rule set declared in `.github/workflows/pr-preview.yml`.
- **`src/lib/useSession.ts`** talks to `/_bffless/auth/session` and `/_bffless/auth/refresh` (BFFless built-in cookie-based auth relay). It dedupes concurrent calls via a module-level `inFlight` promise — `refetch()` resets it. Tests and any new auth-aware code must be aware of this singleton: it persists across renders within a session.
- **`src/components/ContactDialog.tsx`** uses the native `<dialog>` element with `showModal()`. Authenticated users get a file-attachment field that uploads to `/api/uploads/contact-attachments` first, then POSTs the resulting `attachment_url` alongside the form payload to `/api/contact`. Unauthenticated users submit without the upload step.

### The demo pages document their own backend

Forms, Comments, Chat, and Auth each carry an "implementation" section that renders **the actual rule files** — `src/lib/ruleFiles.ts` imports them from `.bffless/proxy-rules/**` with Vite's `?raw`, so a page shows the exact bytes CI deploys and can't drift from the endpoint it documents. `src/lib/ruleFiles.test.ts` enforces that every `path` label still matches its `source` on disk.

When you change a rule, the page explaining it updates itself; when you change what a page *claims*, put the claim in the rule file's comments, not in the JSX. `CodeFile` (`src/components/CodeFile.tsx`) renders a file with light YAML colouring from `src/lib/highlight.ts` — a lossless tokenizer, never a parser: the tokens always rejoin to the original source.

### Tests

- Vitest is configured in `vite.config.ts` (not a separate `vitest.config.ts`): `jsdom`, globals on, setup `src/test/setup.ts` (registers `@testing-library/jest-dom` and `cleanup()` after each test). Test files live next to source as `*.test.ts(x)`.
- Coverage excludes `src/main.tsx` and `src/test/**`; the `lcov.info` output is what `bffless/compare-coverage` diffs against the `production` alias on PRs.
- Playwright tests live in `e2e/`. `e2e/home.spec.ts` mocks both `**/api/comments**` and `**/_bffless/auth/**` via `page.route` so the preview server doesn't need a real backend. Screenshots are written to `screenshots/` and uploaded as artifacts.

### CI / deploys

Three GitHub Actions workflows drive everything:

- `.github/workflows/deploy.yml` — runs on push to `main`. Validates + tests the rule sets, builds, runs coverage + Playwright, syncs the rule sets with `bffless/deploy-proxy-rules@v1` (`prune: true`), then uses `bffless/upload-artifact@v1` to publish `dist/`, `coverage/`, `screenshots/`, `playwright-report/`, and `.bffless/skills/` to the `production` alias. **Rules sync before the bundle uploads**, so a route is never missing for the deploy that needs it.
- `.github/workflows/pr-preview.yml` — runs on PRs. Same build/test pipeline, plus a **dry-run** `deploy-proxy-rules` that comments what merging would change about the live rule sets (it writes nothing — production's rules only ever change from `main`). Uses `bffless/compare-coverage` and `bffless/compare-screenshots` against `production` to post diffs, then uploads to the shared `preview` alias.
- `.github/workflows/rules-drift.yml` — scheduled `rules diff`; fails when someone has edited a git-managed rule set in the dashboard.

Two things to know when editing these:

- `bffless/upload-artifact` derives the served prefix from `path` by default — don't set `base-path` redundantly unless the served prefix actually needs to differ from the upload path (see memory `feedback_bffless_base_path.md`). This is why the skills step uploads `.bffless/skills` (not `.bffless`, which would publish the rule sources as site files) and the SKILL.md still lands at `.bffless/skills/<name>/SKILL.md` where chat looks for it.
- Attaching a rule set on upload is **additive and idempotent** — an upload can never detach one (that needs `PATCH /api/deployments/aliases/:id`). Naming a set that's already attached is a no-op.

### TypeScript config

Project references: root `tsconfig.json` → `tsconfig.app.json` (src, bundler resolution, `verbatimModuleSyntax`, `noUnusedLocals/Parameters`, `erasableSyntaxOnly`) and `tsconfig.node.json` (Vite/Playwright configs). `npm run build` invokes `tsc -b`, so type errors in either project break the build — fix the offending code rather than excluding it (see memory `feedback_fix_code_not_config.md`).

## Studio (moved)

Studio was extracted into the **`bffless/apps`** monorepo (`apps/studio`) — it's now a self-contained
give-away app for the BFFless platform, no longer part of this demo repo. This repo is the BFFless
demo & playground only (Home / Forms / Comments / Chat / Auth). For Studio work, see that repo.
