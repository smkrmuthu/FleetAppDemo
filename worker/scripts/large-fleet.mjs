#!/usr/bin/env node
// Prints the SQL for the large sample fleet (260 trucks, 250 drivers, this and last
// month's movements) so the screens can be tried at scale. The generator itself lives
// in src/lib/largeFleet.ts, which the nightly refresh also uses.
//
//   node scripts/large-fleet.mjs [--vehicles 260] [--drivers 250] [--today 2026-10-08] > large-fleet.sql
//   npx wrangler d1 execute fleet-ledger-demo-db --local -c wrangler.toml --file=large-fleet.sql
//
// Statements are separated by a line holding only "--;" for tools that run them one at a
// time. large-fleet-remove.sql takes everything away again. Needs Node 22.18 or newer
// (it reads the TypeScript file directly).
import { buildLargeFleetStatements } from '../src/lib/largeFleet.ts';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const today = args.today ?? new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const opts = { withFleet: true, mode: 'all' };
if (args.vehicles) opts.vehicles = Number(args.vehicles);
if (args.drivers) opts.drivers = Number(args.drivers);
console.log(`-- Large sample fleet as of ${today}`);
console.log(buildLargeFleetStatements(today, opts).join(';\n--;\n') + ';');
