#!/usr/bin/env node
// Generates SQL for a large sample fleet (default 120 trucks, 110 drivers and
// about two months of movements) so the screens can be tried at scale.
//
//   node scripts/large-fleet.mjs [--vehicles 120] [--drivers 110] [--today 2026-10-08] > large-fleet.sql
//   npx wrangler d1 execute fleet-ledger-demo-db --local -c wrangler.toml --file=large-fleet.sql
//
// Everything it adds is marked (trips and notifications 'lf-*', trucks and
// drivers with custom_fields {"sample":"large-fleet"}), so large-fleet-remove.sql
// takes it all away again. Output is repeatable: the same arguments give the same SQL.

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const N_VEH = Number(args.vehicles ?? 120);
const N_DRV = Math.min(Number(args.drivers ?? 110), N_VEH + 20);
const today = args.today ?? new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

const ORG = 'org-meridian';
const OFFICE = 'user-kavitha';
const MARK = `'{"sample":"large-fleet"}'`;
const BRANCHES = ['branch-chennai', 'branch-cochin', 'branch-hosur'];

let s = 20261008;
const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const pad = (n, w = 2) => String(n).padStart(w, '0');

const addDays = (iso, d) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

const TOWNS = [
  ['Chennai', 13.08, 80.27, 'Yard'], ['Ennore', 13.21, 80.32, 'Yard'], ['Sriperumbudur', 12.97, 79.94, 'ICD'], ['Hosur', 12.74, 77.83, 'Warehouse'],
  ['Bengaluru', 12.97, 77.59, 'Hub'], ['Coimbatore', 11.0, 76.96, 'Factory'], ['Tirupur', 11.11, 77.34, 'Factory'], ['Erode', 11.34, 77.72, 'Warehouse'],
  ['Salem', 11.66, 78.15, 'Plant'], ['Trichy', 10.8, 78.69, 'Depot'], ['Madurai', 9.92, 78.12, 'Factory'], ['Tuticorin', 8.76, 78.13, 'Yard'],
  ['Cochin', 9.93, 76.27, 'Yard'], ['Krishnapatnam', 14.25, 80.12, 'Port Yard'], ['Nellore', 14.44, 79.99, 'Warehouse'], ['Vijayawada', 16.51, 80.65, 'Warehouse'],
  ['Hyderabad', 17.38, 78.48, 'Plant']
];
const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[2] - a[2]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 1.25);
};
const place = (t) => `${t[0]} ${t[3]}`;

const MODELS = ['Tata Signa 4825', 'Ashok Leyland 3520', 'BharatBenz 2823', 'Eicher Pro 6028', 'Tata Prima 4028', 'Ashok Leyland 2820', 'BharatBenz 3523', 'Eicher Pro 6035'];
const FIRST = ['Murugan', 'Rafiq', 'Prakash', 'Ilango', 'Selvam', 'Karthik', 'Anwar', 'Suresh', 'Ravi', 'Dinesh', 'Manoj', 'Bala', 'Saravanan', 'Joseph', 'Imran', 'Vignesh', 'Arun', 'Gopal', 'Naveen', 'Siva', 'Harish', 'Kumar', 'Jayakumar', 'Mani', 'Raja', 'Senthil', 'Thomas', 'Basheer', 'Lokesh', 'Venkat'];
const LAST = ['S', 'A', 'N', 'R', 'K', 'M', 'P', 'V', 'T', 'D', 'B', 'G', 'J', 'L', 'C'];
const STATES = [['TN', 'Chennai', 38], ['TN', 'Coimbatore', 41], ['TN', 'Madurai', 58], ['KA', 'Bengaluru', 51], ['KL', 'Cochin', 7], ['TN', 'Hosur', 70]];
const CATS = [['Loan / lease', 4200000, 6200000], ['Insurance', 900000, 2200000], ['Permit / tax', 800000, 1500000], ['Maintenance', 250000, 1400000], ['Detention / halting charges', 600000, 2400000]];
const ITEMS = ['Auto parts', 'FMCG cartons', 'Steel coils', 'Textiles', 'Cement bags', 'Machinery', 'Packaged food', 'Containers'];

const stmts = [];
const batch = (table, cols, rows) => { for (let i = 0; i < rows.length; i += 50) stmts.push(`INSERT INTO ${table} (${cols}) VALUES\n${rows.slice(i, i + 50).join(',\n')};`); };

// ── trucks and drivers ───────────────────────────────────────────────────
const vehicles = [];
for (let i = 0; i < N_VEH; i++) {
  const [st, , rto] = STATES[i % STATES.length];
  const reg = `${st}${pad(rto + (i % 3))} ${String.fromCharCode(65 + (i * 7) % 26)}${String.fromCharCode(65 + (i * 11 + 3) % 26)} ${1000 + ((i * 937) % 9000)}`;
  const fcOffset = i % 9 === 0 ? int(-12, 25) : int(40, 400); // a few due soon or lapsed
  vehicles.push({ id: reg, model: pick(MODELS), fc: addDays(today, fcOffset), odo: int(40000, 260000), driver: null });
}
const drivers = [];
const usedNames = new Set(['Murugan S', 'Rafiq A', 'Prakash N', 'Ilango R']);
for (let i = 0; i < N_DRV; i++) {
  let name; do { name = `${pick(FIRST)} ${pick(LAST)}`; } while (usedNames.has(name) && (name = `${name}.${pad(i)}`) && usedNames.has(name));
  usedNames.add(name);
  const lic = i % 8 === 0 ? int(-5, 40) : int(120, 1400);
  const d = { id: name, branch: BRANCHES[i % 3], phone: `+91 9${int(4000, 9999)} ${int(10000, 99999)}`, lic: `${vehicles[i % N_VEH].id.slice(0, 2)}${int(10, 99)} ${2008 + (i % 12)}${pad(int(1, 99999), 7)}`, exp: addDays(today, lic), vehicle: vehicles[i] ? vehicles[i].id : null };
  if (vehicles[i]) vehicles[i].driver = name;
  drivers.push(d);
}

batch('vehicles', 'id, org_id, reg_no, model, fc_date, fc_renewal_due, active, custom_fields',
  vehicles.map((v) => `(${q(v.id)}, ${q(ORG)}, ${q(v.id)}, ${q(v.model)}, ${q(v.fc)}, ${q(v.fc)}, 1, ${MARK})`));
batch('drivers', 'id, org_id, branch_id, full_name, phone, licence_no, licence_expiry, credential, default_vehicle, active, custom_fields',
  drivers.map((d) => `(${q(d.id)}, ${q(ORG)}, ${q(d.branch)}, ${q(d.id)}, ${q(d.phone)}, ${q(d.lic)}, ${q(d.exp)}, ${q(pick(['Yard pass · valid', 'Yard pass · valid', 'Hazmat endorsed', 'Yard pass · renew']))}, ${q(d.vehicle)}, 1, ${MARK})`));

// ── movements: previous month and this month so far ──────────────────────
const monthStart = today.slice(0, 8) + '01';
const prevStart = (() => { const d = new Date(monthStart + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
const prevDays = Math.round((new Date(monthStart) - new Date(prevStart)) / 86400e3);
const todayDay = Number(today.slice(8));

const trips = [], expenses = [], stops = [], notes = [];
let tn = 0, xn = 0;
const offroad = new Set(); // trucks given a maintenance window below
for (let i = 0; i < N_VEH; i += 29) offroad.add(vehicles[i + 3]?.id);

function addTrip(v, load, span, status, odoStart) {
  const a = pick(TOWNS); let b = pick(TOWNS); while (b === a) b = pick(TOWNS);
  const dist = Math.max(40, km(a, b)); const days = Math.max(1, Math.min(span, Math.ceil(dist / 420)));
  const unload = status === 'draft' ? null : addDays(load, days - 1);
  const tons = int(14, 28); const id = `lf-${pad(++tn, 5)}`;
  const revenue = rnd() < 0.02 ? 0 : Math.round(dist * int(52, 82) * (tons / 22)) * 100;
  const driver = v.driver ?? pick(drivers).id;
  const createdBy = status === 'pending' ? OFFICE : OFFICE;
  trips.push(`(${q(id)}, ${q(ORG)}, ${q(v.id)}, ${q(driver)}, ${q(`EWB ${int(1000, 9999)} ${int(1000, 9999)} ${int(1000, 9999)}`)}, ${q(`ITM-${int(1000, 9999)}`)}, ${q(load)}, ${unload ? q(unload) : 'NULL'}, ${q(place(a))}, ${q(place(b))}, ${tons * 1000}, ${odoStart}, ${odoStart + dist}, ${revenue}, ${q(status)}, ${q(createdBy)}, ${q(load + 'T09:00:00Z')}, ${q(load + 'T09:00:00Z')})`);
  const lastDay = unload ?? load;
  const lines = [];
  const litres = Math.round(dist / 3.1);
  if (days > 1 && litres > 160) { lines.push(['diesel', load, Math.round(litres / 2)], ['diesel', lastDay, litres - Math.round(litres / 2)]); } else lines.push(['diesel', load, litres]);
  const tolls = int(1, Math.min(4, 1 + Math.floor(dist / 250)));
  for (let k = 0; k < tolls; k++) lines.push(['toll', addDays(load, Math.min(days - 1, k)), null]);
  if (rnd() < 0.5) lines.push(['adblue', load, int(6, 14)]);
  if (rnd() < 0.45) lines.push(['other', lastDay, null]);
  for (const [kind, date, lit] of lines) {
    const rate = kind === 'diesel' ? int(9300, 9800) : kind === 'adblue' ? 7500 : null;
    const amount = kind === 'diesel' || kind === 'adblue' ? lit * rate : kind === 'toll' ? int(6, 24) * 10000 : int(3, 15) * 10000;
    expenses.push(`(${q(`${id}x${++xn}`)}, ${q(ORG)}, ${q(id)}, ${q(date)}, ${q(kind)}, ${lit == null ? 'NULL' : lit}, ${rate == null ? 'NULL' : rate}, ${amount}, ${q(OFFICE)}, ${q(date + 'T09:00:00Z')})`);
  }
  if (rnd() < 0.18) stops.push(`(${q(`${id}s1`)}, ${q(ORG)}, ${q(id)}, 1, ${q(place(pick(TOWNS)))}, NULL)`);
  if (status === 'pending') notes.push(`(${q(`lf-n-${pad(notes.length + 1, 4)}`)}, ${q(ORG)}, 'approval', ${q(`${driver} logged ${v.id} — pending approval`)}, 'triplog', ${q(id)}, 0, ${q(unload + 'T12:00:00Z')})`);
  return dist;
}

for (const v of vehicles) {
  let odo = v.odo;
  // last month: 3–6 completed trips back to back, all approved
  let day = int(1, 4);
  for (let k = 0, n = int(3, 6); k < n && day < prevDays - 1; k++) {
    const load = addDays(prevStart, day - 1); const dist = addTrip(v, load, int(1, 3), 'approved', odo);
    odo += dist + 1; day += Math.max(2, Math.ceil(dist / 420) + int(1, 3));
  }
  // this month: completed trips, plus the state each truck is in today
  day = int(1, 3); const ends = todayDay;
  const mood = rnd();
  const tail = mood < 0.14 ? 'draft' : mood < 0.24 ? 'pending' : 'approved';
  for (let k = 0, n = int(1, 3); k < n && day <= ends - 3; k++) {
    const load = addDays(monthStart, day - 1); const dist = addTrip(v, load, int(1, 2), rnd() < 0.15 ? 'pending' : 'approved', odo);
    odo += dist + 1; day += Math.max(2, Math.ceil(dist / 420) + int(1, 2));
  }
  if (tail === 'draft' && !offroad.has(v.id)) addTrip(v, addDays(today, -int(0, 1)), 3, 'draft', odo);
  else if (tail === 'pending' && day <= ends - 1) addTrip(v, addDays(monthStart, Math.max(0, day - 1)), 1, 'pending', odo);
}
batch('trips', 'id, org_id, vehicle_id, driver_id, waybill_no, item_no, load_date, unload_date, from_loc, to_loc, weight_kg, odo_start, odo_end, revenue_paise, status, created_by, created_at, updated_at', trips);
batch('trip_expenses', 'id, org_id, trip_id, spent_on, kind, litres, rate_paise, amount_paise, created_by, created_at', expenses);
if (stops.length) batch('trip_stops', 'id, org_id, trip_id, seq, location, note', stops);
if (notes.length) batch('notifications', 'id, org_id, kind, message, tab, related_trip_id, read, created_at', notes);

// ── monthly (fixed) costs, a few per truck for both months ───────────────
const fixed = []; let fn = 0;
for (const v of vehicles) for (const start of [prevStart, monthStart]) {
  const picks = [CATS[0], CATS[int(1, 4)]];
  for (const [cat, lo, hi] of picks) {
    const date = addDays(start, int(0, 6)); if (date > today) continue;
    fixed.push(`(${q(`lf-fx${pad(++fn, 5)}`)}, ${q(ORG)}, ${q(v.id)}, ${q(v.driver)}, ${q(date)}, ${q(cat)}, ${Math.round(int(lo, hi) / 100) * 100}, NULL, ${q(OFFICE)}, ${q(date + 'T09:00:00Z')})`);
  }
}
batch('monthly_expenses', 'id, org_id, vehicle_id, driver_id, spent_on, category, amount_paise, remarks, created_by, created_at', fixed);

// ── a few trucks off the road for maintenance ────────────────────────────
const windows = [...offroad].filter(Boolean).map((id, k) => `(${q(`lf-un${k + 1}`)}, ${q(ORG)}, ${q(id)}, ${q(addDays(today, -1) + 'T09:00')}, ${q(addDays(today, 2 + k) + 'T18:00')}, 'Workshop', ${q(OFFICE)})`);
if (windows.length) batch('vehicle_unavailability', 'id, org_id, vehicle_id, starts_at, ends_at, remarks, created_by', windows);

console.log(`-- Large sample fleet: ${vehicles.length} trucks, ${drivers.length} drivers, ${trips.length} movements, ${expenses.length} expense lines (as of ${today})`);
console.log(stmts.join('\n\n'));
