# CLAUDE.md

Guidance for Claude Code when working in this repository. Read it fully before changing anything: it records the rules, the process and the mistakes that cost time or caused an outage. It is written so a session on any computer (macOS, Linux or Windows) can carry on the work.

## 1. What this is

**Fleet Ledger Demo**: the standalone sales-demo copy of Fleet Ledger, a goods-movement and expense ledger for trucking fleets (trips against a waybill, fuel/AdBlue/toll stops, monthly fixed costs, month-end reports).

- Repo: `smkrmuthu/FleetAppDemo`, branch `main`. Live at https://fleet.oneuptech.co.
- Company in the data: **Demo Logistics** (fictional). Trip numbers are `DEMO-#####`.
- Audience: prospects in sales demos, including prospects with 250+ trucks. The look is a bold industrial design (brand red `#EF2B1F`, slate `#17212B`).
- Owner: smkrmuthu@gmail.com. Works in India (IST, UTC+5:30). Work happens in short sessions, including nights and weekends on a different computer, so the repo, this file and the Google documents (section 12) are the only memory. Keep them current.

### Hard rule: never touch production

The production app **FleetApp-SMT** (`smkrmuthu/fleetApp`, https://smt.oneuptech.co) serves a real client with live data. The demo is fully separate from it: its own repo, Cloudflare workers, D1 database, R2 bucket and JWT secret.

- Never paste, reference or connect to SMT's database, bucket, API or secrets from demo work.
- Never run `wrangler` against anything but the demo resources below.
- Design or code goes to SMT only on a separate branch in that repo, and only when the owner asks. SMT has its own Claude session/thread.
- Do not copy SMT's client-specific content (its Chennai sites and areas, customer names) into this repo.
- **The Cloudflare account is shared** by the demo, SMT and the estate apps. Account-wide limits (section 8) apply to all of them, so a careless job on the demo can take SMT down. That happened on 8 Oct 2026.

| Thing | Demo value |
|---|---|
| Web worker | `fleetappdemo` (root `wrangler.jsonc`, static assets, custom domain `fleet.oneuptech.co`) |
| API worker | `fleet-ledger-demo-api` (`worker/wrangler.toml`), https://fleet-ledger-demo-api.smkrmuthu.workers.dev |
| D1 database | `fleet-ledger-demo-db`, id `886fcd84-b0a7-417b-91e9-236f6adde3ce` |
| R2 bucket | `fleet-ledger-demo-docs` |
| Cron | `0 21 * * *` UTC = 02:30 IST (backup, then sample-data refresh) |
| Demo logins | `mgr@demo.com`/`mgr123`, `office@demo.com`/`office123`, `driver@demo.com`/`driver123` (public, fictional) |

## 2. Setting up another computer (including Windows)

1. Install Git and **Node.js 22.18 or newer** (the large-fleet script reads TypeScript directly; Node 24 LTS also works). Optional: VS Code with the Claude Code extension.
2. Clone and install:
   ```
   git clone https://github.com/smkrmuthu/FleetAppDemo
   cd FleetAppDemo
   npm install
   cd worker
   npm install
   npx wrangler login      # log in as the Cloudflare account that owns oneuptech.co
   ```
   The folder may be named differently on the owner's machines (`FleetApp_Demo` has been used). Always check you are inside the `FleetAppDemo` repo (`git remote -v` shows `smkrmuthu/FleetAppDemo`) before running anything, and never inside the SMT repo.
3. Windows notes:
   - Use PowerShell or Git Bash. The npm scripts are the same. Where this file shows `VAR=value command`, in PowerShell write `$env:VAR="value"; command`.
   - Set `git config core.autocrlf input` so line endings stay LF.
   - Start the local servers in separate terminals (section 3). To stop one, press Ctrl+C in its terminal. Do not use broad kill commands (`pkill`/`Stop-Process -Name node` can end your own session or other work).
   - Playwright screenshots are optional: `npx playwright install chromium` if you want them.
4. `worker/.dev.vars`, `worker/.wrangler/` and `dist/` are git-ignored. Secrets are never committed.
5. Connectors (Cloudflare, Google Docs/Drive, GitHub) are set up per Claude account, not per computer. If a connector is missing on the new machine, say so and ask the owner to connect it rather than working around it.

## 3. Commands

Frontend (repo root):

```bash
npm install
npm run dev                     # Vite dev server; talks to the deployed demo API by default
VITE_API_BASE=http://127.0.0.1:8787/v1 npx vite --port 5180 --host 127.0.0.1   # against a local API
npx tsc --noEmit -p .           # type-check
npm test                        # vitest run
npm run build                   # tsc && vite build
```

API (`worker/`). **Always use the npm scripts or pass `-c wrangler.toml`**: a bare `wrangler` call picks up the root `wrangler.jsonc` (the web worker) by mistake.

```bash
npm install
npx wrangler dev -c wrangler.toml --local --port 8787 --ip 127.0.0.1 [--test-scheduled]
npm run db:migrate:local && npm run db:seed:local    # local DB lives in worker/.wrangler (gitignored)
npm test
npx tsc --noEmit
npm run deploy                  # deploys the demo API (manual; the Cloudflare Git build only publishes the web worker)
```

- Trigger the nightly job locally: run dev with `--test-scheduled`, then open `http://127.0.0.1:8787/__scheduled?cron=0+21+*+*+*`.
- Use `localhost`/`127.0.0.1` URLs, not the deployed ones, for local testing.
- **Before every push:** `npx tsc --noEmit -p .`, `npm test`, `npm run build` in the root, and in `worker/`: `npx tsc --noEmit` and `npm test` if the API changed.

## 4. The working process

1. Understand the request. Ask only when the answer changes what you do and cannot be found in the code or this file.
2. Make the change in the style of the surrounding code (section 6). Add or update tests.
3. Run the checks above. For UI changes, also look at the screens: run the API and Vite locally, load the 260-truck set (section 9) if the change is about scale, and take screenshots.
4. Commit with a clear message and push to `main`. The owner has asked for direct pushes to `main`; open **no pull request** unless asked. Do not push to other branches without permission.
5. If the change is in `worker/`, the live API needs a manual deploy. The owner runs `cd worker && git pull && npm install && npm run deploy` on their own machine. Say when a deploy is needed. A new migration also needs `npm run db:migrate:remote` (section 8).
6. Update the Google documents (section 12) when meaningful work lands, and this file when a rule or process changes.
7. Report plainly: what was done, what was verified (and how), what could not be verified. If a sandbox cannot reach the live sites, say so rather than claiming it works live.

## 5. Stack and layout

- **Frontend (repo root):** Vite + React 19 + TypeScript, Capacitor wrappers (`android/`, `ios/`), PWA (`public/sw.js`), lucide-react icons, jsPDF/autotable and write-excel-file for exports, Leaflet for the route map. No router library; `src/App.tsx` switches tabs by role.
- **API (`worker/`):** Hono + Drizzle on Cloudflare Workers, D1 (SQLite) and R2. Zod validation. Multi-tenant: `org_id` on every table, taken from the JWT.
- **Tests:** Vitest in both packages. API tests build a real SQLite database (Node's `node:sqlite`) from the migrations and seed.

```
src/
  App.tsx               tab wiring, role → tabs (ROLE_TABS / TAB_LABELS in src/data/mockData.ts)
  index.css             design tokens + all styling (legacy variable names aliased to new tokens)
  components/ui.tsx     shared UI: PageHeader, DataTable, KpiCard, StatusBadge, Modal, HeroKpi, ...
  components/           screens: Dashboard, FleetStatus, RouteNetwork/RouteMap, TripLog, AddMovement,
                        MovementReview, MonthlyReport, MovementSummary, MonthlyExpenses, FuelExpenses,
                        Master, People, SettingsPage, Pager (paging), ...
  lib/api.ts            API client      lib/reports.ts, exporter.ts   Excel/PDF exports
  utils/                aggregate.ts (per-vehicle totals), calc.ts, fleetStatus.ts,
                        routeGeo.ts (built-in towns), placeGeo.ts (place names → map positions, lane grouping),
                        roadRoute.ts (road routes) (+ tests)
worker/
  src/index.ts          Hono app + scheduled handler (backup, then demo refresh)
  src/routes/           one file per resource    src/lib/  jwt, password, backup, demoData, largeFleet, ...
  drizzle/schema.ts     schema     migrations/  D1 SQL migrations 0000-0016     seed.sql   demo sample data
  scripts/              large-fleet.mjs, large-fleet-remove.sql, backup/restore helpers
docs/                   RUNBOOK.md, backup/restore, architecture
```

## 6. Conventions

- Match surrounding code: comment density, naming, inline-style vs CSS-class idiom of the file you edit. Keep comments sparing and about *why*.
- Use design tokens from `src/index.css` (`var(--color-...)`, `var(--font-heading)`), not hard-coded colours. Display/figures use Archivo, body Inter.
- Reuse components from `ui.tsx` before writing new markup. Tables use `<table className="table">`; a `<tfoot>` row renders as the bold Total row.
- Money is stored as paise (integers) in the DB; format with `rupees()` / `formatNum()` from `src/utils/calc.ts`. Very large totals shorten with `rupeesCompact()` (lakh/crore).
- **Long lists:** tables that can grow past ~25 rows use `usePaging()` + `<Pager attached …>` (`src/components/Pager.tsx`, 25 per page, resets when filters change); totals/footers and exports still cover every row, not just the page. Fleet-sized lists also get search and "show more" (see `FleetStatus.tsx`, People, Dashboard). Paging is client-side only: the app still downloads every record.
- **Totals:** per-vehicle totals come from `totalOfVehicles()` in `src/utils/aggregate.ts`; ratios (margin, ₹/km) are recomputed from the totals, never averaged. Report exports take `withTotal`/`foot` options; the full backup (`exportBackup`) must stay pure data with no total rows.
- Schema changes are a new migration in `worker/migrations/` (generate with `npx drizzle-kit generate` after editing `drizzle/schema.ts`) plus the Drizzle schema; never edit applied migrations. Keep `seed.sql` consistent with the schema.
- Bump the cache name in `public/sw.js` (`fleet-ledger-demo-shell-vN`) when shipped shell assets change.
- Anything shown as an approximation must say so. There is no GPS: fleet status is derived from recorded movements and unavailability windows (draft trip = on the road, pending = awaiting approval, unavailability window = off the road); the route map is tagged "Likely road routes · not GPS" or "Straight lines".
- Writing style for text and docs: plain, specific, no filler words, no emoji.

## 7. Key design decisions (short)

- **Look:** bold industrial, for sales demos. Dark sidebar, hero band with counting figures, signage-style table headers.
- **Dashboard for big fleets:** summary bar with clickable counts (on the road / awaiting approval / off the road / idle / alerts), search, cards/list toggle, "show more"; Fleet performance sortable and paged; Trends show the trucks that matter first; Needs attention lists expand; map draws the busiest 24 lanes. Small fleets still see a card per truck.
- **Totals** on every per-vehicle table and in exports (see conventions).
- **Route map** (`RouteNetwork.tsx`, `RouteMap.tsx`): groups the month's movements into lanes (loading place → stops → unloading place) and draws them on a Leaflet map (OpenStreetMap tiles). Positions come from the built-in town list in `routeGeo.ts` first, then a Nominatim search limited to southern India; road routes come from the public OSRM servers (about one request a second). Both are remembered in the browser (localStorage). For big fleets it draws only the 24 busiest lanes and asks for road routes for the 10 busiest. Ported from FleetApp-SMT's map without its client-specific places.
- **Separation from SMT** (section 1) and **sample data that rolls itself** (sections 9 and 10).

## 8. Cloudflare, deploys, and what has gone wrong

### Deploying

- **Web app:** push to `main`; the Cloudflare Git build publishes the `fleetappdemo` worker. Verify in a private window at https://fleet.oneuptech.co.
- **API:** manual: `cd worker && git pull && npm install && npm run deploy`. Migrations on the remote DB: `npm run db:migrate:remote`. Secrets: `npm run secret:jwt` (a fresh value, never SMT's), optional `npm run secret:gemini`. Migration 0016 is already applied to the live demo DB.
- Pushing code does not change the live database. A migration must be applied separately.

### Plan and limits (learned the hard way)

- The Cloudflare account is on **Workers Paid** since 8 Oct 2026. Before that, the free plan's D1 limits (about 5 million rows read a day, resetting at midnight UTC) were enforced from 1 Sep 2026 and applied **account-wide**.
- On 8 Oct 2026 a bulk delete of about 400 movements read 5.3 million rows (the child tables had no index on `trip_id`, so every foreign-key lookup scanned the whole table). The account passed the limit and **every app on it, including SMT production, failed** with "Something went wrong" until the upgrade. Migration 0016 added the indexes.
- Cloudflare emails when the limit is reached, not before. Budget alerts ($10) only cover dollar spend. An outside uptime monitor on both sites is still to be set up.
- "Something went wrong" from the API is its generic 500 message (`worker/src/index.ts` `onError`). The real error is in the Worker logs (dashboard → Workers → fleet-ledger-demo-api → Logs, or `npx wrangler tail`).
- **Before any bulk change on a live database:** estimate the rows read (check the query plan or run it on the local copy first), prefer indexed lookups, and look at `rows_read` in every result.

### Working on the live database through the Cloudflare connector

- It is the demo database only (`886fcd84-…`). The owner must ask for any bulk load, delete or re-dating of the large set, because prospects see the result.
- Run dependent statements **one at a time, in order**, never in parallel (a parallel run once deleted rows before their dependents were cleared and failed half-way).
- The permission checker may block bulk deletes on shared resources. Do not work around it: stop and ask the owner.
- Reads for checks are fine and cheap; keep them small.

## 9. Sample data

### Small set and nightly refresh

`worker/src/lib/demoData.ts` rebuilds the sample movements for the current and previous month each night, so the dashboard never opens empty.

- Runs only when `DEMO_MODE = "true"` **and** the organisation is named "Demo Logistics"; it refuses otherwise.
- Only replaces rows whose ids start `demo-` (and the old hand-run `ot*` rows); movements users create while trying the demo are kept.
- Written as literal SQL in ~18 statements applied as one D1 batch (D1 limits: 100 bound params, per-invocation query limits).
- Covered by `demoData.test.ts`, which builds a real SQLite database from the migrations and seed.
- To switch it off, remove `DEMO_MODE` from `worker/wrangler.toml` and deploy.

### Large fleet (for 250+ truck prospects and scale testing)

The generator is `worker/src/lib/largeFleet.ts`: 260 trucks, 250 drivers, this and last month's movements with expenses, monthly fixed costs, 9 workshop windows and approval notices. The database builds the rows itself from ~15 KB of SQL (recursive queries and a repeatable hash), so the same date always gives the same data. `worker/scripts/large-fleet.mjs` prints it (`--vehicles`, `--drivers`, `--today`; statements are split by a `--;` line). Everything it adds is marked (`lf-*` ids, `custom_fields` `{"sample":"large-fleet"}`), and `worker/scripts/large-fleet-remove.sql` takes it all away.

**It is loaded in the live demo DB (8 Oct 2026) and rolls forward every night** inside the demo refresh (`planLargeFleet`): on the 1st both months are rebuilt, on other nights only this month's movements and fixed costs, and truck due dates and licence expiries move with the calendar. It only runs while the set is present, so `large-fleet-remove.sql` stops it too. Roll tests: `worker/src/lib/largeFleet.test.ts`.

```bash
cd worker && node scripts/large-fleet.mjs > large-fleet.sql
npx wrangler d1 execute fleet-ledger-demo-db --local -c wrangler.toml --file=large-fleet.sql
npx wrangler d1 execute fleet-ledger-demo-db --local -c wrangler.toml --file=scripts/large-fleet-remove.sql   # undo
```

Always load it on the **local** DB first. Expected counts after loading on top of the base seed: 264 trucks, 254 drivers, about 1,650 large-set movements.

### Checking the nightly roll (read-only)

After 02:30 IST, query the live demo DB and check: newest `trips.load_date` is today; about 264 vehicles, 254 drivers, ~1,650+ `lf-` trips with nothing doubled; this month's fixed costs use ids like `lf-fxm1…` (last month's may still be `lf-fx…` until the 1st); `vehicles.fc_date`, `drivers.licence_expiry` and `vehicle_unavailability` dates moved by a day; no future-dated trips. The roll ran correctly on 9 Oct 2026. First full month rollover to check: 1 Nov 2026.

## 10. Backups and the SMT relationship

- The API's nightly cron runs a backup to R2 (`backups/<date>/…`, manifest written last) and then the sample-data refresh. Restore notes: `docs/database-backup-and-restore.md`, `docs/RUNBOOK.md`.
- The Cloudflare connector cannot list R2 objects. To confirm a backup ran, use the Backup panel in Masters (Manager) or the bucket's `backups/` folder in the dashboard.
- Everything about SMT production belongs to the SMT repo and its own session.

## 11. Known gaps and open items

- Android/iOS splash screens still show the SMT logo.
- Monthly Expenses description dropdown prompts to add descriptions in Masters.
- Older dialogs are only restyled, not redesigned.
- Server-side paging and totals for fleets of 500+ trucks (today the app downloads every record).
- Set up an outside uptime monitor on smt.oneuptech.co and fleet.oneuptech.co.
- Confirm SMT's backup of 8 Oct 2026 ran; check the 1 Nov 2026 rollover of the large set.
- Porting the new design and the large-fleet work to SMT is pending the owner's agreement (and belongs to the SMT session).

## 12. Documents to keep current

Google Drive folder "Demo - FleetApp" holds:

- **Fleet Ledger Demo – Go-live & Domain Switch Checklist**: what was done and what is open, with dates. Update it when meaningful work lands. Doc id `11AfaqIn2eTIe9bDU0adyB-JPYkLiK7IslDJ23qGXiZU`.
- **Fleet Ledger Demo - Technical Design and Key Decisions**: architecture, design decisions, operations, incident. Update it when a design decision or process changes. Doc id `1DsaqvtDqaluCijpSqPAA9B9Ltf8amtkx8CtjoTASGzY`.

Edit documents in place with the Google Docs connector (read the doc, then insert or replace with a revision guard); do not recreate them. SMT has its own separate Technical and Architecture documents; leave those alone.

## 13. Working with the owner

- Ask before anything outward-facing or hard to reverse: deploys, deleting branches or resources, domain or DNS changes, billing, bulk changes to a live database.
- Say plainly what was and was not verified. If a mistake was made, say so and fix it.
- If something looks wrong in this file, tell the owner rather than silently changing the rules.
