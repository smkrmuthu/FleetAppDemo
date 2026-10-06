# Fleet Ledger: Runbook

For whoever looks after the app. Read this first; the database details are in
[database-backup-and-restore.md](database-backup-and-restore.md).

Last updated: 2026-10-04.

## 1. What runs where

| Part | Where | Notes |
|---|---|---|
| Web app (React) | GitHub Pages `smkrmuthu.github.io/FleetAppDemo` and Cloudflare `fleet.oneuptech.co` / `fleetappdemo.smkrmuthu.workers.dev` | Both rebuild when `main` changes |
| API (Cloudflare Worker) | `fleet-ledger-demo-api.smkrmuthu.workers.dev` | Deployed by hand (section 3) |
| Database | Cloudflare D1 `fleet-ledger-demo-db` | Migrations in `worker/migrations/` |
| Uploaded bills, nightly backups | Cloudflare R2 bucket `fleet-ledger-demo-docs` | Backups under `backups/` |
| Android app | Capacitor project in `android/` | Debug build only (section 8) |
| Code | GitHub `smkrmuthu/FleetAppDemo` | `main` is what is live |

The API address is written into `src/lib/api.ts` (`API_BASE`), and the websites allowed to call it are
listed in `worker/wrangler.toml` (`ALLOWED_ORIGIN`). Change both together if the API address ever moves.

## 2. Checks before anything goes live

```bash
npx tsc --noEmit && npm test            # the web app
cd worker && npx tsc --noEmit && npm test   # the API
```

GitHub runs the same checks on every push (`.github/workflows/ci.yml`), and the Pages deployment
refuses to publish if they fail. **The Cloudflare site (`fleet.oneuptech.co`) is built by
Cloudflare's own Git integration, which these checks do not gate**, so a failing CI run on `main`
should be treated as "do not trust this deploy" and fixed straight away.

## 3. Deploying a change

Web app only: merge to `main` and push. Both sites rebuild within a couple of minutes. Check the new file name
in the page source (`assets/index-XXXX.js`) changed, and hard-refresh your browser.

API change:

```bash
cd worker
npx wrangler deploy
```

Database change (a new or altered table or column):

1. `cd worker && npm run db:generate` creates a numbered file in `worker/migrations/`. Read it.
2. Take a backup first: Master > Data backup > **Back up now**, or the manual export in the backup document.
3. `npm run db:migrate:remote`, then `npx wrangler deploy`, then merge the web app.
   Deploy the API before the web app that needs it, so the new screens never call a route that is not there yet.

Never edit or delete a migration file that has already been applied.

## 4. Backups (automatic)

- Every night at 02:30 India time the API copies the whole database, and any uploaded file that has no copy yet, into
  `backups/<date>/` and `backups/files/` in the R2 bucket. The last 30 nights are kept.
- A Manager sees the last backup time under **Master > Data backup**, with a red warning if it is more than a day old or
  the latest attempt failed. **Check this panel when you open the app.**
- "Back up now" runs it on demand. Nothing needs to be installed.
- Restore: see section 6 of this file and the backup document.
- These copies sit in the same Cloudflare account as the live data. They protect against mistakes and bad changes,
  **not against losing the account**. Once a month, download one and keep it somewhere else, encrypted:

  ```bash
  cd worker
  scripts/download-backup.sh 2026-10-04 ~/FleetLedger-backups/2026-10-04
  ```

  Those folders contain real company data and password hashes. Never put them in the repository.

## 5. Secrets

| Secret | What it does | If it must change |
|---|---|---|
| `JWT_SECRET` | Signs sign-in tokens | `cd worker && npx wrangler secret put JWT_SECRET`. Everyone is signed out once; passwords are unaffected |
| `GEMINI_API_KEY` | Reads fuel-bill photos | `npx wrangler secret put GEMINI_API_KEY` |

Secrets live only in Cloudflare, never in the repository or in a backup.

## 6. Restoring

**Undo a recent mistake (within 30 days):** D1 Time Travel, section 4A of the backup document.

**Rebuild from a nightly backup** (new or empty database, after the Worker points at it):

```bash
cd worker
scripts/download-backup.sh <date> /tmp/restore-folder
npx wrangler d1 migrations apply <database> --remote          # builds the empty tables
node scripts/restore-from-backup.mjs /tmp/restore-folder > /tmp/restore.sql
npx wrangler d1 execute <database> --remote --file /tmp/restore.sql
rm -r /tmp/restore-folder /tmp/restore.sql
```

Then compare row counts with the manifest in the folder and sign in to check the latest trips. The restore script
orders the tables itself and fills in circular links (a truck's default driver and a driver's default truck) at the end.
Uploaded files come back from `backups/files/` (copy them to the original keys with `wrangler r2 object put`).

The older `order-dump.py` route is kept only for `wrangler d1 export` files.

## 7. People and access

- Roles: **Driver** (starts and logs their own open trips; no fuel entry and no fixed costs), **Office** (movements, fuel, monthly expenses, summary), **Manager** (everything),
  **Viewer** (read-only: Dashboard, Movement Summary, Monthly Report).
- Managers add and edit users under **People**. Passwords must be at least 8 characters; a Manager sets and resets them
  (there is no "forgot password" email yet).
- A user who is deleted or disabled is locked out on their very next action, and a changed role applies at once.
- Sign-in is limited to 5 attempts a minute per account (10 per network); the limit is stored in the database so
  restarting the API does not clear it.

## 8. Android app

`cd android && ./gradlew assembleDebug` after `npx cap sync android`. Needs JDK 21 and the Android SDK
(`JAVA_HOME`, `ANDROID_HOME`). This produces a **debug** file for installing directly. A Play Store release needs a
Google Play developer account and a signing key that only the owner should hold, and is not set up. The iPhone app
needs Xcode and an Apple developer account and is not set up.

## 9. When something is wrong

| Symptom | First thing to try |
|---|---|
| Everyone sees an old screen | Hard refresh; confirm the new `assets/index-XXXX.js` is being served |
| "Too many sign-in attempts" | Wait a minute. Repeated for one person: check the password, reset it under People |
| A user is thrown back to sign-in | Their account was disabled or deleted, or their 12-hour sign-in expired |
| Data Backup panel is red | Press "Back up now". If it fails again, run `cd worker && npx wrangler tail` and press it again to see the error |
| API errors after a deploy | `npx wrangler tail` for live logs; roll back with `npx wrangler rollback` |
| Wrong data after a bad change | Time Travel restore (backup document, 4A) |

## 10. Known limits (not done)

- No second-factor sign-in and no "forgot password" email or SMS (needs a provider).
- No alert emails or paging if the app or the nightly backup fails; the Data Backup panel is the only warning.
- Screens load all records for the company; this is fine for thousands of trips but will need paging later.
- Backups live in the same Cloudflare account (monthly off-site copy is manual).
- One company per deployment.
- Android is a debug build; there is no iPhone app.
