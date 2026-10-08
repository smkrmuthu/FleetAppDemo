import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { refreshDemoData } from './demoData';
import { buildLargeFleetStatements, LARGE_FLEET_MARK, planLargeFleet } from './largeFleet';

// A real SQLite database built from the project's own migrations and seed.
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('../../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  db.exec(readFileSync(new URL('../../seed.sql', import.meta.url), 'utf8'));
  return db;
}
const run = (db: DatabaseSync, statements: string[]) => {
  db.exec('BEGIN');
  for (const s of statements) db.exec(s);
  db.exec('COMMIT');
};
const rows = <T>(db: DatabaseSync, sql: string) => db.prepare(sql).all() as T[];
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const state = (db: DatabaseSync) => ({
  vehicles: count(db, `SELECT count(*) n FROM vehicles WHERE custom_fields = '${LARGE_FLEET_MARK}'`),
  drivers: count(db, `SELECT count(*) n FROM drivers WHERE custom_fields = '${LARGE_FLEET_MARK}'`),
  first: (db.prepare(`SELECT load_date FROM trips WHERE id = 'lf-0-0'`).get() as { load_date: string } | undefined)?.load_date ?? null
});
const night = (db: DatabaseSync, today: string) => {
  const plan = planLargeFleet(today, state(db));
  if (plan) run(db, buildLargeFleetStatements(today, plan));
  return plan;
};

describe('buildLargeFleetStatements', () => {
  it('builds 260 trucks, 250 drivers and a believable spread of movements', () => {
    const db = freshDb();
    run(db, buildLargeFleetStatements('2026-10-08', { withFleet: true }));
    expect(count(db, 'SELECT count(*) n FROM vehicles')).toBe(264);
    expect(count(db, 'SELECT count(*) n FROM drivers')).toBe(254);
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'lf-%'")).toBeGreaterThan(1400);
    const open = rows<{ status: string; n: number }>(db, "SELECT status, count(*) n FROM trips WHERE id LIKE 'lf-%' AND load_date >= '2026-10-01' GROUP BY status");
    const by = Object.fromEntries(open.map((o) => [o.status, o.n]));
    expect(by.draft).toBeGreaterThan(20);
    expect(by.pending).toBeGreaterThan(10);
    expect(by.approved).toBeGreaterThan(by.draft! + by.pending!);
    expect(rows(db, 'PRAGMA foreign_key_check')).toEqual([]);
  });

  it('never dates a movement in the future or unloads before loading', () => {
    const db = freshDb();
    run(db, buildLargeFleetStatements('2026-10-08', { withFleet: true }));
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'lf-%' AND (load_date > '2026-10-08' OR unload_date < load_date OR unload_date > '2026-10-08')")).toBe(0);
    expect(count(db, "SELECT count(*) n FROM monthly_expenses WHERE id LIKE 'lf-%' AND spent_on > '2026-10-08'")).toBe(0);
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'lf-%' AND odo_end <= odo_start")).toBe(0);
  });

  it('is repeatable: the same date gives the same data', () => {
    expect(buildLargeFleetStatements('2026-10-08', { withFleet: true })).toEqual(buildLargeFleetStatements('2026-10-08', { withFleet: true }));
  });
});

describe('nightly roll', () => {
  it('does nothing when the set was never loaded (or was removed)', () => {
    const db = freshDb();
    expect(night(db, '2026-10-09')).toBeNull();
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'lf-%'")).toBe(0);
  });

  it('rebuilds only this month on an ordinary night, keeping last month and what people added', () => {
    const db = freshDb();
    run(db, buildLargeFleetStatements('2026-10-08', { withFleet: true }));
    db.exec(`INSERT INTO trips (id, org_id, vehicle_id, driver_id, waybill_no, load_date, status, created_by)
             VALUES ('3f2a9c1e-0000-4000-8000-000000000001', 'org-meridian', 'TN38 AB 4412', 'Murugan S', 'DEMO-00001', '2026-10-07', 'pending', 'user-kavitha')`);
    const lastMonth = rows(db, "SELECT id, load_date FROM trips WHERE id LIKE 'lf-%' AND load_date < '2026-10-01' ORDER BY id");
    expect(night(db, '2026-10-12')?.mode).toBe('month');
    expect(night(db, '2026-10-12')?.mode).toBe('month'); // twice in a night changes nothing more
    expect(rows(db, "SELECT id, load_date FROM trips WHERE id LIKE 'lf-%' AND load_date < '2026-10-01' ORDER BY id")).toEqual(lastMonth);
    expect(count(db, "SELECT count(*) n FROM trips WHERE id = '3f2a9c1e-0000-4000-8000-000000000001'")).toBe(1);
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'lf-%' AND load_date > '2026-10-12'")).toBe(0);
    // no duplicated fixed costs
    expect(count(db, "SELECT count(*) n FROM (SELECT vehicle_id, category, spent_on FROM monthly_expenses WHERE id LIKE 'lf-%' GROUP BY 1,2,3 HAVING count(*) > 1)")).toBe(0);
    expect(count(db, "SELECT count(*) n FROM monthly_expenses WHERE id LIKE 'lf-fx%' AND spent_on >= '2026-10-01'")).toBe(count(db, "SELECT count(DISTINCT vehicle_id || category) n FROM monthly_expenses WHERE id LIKE 'lf-fx%' AND spent_on >= '2026-10-01'"));
    expect(rows(db, 'PRAGMA foreign_key_check')).toEqual([]);
  });

  it('clears fixed costs from the hand-loaded copy, which numbered them differently', () => {
    const db = freshDb();
    run(db, buildLargeFleetStatements('2026-10-08', { withFleet: true }));
    db.exec(`UPDATE monthly_expenses SET id = 'lf-fx' || substr(id, instr(id, 'v') + 1, instr(id, 'p') - instr(id, 'v') - 1) || '-' || substr(id, 7, 1) || '-' || substr(id, -1) WHERE id LIKE 'lf-fxm%'`);
    expect(count(db, "SELECT count(*) n FROM monthly_expenses WHERE id GLOB 'lf-fx[0-9]*-1-[01]'")).toBeGreaterThan(200);
    const thisMonth = count(db, "SELECT count(*) n FROM monthly_expenses WHERE id LIKE 'lf-%' AND spent_on >= '2026-10-01'");
    night(db, '2026-10-09');
    expect(count(db, "SELECT count(*) n FROM monthly_expenses WHERE id LIKE 'lf-%' AND spent_on >= '2026-10-01'")).toBe(thisMonth);
  });

  it('on the 1st of a month rebuilds both months, so last month becomes the old this month', () => {
    const db = freshDb();
    run(db, buildLargeFleetStatements('2026-10-28', { withFleet: true }));
    expect(night(db, '2026-11-01')?.mode).toBe('all');
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'lf-%' AND load_date < '2026-10-01'")).toBe(0);
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'lf-%' AND load_date BETWEEN '2026-10-01' AND '2026-10-31'")).toBeGreaterThan(900);
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'lf-%' AND load_date >= '2026-11-01'")).toBeGreaterThan(20); // the 1st: the trucks' state today, little more
    // and the night after is an ordinary one again
    expect(night(db, '2026-11-02')?.mode).toBe('month');
    expect(rows(db, 'PRAGMA foreign_key_check')).toEqual([]);
  });

  it('moves truck due dates and licence expiries with the calendar', () => {
    const db = freshDb();
    run(db, buildLargeFleetStatements('2026-10-08', { withFleet: true }));
    const before = rows<{ id: string; fc_date: string }>(db, `SELECT id, fc_date FROM vehicles WHERE custom_fields = '${LARGE_FLEET_MARK}' ORDER BY id LIMIT 5`);
    night(db, '2026-10-20');
    const after = rows<{ id: string; fc_date: string }>(db, `SELECT id, fc_date FROM vehicles WHERE custom_fields = '${LARGE_FLEET_MARK}' ORDER BY id LIMIT 5`);
    expect(after.map((a) => a.id)).toEqual(before.map((b) => b.id));
    expect(after.map((a) => a.fc_date)).not.toEqual(before.map((b) => b.fc_date));
    expect(count(db, `SELECT count(*) n FROM vehicles WHERE custom_fields = '${LARGE_FLEET_MARK}'`)).toBe(260);
  });

  it('planLargeFleet: a missing or stale first movement means a full rebuild', () => {
    expect(planLargeFleet('2026-10-08', { vehicles: 0, drivers: 0, first: null })).toBeNull();
    expect(planLargeFleet('2026-10-08', { vehicles: 260, drivers: 250, first: '2026-09-01' })?.mode).toBe('month');
    expect(planLargeFleet('2026-11-01', { vehicles: 260, drivers: 250, first: '2026-09-01' })?.mode).toBe('all');
    expect(planLargeFleet('2026-01-05', { vehicles: 260, drivers: 250, first: '2025-12-01' })?.mode).toBe('month');
    expect(planLargeFleet('2026-10-08', { vehicles: 260, drivers: 250, first: null })?.mode).toBe('all');
  });
});

describe('deleting a movement', () => {
  it('finds its lines, stops, documents and notices by index instead of scanning the tables', () => {
    const db = freshDb();
    for (const [table, column] of [['trip_expenses', 'trip_id'], ['trip_stops', 'trip_id'], ['trip_documents', 'trip_id'], ['notifications', 'related_trip_id']]) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT 1 FROM ${table} WHERE ${column} = 'x'`).all().map((r) => String((r as { detail: string }).detail)).join(' ');
      expect(plan, `${table}.${column}`).toMatch(/USING (COVERING )?INDEX/);
    }
  });
});

describe('refreshDemoData with the large set loaded', () => {
  it('adds the roll to the same single batch, and leaves it out when the set is absent', async () => {
    for (const present of [true, false]) {
      const batch = vi.fn(async () => []);
      const db = {
        batch,
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () =>
              sql.includes('FROM orgs') ? { name: 'Demo Logistics' } : present ? { vehicles: 260, drivers: 250, first: '2026-09-01' } : { vehicles: 0, drivers: 0, first: null }
          }),
          sql
        })
      };
      const r = await refreshDemoData({ DB: db as unknown as D1Database, DEMO_MODE: 'true' }, new Date('2026-10-15T10:00:00Z'));
      expect(r).toMatchObject({ ran: true, largeFleet: present ? 'month' : null });
      expect(batch).toHaveBeenCalledTimes(1);
      const n = (batch.mock.calls[0] as unknown as [unknown[]])[0].length;
      if (present) expect(n).toBeGreaterThan(20);
      if (present) expect(n).toBeLessThan(50); // stays inside a Worker's per-invocation query limit
    }
  });
});
