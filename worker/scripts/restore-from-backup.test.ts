import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const script = join(__dirname, 'restore-from-backup.mjs');

function makeBackup(manifest: object, tables: Record<string, object[]>) {
  const dir = mkdtempSync(join(tmpdir(), 'restore-test-'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  for (const [t, rows] of Object.entries(tables)) {
    writeFileSync(join(dir, `${t}.ndjson.gz`), gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
  }
  return dir;
}

describe('restore-from-backup.mjs', () => {
  const manifest = {
    orderSource: 'foreign_keys',
    order: ['d1_migrations', 'vehicles', 'drivers', 'rate_limits'],
    tables: { d1_migrations: 1, vehicles: 1, drivers: 1, rate_limits: 1 },
    deferred: [{ child: 'vehicles', column: 'default_driver', parent: 'drivers' }],
    primaryKeys: { vehicles: ['id'], drivers: ['id'] }
  };
  const tables = {
    d1_migrations: [{ id: 1, name: '0000.sql' }],
    vehicles: [{ id: 'TN 01', model: "Tata 'Prima'", default_driver: 'Ravi', note: 'line1\nline2 "q" ₹ தமிழ்' }],
    drivers: [{ id: 'Ravi', default_vehicle: 'TN 01', active: true, nothing: null }],
    rate_limits: [{ key: 'x', count: 1, reset_at: 1 }]
  };

  it('writes parents first, escapes values, and fills circular links in afterwards', () => {
    const sql = execFileSync('node', [script, makeBackup(manifest, tables)], { encoding: 'utf8' });
    expect(sql).not.toContain('d1_migrations');
    expect(sql).not.toContain('rate_limits');
    expect(sql).toContain("'Tata ''Prima'''"); // quote doubled
    expect(sql).toContain('line1\nline2 "q" ₹ தமிழ்');
    const driverInsert = sql.split('\n').find((l) => l.startsWith('INSERT INTO "drivers"'))!;
    expect(driverInsert).toContain("VALUES ('Ravi', 'TN 01', 1, NULL)"); // true -> 1, null stays NULL
    // the circular link is inserted empty, then set by an UPDATE after every INSERT
    const vehicleInsert = sql.split('\n').find((l) => l.startsWith('INSERT INTO "vehicles"'))!;
    expect(vehicleInsert).toMatch(/VALUES \('TN 01', 'Tata ''Prima''', NULL,/);
    const lines = sql.trim().split('\n');
    const lastInsert = lines.map((l, i) => (l.startsWith('INSERT') ? i : -1)).reduce((a, b) => Math.max(a, b));
    const updateAt = lines.findIndex((l) => l.startsWith('UPDATE "vehicles" SET "default_driver" = \'Ravi\' WHERE "id" = \'TN 01\''));
    expect(updateAt).toBeGreaterThan(lastInsert);
  });

  it('refuses a backup whose row count does not match its manifest', () => {
    const bad = makeBackup({ ...manifest, tables: { ...manifest.tables, vehicles: 5 } }, tables);
    const r = spawnSync('node', [script, bad], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('expected 5 rows');
  });

  it('refuses a folder without a manifest', () => {
    const r = spawnSync('node', [script, mkdtempSync(join(tmpdir(), 'empty-'))], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
  });
});
