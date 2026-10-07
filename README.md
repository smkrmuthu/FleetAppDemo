# Fleet Ledger Demo

> **This is the standalone demo of Fleet Ledger, kept separate from FleetApp-SMT.**
> It has its own Cloudflare Worker (`fleet-ledger-demo-api`), its own D1 database
> (`fleet-ledger-demo-db`), its own R2 bucket (`fleet-ledger-demo-docs`) and only
> fictional sample data under the company name "Demo Logistics". Nothing here
> reads or writes the SMT production database. Trip numbers are `DEMO-#####`.
>
> **Already done (6 Oct 2026):** the demo D1 database `fleet-ledger-demo-db`
> (`886fcd84-b0a7-417b-91e9-236f6adde3ce`) is created, migrated (0000–0015)
> and seeded; the R2 bucket `fleet-ledger-demo-docs` exists.
>
> **To deploy the demo** (from a clone of this repo, after `npx wrangler login`):
> 1. API, from `worker/`: `npm install`, `npm run secret:jwt` (a NEW value,
>    never SMT's), then `npm run deploy`. Always use these npm scripts: they
>    pass `-c wrangler.toml`, so wrangler can't pick up the web app's
>    `wrangler.jsonc` in the repo root instead.
> 2. Web app: Cloudflare dashboard → Workers & Pages → Create → Import a Git
>    repository → `smkrmuthu/FleetAppDemo`, branch `main`, build command
>    `npm run build`, deploy command `npx wrangler deploy`. The root
>    `wrangler.jsonc` pins the worker name to `fleetappdemo`.
> 3. Attach the custom domain `fleet.oneuptech.co` to the `fleetappdemo` worker.
>
> **Sample data rolls itself.** Every night (the 02:30 IST cron in
> `worker/wrangler.toml`, the same one that runs the backup) the demo API rebuilds
> its sample movements for the current and previous month, dated relative to
> today, and moves the trucks' due dates and two licences to match. On the 1st
> the month rolls over by itself. Code: `worker/src/lib/demoData.ts`. It runs
> only when `DEMO_MODE = "true"` **and** the organisation is named "Demo
> Logistics", and it only replaces rows it created (ids starting `demo-`), so
> movements people add while trying the demo are kept. To try it locally:
> `npx wrangler dev -c wrangler.toml --test-scheduled`, then open
> `http://127.0.0.1:8787/__scheduled`. To switch it off, remove `DEMO_MODE`.
>
> Demo sign-in: `mgr@demo.com` / `mgr123`, `office@demo.com` / `office123`,
> `driver@demo.com` / `driver123`.

Goods movement & expense log for a trucking fleet. Drivers log trips against
a waybill and item reference — plain domestic haulage, not export/import
trade documentation — recording fuel, AdBlue and toll stops as they happen
across however many days a trip takes. Documentation posts the fixed costs
(permits, insurance, EMI). Managers close the month — all from the same
ledger.

**Real backend, real database.** The frontend talks to a live Cloudflare
Worker + D1 API (`worker/`) — no more in-memory mock state. Built as a base
to extend to other transport companies and larger fleets (100+ vehicles):
the schema is multi-tenant (`org_id` on every table, enforced centrally from
the JWT), and adding or dropping a column is a reviewable migration, not a
manual `ALTER TABLE`. See [worker/README.md](worker/README.md) for the API's
own architecture notes and what's genuinely implemented vs. still deferred
(OTP sign-in, receipt/document persistence, month-close).

## Live app

**[smkrmuthu.github.io/FleetAppDemo](https://smkrmuthu.github.io/FleetAppDemo/)**
— all nine screens, backed by the real API, publicly viewable, no install
required. Redeploys automatically on every push to `main` via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml). API is at
`https://fleet-ledger-demo-api.smkrmuthu.workers.dev`, deployed separately (see
`worker/`).

Demo sign-in (also listed in [worker/README.md](worker/README.md)):

| Role    | Phone           | Password    |
| ------- | --------------- | ----------- |
| Manager | +91 94440 61928 | manager123  |
| Office  | +91 90031 77402 | office123   |
| Driver  | +91 98431 20114 | driver123   |

The header's Driver/Office/Manager switcher re-authenticates as that role's
demo account for quick comparison — it's a demo convenience, not a
client-side permission toggle; every permission check it triggers is the
same one a genuinely different signed-in user would hit.

## Stack

Vite + React 19 + TypeScript, installable as a PWA (manifest + service
worker), wrapped for iOS and Android with Capacitor — the same setup used by
the sibling `EMB_App` project. Backend: Hono + Drizzle ORM on Cloudflare
Workers + D1 (`worker/`), a separate Cloudflare deployment from EMB_App's.

## Screens

Sign in · Movement Summary · Add Movement (multiple fuel/AdBlue/toll stops
per trip, a required details field for "Other", a mock receipt-scan flow) ·
Trip Log (inline approve) · Monthly Expenses · Monthly Report (manager
only) · People (trucks, drivers, user accounts — all real CRUD) · Data
Model (reference).

## Commands

```bash
npm run dev             # local dev server (calls the deployed API)
npm run build            # typecheck + production build
npm run cap:sync         # build + copy web assets into ios/ and android/
npm run cap:open:ios     # open the Xcode project
npm run cap:open:android # open the Android Studio project
```

See [worker/README.md](worker/README.md) for backend commands (local dev,
migrations, seeding, deploy).

Building the Android APK from the CLI needs JDK 21 and the Android SDK on
`PATH`/`JAVA_HOME` — see the sibling project's toolchain notes if you don't
already have them installed.

## What's next

- OTP sign-in (needs an SMS provider) — password is the only working
  sign-in path today.
- Receipt/document upload actually persisting (needs R2 + EMB_App's
  existing OCR pipeline) — the document picker in Add Movement is real UI
  but the files aren't sent anywhere yet.
- Reading the odometer automatically from a dashboard photo, the same OCR
  pipeline applied to a different reading.
- Reject (not just approve) a pending movement — workflow still to be
  decided: who can reject, whether it needs a reason, whether it returns to
  the driver as an edit request.
- Month-close (`POST /months/:yyyy-mm:close` is documented in
  `design/handoff/API.md` but not built) and offline queueing for drivers.
- Vehicle tracking — either phone-based GPS from the driver's own app, or
  integrating an already-fitted hardware tracker's API/webhook feed.
