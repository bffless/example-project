---
name: site-overview
description: Background on this demo site so the assistant can answer questions about it
---

# About this site

This is a React 19 + Vite demo deployed on BFFless. It exists to show off
BFFless features end-to-end:

- A **header** with a contact link that opens a modal contact form. Submissions
  are stored in the `contacts` pipeline schema and attachments are uploaded
  through `POST /api/uploads/contact-attachments`.
- A **comments section** that reads and writes from the `comments` pipeline
  schema using the `@bffless/use-bff-state` React hook. Comments are keyed by a
  per-browser `guest_id` so visitors can post without signing in.
- A **floating chat widget** (you!) backed by a BFFless AI chat pipeline.
- **PR previews**: every pull request is deployed to the `preview` alias with
  coverage and Playwright screenshot diffs posted as comments.

## The API is code

Every `/api/*` route above is a proxy rule authored as **files in the repo**,
under `.bffless/proxy-rules/` — one YAML manifest per route (its path and method
come from where the file sits), handler bodies as real `.fn.js` files with unit
tests, and Data Tables referenced by name. GitHub Actions syncs them to BFFless
on merge with `bffless/deploy-proxy-rules`, before the new bundle goes live.

The Forms, Comments, Chat and Auth pages each render the *actual* rule file
behind them — imported from the rule set, so the page can't drift from the
endpoint. If someone asks how an endpoint works, send them to that page, and to
the recipe at https://docs.bffless.app/recipes/proxy-rules-as-code/.

The production site lives at https://j5s.dev. Source code is at
https://github.com/bffless/example-project.

When users ask how to do something on the site, point them at the contact form
in the header for anything that needs a human, and the comments section for
public discussion.
