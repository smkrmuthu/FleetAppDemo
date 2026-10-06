# Fleet Ledger: Database storage, backup and restore

Last verified: 2026-10-04. The nightly backup and its restore (section 9) were tested on 2026-10-04 against a local copy; the older drill in section 6 dates from 2026-09-25. See also [RUNBOOK.md](RUNBOOK.md).

## 1. Where the data lives

| What | Where | Identifier |
|---|---|---|
| Database (all trips, vehicles, drivers, users, expenses, Master settings, audit log) | Cloudflare **D1** (managed SQLite) | name `fleet-ledger-demo-db`, id `886fcd84-b0a7-417b-91e9-236f6adde3ce`, region APAC, created 2026-09-14 |
| Uploaded files (receipt photos, PDFs) | Cloudflare **R2** bucket | `fleet-ledger-demo-docs`, region APAC, Standard storage |
| API that reads and writes both | Cloudflare **Worker** | `fleet-ledger-demo-api`, `https://fleet-ledger-demo-api.smkrmuthu.workers.dev/v1` |
| Secrets (`JWT_SECRET`, `GEMINI_API_KEY`) | Worker secrets | not in the database, not in any dump |
| Source code and migrations | GitHub `smkrmuthu/FleetAppDemo` | `worker/migrations/*.sql` |

- The database is **not** on any user's phone or on GitHub Pages. The web app and the Android app hold only a login token and call the Worker; the Worker is the only thing that touches D1 and R2 (bindings `DB` and `DOCS` in `worker/wrangler.toml`).
- A D1 database is one logical database managed by Cloudflare, which keeps it durable and replicated on its side. You cannot open a file on a server, so backups are taken through Cloudflare's tools (below).
- The database stores only a **pointer** to each uploaded file (`receipts.storage_key`, format `<orgId>/<tripId>/<receiptId>__<filename>`). The file itself is in R2. **A database backup does not contain the files.**

Schema: 18 tables, defined in `worker/drizzle/schema.ts` and built by migrations `0000` to `0007` in `worker/migrations/`. The `d1_migrations` table records which have run. The trip-number sequence (`DEMO-#####`) lives in the `counters` table, so any restore of the database also restores the sequence.

## 2. Backup layers

| # | Layer | Automatic? | Covers | Retention | Use it for |
|---|---|---|---|---|---|
| 1 | D1 **Time Travel** | Yes, always on | Database only | 30 days on Workers Paid, 7 days on Free (confirm your plan in the Cloudflare dashboard) | "Undo" a bad change from the last few weeks |
| 2 | **SQL export** (`wrangler d1 export`) | No, manual today | Database only | Forever, wherever you store the file | Off-Cloudflare copy, moving to a new database or account |
| 3 | In-app **Backup data** (Manager) | No, manual | Trips, vehicles, drivers, users, Master settings as a readable file | Wherever you keep it | Reading or analysing data in Excel. **Not** for restoring the database |
| 4 | **R2 files** | Partly: new uploads are copied nightly to `backups/files/` (same bucket) | Uploaded documents | Kept; not pruned | Recovering a file deleted by mistake. Does not protect against losing the bucket or account (section 5) |
| 5 | **Nightly backup** (section 9) | Yes, 02:30 IST | Database + uploaded-file copies | 30 nights | Rebuilding the database from a known night; checking what changed |

Current state: layers 1 and 5 are automatic. Both sit inside the same Cloudflare account, so keep an occasional off-site copy (layer 2, or `scripts/download-backup.sh`, section 9). Copies from layer 2 made so far exist only on the developer's Mac (`~/FleetLedger-backups/`).

## 3. Taking a backup

Run from the `worker/` folder (needs `wrangler login` once).

**Data-only export. This is the format the tested restore uses. Take this one.**

```bash
npx wrangler d1 export fleet-ledger-demo-db --remote --no-schema \
  --output ~/FleetLedger-backups/fleet-ledger-demo-db-DATA-$(date +%Y%m%d-%H%M).sql
chmod 600 ~/FleetLedger-backups/*.sql
```

Optional full export (schema plus data), useful as a readable reference:

```bash
npx wrangler d1 export fleet-ledger-demo-db --remote \
  --output ~/FleetLedger-backups/fleet-ledger-demo-db-$(date +%Y%m%d-%H%M).sql
```

> **The full export cannot be replayed as-is.** D1's importer fails on it with a foreign-key error because the file lists tables in an order that puts child rows before their parents. Restore from the data-only export plus the migrations (section 4B).

**Security:** every dump contains user password hashes and salts, all trip and pricing data, and the audit log. Keep it out of the repo, restrict permissions, and store any off-machine copy encrypted.

## 4. Restoring the database

Before any restore that overwrites data, take a fresh export first (section 3).

### A. Undo recent changes in place: Time Travel

Restores the same database to an earlier moment (within the retention window). It replaces the current contents.

```bash
# See the current bookmark (a marker for "now"). Save it so you can return to it.
npx wrangler d1 time-travel info fleet-ledger-demo-db

# Restore to a moment in time (RFC 3339 or Unix seconds), or to a bookmark
npx wrangler d1 time-travel restore fleet-ledger-demo-db --timestamp 2026-09-25T06:00:00Z
npx wrangler d1 time-travel restore fleet-ledger-demo-db --bookmark <bookmark>
```

The restore prints the bookmark of the state you just replaced; restoring to that bookmark undoes the restore. `time-travel info` was run against production and works; a real `restore` has **not** been run on production (it overwrites live data), so treat the first use as a controlled exercise.

Time Travel does not touch R2 files.

### B. Rebuild from a SQL backup into a new database

> **Known weakness (found 2026-10-04):** this route relies on a hand-kept table order in `scripts/order-dump.py`. A truck's *default driver* and a driver's *default truck* point at each other, so no table order can load them without a foreign-key error once both are filled in. The 2026-09-25 drill predates default drivers. Prefer the nightly backup route in section 9, which handles this; use this section only for `wrangler d1 export` files, and expect that step 4 may need the circular links cleared first.


Use this for a lost or corrupted database, moving accounts, or a practice restore.

```bash
cd worker

# 1. Create the empty database and note the database_id it prints
npx wrangler d1 create fleet-ledger-demo-db-restored

# 2. Point worker/wrangler.toml at it (database_name and database_id under [[d1_databases]])

# 3. Build the schema from the migrations (this also fills d1_migrations)
npx wrangler d1 migrations apply fleet-ledger-demo-db-restored --remote

# 4. Put the data-only backup into parent-before-child order, then load it
python3 scripts/order-dump.py ~/FleetLedger-backups/fleet-ledger-demo-db-DATA-YYYYMMDD-HHMM.sql > /tmp/ordered.sql
npx wrangler d1 execute fleet-ledger-demo-db-restored --remote --yes --file /tmp/ordered.sql
rm /tmp/ordered.sql

# 5. Deploy the Worker so it uses the restored database
npx wrangler deploy
```

Why `scripts/order-dump.py`: D1's import commits in batches, so a child row loaded before its parent (`users` before `drivers`, `audit_log` before `users`) fails with `FOREIGN KEY constraint failed` and the whole import rolls back. The script loads parents first and drops the `d1_migrations` rows (step 3 already created them). If you add a table to the schema, add it to the `ORDER` list in that script.

### C. Verify a restore

Run the same counts on the source and the restored database; they must match, and the foreign-key check must return no rows:

```sql
SELECT (SELECT count(*) FROM trips) trips, (SELECT count(*) FROM users) users,
       (SELECT count(*) FROM vehicles) vehicles, (SELECT count(*) FROM drivers) drivers,
       (SELECT count(*) FROM audit_log) audit,
       (SELECT value FROM counters WHERE key='trip_no') trip_counter,
       (SELECT count(*) FROM d1_migrations) migrations;
PRAGMA foreign_key_check;
```

```bash
npx wrangler d1 execute <database> --remote --command "<the SQL above>"
```

Then sign in to the app, open the Trip Log and confirm the latest trips and the next trip number look right.

## 5. Uploaded files (R2)

The bucket holds the receipt photos and PDFs (2 objects, about 5 MB at the time of writing). Find which files the database expects:

```bash
npx wrangler d1 execute fleet-ledger-demo-db --remote --command "SELECT storage_key FROM receipts"
```

Download one, or upload one back:

```bash
npx wrangler r2 object get  fleet-ledger-demo-docs/<storage_key> --remote --file ./file.jpg
npx wrangler r2 object put  fleet-ledger-demo-docs/<storage_key> --remote --file ./file.jpg
```

For a full copy of the bucket, use `rclone` against R2's S3-compatible endpoint (create an R2 API token in the Cloudflare dashboard). A restored database only works with attachments if the objects exist under the same keys.

## 6. What was tested (2026-09-25)

A restore drill was run against a temporary, separate D1 database (created and deleted for the test; production was only read):

- Replaying the **full** export directly: **failed** (foreign-key ordering, as described above).
- Migrations, then the **data-only** export loaded through `order-dump.py`: **succeeded**. The restored copy matched production: 12 trips, 7 users, 8 vehicles, 10 drivers, 18 trip expense lines, 308 audit rows, trip counter 8, 8 migrations, and `PRAGMA foreign_key_check` returned no rows.
- Time Travel: `info` confirmed. `restore` not exercised.
- R2 download and upload: commands not exercised.

## 7. Full disaster recovery (new Cloudflare account or lost project)

1. Install Node and Wrangler, then `wrangler login` to the new account.
2. Get the code: `git clone git@github.com:smkrmuthu/FleetAppDemo.git`, then `npm install` in the root and in `worker/`.
3. Create the R2 bucket `fleet-ledger-demo-docs`, and the D1 database (section 4B steps 1 to 4).
4. Put the new `database_id` in `worker/wrangler.toml`.
5. Set the secrets: `npx wrangler secret put JWT_SECRET` (any long random value; existing logins simply expire and users sign in again, passwords are unaffected) and `npx wrangler secret put GEMINI_API_KEY` (from your Google AI account).
6. `npx wrangler deploy` and note the new Worker URL.
7. If the URL changed, update `API_BASE` in `src/lib/api.ts` and `ALLOWED_ORIGIN` in `worker/wrangler.toml`, rebuild, push (GitHub Pages redeploys) and rebuild the Android app.
8. Restore the R2 files (section 5) and verify (section 4C).

## 8. Recommended next steps

1. ~~Schedule a backup~~ **Done 2026-10-04**: nightly, see section 9. Still keep a monthly copy outside Cloudflare.
2. **Back up R2 outside Cloudflare** with `rclone` on the same schedule. The nightly job only copies files within the same bucket.
3. **Confirm the Cloudflare plan** to know whether Time Travel keeps 7 or 30 days, and that the nightly job fits the plan's time limit for scheduled jobs. The Master > Data backup panel shows it if a run fails.
4. **Repeat the restore drill** (section 9) every quarter and after any schema change.
5. Keep at least one backup that is **older than the Time Travel window**.

## 9. Nightly backup (automatic)

**What it does.** At 21:00 UTC (02:30 IST) the API reads every table and writes it to the R2 bucket `fleet-ledger-demo-docs`:

```
backups/<YYYY-MM-DD>/<table>.ndjson.gz    one JSON row per line, compressed
backups/<YYYY-MM-DD>/schema.sql           the CREATE statements, for reference
backups/<YYYY-MM-DD>/manifest.json        written last: row counts, the correct load order, circular links
backups/files/<document key>              copy of each uploaded file (up to 150 new files per night)
backups/last-error.json                   only exists while the latest run has failed
```

Dated folders older than 30 days are deleted. A folder without `manifest.json` is an unfinished run and should be ignored.
Managers see the result in **Master > Data backup** and can press **Back up now**.

**Restore from it** (into a database whose tables were built by the migrations):

```bash
cd worker
scripts/download-backup.sh 2026-10-04 /tmp/restore-folder
node scripts/restore-from-backup.mjs /tmp/restore-folder > /tmp/restore.sql
npx wrangler d1 execute <database> --remote --file /tmp/restore.sql
```

The script loads tables parents-first in the order recorded in the manifest, loads the circular links empty and fills them in
at the end, skips `d1_migrations` and `rate_limits`, and refuses to run if a file is missing or a row count differs from the manifest.

**Tested 2026-10-04** (local copy of the database): a backup was taken, downloaded from R2, turned into SQL with the
`defer_foreign_keys` line removed, and loaded into a fresh database. Counts and values matched the source, including
quotes, a line break, the rupee sign and Tamil text, a circular default-driver link was restored, and `PRAGMA foreign_key_check`
returned no rows. The first attempt failed on a foreign-key error and led to the cycle handling above.
**Not yet exercised against production:** the first scheduled run and the table-order lookup on the real D1; check the panel the morning after deploy.
