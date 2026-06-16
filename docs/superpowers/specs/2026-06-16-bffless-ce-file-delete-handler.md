# BFFless CE — `file_delete` pipeline handler (delete bucket objects by prefix)

> **Audience:** the BFFless **Community Edition (CE)** codebase — this is a new
> pipeline *handler type*, built in a separate session. It is a dependency of the
> example-upload app's Studio **story 11c** (per-project GCS storage layout +
> project deletion). This doc is self-contained; it assumes no context from the
> app repo.

## Why

CE today has these storage handlers: `file_upload` (`file_upload_handler`),
`file_serve` (`file_serve_handler`), `image_convert`, `signed_url`,
`presigned_upload`, `register_upload`. **None can delete.** `function_handler` is
pure JS with no storage binding (it only computes strings that other handlers
consume).

The Studio app is moving every project's assets under a single prefix
(`uploads/projects/<projectId>/...`) so a project can be deleted by removing that
whole "folder." Deleting an object *prefix* in object storage = **list all keys
under the prefix, then delete them** (object stores have no atomic folder delete).
That requires storage list+delete access, which only a first-class handler can have.

## What to build

A new pipeline handler, **`file_delete`** (handler type string `file_delete`),
that deletes all objects under a given key prefix (or a single key) within the
**same per-project storage root the other storage handlers use** — i.e. the root
that `file_upload`/`file_serve` address via `subDir` (for this project that root is
`bffless/<project-slug>/uploads/`, e.g. `bffless/example-project/uploads/`). The
handler's `prefix`/`key` are **relative to that uploads root**, exactly like
`subDir` is for the other handlers.

### Config schema

```jsonc
{
  "handlerType": "file_delete",
  "config": {
    // Delete EVERY object whose key starts with this, relative to the uploads
    // root. Expression-interpolated like other handler config (e.g. can embed
    // {{steps.prep.prefix}} or request.body.* via the same templating the other
    // handlers use). Exactly one of `prefix` or `key` is required.
    "prefix": "projects/abc123/",

    // OR delete a single object (relative to the uploads root):
    // "key": "projects/abc123/source/2026-06-16/uuid-file.mov",

    // Optional. When true, list+report what WOULD be deleted but delete nothing.
    "dryRun": false
  }
}
```

### Behavior

1. Resolve the storage root for the rule's project (same resolution the existing
   storage handlers use — do not invent a new bucket/path convention).
2. Resolve `prefix` (or `key`) after expression interpolation.
3. **`prefix` mode:** list all objects under `<uploadsRoot>/<prefix>` (paginate to
   completion) and delete them (batched). **`key` mode:** delete the one object.
4. Return a small JSON result the pipeline can forward:
   ```json
   { "deleted": 7, "prefix": "projects/abc123/", "dryRun": false }
   ```
   (`key` mode: `{ "deleted": 0|1, "key": "..." }`.)
5. **Idempotent:** a prefix/key that matches nothing is **not** an error →
   `{ "deleted": 0, ... }`.

### Safety (important — this is a destructive handler)

- **Reject an empty / whitespace-only / `"/"`-only `prefix`** with a 4xx-style
  handler error. A blank prefix must NEVER fall through to "delete everything under
  the uploads root." (The app builds `projects/<projectId>/` and guards `projectId`
  non-empty, but the handler must defend itself too.)
- **Reject path traversal / escapes:** any `prefix`/`key` containing `..` or
  resolving outside the project's uploads root → handler error. Deletion must be
  confined to the calling project's own storage namespace.
- Surface storage/SDK errors as a handler failure (5xx) with a readable message;
  do not partially succeed silently — if some deletes fail, report how many
  succeeded and that there were failures.

### Auth

The handler itself is auth-agnostic (auth is a rule-level validator). NOTE for
whoever wires the consuming rule: this is destructive, so the delete route should
carry `auth_required` once the app's auth gate lands (the app's Studio routes
currently run with validators off for local dev — story 07 restores them). No
handler work needed for this; just don't bake auth assumptions into the handler.

### Tests (CE side)

- Deletes every object under a multi-object prefix; returns the right `deleted`
  count; siblings outside the prefix are untouched.
- Idempotent: deleting an empty/nonexistent prefix → `{ deleted: 0 }`, no error.
- Empty/`"/"` prefix → rejected (nothing deleted).
- `..`/escape in prefix or key → rejected.
- `dryRun: true` lists/reports but deletes nothing.
- `key` mode deletes exactly one object.

## How the app (story 11c) will consume it

A new Studio pipeline rule, roughly:

```
POST /api/projects/delete        (validators off for now, like the other studio routes)
  step 1  function_handler "prep":
            const id = (request.body.projectId || '').trim()
            if (!id) throw ...            // never allow an empty prefix
            return { prefix: 'projects/' + id + '/' }
  step 2  file_delete:
            { "prefix": "{{steps.prep.prefix}}" }
  step 3  response_handler: { body: "{{{steps.delete}}}", status: 200 }
```

The app's `deleteProject` flow will `POST /api/projects/delete { projectId }`
(best-effort) and then remove the project from local state. The app side (the rule
above, the MSW mock, and the UI wiring) is **story 11c** in the app repo and does
**not** require any CE change beyond this handler — it only needs `file_delete` to
exist and behave as specified.

## Deliverable

The `file_delete` handler available as a selectable pipeline step (it should show
up in the CE pipeline-editor "Files" group alongside File Upload / File Serve /
Signed URL / Presigned Upload / Register Upload), with the config schema, behavior,
safety guards, and tests above.
