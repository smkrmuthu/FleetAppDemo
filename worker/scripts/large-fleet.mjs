#!/usr/bin/env node
// Generates the SQL for a large sample fleet (default 260 trucks, 250 drivers and
// this month's and last month's movements) so the screens can be tried at scale.
//
//   node scripts/large-fleet.mjs [--vehicles 260] [--drivers 250] [--today 2026-10-08] > large-fleet.sql
//   npx wrangler d1 execute fleet-ledger-demo-db --local -c wrangler.toml --file=large-fleet.sql
//
// The SQL is short: the database itself builds the rows (recursive queries and a
// repeatable hash instead of random numbers), so the same arguments always give the
// same data. Statements are separated by a line holding only "--;" for tools that run
// them one at a time. Everything added is marked (trips, notifications, fixed costs and
// windows 'lf-*'; trucks and drivers with custom_fields {"sample":"large-fleet"}), and
// large-fleet-remove.sql takes it all away again.

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const N_VEH = Number(args.vehicles ?? 260);
const N_DRV = Math.min(Number(args.drivers ?? 250), N_VEH);
const TODAY = args.today ?? new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

const TOWNS = [
  ['Chennai', 13.08, 80.27, 'Yard'], ['Ennore', 13.21, 80.32, 'Yard'], ['Sriperumbudur', 12.97, 79.94, 'ICD'], ['Hosur', 12.74, 77.83, 'Warehouse'],
  ['Bengaluru', 12.97, 77.59, 'Hub'], ['Coimbatore', 11.0, 76.96, 'Factory'], ['Tirupur', 11.11, 77.34, 'Factory'], ['Erode', 11.34, 77.72, 'Warehouse'],
  ['Salem', 11.66, 78.15, 'Plant'], ['Trichy', 10.8, 78.69, 'Depot'], ['Madurai', 9.92, 78.12, 'Factory'], ['Tuticorin', 8.76, 78.13, 'Yard'],
  ['Cochin', 9.93, 76.27, 'Yard'], ['Krishnapatnam', 14.25, 80.12, 'Port Yard'], ['Nellore', 14.44, 79.99, 'Warehouse'], ['Vijayawada', 16.51, 80.65, 'Warehouse'],
  ['Hyderabad', 17.38, 78.48, 'Plant']
];
const NT = TOWNS.length;
const road = (a, b) => {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[2] - a[2]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return Math.max(40, Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 1.25));
};
const MATRIX = TOWNS.flatMap((a) => TOWNS.map((b) => road(a, b)));
const PLACES = TOWNS.map((t) => `${t[0]} ${t[3]}`);
const MODELS = ['Tata Signa 4825', 'Ashok Leyland 3520', 'BharatBenz 2823', 'Eicher Pro 6028', 'Tata Prima 4028', 'Ashok Leyland 2820', 'BharatBenz 3523', 'Eicher Pro 6035'];
const FIRST = ['Murugan', 'Rafiq', 'Prakash', 'Ilango', 'Selvam', 'Karthik', 'Anwar', 'Suresh', 'Ravi', 'Dinesh', 'Manoj', 'Bala', 'Saravanan', 'Joseph', 'Imran', 'Vignesh', 'Arun', 'Gopal', 'Naveen', 'Siva', 'Harish', 'Kumar', 'Jayakumar', 'Mani', 'Raja', 'Senthil', 'Thomas', 'Basheer', 'Lokesh', 'Venkat'];
const LAST = ['S', 'A', 'N', 'R', 'K', 'M', 'P', 'V', 'T', 'D', 'B', 'G', 'J', 'L', 'C'];
const CATS = ['Insurance', 'Permit / tax', 'Maintenance', 'Detention / halting charges'];
const j = (a) => `'${JSON.stringify(a).replace(/'/g, "''")}'`;
const ORG = `'org-meridian'`, OFFICE = `'user-kavitha'`, MARK = `'{"sample":"large-fleet"}'`;
const P = `'${TODAY}'`;

// A repeatable "random" fraction in [0,1) from two integers.
const R = (a, b) => `((((${a})*7919+(${b})*104729+17)*2654435761) % 4294967296 / 4294967296.0)`;
const RI = (lo, hi, a, b) => `(${lo}+CAST(${R(a, b)}*(${hi}-(${lo})+1) AS INT))`;
const seq = (name, n, col = 'i') => `${name}(${col}) AS (SELECT 0 UNION ALL SELECT ${col}+1 FROM ${name} WHERE ${col} < ${n - 1})`;

const reg = (i) => `printf('%s%02d %s%s %04d', json_extract('["TN","TN","TN","KA","KL","TN"]','$['||((${i})%6)||']'), json_extract('[38,41,58,51,7,70]','$['||((${i})%6)||']')+((${i})%3), char(65+((${i})*7)%26), char(65+((${i})*11+3)%26), 1000+((${i})*937)%9000)`;
const drvName = (k) => `(json_extract(${j(FIRST)},'$['||((${k})%30)||']')||' '||json_extract(${j(LAST)},'$['||(((${k})/30+4)%15)||']'))`;
const driverOf = (v) => `CASE WHEN (${v}) < ${N_DRV} THEN ${drvName(v)} ELSE ${drvName(`${RI(0, N_DRV - 1, v, 99)}`)} END`;

const out = [];

out.push(`WITH RECURSIVE ${seq('n', N_VEH)}
INSERT INTO vehicles (id, org_id, reg_no, model, fc_date, fc_renewal_due, active, custom_fields)
SELECT r, ${ORG}, r, json_extract(${j(MODELS)},'$['||((i*5)%8)||']'), fc, fc, 1, ${MARK}
FROM (SELECT i, ${reg('i')} AS r, date(${P}, (CASE WHEN i%9=0 THEN ${RI(-12, 25, 'i', 1)} ELSE ${RI(40, 400, 'i', 2)} END)||' days') AS fc FROM n)`);

out.push(`WITH RECURSIVE ${seq('n', N_DRV)}
INSERT INTO drivers (id, org_id, branch_id, full_name, phone, licence_no, licence_expiry, credential, default_vehicle, active, custom_fields)
SELECT ${drvName('i')}, ${ORG}, json_extract('["branch-chennai","branch-cochin","branch-hosur"]','$['||(i%3)||']'), ${drvName('i')},
  printf('+91 9%04d %05d', ${RI(4000, 9999, 'i', 3)}, ${RI(10000, 99999, 'i', 4)}),
  printf('%s%02d %d%07d', substr(${reg('i')},1,2), ${RI(10, 99, 'i', 5)}, 2008+(i%12), ${RI(1, 99999, 'i', 6)}),
  date(${P}, (CASE WHEN i%8=0 THEN ${RI(-5, 40, 'i', 7)} ELSE ${RI(120, 1400, 'i', 8)} END)||' days'),
  json_extract('["Yard pass · valid","Yard pass · valid","Hazmat endorsed","Yard pass · renew"]','$['||${RI(0, 3, 'i', 9)}||']'),
  ${reg('i')}, 1, ${MARK}
FROM n`);

// movements: slots 0-5 last month (approved), 6-8 this month, 10 = the truck's state today
const slotInfo = `
  base AS (
    SELECT v, g,
      CASE WHEN g <= 5 THEN date(${P},'start of month','-1 month', (v%4 + g*4)||' days')
           WHEN g <= 8 THEN date(${P},'start of month', (v%2 + (g-6)*3)||' days')
           WHEN g = 10 AND v%7=0 THEN date(${P}, '-'||(v%2)||' days')
           ELSE max(date(${P},'start of month'), date(${P},'-2 days')) END AS load,
      CASE WHEN g = 10 AND v%7=0 THEN 3 WHEN g = 10 THEN 1 ELSE 1+${RI(0, 2, 'v', 'g+10')} END AS span,
      CASE WHEN g <= 5 THEN 'approved'
           WHEN g <= 8 THEN CASE WHEN ${R('v', 'g')} < 0.05 THEN 'pending' ELSE 'approved' END
           WHEN v%7=0 THEN 'draft' ELSE 'pending' END AS status
    FROM vs, gs
    WHERE (g <= 5 AND g <= 2 + ((v*7)%4))
       OR (g BETWEEN 6 AND 8 AND (g-6) < 1 + ((v*5)%3) AND CAST(strftime('%d',${P}) AS INT) - 3 >= 1 + (v%2) + (g-6)*3)
       OR (g = 10 AND v%29 <> 3 AND (v%7=0 OR v%17=3))
  ),
  t AS (
    SELECT *, (v*3+g*5+v/7) % ${NT} AS a FROM base
  ),
  t2 AS (
    SELECT *, (a + 1 + (v+g*7)%${NT - 1}) % ${NT} AS b FROM t
  ),
  t3 AS (
    SELECT *, CAST(json_extract(${j(MATRIX)},'$['||(a*${NT}+b)||']') AS INT) AS dist,
      ${RI(14, 28, 'v', 'g+20')} AS tons FROM t2
  )`;
const vgs = `${seq('vs', N_VEH, 'v')}, gs(g) AS (SELECT 0 UNION ALL SELECT g+1 FROM gs WHERE g < 10)`;

out.push(`WITH RECURSIVE ${vgs}, ${slotInfo.trim()}
INSERT INTO trips (id, org_id, vehicle_id, driver_id, waybill_no, item_no, load_date, unload_date, from_loc, to_loc, weight_kg, odo_start, odo_end, revenue_paise, status, created_by, created_at, updated_at)
SELECT 'lf-'||v||'-'||g, ${ORG}, ${reg('v')}, ${driverOf('v')},
  printf('EWB %04d %04d %04d', ${RI(1000, 9999, 'v', 'g+30')}, ${RI(1000, 9999, 'v', 'g+31')}, ${RI(1000, 9999, 'v', 'g+32')}),
  printf('ITM-%04d', ${RI(1000, 9999, 'v', 'g+33')}),
  load,
  CASE WHEN status = 'draft' THEN NULL ELSE date(load, (max(1, min(span, (dist+419)/420)) - 1)||' days') END,
  json_extract(${j(PLACES)},'$['||a||']'), json_extract(${j(PLACES)},'$['||b||']'),
  tons*1000, 40000 + (v*977)%220000 + g*1500, 40000 + (v*977)%220000 + g*1500 + dist,
  CASE WHEN ${R('v', 'g+40')} < 0.02 THEN 0 ELSE CAST(dist * ${RI(52, 82, 'v', 'g+41')} * tons / 22.0 AS INT) * 100 END,
  status, ${OFFICE}, load||'T09:00:00Z', load||'T09:00:00Z'
FROM t3`);

// fuel, toll, AdBlue and other lines for each movement
const lineCtes = `ls(l) AS (SELECT 0 UNION ALL SELECT l+1 FROM ls WHERE l < 7),
  x AS (
    SELECT tr.id, tr.load_date, coalesce(tr.unload_date, tr.load_date) AS last_day,
      CAST(julianday(coalesce(tr.unload_date, tr.load_date)) - julianday(tr.load_date) AS INT) + 1 AS days,
      tr.odo_end - tr.odo_start AS dist,
      CAST(substr(tr.id, 4, instr(substr(tr.id,4),'-')-1) AS INT) AS v,
      CAST(substr(substr(tr.id,4), instr(substr(tr.id,4),'-')+1) AS INT) AS g
    FROM trips tr WHERE tr.id LIKE 'lf-%'
  ),
  y AS (
    SELECT *, CAST(dist / (CASE WHEN v%11=4 THEN 2.4+(v*13%30)/100.0 ELSE 2.9+(v*37%60)/100.0 END) + 0.5 AS INT) AS litres FROM x
  ),
  z AS (
    SELECT *, (days > 1 AND litres > 160) AS split,
      1 + CAST(${R('v', 'g+50')} * min(4, 1 + dist/250) AS INT) AS tolls,
      ${R('v', 'g+51')} < 0.5 AS has_adblue, ${R('v', 'g+52')} < 0.45 AS has_other FROM y
  ),
  w AS (
    SELECT z.id, ls.l,
      CASE WHEN ls.l IN (1, 7) THEN z.last_day WHEN ls.l BETWEEN 2 AND 5 THEN date(z.load_date, min(z.days-1, ls.l-2)||' days') ELSE z.load_date END AS d,
      CASE WHEN ls.l <= 1 THEN 'diesel' WHEN ls.l <= 5 THEN 'toll' WHEN ls.l = 6 THEN 'adblue' ELSE 'other' END AS kind,
      CASE WHEN ls.l = 0 THEN CASE WHEN z.split THEN (z.litres+1)/2 ELSE z.litres END
           WHEN ls.l = 1 THEN z.litres - (z.litres+1)/2
           WHEN ls.l = 6 THEN ${RI(6, 14, 'z.v', 'z.g+53')} END AS lit,
      CASE WHEN ls.l <= 1 THEN ${RI(9300, 9800, 'z.v*8+ls.l', 'z.g+54')} WHEN ls.l = 6 THEN 7500 END AS rate,
      CASE WHEN ls.l BETWEEN 2 AND 5 THEN ${RI(6, 24, 'z.v*8+ls.l', 'z.g+55')} * 10000 WHEN ls.l = 7 THEN ${RI(3, 15, 'z.v*8+ls.l', 'z.g+56')} * 10000 END AS flat
    FROM z, ls
    WHERE ls.l = 0 OR (ls.l = 1 AND z.split) OR (ls.l BETWEEN 2 AND 5 AND ls.l - 2 < z.tolls)
       OR (ls.l = 6 AND z.has_adblue) OR (ls.l = 7 AND z.has_other)
  )`;
out.push(`WITH RECURSIVE ${lineCtes}
INSERT INTO trip_expenses (id, org_id, trip_id, spent_on, kind, litres, rate_paise, amount_paise, created_by, created_at)
SELECT id||'x'||l, ${ORG}, id, d, kind, lit, rate, coalesce(lit*rate, flat), ${OFFICE}, d||'T09:00:00Z' FROM w`);

out.push(`INSERT INTO notifications (id, org_id, kind, message, tab, related_trip_id, read, created_at)
SELECT 'lf-n-'||substr(id,4), ${ORG}, 'approval', driver_id||' logged '||vehicle_id||' — pending approval', 'triplog', id, 0, coalesce(unload_date, load_date)||'T12:00:00Z'
FROM trips WHERE id LIKE 'lf-%' AND status = 'pending'`);

// fixed (monthly) costs: the loan or lease plus one other, for each truck, each month so far
out.push(`WITH RECURSIVE ${seq('vs', N_VEH, 'v')}, ms(m) AS (SELECT 0 UNION ALL SELECT 1), ps(p) AS (SELECT 0 UNION ALL SELECT 1),
  f AS (
    SELECT v, m, p, date(${P},'start of month', (CASE WHEN m = 0 THEN '-1 month' ELSE '+0 month' END), ((v*5+p*3)%7)||' days') AS d,
      CASE WHEN p = 0 THEN 'Loan / lease' ELSE json_extract(${j(CATS)},'$['||((v*3+m*5)%4)||']') END AS cat
    FROM vs, ms, ps
  )
INSERT INTO monthly_expenses (id, org_id, vehicle_id, driver_id, spent_on, category, amount_paise, remarks, created_by, created_at)
SELECT 'lf-fx'||v||'-'||m||'-'||p, ${ORG}, ${reg('v')}, CASE WHEN v < ${N_DRV} THEN ${drvName('v')} END, d, cat,
  CASE cat WHEN 'Loan / lease' THEN ${RI(420, 620, 'v', 'm*2+p+60')} WHEN 'Insurance' THEN ${RI(90, 220, 'v', 'm*2+p+61')}
           WHEN 'Permit / tax' THEN ${RI(80, 150, 'v', 'm*2+p+62')} WHEN 'Maintenance' THEN ${RI(25, 140, 'v', 'm*2+p+63')}
           ELSE ${RI(60, 240, 'v', 'm*2+p+64')} END * 10000,
  NULL, ${OFFICE}, d||'T09:00:00Z'
FROM f WHERE d <= ${P}`);

// a few trucks in the workshop
out.push(`WITH RECURSIVE ${seq('vs', N_VEH, 'v')}
INSERT INTO vehicle_unavailability (id, org_id, vehicle_id, starts_at, ends_at, remarks, created_by)
SELECT 'lf-un'||v, ${ORG}, ${reg('v')}, date(${P},'-1 days')||'T09:00', date(${P}, (2 + v%5)||' days')||'T18:00', 'Workshop', ${OFFICE}
FROM vs WHERE v%29 = 3`);

console.log(`-- Large sample fleet: ${N_VEH} trucks, ${N_DRV} drivers (as of ${TODAY})`);
console.log(out.join(';\n--;\n') + ';');
