# Fleet Ledger API

Cloudflare Worker + D1 backend for the Fleet Ledger frontend. Separate
Cloudflare resources from EMB_App's worker — same account, no shared data,
no shared failure domain. Live at `https://fleet-ledger-demo-api.smkrmuthu.workers.dev`.

## Why D1 (SQLite), not the Postgres sketched in `design/handoff/SCHEMA.sql`

This account already had Cloudflare access, so D1 needed no new signup and
deploys with the same `wrangler` login already used for EMB_App. At this
company's actual data volume — even 100+ trucks is well under a million
trips a year — D1 handles it fine. The partitioning, row-level security and
materialized views in the original handoff doc are real Postgres patterns,
just not load-bearing yet; migrating to hosted Postgres later is a real
option if a client ever needs those specifically, not a rewrite.

## Flexibility, as asked for

- **Schema changes are migrations, not manual ALTERs.** Edit
  `drizzle/schema.ts`, run `npm run db:generate`, review the generated SQL
  in `migrations/`, then apply it. Add or drop a column and every
  environment gets the same change in the same order.
- **`custom_fields` JSON column** on `vehicles`, `drivers`, and `trips` — a
  tenant-specific attribute one client needs (and another doesn't) lives
  there without a migration at all.
- **Generic filter builder** (`src/lib/filters.ts`) — list endpoints accept
  any combination of an allow-listed set of query params, in any order.
  Adding a new filterable field to an endpoint is one line in that
  endpoint's allowlist, not new routing logic.
- **`org_id` on every table** — the schema is multi-tenant from day one, so
  the same deployment can host multiple transport companies, or multiple
  fleets within one, without cross-tenant leakage. There's no database-level
  RLS on D1 (SQLite has none); isolation is enforced once, centrally, in
  `src/middleware/auth.ts` — every query is scoped to the caller's org_id
  from the verified JWT, never from the request body.

## What's real vs. not yet

- **Real**: password auth (PBKDF2 + JWT), trips with multi-line fuel/AdBlue/
  toll/other expenses, vehicles/drivers/users/monthly-expenses CRUD,
  approve, notifications, audit log, soft-delete throughout.
- **Not yet**: OTP sign-in (needs an SMS provider), receipt/document upload
  and OCR (needs R2 + the OCR pipeline EMB_App already has), month-close,
  a real invite-by-link flow for new users (Manager sets a password
  directly for now).

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in a random JWT_SECRET
npm run db:migrate:local
npm run db:seed:local
npm run dev                       # http://localhost:8787
```

Demo sign-in (also seeded to production):

| Role    | Phone           | Password    |
| ------- | --------------- | ----------- |
| Manager | +91 94440 61928 | manager123  |
| Office  | +91 90031 77402 | office123   |
| Driver  | +91 98431 20114 | driver123   |

## Deploying a schema change

```bash
npm run db:generate               # writes a new migrations/000N_*.sql
npm run db:migrate:local          # apply + test locally first
npm run db:migrate:remote         # then production
npm run deploy
```

## Secrets

`JWT_SECRET` is set via `npx wrangler secret put JWT_SECRET` — not in
`wrangler.toml`, not in git.
