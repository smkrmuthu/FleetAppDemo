import type { Env } from '../types';

// Nightly database backup, written to the same R2 bucket as the uploaded
// documents under a `backups/` prefix (no uploaded document key ever starts
// with that — keys begin with an org id).
//
//   backups/<YYYY-MM-DD>/<table>.ndjson.gz   one JSON object per row
//   backups/<YYYY-MM-DD>/schema.sql          the CREATE statements, for reference
//   backups/<YYYY-MM-DD>/manifest.json       written LAST — its presence means the
//                                            backup is complete
//   backups/files/<document key>             a copy of each uploaded document
//   backups/last-error.json                  only while the latest run has failed
//
// This protects against a bad change or an accidental delete. It lives in the
// same Cloudflare account as the live data, so it does not protect against
// losing the account — keep an occasional copy elsewhere (docs/RUNBOOK.md).

export const BACKUP_PREFIX = 'backups/';
export const KEEP_DAYS = 30;
const PAGE_SIZE = 1000;
// A run copies at most this many new documents; the rest follow on later runs.
const MAX_FILES_PER_RUN = 150;

export interface ForeignKeyEdge {
  child: string;
  column: string;
  parent: string;
}

export interface BackupManifest {
  date: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  keepDays: number;
  // Parent tables before child tables — the order to load them back in.
  order: string[];
  // 'foreign_keys' = derived from the schema; 'alphabetical' = could not be read (restore must defer FK checks).
  orderSource: 'foreign_keys' | 'alphabetical';
  // Links that form a cycle (e.g. a truck's default driver and a driver's default truck). The restore
  // loads these columns empty first and fills them in after every table is loaded.
  deferred: ForeignKeyEdge[];
  // Primary-key columns per table, used to fill the deferred links in.
  primaryKeys: Record<string, string[]>;
  tables: Record<string, number>;
  totalRows: number;
  bytes: number;
  files: { total: number; copiedThisRun: number };
}

export interface BackupStatus {
  keepDays: number;
  latest: BackupManifest | null;
  lastError: { at: string; message: string } | null;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

// Parents before children (Kahn's algorithm). Foreign keys that form a cycle
// can't all be satisfied by ordering alone: when no table is ready, the table
// with the fewest unmet parents goes next and its unmet links are returned as
// `deferred` (load them empty, fill them in at the end). Self-references
// aren't ordered at all — rows within a table load in their original order.
export function dependencyOrder(tables: string[], edges: ForeignKeyEdge[]): { order: string[]; deferred: ForeignKeyEdge[] } {
  const known = new Set(tables);
  const live = edges.filter((e) => e.child !== e.parent && known.has(e.child) && known.has(e.parent));
  const done = new Set<string>();
  const order: string[] = [];
  const deferred: ForeignKeyEdge[] = [];
  const unmet = (t: string) => live.filter((e) => e.child === t && !done.has(e.parent));
  const sorted = [...tables].sort();
  while (order.length < tables.length) {
    let next = sorted.find((t) => !done.has(t) && unmet(t).length === 0);
    if (!next) {
      const stuck = sorted.filter((t) => !done.has(t));
      next = stuck.reduce((best, t) => (unmet(t).length < unmet(best).length ? t : best), stuck[0]);
      deferred.push(...unmet(next));
    }
    done.add(next);
    order.push(next);
  }
  return { order, deferred };
}

export function toNdjson(rows: Record<string, unknown>[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

async function listTables(db: D1Database): Promise<string[]> {
  const res = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
  ).all<{ name: string }>();
  return res.results.map((r) => r.name);
}

// Reads each table's declared foreign keys. (The table-valued pragma form is
// not permitted on D1; the plain PRAGMA statement is.) Returns null if it
// can't be read, in which case the order is only alphabetical and the
// manifest says so.
async function foreignKeyEdges(db: D1Database, tables: string[]): Promise<ForeignKeyEdge[] | null> {
  try {
    const edges: ForeignKeyEdge[] = [];
    for (const child of tables) {
      const res = await db.prepare(`PRAGMA foreign_key_list("${child}")`).all<{ table: string; from: string }>();
      for (const r of res.results) edges.push({ child, column: r.from, parent: r.table });
    }
    return edges;
  } catch (err) {
    console.error('could not read foreign keys', err);
    return null;
  }
}

async function primaryKeys(db: D1Database, tables: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const t of tables) {
    const res = await db.prepare(`PRAGMA table_info("${t}")`).all<{ name: string; pk: number }>();
    out[t] = res.results.filter((c) => c.pk > 0).sort((x, y) => x.pk - y.pk).map((c) => c.name);
  }
  return out;
}

async function dumpTable(db: D1Database, table: string): Promise<Record<string, unknown>[]> {
  // `table` comes from sqlite_master, never from a request.
  const rows: Record<string, unknown>[] = [];
  let last = 0;
  for (;;) {
    const res = await db.prepare(`SELECT rowid AS __rowid, * FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE_SIZE}`)
      .bind(last).all<Record<string, unknown>>();
    if (!res.results.length) break;
    for (const r of res.results) {
      last = r.__rowid as number;
      const { __rowid, ...row } = r;
      rows.push(row);
    }
    if (res.results.length < PAGE_SIZE) break;
  }
  return rows;
}

async function deleteUnder(bucket: R2Bucket, prefix: string) {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

// Copies uploaded documents that have no backup copy yet.
async function mirrorDocuments(bucket: R2Bucket): Promise<{ total: number; copied: number }> {
  let total = 0;
  let copied = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    for (const obj of page.objects) {
      if (obj.key.startsWith(BACKUP_PREFIX)) continue;
      total++;
      if (copied >= MAX_FILES_PER_RUN) continue;
      const copyKey = `${BACKUP_PREFIX}files/${obj.key}`;
      if (await bucket.head(copyKey)) continue;
      const src = await bucket.get(obj.key);
      if (!src) continue;
      await bucket.put(copyKey, src.body, { httpMetadata: src.httpMetadata });
      copied++;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { total, copied };
}

// Removes dated backups older than `keepDays`.
export async function pruneOldBackups(bucket: R2Bucket, now: Date, keepDays = KEEP_DAYS): Promise<string[]> {
  const cutoff = dayKey(new Date(now.getTime() - keepDays * 86_400_000));
  const listing = await bucket.list({ prefix: BACKUP_PREFIX, delimiter: '/' });
  const removed: string[] = [];
  for (const prefix of listing.delimitedPrefixes) {
    const m = prefix.match(/^backups\/(\d{4}-\d{2}-\d{2})\/$/);
    if (m && m[1] < cutoff) {
      await deleteUnder(bucket, prefix);
      removed.push(m[1]);
    }
  }
  return removed;
}

export async function runBackup(env: Env, now = new Date()): Promise<BackupManifest> {
  const started = Date.now();
  const date = dayKey(now);
  const base = `${BACKUP_PREFIX}${date}/`;
  try {
    const tables = await listTables(env.DB);
    const edges = await foreignKeyEdges(env.DB, tables);
    const { order, deferred } = dependencyOrder(tables, edges ?? []);
    const pks = await primaryKeys(env.DB, tables);

    const counts: Record<string, number> = {};
    let bytes = 0;
    // Written to a staging name first would be safer still, but the manifest
    // is only written once every table is in, so a half-finished run is
    // visibly incomplete (no manifest) and is simply redone.
    for (const table of order) {
      const rows = await dumpTable(env.DB, table);
      counts[table] = rows.length;
      const body = await gzip(toNdjson(rows));
      bytes += body.byteLength;
      await env.DOCS.put(`${base}${table}.ndjson.gz`, body, { httpMetadata: { contentType: 'application/gzip' } });
    }

    const schema = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type DESC, name"
    ).all<{ sql: string }>();
    await env.DOCS.put(`${base}schema.sql`, schema.results.map((r) => r.sql + ';').join('\n\n') + '\n');

    const files = await mirrorDocuments(env.DOCS);

    const manifest: BackupManifest = {
      date,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      keepDays: KEEP_DAYS,
      order,
      orderSource: edges ? 'foreign_keys' : 'alphabetical',
      deferred,
      primaryKeys: pks,
      tables: counts,
      totalRows: Object.values(counts).reduce((a, n) => a + n, 0),
      bytes,
      files: { total: files.total, copiedThisRun: files.copied }
    };
    await env.DOCS.put(`${base}manifest.json`, JSON.stringify(manifest, null, 2), { httpMetadata: { contentType: 'application/json' } });
    await env.DOCS.delete(`${BACKUP_PREFIX}last-error.json`);
    await pruneOldBackups(env.DOCS, now);
    return manifest;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DOCS.put(`${BACKUP_PREFIX}last-error.json`, JSON.stringify({ at: new Date().toISOString(), message })).catch(() => {});
    throw err;
  }
}

export async function backupStatus(env: Env): Promise<BackupStatus> {
  const listing = await env.DOCS.list({ prefix: BACKUP_PREFIX, delimiter: '/' });
  const dates = listing.delimitedPrefixes
    .map((p) => p.match(/^backups\/(\d{4}-\d{2}-\d{2})\/$/)?.[1])
    .filter((d): d is string => !!d)
    .sort()
    .reverse();
  let latest: BackupManifest | null = null;
  for (const d of dates) {
    const obj = await env.DOCS.get(`${BACKUP_PREFIX}${d}/manifest.json`);
    if (obj) { latest = JSON.parse(await obj.text()) as BackupManifest; break; }
  }
  const errObj = await env.DOCS.get(`${BACKUP_PREFIX}last-error.json`);
  const lastError = errObj ? (JSON.parse(await errObj.text()) as { at: string; message: string }) : null;
  return { keepDays: KEEP_DAYS, latest, lastError };
}
