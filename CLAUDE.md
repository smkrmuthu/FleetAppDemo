# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Fleet Ledger Demo** — the standalone sales-demo copy of Fleet Ledger, a goods-movement and expense ledger for trucking fleets (trips against a waybill, fuel/AdBlue/toll stops, monthly fixed costs, month-end reports).

- Repo: `smkrmuthu/FleetAppDemo`. Live at https://fleet.oneuptech.co.
- Company in the data: **Demo Logistics** (fictional). Trip numbers are `DEMO-#####`.
- Audience: prospects in sales demos. The look is a bold industrial design (brand red `#EF2B1F`, slate `#17212B`).

### Hard rule: never touch production

The production app **FleetApp-SMT** (`smkrmuthu/fleetApp`, https://smt.oneuptech.co) serves a real client with live data. This repo is fully separate from it: its own repo, Cloudflare workers, D1 database, R2 bucket and JWT secret.

- Never paste, reference or connect to SMT's database id, bucket, API or secrets.
- Never run `wrangler` against anything but the demo resources below.
- Design or code is ported to SMT only on a separate branch in that repo, and only when the user asks.

| Thing | Demo value |
|---|---|
| Web worker | `fleetappdemo` (root `wrangler.jsonc`, static assets, custom domain `fleet.oneuptech.co`) |
| API worker | `fleet-ledger-demo-api` (`worker/wrangler.toml`) |
| D1 database | `fleet-ledger-demo-db`, id `886fcd84-b0a7-417b-91e9-236f6adde3ce` |
| R2 bucket | `fleet-ledger-demo-docs` |
| Cron | `0 21 * * *` UTC = 02:30 IST (backup + sample-data refresh) |
| Demo logins | `mgr@demo.com`/`mgr123`, `office@demo.com`/`office123`, `driver@demo.com`/`driver123` |

## Stack

- **Frontend (repo root):** Vite + React 19 + TypeScript, Capacitor wrappers (`android/`, `ios/`), PWA (`public/sw.js`), lucide-react icons, jsPDF/autotable and write-excel-file for exports. No router library; `src/App.tsx` switches tabs by role.
- **API (`worker/`):** Hono + Drizzle on Cloudflare Workers, D1 (SQLite) and R2. Zod validation. Multi-tenant: `org_id` on every table, taken from the JWT.
- **Tests:** Vitest in both packages.

## Commands

Frontend (repo root):

```bash
npm install
npm run dev                     # Vite dev server; talks to the deployed demo API by default
VITE_API_BASE=http://127.0.0.1:8787/v1 npx vite --port 5180 --host 127.0.0.1   # against a local API
npx tsc --noEmit -p .           # type-check
npm test                        # vitest run
npm run build                   # tsc && vite build
```

API (`worker/`) — **always use the npm scripts or pass `-c wrangler.toml`**; a bare `wrangler` call picks up the root `wrangler.jsonc` (the web worker) by mistake:

```bash
npm install
npx wrangler dev -c wrangler.toml --local --port 8787 --ip 127.0.0.1 [--test-scheduled]
npm run db:migrate:local && npm run db:seed:local    # local DB lives in worker/.wrangler (gitignored)
npm test
npx tsc --noEmit
npm run deploy                  # deploys the demo API (manual; Cloudflare Git build only publishes the web worker)
```

Trigger the nightly job locally: run dev with `--test-scheduled`, then `curl "http://127.0.0.1:8787/__scheduled?cron=0+21+*+*+*"`.

Before pushing, run: `npx tsc --noEmit -p .`, `npm test`, `npm run build` (and in `worker/`: `npx tsc --noEmit`, `npm test` if the API changed).

## Layout

```
src/
  App.tsx               tab wiring, role → tabs (ROLE_TABS / TAB_LABELS in src/data/mockData.ts)
  index.css             design tokens + all styling (legacy variable names aliased to new tokens)
  components/ui.tsx     shared UI: PageHeader, DataTable, KpiCard, StatusBadge, Modal, HeroKpi, ...
  components/           screens: Dashboard, TripLog, AddMovement, MovementReview, MonthlyReport,
                        MovementSummary, MonthlyExpenses, FuelExpenses, Master, People, SettingsPage, ...
  lib/api.ts            API client      lib/reports.ts, exporter.ts   Excel/PDF exports
  utils/                aggregate.ts (per-vehicle totals), calc.ts, fleetStatus.ts, routeGeo.ts (+ tests)
worker/
  src/index.ts          Hono app + scheduled handler (backup, demo refresh)
  src/routes/           one file per resource    src/lib/  jwt, password, backup, demoData, ...
  migrations/           D1 SQL migrations (Drizzle)   seed.sql   demo sample data
docs/                   RUNBOOK.md, backup/restore, architecture
```

## Conventions

- Match surrounding code: comment density, naming, inline-style vs CSS-class idiom of the file you edit. Keep comments sparing and about *why*.
- Use design tokens from `src/index.css` (`var(--color-...)`, `var(--font-heading)`), not hard-coded colours. Display/figures use Archivo, body Inter.
- Reuse components from `ui.tsx` before writing new markup. Tables use `<table className="table">`; a `<tfoot>` row renders as the bold Total row.
- Money is stored as paise (integers) in the DB; format with `rupees()` / `formatNum()` from `src/utils/calc.ts`.
- **Long lists:** tables that can grow past ~25 rows use `usePaging()` + `<Pager attached …>` (`src/components/Pager.tsx`, 25 per page, resets when filters change); totals/footers and exports still cover every row, not just the page. Fleet-sized lists also get search and "show more" (see `FleetStatus.tsx`, People, Dashboard). Test layout changes with `worker/scripts/large-fleet.mjs --vehicles 260`.
- **Totals:** per-vehicle totals come from `totalOfVehicles()` in `src/utils/aggregate.ts`; ratios (margin, ₹/km) are recomputed from the totals, never averaged. Report exports take `withTotal`/`foot` options; the full backup (`exportBackup`) must stay pure data with no total rows.
- Schema changes are a new migration in `worker/migrations/` plus the Drizzle schema; never edit applied migrations. Keep `seed.sql` consistent with the schema.
- Bump the cache name in `public/sw.js` when shipped shell assets change.
- Anything shown as an approximation must say so (the route map is labelled "Illustrative layout"; there is no GPS — fleet status is derived from recorded movements and unavailability windows).

## Demo sample data (nightly refresh)

`worker/src/lib/demoData.ts` rebuilds the sample movements for the current and previous month each night, so the dashboard never opens empty.

- Runs only when `DEMO_MODE = "true"` **and** the organisation is named "Demo Logistics"; it refuses otherwise.
- Only replaces rows whose ids start `demo-` (and the old hand-run `ot*` rows); movements users create while trying the demo are kept.
- Written as literal SQL in ~18 statements applied as one D1 batch (D1 limits: 100 bound params, per-invocation query limits).
- Covered by `demoData.test.ts`, which builds a real SQLite database from the migrations and seed.
- To switch it off, remove `DEMO_MODE` from `worker/wrangler.toml` and deploy.

## Large-fleet sample data (optional, for scale testing)

`worker/scripts/large-fleet.mjs` generates SQL for ~120 trucks, ~110 drivers and ~700 movements across this and last month (repeatable output). Everything it adds is marked (`lf-*` ids, `custom_fields` `{"sample":"large-fleet"}`), and `worker/scripts/large-fleet-remove.sql` takes it all away. Load it on the **local** DB first; do not apply it to the live demo DB without asking, since it changes what prospects see.

```bash
cd worker && node scripts/large-fleet.mjs > large-fleet.sql
npx wrangler d1 execute fleet-ledger-demo-db --local -c wrangler.toml --file=large-fleet.sql
npx wrangler d1 execute fleet-ledger-demo-db --local -c wrangler.toml --file=scripts/large-fleet-remove.sql   # undo
```

## Deploying

- **Web app:** push to `main`; the Cloudflare Git build publishes the `fleetappdemo` worker. Verify in a private window at https://fleet.oneuptech.co.
- **API:** manual — `cd worker && git pull && npm install && npm run deploy`. Migrations on the remote DB: `npm run db:migrate:remote`. Secrets: `npm run secret:jwt` (a fresh value, never SMT's), optional `npm run secret:gemini`.
- Push straight to `main` only when the user has asked; do not open PRs unless asked.

## Known gaps

- Android/iOS splash screens still show the SMT logo.
- Monthly Expenses description dropdown prompts to add descriptions in Masters.
- Older dialogs are only restyled, not redesigned.
- Porting the approved design to SMT is pending the user's agreement.

## Working with the user

- Ask before anything outward-facing or hard to reverse (deploys, deleting branches/resources, domain or DNS changes).
- Keep the Google Doc "Fleet Ledger Demo – Go-live & Domain Switch Checklist" updated when meaningful work lands.
- If a sandbox cannot reach fleet.oneuptech.co, say so rather than claiming it was verified live.
