import type { DriverMaster, MasterSettings, MonthlyExpense, Trip, UserAccount, Vehicle } from '../types';
import type { VehicleAgg } from '../utils/aggregate';
import { tripCost, vehicleAge } from '../utils/calc';
import { parseDisplayDate } from './api';
import {
  pdfText, dateCell, dec, int, label, money, note, percent, rs, safeName, saveWorkbook, savePdf, th, title,
  type SheetCell, type SheetSpec
} from './exporter';

// Matches the name shown in the app header (org-name wiring is still to do).
const COMPANY = 'Demo Logistics';

const STATUS_LABEL: Record<string, string> = { approved: 'Approved', draft: 'Draft', pending: 'Pending' };

export interface Period {
  from: string; // ISO date
  to: string;
  label: string; // "01 Sep 2026 – 30 Sep 2026"
}

const fileStem = (base: string, p: Period) => safeName(`${base}_${p.from || 'start'}_to_${p.to || 'end'}`);

// ── shared sheets ───────────────────────────────────────────────────────────

export function tripsSheet(trips: Trip[], financials: boolean, name = 'Trips'): SheetSpec {
  const head = [
    'Trip no.', 'Loading date', 'Unloading date', 'Item no.', 'Vehicle', 'Driver', 'Loading point', 'Loading point note',
    'Stops (place, odometer)', 'Final unloading point', 'Final unloading note', 'Transporter', 'Tons', 'Odometer start', 'Odometer end', 'KM',
    'Diesel', 'AdBlue', 'Toll', 'Other', 'Trip expense',
    ...(financials ? ['Revenue', 'Profit'] : []),
    'Status', 'Remarks'
  ];
  const right = new Set(['Tons', 'Odometer start', 'Odometer end', 'KM', 'Diesel', 'AdBlue', 'Toll', 'Other', 'Trip expense', 'Revenue', 'Profit']);
  const dash = (v: string) => (v === '—' ? '' : v);
  const rows: SheetCell[][] = [head.map((h) => th(h, right.has(h)))];
  for (const t of trips) {
    const c = tripCost(t);
    rows.push([
      dash(t.waybillNo), dateCell(parseDisplayDate(t.loadDate)), dateCell(parseDisplayDate(t.unloadDate)), dash(t.itemNo), t.vehicle, dash(t.driver),
      dash(t.from), t.fromNote ?? '',
      t.stops.map((s) => `${s.location}${s.odo ? ` (${s.odo} km)` : ''}`).join('; '),
      dash(t.to), t.toNote ?? '', t.transporter ?? '',
      dec(t.tons), t.odoStart ?? null, t.odoEnd ?? null, int(t.km),
      money(c.diesel), money(c.adblue), money(c.toll), money(c.other), money(c.expense),
      ...(financials ? [money(t.revenue), money(c.profit)] : []),
      STATUS_LABEL[t.status] ?? t.status, t.remarks ?? ''
    ]);
  }
  const widths = [26, 13, 13, 12, 13, 16, 22, 22, 36, 24, 22, 20, 8, 12, 12, 8, 12, 10, 10, 10, 13, ...(financials ? [13, 13] : []), 11, 28];
  return { name, rows, widths, freezeRows: 1 };
}

export function routeSheet(trips: Trip[]): SheetSpec {
  const rows: SheetCell[][] = [[th('Trip no.'), th('Vehicle'), th('Point'), th('Place'), th('Odometer (km)', true), th('Note')]];
  const dash = (v: string) => (v === '—' ? '' : v);
  for (const t of trips) {
    rows.push([dash(t.waybillNo), t.vehicle, 'A - Loading point', dash(t.from), t.odoStart ?? null, t.fromNote ?? '']);
    t.stops.forEach((s, i) => rows.push([dash(t.waybillNo), t.vehicle, `Stop ${i + 1}`, s.location, s.odo ?? null, s.note ?? '']));
    rows.push([dash(t.waybillNo), t.vehicle, 'B - Final unloading', dash(t.to), t.odoEnd ?? null, t.toNote ?? '']);
  }
  return { name: 'Route and odometers', rows, widths: [26, 13, 20, 30, 14, 30], freezeRows: 1 };
}

export function expenseLinesSheet(trips: Trip[]): SheetSpec {
  const kindLabel: Record<string, string> = { diesel: 'Diesel', adblue: 'AdBlue', toll: 'Toll', other: 'Other' };
  const rows: SheetCell[][] = [[th('Trip no.'), th('Vehicle'), th('Date'), th('Kind'), th('Litres', true), th('Rate / litre', true), th('Amount', true), th('Details')]];
  for (const t of trips) {
    for (const l of t.expenses) {
      rows.push([
        t.waybillNo === '—' ? '' : t.waybillNo, t.vehicle, dateCell(parseDisplayDate(l.date) || l.date), kindLabel[l.kind] ?? l.kind,
        l.litres != null ? dec(l.litres, 2) : null, l.ratePerLitre != null ? money(l.ratePerLitre) : null, money(l.amount), l.details ?? ''
      ]);
    }
  }
  return { name: 'Fuel and expense entries', rows, widths: [26, 13, 13, 10, 10, 12, 13, 30], freezeRows: 1 };
}

export function monthlyExpensesSheet(expenses: MonthlyExpense[]): SheetSpec {
  const dash = (v: string) => (v === '—' ? '' : v);
  const rows: SheetCell[][] = [[th('Date'), th('Vehicle'), th('Driver'), th('Description'), th('Remarks'), th('Amount', true)]];
  for (const e of expenses) rows.push([dateCell(parseDisplayDate(e.date)), e.vehicle, dash(e.driver), e.category, dash(e.remarks), money(e.amount)]);
  return { name: 'Fixed costs', rows, widths: [13, 13, 16, 20, 30, 13], freezeRows: 1 };
}

// A "Filters" style block at the top of a summary sheet
function headerRows(heading: string, p: Period, extra: string[] = []): SheetCell[][] {
  return [[title(`${COMPANY} - ${heading}`)], [note(`Period: ${p.label}`)], ...extra.map((e) => [note(e)]), []];
}

// ── Trip Log ────────────────────────────────────────────────────────────────

export async function exportTripLog(trips: Trip[], financials: boolean, p: Period, filterNote: string): Promise<void> {
  const info: SheetSpec = {
    name: 'About',
    rows: [...headerRows('Trip Log', p, [filterNote, `${trips.length} movements`])],
    widths: [70]
  };
  await saveWorkbook(`${fileStem('trip-log', p)}.xlsx`, [
    tripsSheet(trips, financials), routeSheet(trips), expenseLinesSheet(trips), info
  ]);
}

// ── Movement Summary ────────────────────────────────────────────────────────

export interface Stat {
  label: string;
  value: string; // as shown on screen
  raw: number;
  fmt: 'int' | 'dec' | 'money';
  note: string;
}

const statCell = (s: Stat): SheetCell => (s.fmt === 'money' ? money(s.raw) : s.fmt === 'dec' ? dec(s.raw) : int(s.raw));

export interface SummaryData {
  period: Period;
  filterNote: string;
  stats: Stat[];
  byVehicle: VehicleAgg[];
  trips: Trip[];
  expenses: MonthlyExpense[];
}

export async function exportSummaryExcel(d: SummaryData): Promise<void> {
  const totals: SheetSpec = {
    name: 'Summary',
    rows: [
      ...headerRows('Movement Summary', d.period, [d.filterNote]),
      [th('Measure'), th('Value', true), th('Note')],
      ...d.stats.map((s) => [label(s.label), statCell(s), s.note])
    ],
    widths: [24, 18, 30]
  };
  const perVehicle: SheetSpec = {
    name: 'Vehicle-wise',
    rows: [
      ['Vehicle', 'Model', 'Trips', 'KM', 'Tons', 'Trip expense', 'Monthly expense', 'Revenue', 'Profit', 'Rs / km'].map((h, i) => th(h, i >= 2)),
      ...d.byVehicle.map((b) => [b.id, b.model === '—' ? '' : b.model, int(b.trips), int(b.km), dec(b.tons), money(b.ledgerTripExpense), money(b.ledgerMonthly), money(b.revenue), money(b.profit), b.km ? money(b.cost / b.km) : null] as SheetCell[])
    ],
    widths: [14, 18, 8, 10, 10, 14, 16, 14, 14, 10],
    freezeRows: 1
  };
  await saveWorkbook(`${fileStem('movement-summary', d.period)}.xlsx`, [
    totals, perVehicle, tripsSheet(d.trips, true), routeSheet(d.trips), expenseLinesSheet(d.trips), monthlyExpensesSheet(d.expenses)
  ]);
}

export async function exportSummaryPdf(d: SummaryData): Promise<void> {
  const tiles: string[][] = [];
  for (let i = 0; i < d.stats.length; i += 3) {
    const row: string[] = [];
    for (const s of d.stats.slice(i, i + 3)) row.push(pdfText(s.label), pdfText(s.value));
    tiles.push(row);
  }
  await savePdf(`${fileStem('movement-summary', d.period)}.pdf`, {
    title: 'Movement Summary',
    company: COMPANY,
    lines: [`Period: ${d.period.label}`, d.filterNote],
    tables: [
      { heading: 'Totals', head: ['Measure', 'Value', 'Measure', 'Value', 'Measure', 'Value'], body: tiles, right: [1, 3, 5], compact: true },
      {
        heading: 'Vehicle-wise',
        head: ['Vehicle', 'Model', 'Trips', 'KM', 'Tons', 'Trip expense', 'Monthly expense', 'Revenue', 'Profit', 'Rs / km'],
        body: d.byVehicle.map((b) => [
          b.id, b.model === '—' ? '' : b.model, String(b.trips), b.km.toLocaleString('en-IN'), b.tons.toFixed(1),
          rs(b.ledgerTripExpense), rs(b.ledgerMonthly), rs(b.revenue), rs(b.profit), b.km ? rs(b.cost / b.km) : '-'
        ]),
        right: [2, 3, 4, 5, 6, 7, 8, 9]
      }
    ]
  });
}

// ── Monthly Report ──────────────────────────────────────────────────────────

export interface ReportData {
  period: Period;
  headline: Stat[];
  byVehicle: VehicleAgg[];
  trips: Trip[];
  expenses: MonthlyExpense[];
}

export async function exportReportExcel(d: ReportData): Promise<void> {
  const headline: SheetSpec = {
    name: 'Headline',
    rows: [
      ...headerRows('Monthly Report', d.period),
      [th('Measure'), th('Value', true), th('Note')],
      ...d.headline.map((s) => [label(s.label), statCell(s), s.note])
    ],
    widths: [24, 18, 30]
  };
  const ledger: SheetSpec = {
    name: 'Vehicle ledger',
    rows: [
      ['Vehicle', 'Trips', 'KM', 'Tons', 'Diesel', 'Toll', 'Other', 'Monthly', 'Total cost', 'Revenue', 'Profit', 'Margin', 'Cost per km'].map((h, i) => th(h, i >= 1)),
      ...d.byVehicle.map((b) => [
        b.id, int(b.trips), int(b.km), dec(b.tons), money(b.diesel), money(b.ledgerToll), money(b.other), money(b.ledgerMonthly), money(b.cost),
        money(b.revenue), money(b.profit), b.revenue ? percent(b.profit / b.revenue) : null, b.km ? money(b.cost / b.km) : null
      ] as SheetCell[])
    ],
    widths: [14, 8, 10, 10, 13, 12, 12, 13, 14, 14, 14, 9, 13],
    freezeRows: 1
  };
  await saveWorkbook(`${fileStem('monthly-report', d.period)}.xlsx`, [
    headline, ledger, tripsSheet(d.trips, true), routeSheet(d.trips), expenseLinesSheet(d.trips), monthlyExpensesSheet(d.expenses)
  ]);
}

export async function exportReportPdf(d: ReportData): Promise<void> {
  await savePdf(`${fileStem('monthly-report', d.period)}.pdf`, {
    title: 'Monthly Report',
    company: COMPANY,
    lines: [`Period: ${d.period.label}`],
    tables: [
      {
        heading: 'Headline',
        head: ['Measure', 'Value', 'Note'],
        body: d.headline.map((s) => [pdfText(s.label), pdfText(s.value), s.note]),
        right: [1],
        compact: true
      },
      {
        heading: 'Cost per kilometre, by vehicle',
        head: ['Vehicle', 'KM', 'Total cost', 'Cost per km'],
        body: d.byVehicle.map((b) => [b.id, b.km.toLocaleString('en-IN'), rs(b.cost), b.km ? rs(b.cost / b.km) : '-']),
        right: [1, 2, 3]
      },
      {
        heading: 'Vehicle-wise ledger',
        head: ['Vehicle', 'Trips', 'KM', 'Tons', 'Diesel', 'Toll', 'Other', 'Monthly', 'Total cost', 'Revenue', 'Profit', 'Margin'],
        body: d.byVehicle.map((b) => [
          b.id, String(b.trips), b.km.toLocaleString('en-IN'), b.tons.toFixed(1), rs(b.diesel), rs(b.ledgerToll), rs(b.other), rs(b.ledgerMonthly),
          rs(b.cost), rs(b.revenue), rs(b.profit), b.revenue ? `${Math.round((b.profit / b.revenue) * 100)}%` : '-'
        ]),
        right: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      }
    ]
  });
}

// ── Full backup ─────────────────────────────────────────────────────────────

// ── Fuel Expenses ───────────────────────────────────────────────────────────

export interface FuelRow {
  date: string; // display date ("02 Oct 2026")
  vehicle: string;
  tripNo: string;
  litres: number | null;
  rate: number | null;
  amount: number;
  remarks: string;
}

const fuelStem = () => safeName(`fuel-expenses_${new Date().toISOString().slice(0, 10)}`);
const fuelTotals = (rows: FuelRow[]) => ({ litres: rows.reduce((a, r) => a + (r.litres ?? 0), 0), amount: rows.reduce((a, r) => a + r.amount, 0) });

export async function exportFuelExcel(rows: FuelRow[]): Promise<void> {
  const t = fuelTotals(rows);
  const sheet: SheetSpec = {
    name: 'Fuel expenses',
    rows: [
      [th('Date'), th('Vehicle'), th('Trip no.'), th('Litres', true), th('Rate / litre', true), th('Amount', true), th('Remarks')],
      ...rows.map((r) => [
        dateCell(parseDisplayDate(r.date) || r.date), r.vehicle, r.tripNo === '—' ? '' : r.tripNo,
        r.litres != null ? dec(r.litres, 2) : null, r.rate != null ? money(r.rate) : null, money(r.amount), r.remarks
      ] as SheetCell[]),
      [label('Total'), '', '', dec(t.litres, 2), null, money(t.amount), '']
    ],
    widths: [13, 15, 14, 11, 13, 14, 32],
    freezeRows: 1
  };
  await saveWorkbook(`${fuelStem()}.xlsx`, [sheet]);
}

export async function exportFuelPdf(rows: FuelRow[], filterNote = ''): Promise<void> {
  const t = fuelTotals(rows);
  await savePdf(`${fuelStem()}.pdf`, {
    title: 'Fuel Expenses',
    company: COMPANY,
    lines: [...(filterNote ? [filterNote] : []), `${rows.length} entries`, `Total: ${t.litres.toFixed(2)} L, ${rs(t.amount)}`],
    tables: [{
      heading: 'Diesel entries',
      head: ['Date', 'Vehicle', 'Trip no.', 'Litres', 'Rate / litre', 'Amount', 'Remarks'],
      body: rows.map((r) => [r.date, r.vehicle, r.tripNo, r.litres != null ? r.litres.toFixed(2) : '-', r.rate != null ? rs(r.rate) : '-', rs(r.amount), r.remarks]),
      right: [3, 4, 5]
    }]
  });
}

export interface BackupData {
  trips: Trip[];
  expenses: MonthlyExpense[];
  vehicles: Vehicle[];
  drivers: DriverMaster[];
  users: UserAccount[];
  master: MasterSettings;
}

function documentsSheet(trips: Trip[]): SheetSpec {
  const rows: SheetCell[][] = [[th('Trip no.'), th('Vehicle'), th('File name'), th('Type')]];
  for (const t of trips) {
    for (const d of t.documents) rows.push([t.waybillNo === '—' ? '' : t.waybillNo, t.vehicle, d.filename, d.mimeType ?? '']);
  }
  return { name: 'Attached files', rows, widths: [26, 13, 40, 22], freezeRows: 1 };
}

const blankIfDash = (v: string | undefined) => (!v || v === '—' ? '' : v);

export async function exportBackup(d: BackupData): Promise<void> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const attached = d.trips.reduce((a, t) => a + t.documents.length, 0);
  const lines = d.trips.reduce((a, t) => a + t.expenses.length, 0);

  const about: SheetSpec = {
    name: 'About',
    rows: [
      [title(`${COMPANY} - Full data backup`)],
      [note(`Created: ${now.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`)],
      [],
      [th('Sheet'), th('Records', true)],
      ['Trips', int(d.trips.length)],
      ['Route and odometers', int(d.trips.reduce((a, t) => a + t.stops.length + 2, 0))],
      ['Fuel and expense entries', int(lines)],
      ['Attached files (names only)', int(attached)],
      ['Fixed costs', int(d.expenses.length)],
      ['Vehicles', int(d.vehicles.length)],
      ['Drivers', int(d.drivers.length)],
      ['Users', int(d.users.length)],
      [],
      [note('Every trip and record in the app, not just what a screen is currently filtered to.')],
      [note('The attached files themselves (receipts, slips) are not inside this workbook - only their names are listed.')]
    ],
    widths: [34, 12]
  };

  const vehicles: SheetSpec = {
    name: 'Vehicles',
    rows: [
      [
        th('Reg No'), th('Reg Date'), th('Age of Vehicle'), th('Batch #'), th('Tax Date'), th('Insurance'), th('NP Date'), th('FC Date'),
        th('Pollution Cert Date'), th('Owner'), th('Model'), th('Default driver')
      ],
      ...d.vehicles.map((v) => [
        v.id, dateCell(parseDisplayDate(v.regDate)), vehicleAge(v.regDate) === '—' ? '' : vehicleAge(v.regDate), blankIfDash(v.batchNo),
        dateCell(parseDisplayDate(v.taxDate)), dateCell(parseDisplayDate(v.inspectionDate)), dateCell(parseDisplayDate(v.npDate)), dateCell(parseDisplayDate(v.fcDate)),
        dateCell(parseDisplayDate(v.pollutionDate)), blankIfDash(v.owner), blankIfDash(v.model), v.defaultDriver ?? ''
      ] as SheetCell[])
    ],
    widths: [14, 13, 14, 12, 13, 15, 13, 13, 19, 20, 18, 20],
    freezeRows: 1
  };
  const drivers: SheetSpec = {
    name: 'Drivers',
    rows: [
      [th('Name'), th('Licence no.'), th('Licence expiry'), th('Credential'), th('Assigned vehicle')],
      ...d.drivers.map((x) => [x.name, blankIfDash(x.licence), dateCell(parseDisplayDate(x.expiry)), blankIfDash(x.credential), blankIfDash(x.vehicle)] as SheetCell[])
    ],
    widths: [22, 18, 14, 20, 16],
    freezeRows: 1
  };
  const users: SheetSpec = {
    name: 'Users',
    rows: [
      [th('Name'), th('Role'), th('Mobile'), th('Branch'), th('Last active')],
      ...d.users.map((u) => [u.name, u.role, u.phone, blankIfDash(u.branch), blankIfDash(u.seen)] as SheetCell[])
    ],
    widths: [22, 16, 18, 16, 18],
    freezeRows: 1
  };
  const master: SheetSpec = {
    name: 'Master values',
    rows: [
      [th('Setting'), th('Value', true)],
      ['Diesel rate (Rs per litre)', d.master.dieselRate === null ? null : money(d.master.dieselRate)],
      ['AdBlue rate (Rs per litre)', d.master.adblueRate === null ? null : money(d.master.adblueRate)],
      ['Default loading point', d.master.loadingPoint ?? '']
    ],
    widths: [30, 26]
  };

  await saveWorkbook(`fleet-ledger-backup_${stamp}.xlsx`, [
    about, tripsSheet(d.trips, true), routeSheet(d.trips), expenseLinesSheet(d.trips), documentsSheet(d.trips),
    monthlyExpensesSheet(d.expenses), vehicles, drivers, users, master
  ]);
}
