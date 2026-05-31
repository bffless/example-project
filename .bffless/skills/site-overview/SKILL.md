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
- **PR previews**: every pull request gets its own alias under `pr-N.j5s.dev`
  with coverage and Playwright screenshot diffs posted as comments.

The production site lives at https://j5s.dev. Source code is at
https://github.com/bffless/example-upload.

When users ask how to do something on the site, point them at the contact form
in the header for anything that needs a human, and the comments section for
public discussion.
