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

Single-page React 19 + TypeScript app built with Vite 8, deployed as a static bundle to BFFless. There's no application backend in this repo — runtime data and auth come from BFFless endpoints that the deployed site sits behind.

### Runtime integrations

- **`src/components/CommentsSection.tsx`** uses `useBffState` from `@bffless/use-bff-state` against `/api/comments`. The hook owns fetch/update/loading/error state; the component just renders and calls `update({...})` to append. PR-preview deployments resolve `/api/*` through the `api-backend` proxy rule set declared in `.github/workflows/pr-preview.yml`.
- **`src/lib/useSession.ts`** talks to `/_bffless/auth/session` and `/_bffless/auth/refresh` (BFFless built-in cookie-based auth relay). It dedupes concurrent calls via a module-level `inFlight` promise — `refetch()` resets it. Tests and any new auth-aware code must be aware of this singleton: it persists across renders within a session.
- **`src/components/ContactDialog.tsx`** uses the native `<dialog>` element with `showModal()`. Authenticated users get a file-attachment field that uploads to `/api/uploads/contact-attachments` first, then POSTs the resulting `attachment_url` alongside the form payload to `/api/contact`. Unauthenticated users submit without the upload step.

### Tests

- Vitest is configured in `vite.config.ts` (not a separate `vitest.config.ts`): `jsdom`, globals on, setup `src/test/setup.ts` (registers `@testing-library/jest-dom` and `cleanup()` after each test). Test files live next to source as `*.test.ts(x)`.
- Coverage excludes `src/main.tsx` and `src/test/**`; the `lcov.info` output is what `bffless/compare-coverage` diffs against the `production` alias on PRs.
- Playwright tests live in `e2e/`. `e2e/home.spec.ts` mocks both `**/api/comments**` and `**/_bffless/auth/**` via `page.route` so the preview server doesn't need a real backend. Screenshots are written to `screenshots/` and uploaded as artifacts.

### CI / deploys

Two GitHub Actions workflows drive everything:

- `.github/workflows/deploy.yml` — runs on push to `main`. Builds, runs coverage + Playwright, then uses `bffless/upload-artifact@v1` to publish `dist/`, `coverage/`, `screenshots/`, and `playwright-report/` to the `production` alias.
- `.github/workflows/pr-preview.yml` — runs on PRs. Same build/test pipeline, but uses `bffless/compare-coverage` and `bffless/compare-screenshots` against `production` to post diffs as PR comments, then uploads everything to a `pr-<number>` alias with `proxy-rule-set-name: api-backend` so `/api/*` routes work in the preview.

When editing these workflows, note that `bffless/upload-artifact` derives the served prefix from `path` by default — don't set `base-path` redundantly unless the served prefix actually needs to differ from the upload path (see memory `feedback_bffless_base_path.md`).

### TypeScript config

Project references: root `tsconfig.json` → `tsconfig.app.json` (src, bundler resolution, `verbatimModuleSyntax`, `noUnusedLocals/Parameters`, `erasableSyntaxOnly`) and `tsconfig.node.json` (Vite/Playwright configs). `npm run build` invokes `tsc -b`, so type errors in either project break the build — fix the offending code rather than excluding it (see memory `feedback_fix_code_not_config.md`).

## Studio (moved)

Studio was extracted into the **`bffless/apps`** monorepo (`apps/studio`) — it's now a self-contained
give-away app for the BFFless platform, no longer part of this demo repo. This repo is the BFFless
demo & playground only (Home / Forms / Comments / Chat / Auth). For Studio work, see that repo.
