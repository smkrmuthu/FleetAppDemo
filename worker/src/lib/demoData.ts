// Keeps the DEMO deployment's sample data current, so the dashboard never opens
// on "No movements in this period".
//
// Every night (the cron in wrangler.toml) the sample movements are rebuilt for
// the current month and the previous one, dated relative to today: movements
// from the last few days, one truck still on the road, a couple awaiting
// approval. On the 1st the month rolls over by itself. Truck due dates and two
// driver licences are moved relative to today too, so the warnings stay
// believable.
//
// This only ever touches rows this file created (ids starting "demo-", plus the
// "ot…"/"oe…" rows and notifications n7/n8 that an earlier hand-run script
// added). Anything people create while trying the demo is left alone.
//
// If the large sample fleet (largeFleet.ts) has been loaded, the same run rolls it forward
// too, in the same batch.
//
// Safety: it does nothing unless DEMO_MODE is "true" AND the organisation is
// named "Demo Logistics", so it cannot run against the production database.

import type { Env } from '../types';
import { buildLargeFleetStatements, LARGE_FLEET_MARK, planLargeFleet, type LargeFleetOptions } from './largeFleet';

const ORG = 'org-meridian';
const ORG_NAME = 'Demo Logistics';
const OFFICE_USER = 'user-kavitha';

type LineKind = 'diesel' | 'adblue' | 'toll' | 'other';
// [kind, litres, ratePaise, amountPaise]
type Line = [LineKind, number | null, number | null, number];

interface TripSpec {
  vehicle: string;
  driver: string;
  from: string;
  to: string;
  tons: number;
  km: number;
  revenue: number; // paise
  days: number; // loading day to unloading day, inclusive
  lines: Line[];
}

const TRIPS: TripSpec[] = [
  { vehicle: 'TN38 AB 4412', driver: 'Murugan S', from: 'Chennai Yard', to: 'Sriperumbudur ICD', tons: 24.5, km: 342, revenue: 3450000, days: 2,
    lines: [['diesel', 118, 9500, 1121000], ['toll', null, null, 184000], ['other', null, null, 90000]] },
  { vehicle: 'TN45 CQ 9087', driver: 'Rafiq A', from: 'Tirupur Factory', to: 'Cochin Yard', tons: 18, km: 372, revenue: 3180000, days: 2,
    lines: [['diesel', 131, 9400, 1231400], ['toll', null, null, 210000], ['other', null, null, 125000]] },
  { vehicle: 'KA01 MD 7731', driver: 'Prakash N', from: 'Ennore Yard', to: 'Hosur Warehouse', tons: 21.2, km: 208, revenue: 1940000, days: 1,
    lines: [['diesel', 74, 9600, 710400], ['toll', null, null, 98000], ['other', null, null, 45000]] },
  { vehicle: 'TN52 BK 2290', driver: 'Ilango R', from: 'Hosur Warehouse', to: 'Cochin Yard', tons: 26, km: 692, revenue: 6820000, days: 3,
    lines: [['diesel', 130, 9500, 1235000], ['toll', null, null, 184000], ['diesel', 116, 9500, 1102000], ['adblue', 8, 7500, 60000], ['toll', null, null, 180000], ['other', null, null, 210000]] },
  { vehicle: 'TN38 AB 4412', driver: 'Murugan S', from: 'Chennai Yard', to: 'Vijayawada Warehouse', tons: 25, km: 456, revenue: 4190000, days: 2,
    lines: [['diesel', 162, 9500, 1539000], ['toll', null, null, 238000], ['other', null, null, 115000]] },
  { vehicle: 'TN45 CQ 9087', driver: 'Rafiq A', from: 'Hyderabad Plant', to: 'Krishnapatnam Yard', tons: 19.5, km: 574, revenue: 4760000, days: 2,
    lines: [['diesel', 108, 9600, 1036800], ['toll', null, null, 160000], ['diesel', 97, 9600, 931200], ['adblue', 6, 7500, 45000], ['toll', null, null, 136000], ['other', null, null, 140000]] },
  { vehicle: 'KA01 MD 7731', driver: 'Prakash N', from: 'Ennore Yard', to: 'Erode Warehouse', tons: 22, km: 98, revenue: 860000, days: 1,
    lines: [['diesel', 36, 9500, 342000], ['toll', null, null, 42000], ['other', null, null, 26000]] },
  { vehicle: 'TN52 BK 2290', driver: 'Ilango R', from: 'Madurai Factory', to: 'Tuticorin Yard', tons: 23.4, km: 268, revenue: 2480000, days: 2,
    lines: [['diesel', 97, 9500, 921500], ['toll', null, null, 118000], ['other', null, null, 64000]] }
];

// This month: how many days before today each movement loaded, and its state.
const THIS_MONTH: { spec: number; ago: number; status: 'approved' | 'pending' | 'draft'; noRevenue?: boolean }[] = [
  { spec: 0, ago: 6, status: 'approved' },
  { spec: 1, ago: 6, status: 'approved' },
  { spec: 2, ago: 5, status: 'approved', noRevenue: true }, // costs but no revenue: a real exception to show
  { spec: 3, ago: 5, status: 'approved' },
  { spec: 4, ago: 4, status: 'pending' },
  { spec: 5, ago: 3, status: 'approved' },
  { spec: 6, ago: 2, status: 'pending' },
  { spec: 7, ago: 1, status: 'draft' }
];
// Last month: day offsets from the 1st; every movement is complete.
const LAST_MONTH_DAYS = [1, 2, 4, 5, 8, 10, 13, 16];

const FIXED: { vehicle: string; driver: string; category: string; amount: number; remarks: string; day: number }[] = [
  { vehicle: 'TN38 AB 4412', driver: 'Murugan S', category: 'Detention / halting charges', amount: 2860000, remarks: 'Yard halt', day: 1 },
  { vehicle: 'TN45 CQ 9087', driver: 'Rafiq A', category: 'Permit / tax', amount: 1240000, remarks: 'Monthly transit permit', day: 2 },
  { vehicle: 'KA01 MD 7731', driver: 'Prakash N', category: 'Detention / halting charges', amount: 1980000, remarks: '2 days at the plant gate', day: 3 },
  { vehicle: 'TN52 BK 2290', driver: 'Ilango R', category: 'Loan / lease', amount: 5620000, remarks: 'EMI', day: 4 },
  { vehicle: 'TN38 AB 4412', driver: 'Murugan S', category: 'Insurance', amount: 1840000, remarks: 'Goods-in-transit insurance', day: 5 },
  { vehicle: 'TN45 CQ 9087', driver: 'Rafiq A', category: 'Maintenance', amount: 520000, remarks: 'Oil change', day: 6 }
];

// Days from today until each due date, per truck and driver.
const VEHICLE_DUE: { id: string; set: Record<string, number> }[] = [
  { id: 'TN38 AB 4412', set: { fc_date: 160, fc_renewal_due: 160, pollution_date: 17 } },
  { id: 'TN45 CQ 9087', set: { fc_date: 22, fc_renewal_due: 22 } },
  { id: 'KA01 MD 7731', set: { fc_date: 90, fc_renewal_due: 90, tax_date: 42 } },
  { id: 'TN52 BK 2290', set: { fc_date: 75, fc_renewal_due: 75 } }
];
const DRIVER_LICENCE_DAYS: Record<string, number> = { 'Ilango R': 20, 'Rafiq A': 40 };

const DAY_MS = 86_400_000;
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const msOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso: string, n: number) => isoOf(msOf(iso) + n * DAY_MS);
const minIso = (a: string, b: string) => (a < b ? a : b);
const maxIso = (a: string, b: string) => (a > b ? a : b);

// Today's date in India, whatever time zone the Worker runs in.
export function istToday(now: Date = new Date()): string {
  return isoOf(now.getTime() + 330 * 60_000);
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const num = (n: number | null) => (n === null ? 'NULL' : String(n));

// A repeatable pseudo-random number, so waybill and item numbers look real
// without changing every night.
function pseudo(seed: number): number {
  let x = (seed * 2654435761) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13;
  return x >>> 0;
}
const digits = (seed: number, n: number) => String(pseudo(seed) % 10 ** n).padStart(n, '0');

interface PlannedTrip {
  id: string;
  spec: TripSpec;
  load: string;
  unload: string | null;
  status: 'approved' | 'pending' | 'draft';
  revenue: number;
  waybill: string;
  item: string;
}

function plan(today: string): { trips: PlannedTrip[]; yyyymm: string; prevYyyymm: string; monthStart: string; prevStart: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevStart = isoOf(Date.UTC(y, m - 2, 1));
  const prevLen = Math.round((msOf(monthStart) - msOf(prevStart)) / DAY_MS);
  const yyyymm = today.slice(0, 7).replace('-', '');
  const prevYyyymm = prevStart.slice(0, 7).replace('-', '');
  const trips: PlannedTrip[] = [];

  LAST_MONTH_DAYS.forEach((offset, i) => {
    const spec = TRIPS[i]!;
    const load = addDays(prevStart, Math.min(offset, prevLen - 1 - spec.days));
    const seed = Number(prevYyyymm) * 10 + i;
    trips.push({
      id: `demo-${prevYyyymm}-${i + 1}`, spec, load, unload: addDays(load, spec.days - 1), status: 'approved', revenue: spec.revenue,
      waybill: `EWB ${digits(seed, 4)} ${digits(seed + 100, 4)} ${digits(seed + 200, 4)}`, item: `ITM-${digits(seed + 300, 4)}`
    });
  });
  THIS_MONTH.forEach((p, i) => {
    const spec = TRIPS[p.spec]!;
    // never before the 1st: early in the month everything loads on the 1st
    const load = maxIso(monthStart, addDays(today, -p.ago));
    const unload = p.status === 'draft' ? null : minIso(today, addDays(load, spec.days - 1));
    const seed = Number(yyyymm) * 10 + i;
    trips.push({
      id: `demo-${yyyymm}-${i + 1}`, spec, load, unload, status: p.status, revenue: p.noRevenue ? 0 : spec.revenue,
      waybill: `EWB ${digits(seed, 4)} ${digits(seed + 100, 4)} ${digits(seed + 200, 4)}`, item: `ITM-${digits(seed + 300, 4)}`
    });
  });
  return { trips, yyyymm, prevYyyymm, monthStart, prevStart };
}

// The SQL that rebuilds the sample data for `today` (YYYY-MM-DD). Values are
// written into the statements directly (they all come from the constants above,
// never from a request), which keeps it to a handful of statements.
export function buildDemoStatements(today: string): string[] {
  const { trips, yyyymm, prevYyyymm, monthStart, prevStart } = plan(today);
  const out: string[] = [];

  // — remove what an earlier run (or the old hand-run script) added —
  out.push(`DELETE FROM notifications WHERE id LIKE 'demo-%' OR id IN ('n7','n8') OR related_trip_id LIKE 'demo-%' OR related_trip_id LIKE 'ot%'`);
  out.push(`DELETE FROM trip_documents WHERE trip_id LIKE 'demo-%' OR trip_id LIKE 'ot%'`);
  out.push(`DELETE FROM trip_stops WHERE trip_id LIKE 'demo-%' OR trip_id LIKE 'ot%'`);
  out.push(`DELETE FROM trip_expenses WHERE trip_id LIKE 'demo-%' OR trip_id LIKE 'ot%'`);
  out.push(`DELETE FROM trips WHERE id LIKE 'demo-%' OR id LIKE 'ot%'`);
  out.push(`DELETE FROM monthly_expense_documents WHERE monthly_expense_id LIKE 'demo-%' OR monthly_expense_id LIKE 'oe%'`);
  out.push(`DELETE FROM monthly_expenses WHERE id LIKE 'demo-%' OR id LIKE 'oe%'`);
  // the two September trips the base seed leaves waiting would look neglected
  out.push(`UPDATE trips SET status = 'approved' WHERE id IN ('t7','t8') AND status <> 'approved'`);

  // — movements, with one running odometer per truck —
  const odo = new Map<string, number>();
  [...new Set(TRIPS.map((t) => t.vehicle))].forEach((v, i) => odo.set(v, 98_000 + i * 13_500));
  const tripRows: string[] = [];
  const lineRows: string[] = [];
  const noteRows: string[] = [];
  for (const t of [...trips].sort((a, b) => a.load.localeCompare(b.load) || a.id.localeCompare(b.id))) {
    const start = odo.get(t.spec.vehicle)!;
    // a movement still on the road has covered part of its distance
    const km = t.status === 'draft' ? Math.round(t.spec.km * 0.4) : t.spec.km;
    odo.set(t.spec.vehicle, start + km + 12);
    const created = `${t.load}T09:00:00Z`;
    tripRows.push(
      `(${q(t.id)}, ${q(ORG)}, ${q(t.spec.vehicle)}, ${q(t.spec.driver)}, ${q(t.waybill)}, ${q(t.item)}, ${q(t.load)}, ${t.unload ? q(t.unload) : 'NULL'}, ` +
      `${q(t.spec.from)}, ${q(t.spec.to)}, ${Math.round(t.spec.tons * 1000)}, ${start}, ${start + km}, ${t.revenue}, ${q(t.status)}, ${q(OFFICE_USER)}, ${q(created)}, ${q(created)})`
    );
    const lines = t.status === 'draft' ? t.spec.lines.slice(0, 2) : t.spec.lines;
    lines.forEach(([kind, litres, rate, amount], k) => {
      const spentOn = k < 3 || !t.unload ? t.load : t.unload;
      lineRows.push(`(${q(`${t.id}-${k + 1}`)}, ${q(ORG)}, ${q(t.id)}, ${q(spentOn)}, ${q(kind)}, ${num(litres)}, ${num(rate)}, ${amount}, ${q(OFFICE_USER)}, ${q(`${spentOn}T09:00:00Z`)})`);
    });
    if (t.status === 'pending') {
      noteRows.push(`(${q(`demo-n-${t.id}`)}, ${q(ORG)}, 'approval', ${q(`${t.spec.driver} logged ${t.spec.vehicle} — pending approval`)}, 'triplog', ${q(t.id)}, 0, ${q(`${t.unload ?? t.load}T16:20:00Z`)})`);
    }
  }
  out.push(
    `INSERT INTO trips (id, org_id, vehicle_id, driver_id, waybill_no, item_no, load_date, unload_date, from_loc, to_loc, weight_kg, odo_start, odo_end, revenue_paise, status, created_by, created_at, updated_at) VALUES\n${tripRows.join(',\n')}`
  );
  out.push(`INSERT INTO trip_expenses (id, org_id, trip_id, spent_on, kind, litres, rate_paise, amount_paise, created_by, created_at) VALUES\n${lineRows.join(',\n')}`);
  if (noteRows.length) out.push(`INSERT INTO notifications (id, org_id, kind, message, tab, related_trip_id, read, created_at) VALUES\n${noteRows.join(',\n')}`);

  // — fixed costs for both months —
  const fixedRows: string[] = [];
  for (const [label, first] of [[prevYyyymm, prevStart], [yyyymm, monthStart]] as const) {
    FIXED.forEach((f, k) => {
      const date = minIso(today, addDays(first, f.day - 1));
      fixedRows.push(`(${q(`demo-${label}-fx${k + 1}`)}, ${q(ORG)}, ${q(f.vehicle)}, ${q(f.driver)}, ${q(date)}, ${q(f.category)}, ${f.amount}, ${q(f.remarks)}, ${q(OFFICE_USER)}, ${q(`${date}T09:00:00Z`)})`);
    });
  }
  out.push(`INSERT INTO monthly_expenses (id, org_id, vehicle_id, driver_id, spent_on, category, amount_paise, remarks, created_by, created_at) VALUES\n${fixedRows.join(',\n')}`);

  // — due dates relative to today —
  for (const v of VEHICLE_DUE) {
    const sets = Object.entries(v.set).map(([col, days]) => `${col} = ${q(addDays(today, days))}`).join(', ');
    out.push(`UPDATE vehicles SET ${sets} WHERE id = ${q(v.id)}`);
  }
  for (const [name, days] of Object.entries(DRIVER_LICENCE_DAYS)) {
    out.push(`UPDATE drivers SET licence_expiry = ${q(addDays(today, days))} WHERE id = ${q(name)}`);
  }
  return out;
}

export function isDemoMode(env: Pick<Env, 'DEMO_MODE'>): boolean {
  return env.DEMO_MODE === 'true';
}

export type DemoRefreshResult = { ran: false; reason: string } | { ran: true; today: string; statements: number; largeFleet: LargeFleetOptions['mode'] | null };

export async function refreshDemoData(env: Pick<Env, 'DB' | 'DEMO_MODE'>, now: Date = new Date()): Promise<DemoRefreshResult> {
  if (!isDemoMode(env)) return { ran: false, reason: 'DEMO_MODE is not on' };
  const org = await env.DB.prepare('SELECT name FROM orgs WHERE id = ?').bind(ORG).first<{ name: string }>();
  if (!org || org.name !== ORG_NAME) return { ran: false, reason: `organisation is not "${ORG_NAME}"` };
  const today = istToday(now);
  const statements = buildDemoStatements(today);
  // The large sample fleet, if someone has loaded it, rolls forward with the calendar:
  // the whole of it on the 1st, only this month's movements on other nights.
  const fleet = await env.DB.prepare(
    `SELECT (SELECT count(*) FROM vehicles WHERE org_id = ? AND custom_fields = ?) AS vehicles,
            (SELECT count(*) FROM drivers WHERE org_id = ? AND custom_fields = ?) AS drivers,
            (SELECT load_date FROM trips WHERE id = 'lf-0-0') AS first`
  ).bind(ORG, LARGE_FLEET_MARK, ORG, LARGE_FLEET_MARK).first<{ vehicles: number; drivers: number; first: string | null }>();
  const plan = fleet ? planLargeFleet(today, fleet) : null;
  if (plan) statements.push(...buildLargeFleetStatements(today, plan));
  // one batch = one transaction: either the whole refresh applies or none of it
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  return { ran: true, today, statements: statements.length, largeFleet: plan ? plan.mode : null };
}
