---
name: bffless-pipeline
description: >-
  Build, wire, or debug a BFFless pipeline (handler chain) behind an `/api/*`
  endpoint — the serverless backend this repo uses instead of an app server. Use
  when creating or editing a proxy/pipeline rule, uploading files to a bucket,
  calling Replicate (Whisper, Gemini, voice clone/TTS) from a pipeline, signing
  bucket objects for an external model, or diagnosing 413/CORS/REPLICATE errors.
  Knows the hard-won gotchas: the 1 MB body cap, presigned direct-to-bucket
  uploads, signing bucket objects for Replicate, and validators-off-until-07.
---

# Building a BFFless pipeline for an `/api/*` endpoint

There is **no application backend** in this repo. Runtime data, auth, and AI all
come from **BFFless pipelines** — ordered chains of handlers attached to a proxy
rule, no server code. The front end calls `/api/*` with
`fetch(..., { credentials: 'include' })`; in dev, unhandled `/api/*` proxies to
`https://j5s.dev` (`vite.config.ts`). The studio rules live in the `studio` rule
set; existing rule ids are recorded in the `stories/inprogress/studio/*` files.

Manage rules through the **`bffless-j5s` MCP tools** (`create_proxy_rule`,
`get_proxy_rule`, `update_proxy_rule`, `create_signed_url`, the pipeline-log
tools, etc.). Use the **`bffless:*` skills** (`bffless:pipelines`,
`bffless:proxy-rules`, `bffless:cache-and-storage`, `bffless:authentication`) for
handler reference. **GitHub via `gh`, never `curl`** — but `curl` is fine for
verifying a presigned URL or a signed download end-to-end.

## Handler vocabulary

A pipeline is a list of steps, each a handler with a config. Relevant handlers:
`presigned_upload` / `register_upload`, `file_serve` (Range-aware GET),
`signed_url`, `replicate`, `ai_handler`, `function_handler`, `http_request`,
`stripe_checkout` / `stripe_webhook`, `response_handler`. Validators: `auth_required`,
`rate_limit`. Expressions reference prior state: `input.*` / `request.body.*`,
`query.*`, `steps.<name>.*`, `user.*`.

> **Replicate string inputs are expressions.** A bare enum value like `verbose` is
> read as an expression and resolves to empty. **Quote enum literals**:
> `"'verbose'"`. (See memory `project_studio_director_pipeline.md`.)

## Gotcha #1 — the 1 MB body cap (NEVER stream files through a pipeline)

The BFFless edge nginx caps request bodies at **1 MB** on *every* upload route and
alias (proven: 1000 KB→200, 1024 KB→413). Any real video/audio is far over that,
so a streaming `file_upload_handler` pipeline **always 413s**. The first streaming
attempt (rule `c268d337`) was deleted for exactly this. Use the presigned flow.

## The presigned direct-to-bucket upload (the only way files get in)

Two rules + a serve route. The browser PUTs straight to GCS, bypassing the 1 MB cap.

1. `POST /api/uploads/<kind>/prepare` — handler `presigned_upload`. Config:
   `subDir` (e.g. `"source"`, `"audio"`, `"voice"`, `"narration"`, `"thumbnails"`),
   date-bucketed, a large `maxFileSize`, allowed MIME (`["video/*"]` etc.). Returns
   `{ uploadUrl, storageKey, originalName, publicPath, expiresAt }`.
2. Browser `PUT <uploadUrl>` with the raw bytes — **no credentials**, just
   `Content-Type: file.type`. The signed GCS PUT signs only `host`.
3. `POST /api/uploads/<kind>/register` — handler `register_upload`, same
   `schemaId`/`subDir`. Verifies the bucket object and writes the record **flat at
   top level** (`{ url, storage_path, size, … }`). Return a flexible
   `{ url }`/`{ record: { url } }` shape (matches what the FE reads).
4. `GET /api/uploads/<kind>/*` — `file_serve`, Range-aware, proxies the bucket.

This whole flow is wrapped client-side by `presignedUpload` in `src/lib/upload.ts`
and exposed as the RTK Query `upload` mutation (`{ file, kind } → { url }`).

> **⚠️ Bucket CORS:** the PUT goes to `storage.googleapis.com` from the site origin,
> so the bucket must allow `PUT` from `http://localhost:5173` and the prod origin.
> `curl` ignores CORS; the browser doesn't. A CORS-failing PUT is a **platform-side**
> bucket config (not exposed via MCP) — flag it for a human, don't chase it in code.

## Gotcha #2 — Replicate can't fetch your serve URLs; SIGN the object

A relative `/api/uploads/...` serve path (or even the alias URL) is not something
Replicate can reliably fetch, and signing the relative key signs a non-existent
object. To feed a bucket file (audio for Whisper, contact sheets for Gemini) to a
model, **mint a presigned GCS download URL inside the pipeline** and pass *that*:

1. `function_handler` **resolvePath** — rebuild the full project-prefixed storage
   key from the public serve path. The prefix
   `bffless/example-project/uploads/<subDir>/<date>/<file>` is a project constant;
   the `/api/uploads/...` serve URL is **not** the storage key.
2. `signed_url` **sign** — mint a ~1 h presigned `storage.googleapis.com/...`
   download URL (signs `host` only). Output `steps.sign.url`.
3. `replicate` — pass `steps.sign.url` as the model's file input.

For **multi-image** models (the Gemini director/refiner), repeat: up to 10
**conditional** `signed_url` steps (one per contact sheet), then `collect` them
into the `images` array. ≤10 images, ≤7 MB each — the compositor (`frames.ts`)
already tiles to those limits (memory `project_studio_director_gemini.md`).

## Canonical AI pipeline shape (director / refiner)

`/api/scenes` (rule `138f27fb`) and `/api/refine-scene` (rule `afacb572`) share it:

1. `prep` (`function_handler`) — build storage paths + the `prompt` +
   `system_instruction`.
2. up to 10 conditional `signed_url` steps — one per contact sheet.
3. `collect` → `replicate` `google/gemini-3.1-pro` with `images`, `prompt`,
   `system_instruction`, `thinking_level` (`high`, dial to `medium` if it nears the
   120 s rule cap on long clips).
4. `parse` (`function_handler`) — JSON-parse + **clamp/coerce** every timestamp and
   cut into bounds, sort, de-overlap. (The client `toScenes`/`toRefinement` clamps
   *again* — never trust the model.)
5. `respond` — the exact shape the MSW mock returns, so the FE is unchanged.

Transcription (`/api/transcribe`, rule `972a6dc5`) is the same skeleton with
`victor-upmeet/whisperx`, **`align_output:true`** (the flag that yields per-word
timestamps), and a `flatten` step that maps WhisperX `segments[].words[]
{ word,start,end }` → `{ text,start,end }`.

## Gotcha #3 — validators are intentionally OFF until story 07

`auth_required` + `rate_limit` are **deliberately omitted** on the studio rules so
local unauthenticated dev works (memory `project_studio_upload_auth_temp.md`). Do
**not** "fix" this. Story 07 restores them:
`validators: [{ type: "auth_required", config: { allowApiKey: true } }]` and
`rate_limit` (config key is **`limit`** + `windowMs`, by-IP).

## Gotcha #4 — `REPLICATE_NOT_CONFIGURED`

If a Replicate step fails with this, the project has no Replicate API token. It's
set in BFFless **Settings → AI → AI Services**, **not exposed via MCP** — a human
must add it. Everything up to the model step (resolvePath → sign → reachable URL)
can still be verified without it.

## Debugging

- Turn **debug on** for the rule and read the pipeline logs via the MCP log tools
  (`list_pipeline_logs`, `get_pipeline_log`, `get_pipeline_log_step`) — each step's
  in/out is captured. The studio rules ship with debug on for first real runs.
- Verify a signed download URL with `curl -I` — you want `HTTP 200`, the right
  `Content-Type`, and Range support before blaming the model.
- The `studio` rule set is attached to **both** the `preview` and `production`
  aliases, so `/api/*` works in PR previews.

## When you build a new rule

Base it on the closest existing rule (director for an AI call, the upload pair for
files), keep the response shape identical to the MSW mock, verify end-to-end, then
**record the rule id in the story file** and flip the mock off. See the
**`wire-studio-stage`** skill for the front-end half.
