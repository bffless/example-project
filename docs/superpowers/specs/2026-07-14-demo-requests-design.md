# Demo-request pipeline, schema, and header dialog — design

Date: 2026-07-14
Status: approved (James, in-session)

## Goal

Let visitors schedule a product demo. Records land in a new BFFless Data Table via a
pipeline rule authored as code, and the form is a header-triggered dialog.

## Backend (rules-as-code, `api-backend` set)

- **Schema** `.bffless/proxy-rules/api-backend/schemas/demo_requests.schema.yaml`
  - `name` string required, `email` email required
  - `company`, `preferred_date`, `preferred_time`, `notes` — optional strings
  - No `id:` — the server assigns one on first sync; steps reference `$schema:demo_requests` by name.
- **Rule** `.bffless/proxy-rules/api-backend/rules/api/demo-requests/post.rule.yaml`
  - `POST /api/demo-requests` (path/method derived from file location)
  - Steps: `form_handler` validation → `data_create` into `$schema:demo_requests`
  - Public (no `auth_required`), mirroring `POST /api/contact`.
- Nothing is pushed live manually — `deploy.yml` syncs the set on merge to `main`.

## Frontend

- **`src/components/ScheduleDemoDialog.tsx`** — native `<dialog>` + `showModal()`,
  mirroring `ContactDialog`; reuses `ContactDialog.css` classes (no new custom CSS).
  Fields: name, email, company, preferred date (`type="date"`), preferred time
  (`type="time"`), notes. POSTs JSON to `/api/demo-requests` with
  `credentials: 'include'`, omitting empty optional fields.
- **`src/components/Header.tsx`** — "Schedule a demo" button beside the auth controls;
  Header owns the open state and renders the dialog.

## Out of scope (per placement decision)

No Forms-page documentation section, no `ruleFiles.ts` entry, no attachment upload.

## Testing

- TDD: `ScheduleDemoDialog.test.tsx` (open/close, submit payload shape, optional-field
  omission, error state), Header test for the trigger button.
- `npm run rules:validate`, `npm run test:run`, `npm run lint`, `npm run build`.
