#!/usr/bin/env node
// Turns a nightly backup (see src/lib/backup.ts) into SQL you can load into a
// database whose schema has already been built by the migrations.
//
//   node scripts/restore-from-backup.mjs <backup-folder> > restore.sql
//
// <backup-folder> holds manifest.json and one <table>.ndjson.gz per table
// (scripts/download-backup.sh fetches them from R2). Tables are written in the
// manifest's parent-before-child order. `d1_migrations` and `rate_limits` are
// skipped: the first is rebuilt by `wrangler d1 migrations apply`, the second
// is disposable.
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: restore-from-backup.mjs <backup-folder>');
  process.exit(1);
}
const manifestPath = join(dir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`No manifest.json in ${dir} — that backup is incomplete or the wrong folder.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const SKIP = new Set(['d1_migrations', 'rate_limits']);
if (manifest.orderSource !== 'foreign_keys') {
  console.error('Warning: this backup could not record the table load order (orderSource: ' + manifest.orderSource + '). Loading may fail on a foreign-key error; use the older order-dump.py route instead.');
}

const quoteId = (s) => `"${String(s).replace(/"/g, '""')}"`;
function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}

// Links that form a cycle are loaded empty and filled in at the end.
const deferredByTable = new Map();
for (const e of manifest.deferred ?? []) {
  if (!deferredByTable.has(e.child)) deferredByTable.set(e.child, new Set());
  deferredByTable.get(e.child).add(e.column);
}

const out = ['PRAGMA defer_foreign_keys=TRUE;'];
const fixups = [];
for (const table of manifest.order) {
  if (SKIP.has(table)) continue;
  const file = join(dir, `${table}.ndjson.gz`);
  if (!existsSync(file)) {
    console.error(`Missing ${table}.ndjson.gz — cannot restore a complete database.`);
    process.exit(1);
  }
  const lines = gunzipSync(readFileSync(file)).toString('utf8').split('\n').filter(Boolean);
  if (lines.length !== manifest.tables[table]) {
    console.error(`${table}: expected ${manifest.tables[table]} rows, file has ${lines.length}.`);
    process.exit(1);
  }
  const deferredCols = deferredByTable.get(table) ?? new Set();
  const pk = manifest.primaryKeys?.[table] ?? [];
  for (const line of lines) {
    const row = JSON.parse(line);
    const cols = Object.keys(row);
    for (const c of deferredCols) {
      if (row[c] === null || row[c] === undefined) continue;
      if (!pk.length) {
        console.error(`${table}.${c} is a circular link but ${table} has no primary key to fill it in by.`);
        process.exit(1);
      }
      fixups.push(`UPDATE ${quoteId(table)} SET ${quoteId(c)} = ${literal(row[c])} WHERE ${pk.map((k) => `${quoteId(k)} = ${literal(row[k])}`).join(' AND ')};`);
    }
    const values = cols.map((c) => (deferredCols.has(c) ? 'NULL' : literal(row[c])));
    out.push(`INSERT INTO ${quoteId(table)} (${cols.map(quoteId).join(', ')}) VALUES (${values.join(', ')});`);
  }
}
out.push(...fixups);
process.stdout.write(out.join('\n') + '\n');
