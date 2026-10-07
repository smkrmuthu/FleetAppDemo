import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { addDays, buildDemoStatements, isDemoMode, istToday, refreshDemoData } from './demoData';

// A real SQLite database built from the project's own migrations and seed, so
// the generated SQL is checked against the actual tables and foreign keys.
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('../../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  db.exec(readFileSync(new URL('../../seed.sql', import.meta.url), 'utf8'));
  return db;
}

function refresh(db: DatabaseSync, today: string) {
  db.exec('BEGIN');
  for (const s of buildDemoStatements(today)) db.exec(s);
  db.exec('COMMIT');
}

const rows = <T>(db: DatabaseSync, sql: string) => db.prepare(sql).all() as T[];
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;

describe('istToday', () => {
  it("uses India's date, not the Worker's", () => {
    expect(istToday(new Date('2026-10-31T21:00:00Z'))).toBe('2026-11-01');
    expect(istToday(new Date('2026-10-31T17:29:00Z'))).toBe('2026-10-31');
  });
});

describe('buildDemoStatements', () => {
  it('fills this month and last month, with the right mix of states', () => {
    const db = freshDb();
    refresh(db, '2026-11-15');
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'demo-%'")).toBe(16);
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'demo-202611-%'")).toBe(8);
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'demo-202610-%'")).toBe(8);
    const states = rows<{ status: string; n: number }>(db, "SELECT status, count(*) n FROM trips WHERE id LIKE 'demo-202611-%' GROUP BY status");
    expect(Object.fromEntries(states.map((s) => [s.status, s.n]))).toEqual({ approved: 5, pending: 2, draft: 1 });
    // every last-month movement is complete
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'demo-202610-%' AND status <> 'approved'")).toBe(0);
  });

  it('keeps every date inside its month and never in the future', () => {
    const db = freshDb();
    refresh(db, '2026-11-15');
    for (const t of rows<{ load_date: string; unload_date: string | null; status: string; id: string }>(db, "SELECT id, load_date, unload_date, status FROM trips WHERE id LIKE 'demo-202611-%'")) {
      expect(t.load_date >= '2026-11-01' && t.load_date <= '2026-11-15').toBe(true);
      if (t.status === 'draft') expect(t.unload_date).toBeNull();
      else expect(t.unload_date! <= '2026-11-15' && t.unload_date! >= t.load_date).toBe(true);
    }
    for (const t of rows<{ load_date: string }>(db, "SELECT load_date FROM trips WHERE id LIKE 'demo-202610-%'")) {
      expect(t.load_date.startsWith('2026-10-')).toBe(true);
    }
    for (const e of rows<{ spent_on: string }>(db, "SELECT spent_on FROM monthly_expenses WHERE id LIKE 'demo-%'")) expect(e.spent_on <= '2026-11-15').toBe(true);
  });

  it('on the 1st of a month, loads everything on the 1st rather than before it', () => {
    const db = freshDb();
    refresh(db, '2026-11-01');
    const dates = rows<{ load_date: string }>(db, "SELECT DISTINCT load_date FROM trips WHERE id LIKE 'demo-202611-%'");
    expect(dates).toEqual([{ load_date: '2026-11-01' }]);
  });

  it('rolls the year over (January looks back to December)', () => {
    const db = freshDb();
    refresh(db, '2026-01-03');
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'demo-202512-%'")).toBe(8);
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'demo-202601-%' AND load_date >= '2026-01-01'")).toBe(8);
  });

  it('leaves the database consistent: foreign keys hold and odometers only go up', () => {
    const db = freshDb();
    refresh(db, '2026-11-15');
    expect(rows(db, 'PRAGMA foreign_key_check')).toEqual([]);
    const byVehicle = new Map<string, { start: number; end: number }[]>();
    for (const t of rows<{ vehicle_id: string; odo_start: number; odo_end: number }>(db, "SELECT vehicle_id, odo_start, odo_end FROM trips WHERE id LIKE 'demo-%' ORDER BY load_date, id")) {
      const list = byVehicle.get(t.vehicle_id) ?? [];
      list.push({ start: t.odo_start, end: t.odo_end });
      byVehicle.set(t.vehicle_id, list);
    }
    for (const list of byVehicle.values()) {
      list.forEach((t, i) => {
        expect(t.end).toBeGreaterThan(t.start);
        if (i > 0) expect(t.start).toBeGreaterThan(list[i - 1]!.end);
      });
    }
  });

  it('shows the situations a demo needs: one truck on the road, one movement with no revenue', () => {
    const db = freshDb();
    refresh(db, '2026-11-15');
    expect(rows(db, "SELECT vehicle_id FROM trips WHERE status = 'draft' AND id LIKE 'demo-%'")).toEqual([{ vehicle_id: 'TN52 BK 2290' }]);
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'demo-202611-%' AND revenue_paise = 0")).toBe(1);
    expect(count(db, "SELECT count(*) n FROM notifications WHERE id LIKE 'demo-n-%' AND read = 0")).toBe(2);
  });

  it('moves due dates relative to today', () => {
    const db = freshDb();
    refresh(db, '2026-11-15');
    const tn45 = db.prepare("SELECT fc_date FROM vehicles WHERE id = 'TN45 CQ 9087'").get() as { fc_date: string };
    expect(tn45.fc_date).toBe(addDays('2026-11-15', 22));
    const ilango = db.prepare("SELECT licence_expiry FROM drivers WHERE id = 'Ilango R'").get() as { licence_expiry: string };
    expect(ilango.licence_expiry).toBe(addDays('2026-11-15', 20));
  });

  it('can run again and again without piling up, and leaves what people created alone', () => {
    const db = freshDb();
    refresh(db, '2026-11-15');
    db.exec(`INSERT INTO trips (id, org_id, vehicle_id, driver_id, waybill_no, load_date, status, created_by)
             VALUES ('3f2a9c1e-0000-4000-8000-000000000001', 'org-meridian', 'TN38 AB 4412', 'Murugan S', 'DEMO-00001', '2026-11-14', 'pending', 'user-kavitha')`);
    refresh(db, '2026-11-16');
    refresh(db, '2026-11-16');
    expect(count(db, "SELECT count(*) n FROM trips WHERE id LIKE 'demo-%'")).toBe(16);
    expect(count(db, "SELECT count(*) n FROM trips WHERE id = '3f2a9c1e-0000-4000-8000-000000000001'")).toBe(1);
    expect(count(db, "SELECT count(*) n FROM trip_expenses WHERE trip_id LIKE 'demo-%'")).toBeGreaterThan(40);
    expect(rows(db, 'PRAGMA foreign_key_check')).toEqual([]);
  });

  it('clears the rows an earlier hand-run script added', () => {
    const db = freshDb();
    db.exec(`INSERT INTO trips (id, org_id, vehicle_id, driver_id, waybill_no, load_date, status, created_by)
             VALUES ('ot5', 'org-meridian', 'TN38 AB 4412', 'Murugan S', 'EWB 8000', '2026-10-03', 'pending', 'user-kavitha')`);
    db.exec(`INSERT INTO notifications (id, org_id, kind, message, tab, related_trip_id, read) VALUES ('n7', 'org-meridian', 'approval', 'x', 'triplog', 'ot5', 0)`);
    db.exec(`INSERT INTO monthly_expenses (id, org_id, vehicle_id, spent_on, category, amount_paise) VALUES ('oe1', 'org-meridian', 'TN38 AB 4412', '2026-10-02', 'Insurance', 100)`);
    refresh(db, '2026-11-15');
    expect(count(db, "SELECT count(*) n FROM trips WHERE id = 'ot5'")).toBe(0);
    expect(count(db, "SELECT count(*) n FROM notifications WHERE id = 'n7'")).toBe(0);
    expect(count(db, "SELECT count(*) n FROM monthly_expenses WHERE id = 'oe1'")).toBe(0);
  });
});

describe('refreshDemoData safeguards', () => {
  const fakeDb = (orgName: string | null) => {
    const batch = vi.fn(async () => []);
    return {
      batch,
      prepare: (s: string) => ({ bind: () => ({ first: async () => (orgName ? { name: orgName } : null) }), sql: s })
    };
  };

  it('does nothing unless DEMO_MODE is "true"', async () => {
    const db = fakeDb('Demo Logistics');
    expect(isDemoMode({})).toBe(false);
    expect(isDemoMode({ DEMO_MODE: 'false' })).toBe(false);
    const r = await refreshDemoData({ DB: db as unknown as D1Database }, new Date('2026-11-15T10:00:00Z'));
    expect(r.ran).toBe(false);
    expect(db.batch).not.toHaveBeenCalled();
  });

  it('refuses to run on a database whose organisation is not Demo Logistics', async () => {
    for (const name of ['Shree Mira Trader', null]) {
      const db = fakeDb(name);
      const r = await refreshDemoData({ DB: db as unknown as D1Database, DEMO_MODE: 'true' }, new Date('2026-11-15T10:00:00Z'));
      expect(r.ran).toBe(false);
      expect(db.batch).not.toHaveBeenCalled();
    }
  });

  it('applies the whole refresh as one batch when it is allowed', async () => {
    const db = fakeDb('Demo Logistics');
    const r = await refreshDemoData({ DB: db as unknown as D1Database, DEMO_MODE: 'true' }, new Date('2026-11-15T10:00:00Z'));
    expect(r).toMatchObject({ ran: true, today: '2026-11-15' });
    expect(db.batch).toHaveBeenCalledTimes(1);
  });
});
