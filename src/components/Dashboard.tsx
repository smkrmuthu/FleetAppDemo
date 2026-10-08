import { useState, type ReactNode } from 'react';
import {
  CalendarClock, CircleCheck, ClipboardList, Droplet, FileWarning, Fuel, Gauge, IndianRupee, Plus, Route, Truck, UserX, Wrench
} from 'lucide-react';
import type { DriverLeave, DriverMaster, MonthlyExpense, TabId, Trip, Vehicle, VehicleUnavailability } from '../types';
import { parseDisplayDate } from '../lib/api';
import { dieselLitres, dueStatus, formatDateRange, formatNum, rupees, rupeesCompact, tripCost, tripDurationDays, yearOptions } from '../utils/calc';
import { buildTruckRows } from '../utils/fleetStatus';
import { MonthYearFilter } from './MonthYearFilter';
import { FleetStatus } from './FleetStatus';
import { Pager } from './Pager';
import { RouteNetwork } from './RouteNetwork';
import { SortableTh, type SortDir } from './SortableTh';
import {
  AttentionCard, ChartCard, DataTable, EmptyState, FilterBar, FormField, GhostButton, HeroKpi, PrimaryButton,
  SectionHeading, StatusBadge, TripStatusBadge, type Tone
} from './ui';

interface Props {
  trips: Trip[];
  expenses: MonthlyExpense[];
  vehicles: Vehicle[];
  drivers: DriverMaster[];
  leaves: DriverLeave[];
  unavailability: VehicleUnavailability[];
  onTabChange: (t: TabId) => void;
  onEditTrip: (t: Trip) => void;
  // A read-only viewer: no shortcuts to other screens, nothing to open or edit.
  readOnly?: boolean;
  userName?: string;
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const from = `${y}-${pad(m + 1)}-01`;
  const to = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
  return { from, to };
}

// A naive "YYYY-MM-DDTHH:MM" for right now, in the same local-no-timezone
// format leaves and unavailability windows are stored in.
function nowDateTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function daysInRange(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 86_400_000) + 1 : 0;
}

// A truck below this share of the fleet's average km/L is flagged.
const LOW_MILEAGE_SHARE = 0.85;
const ATTENTION_ROWS = 4;
// With hundreds of trucks the charts show the ones worth looking at first, and open up on request.
const CHART_ROWS = 8;
const CHART_STEP = 12;
const PERF_PAGE = 15;

type PerfKey = 'id' | 'trips' | 'km' | 'onRoadDays' | 'dieselL' | 'tons' | 'mileage' | 'expense' | 'revenue' | 'perTon';

interface Bar { id: string; value: number; label: string; color: string; marker?: number }

// One horizontal bar per truck, on a shared scale.
function BarRows({ rows, max }: { rows: Bar[]; max: number }) {
  return (
    <div className="bar-rows">
      {rows.map((r) => (
        <div key={r.id} className="bar-row">
          <div className="bar-row-label" title={r.id}>{r.id}</div>
          <div className="bar-track" title={`${r.id}: ${r.label}`}>
            <div className="bar-fill" style={{ width: `${Math.min(100, (r.value / max) * 100)}%`, background: r.color }} />
            {r.marker !== undefined && <div className="bar-marker" style={{ left: `${Math.min(100, (r.marker / max) * 100)}%` }} />}
          </div>
          <div className="bar-row-value">{r.label}</div>
        </div>
      ))}
    </div>
  );
}

// Two thin bars per truck (expense above revenue), on a shared scale.
function PairRows({ rows, max }: { rows: { id: string; a: number; b: number; aLabel: string; bLabel: string }[]; max: number }) {
  return (
    <div className="bar-rows">
      {rows.map((r) => (
        <div key={r.id} className="bar-row">
          <div className="bar-row-label" title={r.id}>{r.id}</div>
          <div className="bar-pair">
            <div className="bar-track" title={`${r.id}: expense ${r.aLabel}`}>
              <div className="bar-fill" style={{ width: `${(r.a / max) * 100}%`, background: 'var(--chart-primary)' }} />
            </div>
            <div className="bar-track" title={`${r.id}: revenue ${r.bLabel}`}>
              <div className="bar-fill" style={{ width: `${(r.b / max) * 100}%`, background: 'var(--chart-positive)' }} />
            </div>
          </div>
          <div className="bar-row-value" style={{ color: r.b - r.a < 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
            {r.b - r.a < 0 ? '−' : '+'}{rupees(Math.abs(r.b - r.a)).replace(/\.\d+$/, '')}
          </div>
        </div>
      ))}
    </div>
  );
}

interface AttentionItem { key: string; tone: Tone; icon: ReactNode; title: string; description: string; rows: { id: string; main: ReactNode; meta: ReactNode }[]; more?: { label: string; tab: TabId } }

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) { const k = key(it); const l = m.get(k); if (l) l.push(it); else m.set(k, [it]); }
  return m;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard({ trips, expenses, vehicles, drivers, leaves, unavailability, onTabChange, onEditTrip, readOnly = false, userName = '' }: Props) {
  const [dateFrom, setDateFrom] = useState(() => currentMonthRange().from);
  const [dateTo, setDateTo] = useState(() => currentMonthRange().to);
  const [perfSort, setPerfSort] = useState<{ key: PerfKey; dir: SortDir }>({ key: 'trips', dir: 'desc' });
  const [perfPage, setPerfPage] = useState(0);
  const [chartRows, setChartRows] = useState(CHART_ROWS);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const label = formatDateRange(dateFrom, dateTo);
  const periodDays = daysInRange(dateFrom, dateTo);
  const inPeriod = (display: string) => {
    const d = parseDisplayDate(display);
    return !!d && d >= dateFrom && d <= dateTo;
  };
  const monthTrips = trips.filter((t) => inPeriod(t.loadDate));
  const monthExpenses = expenses.filter((e) => inPeriod(e.date));
  const openTrips = trips.filter((t) => t.status !== 'approved').sort((a, b) => (parseDisplayDate(a.loadDate) < parseDisplayDate(b.loadDate) ? -1 : 1));

  type Flagged<T extends object> = T & { status: NonNullable<ReturnType<typeof dueStatus>> };
  const isFlagged = <T extends { status: ReturnType<typeof dueStatus> }>(x: T): x is Flagged<T> => x.status !== null;

  const compliance = vehicles
    .flatMap((v) =>
      ([
        ['Tax', v.taxDate], ['Insurance', v.inspectionDate], ['NP', v.npDate], ['FC', v.fcDate], ['Pollution', v.pollutionDate]
      ] as const).map(([name, date]) => ({ vehicle: v.id, name, status: dueStatus(date) }))
    )
    .filter(isFlagged)
    .sort((a, b) => a.status.days - b.status.days);

  const licences = drivers
    .map((d) => ({ driver: d.name, status: dueStatus(d.expiry) }))
    .filter(isFlagged)
    .sort((a, b) => a.status.days - b.status.days);

  const now = nowDateTime();
  const onLeaveNow = leaves.filter((l) => l.startsAt <= now && now <= l.endsAt);
  const unavailableNow = unavailability.filter((w) => w.startsAt <= now && now <= w.endsAt);

  // Full per-truck breakdown for the filtered period — trucks with no
  // movements in it are left out rather than shown as a row of zeroes.
  const monthTripsByVehicle = groupBy(monthTrips, (t) => t.vehicle);
  const monthExpensesByVehicle = groupBy(monthExpenses, (e) => e.vehicle);
  const vehicleStats = vehicles
    .map((v) => {
      const vTrips = monthTripsByVehicle.get(v.id) ?? [];
      const km = vTrips.reduce((a, t) => a + t.km, 0);
      const dieselL = vTrips.reduce((a, t) => a + dieselLitres(t.expenses), 0);
      const tons = vTrips.reduce((a, t) => a + t.tons, 0);
      const onRoadDays = vTrips.reduce((a, t) => a + (tripDurationDays(t.loadDate, t.unloadDate) ?? 0), 0);
      const tripExpense = vTrips.reduce((a, t) => a + tripCost(t).expense, 0);
      const fixed = (monthExpensesByVehicle.get(v.id) ?? []).reduce((a, e) => a + e.amount, 0);
      const revenue = vTrips.reduce((a, t) => a + t.revenue, 0);
      return {
        id: v.id, trips: vTrips.length, km, onRoadDays, dieselL, tons,
        mileage: dieselL ? km / dieselL : 0, expense: tripExpense + fixed, revenue, perTon: tons ? revenue / tons : 0
      };
    })
    .filter((v) => v.trips > 0);

  const totals = vehicleStats.reduce(
    (a, v) => ({ trips: a.trips + v.trips, km: a.km + v.km, dieselL: a.dieselL + v.dieselL, tons: a.tons + v.tons, onRoadDays: a.onRoadDays + v.onRoadDays, expense: a.expense + v.expense, revenue: a.revenue + v.revenue }),
    { trips: 0, km: 0, dieselL: 0, tons: 0, onRoadDays: 0, expense: 0, revenue: 0 }
  );
  // Fixed costs on trucks with no movement this period still count towards the total.
  const totalExpense = monthTrips.reduce((a, t) => a + tripCost(t).expense, 0) + monthExpenses.reduce((a, e) => a + e.amount, 0);
  // Fixed costs booked against trucks that made no movement in the period aren't in the table.
  const idleFixed = Math.max(0, totalExpense - totals.expense);
  const fleetMileage = totals.dieselL ? totals.km / totals.dieselL : 0;
  const lowMileage = (m: number) => fleetMileage > 0 && m > 0 && m < fleetMileage * LOW_MILEAGE_SHARE;
  const approvedCount = monthTrips.filter((t) => t.status === 'approved').length;

  // — Needs attention: business exceptions, most serious first. —
  const revenueMissing = monthTrips.filter((t) => t.revenue === 0 && tripCost(t).expense > 0);
  const fuelMissing = monthTrips.filter((t) => t.status !== 'draft' && t.km > 0 && dieselLitres(t.expenses) === 0);
  const unverified = monthExpenses.filter((e) => e.documents.length === 0);
  const attention: AttentionItem[] = [];
  if (revenueMissing.length) attention.push({
    key: 'revenue', tone: 'error', icon: <IndianRupee size={16} />, title: 'Revenue not recorded',
    description: 'Movements with costs but no revenue entered.',
    rows: revenueMissing.map((t) => ({ id: t.id, main: tripLink(t), meta: rupees(tripCost(t).expense) })),
    more: { label: 'Open the Trip Log', tab: 'triplog' }
  });
  if (compliance.length) attention.push({
    key: 'compliance', tone: compliance.some((c) => c.status.expired) ? 'error' : 'warning', icon: <Wrench size={16} />,
    title: 'Maintenance & compliance due', description: 'Tax, insurance, permit, fitness and pollution dates within 60 days.',
    rows: compliance.map((c, i) => ({ id: `${c.vehicle}-${c.name}-${i}`, main: <>{c.vehicle} · {c.name}</>, meta: <span style={{ color: c.status.expired ? 'var(--color-error)' : undefined }}>{c.status.label}</span> })),
    more: { label: 'Manage under People', tab: 'people' }
  });
  if (openTrips.length) attention.push({
    key: 'open', tone: 'warning', icon: <ClipboardList size={16} />, title: 'Trips pending closure',
    description: 'Drafts still open on the road, and completed trips awaiting approval.',
    rows: openTrips.map((t) => ({ id: t.id, main: tripLink(t), meta: <TripStatusBadge status={t.status} short /> })),
    more: { label: 'Open Movements', tab: 'movements' }
  });
  if (fuelMissing.length) attention.push({
    key: 'fuel', tone: 'warning', icon: <Fuel size={16} />, title: 'Fuel entry missing',
    description: 'Movements with distance recorded but no diesel posted.',
    rows: fuelMissing.map((t) => ({ id: t.id, main: tripLink(t), meta: `${formatNum(t.km)} km` })),
    more: { label: 'Open Fuel & Expenses', tab: 'fuel' }
  });
  const thirsty = vehicleStats.filter((v) => lowMileage(v.mileage));
  if (thirsty.length) attention.push({
    key: 'mileage', tone: 'warning', icon: <Droplet size={16} />, title: 'High fuel consumption',
    description: `Below ${Math.round(LOW_MILEAGE_SHARE * 100)}% of the fleet average (${fleetMileage.toFixed(2)} km/L).`,
    rows: thirsty.map((v) => ({ id: v.id, main: v.id, meta: `${v.mileage.toFixed(2)} km/L` }))
  });
  if (licences.length) attention.push({
    key: 'licences', tone: licences.some((l) => l.status.expired) ? 'error' : 'warning', icon: <CalendarClock size={16} />,
    title: 'Driver licences due', description: 'Licences expiring within 60 days.',
    rows: licences.map((l, i) => ({ id: `${l.driver}-${i}`, main: l.driver, meta: <span style={{ color: l.status.expired ? 'var(--color-error)' : undefined }}>{l.status.label}</span> }))
  });
  if (unverified.length) attention.push({
    key: 'bills', tone: 'info', icon: <FileWarning size={16} />, title: 'Unverified expenses',
    description: 'Monthly expenses in this period with no bill attached.',
    rows: unverified.map((e) => ({ id: e.id, main: <>{e.vehicle} · {e.category}</>, meta: rupees(e.amount) })),
    more: { label: 'Open Monthly Expenses', tab: 'expenses' }
  });
  if (onLeaveNow.length || unavailableNow.length) attention.push({
    key: 'offroad', tone: 'info', icon: <UserX size={16} />, title: 'Off the road today', description: 'Drivers on leave and trucks marked unavailable.',
    rows: [
      ...onLeaveNow.map((l) => ({ id: l.id, main: l.driver, meta: 'On leave' })),
      ...unavailableNow.map((w) => ({ id: w.id, main: w.vehicle, meta: 'Unavailable' }))
    ]
  });

  function tripLink(t: Trip) {
    const text = <>{t.vehicle} <span style={{ color: 'var(--color-text-muted)' }}>· {t.waybillNo}</span></>;
    if (readOnly) return <span>{text}</span>;
    return <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, color: 'var(--color-text)', fontWeight: 500, minHeight: 0 }} onClick={() => onEditTrip(t)}>{text}</button>;
  }

  // Per-truck status and the route lanes for the map. Both come only from the
  // recorded movements, availability windows and compliance dates.
  const truckRows = buildTruckRows({
    vehicles, trips, unavailability, now,
    periodStats: Object.fromEntries(vehicleStats.map((v) => [v.id, { trips: v.trips, km: v.km, mileage: v.mileage }]))
  });
  const onRoadCount = truckRows.filter((r) => r.state === 'road').length;
  const routeTrips = monthTrips.map((t) => ({ from: t.from, to: t.to, stops: t.stops.map((s) => s.location), open: t.status !== 'approved' }));
  const firstName = userName.trim();

  const recent = [...trips].sort((a, b) => parseDisplayDate(b.loadDate).localeCompare(parseDisplayDate(a.loadDate)) || b.id.localeCompare(a.id)).slice(0, 6);
  const utilisation = vehicleStats.map((v) => ({ id: v.id, pct: periodDays ? Math.min(100, (v.onRoadDays / periodDays) * 100) : 0, days: v.onRoadDays }));
  const mileageMax = Math.max(1, ...vehicleStats.map((v) => v.mileage), fleetMileage) * 1.1;
  const moneyMax = Math.max(1, ...vehicleStats.flatMap((v) => [v.expense, v.revenue]));

  return (
    <section>
      <section className="hero" aria-label="Fleet summary">
        <div className="hero-top">
          <div>
            <div className="page-eyebrow">{readOnly ? 'Overview' : 'Manager'} · {label}</div>
            <h1>Dashboard</h1>
            <p className="page-description">
              {greeting()}{firstName ? `, ${firstName}` : ''}.{' '}
              {vehicles.length > 0 && <>{onRoadCount} of {vehicles.length} {vehicles.length === 1 ? 'truck is' : 'trucks are'} on the road · </>}
              {openTrips.length === 0 ? 'nothing is waiting on you.' : `${openTrips.length} open ${openTrips.length === 1 ? 'movement' : 'movements'}.`}
            </p>
          </div>
          {!readOnly && (
            <div className="page-actions">
              <button type="button" className="btn btn-on-dark" onClick={() => onTabChange('triplog')}>Trip Log</button>
              <button type="button" className="btn btn-on-dark" onClick={() => onTabChange('people')}>People</button>
              <button type="button" className="btn btn-on-dark" onClick={() => onTabChange('master')}>Masters</button>
              <PrimaryButton icon={<Plus size={16} />} onClick={() => onTabChange('addtrip')}>Add Movement</PrimaryButton>
            </div>
          )}
        </div>
        <div className="hero-kpis">
          <HeroKpi icon={<Truck size={14} />} label="Total Trips" value={monthTrips.length} format={(n) => formatNum(n)}
            sub={`${formatNum(approvedCount)} approved · ${formatNum(monthTrips.length - approvedCount)} open`} />
          <HeroKpi icon={<Route size={14} />} label="Total Distance" value={totals.km} format={(n) => formatNum(n)} unit="km"
            sub={totals.trips ? `${formatNum(totals.km / totals.trips)} km per trip` : 'No trips in period'} />
          <HeroKpi icon={<Gauge size={14} />} label="Diesel Consumed" value={totals.dieselL} format={(n) => formatNum(n)} unit="L"
            sub={fleetMileage ? `Fleet average ${fleetMileage.toFixed(2)} km/L` : 'No diesel posted'} />
          <HeroKpi icon={<IndianRupee size={14} />} label="Total Expense" value={totalExpense} format={rupeesCompact}
            sub={idleFixed > 0
              ? `Includes ${rupees(idleFixed).replace(/\.\d+$/, '')} fixed costs on idle trucks`
              : <>Revenue {rupees(totals.revenue).replace(/\.\d+$/, '')}{totals.revenue === 0 && totalExpense > 0 && <> · <span style={{ color: '#FF8A80' }}>not recorded</span></>}</>} />
        </div>
      </section>

      <FilterBar>
        <FormField label="From" htmlFor="dash-from"><input id="dash-from" className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></FormField>
        <FormField label="To" htmlFor="dash-to"><input id="dash-to" className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></FormField>
        <MonthYearFilter
          dateFrom={dateFrom} dateTo={dateTo} onDateFrom={setDateFrom} onDateTo={setDateTo}
          years={yearOptions([...trips.map((t) => t.loadDate), ...expenses.map((e) => e.date)])}
        />
        <GhostButton style={{ justifySelf: 'start', minHeight: 36 }} onClick={() => { setDateFrom(currentMonthRange().from); setDateTo(currentMonthRange().to); }}>
          Back to this month
        </GhostButton>
      </FilterBar>

      {truckRows.length > 0 && (
        <>
          <SectionHeading title="Fleet status" aside="Right now · figures for the selected period" />
          <FleetStatus rows={truckRows} />
        </>
      )}

      <SectionHeading title="Fleet performance" aside={`By truck · ${label}${vehicleStats.length > PERF_PAGE ? ` · ${formatNum(vehicleStats.length)} trucks with movements` : ''}`} />
      {vehicleStats.length === 0 ? (
        <EmptyState>No movements in this period.</EmptyState>
      ) : (
        <>
        <DataTable minWidth={960}>
          <thead>
            <tr>
              {([
                ['id', 'Truck', false], ['trips', 'Trips', true], ['km', 'KM', true], ['onRoadDays', 'On-road days', true], ['dieselL', 'Diesel (L)', true],
                ['tons', 'Load (t)', true], ['mileage', 'Mileage (km/L)', true], ['expense', 'Expense', true], ['revenue', 'Revenue', true], ['perTon', '₹/ton', true]
              ] as [PerfKey, string, boolean][]).map(([key, text, num]) => (
                <SortableTh key={key} label={text} className={num ? 'num' : undefined} align={num ? 'right' : 'left'}
                  active={perfSort.key === key} dir={perfSort.dir}
                  onSort={() => { setPerfSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : key === 'id' ? 'asc' : 'desc' })); setPerfPage(0); }} />
              ))}
            </tr>
          </thead>
          <tbody>
            {[...vehicleStats].sort((a, b) => {
              const d = perfSort.key === 'id' ? a.id.localeCompare(b.id) : a[perfSort.key] - b[perfSort.key];
              return (perfSort.dir === 'asc' ? d : -d) || a.id.localeCompare(b.id);
            }).slice(perfPage * PERF_PAGE, (perfPage + 1) * PERF_PAGE).map((v) => {
              const noRevenue = v.revenue === 0 && v.expense > 0;
              return (
                <tr key={v.id}>
                  <td className="cell-strong" style={{ whiteSpace: 'nowrap' }}>{v.id}</td>
                  <td className="num">{formatNum(v.trips)}</td>
                  <td className="num">{formatNum(v.km)}</td>
                  <td className="num">{formatNum(v.onRoadDays)}</td>
                  <td className="num">{formatNum(v.dieselL)}</td>
                  <td className="num">{formatNum(v.tons, 1)}</td>
                  <td className="num" style={lowMileage(v.mileage) ? { color: 'var(--color-warning-text)', fontWeight: 600 } : undefined}
                    title={lowMileage(v.mileage) ? 'Below the fleet average' : undefined}>
                    {v.mileage ? v.mileage.toFixed(2) : '—'}
                  </td>
                  <td className="num">{rupees(v.expense)}</td>
                  <td className="num">{noRevenue ? <StatusBadge tone="error" title="Costs recorded but no revenue">Not recorded</StatusBadge> : rupees(v.revenue)}</td>
                  <td className="num">{v.perTon ? rupees(v.perTon) : <span className="cell-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Fleet · {formatNum(vehicleStats.length)} {vehicleStats.length === 1 ? 'truck' : 'trucks'}</td>
              <td className="num">{formatNum(totals.trips)}</td>
              <td className="num">{formatNum(totals.km)}</td>
              <td className="num">{formatNum(totals.onRoadDays)}</td>
              <td className="num">{formatNum(totals.dieselL)}</td>
              <td className="num">{formatNum(totals.tons, 1)}</td>
              <td className="num">{fleetMileage ? fleetMileage.toFixed(2) : '—'}</td>
              <td className="num">{rupees(totals.expense)}</td>
              <td className="num">{rupees(totals.revenue)}</td>
              <td className="num">{totals.tons ? rupees(totals.revenue / totals.tons) : '—'}</td>
            </tr>
          </tfoot>
        </DataTable>
        <Pager attached page={perfPage} pageSize={PERF_PAGE} total={vehicleStats.length} onPage={setPerfPage} />
        </>
      )}

      <SectionHeading title="Routes" aside={label} />
      <RouteNetwork trips={routeTrips} periodLabel={label} />

      {vehicleStats.length > 0 && (
        <>
          <SectionHeading title="Trends" aside="By truck" />
          <div className="chart-grid">
            <ChartCard title="Fleet utilisation" subtitle={`On-road days out of ${periodDays} in the period${vehicleStats.length > CHART_ROWS ? ' · busiest first' : ''}`}>
              <BarRows max={100} rows={[...utilisation].sort((a, b) => b.pct - a.pct || a.id.localeCompare(b.id)).slice(0, chartRows).map((u) => ({ id: u.id, value: u.pct, label: `${Math.round(u.pct)}% · ${u.days}d`, color: 'var(--chart-primary)' }))} />
            </ChartCard>
            <ChartCard title="Fuel efficiency" subtitle={`km per litre of diesel${vehicleStats.length > CHART_ROWS ? ' · lowest first' : ''}`}
              legend={[{ label: 'km/L', color: 'var(--chart-neutral)' }, { label: 'Below average', color: 'var(--color-warning)' }, { label: 'Fleet average', color: 'var(--color-text)' }]}>
              <BarRows max={mileageMax} rows={[...vehicleStats].sort((a, b) => (a.mileage || Infinity) - (b.mileage || Infinity) || a.id.localeCompare(b.id)).slice(0, chartRows).map((v) => ({
                id: v.id, value: v.mileage, label: v.mileage ? v.mileage.toFixed(2) : '—',
                color: lowMileage(v.mileage) ? 'var(--color-warning)' : 'var(--chart-neutral)', marker: fleetMileage || undefined
              }))} />
            </ChartCard>
            <ChartCard title="Expense vs revenue" subtitle={`Trip costs plus fixed costs, against revenue${vehicleStats.length > CHART_ROWS ? ' · weakest margin first' : ''}`}
              legend={[{ label: 'Expense', color: 'var(--chart-primary)' }, { label: 'Revenue', color: 'var(--chart-positive)' }]}>
              <PairRows max={moneyMax} rows={[...vehicleStats].sort((a, b) => (a.revenue - a.expense) - (b.revenue - b.expense) || a.id.localeCompare(b.id)).slice(0, chartRows).map((v) => ({ id: v.id, a: v.expense, b: v.revenue, aLabel: rupees(v.expense), bLabel: rupees(v.revenue) }))} />
            </ChartCard>
          </div>
          {vehicleStats.length > CHART_ROWS && (
            <div className="show-more" style={{ marginTop: 'var(--space-3)' }}>
              <span>Showing {Math.min(chartRows, vehicleStats.length)} of {formatNum(vehicleStats.length)} trucks</span>
              {chartRows < vehicleStats.length && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setChartRows(chartRows + CHART_STEP)}>Show {Math.min(CHART_STEP, vehicleStats.length - chartRows)} more</button>}
              {chartRows > CHART_ROWS && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChartRows(CHART_ROWS)}>Show fewer</button>}
            </div>
          )}
        </>
      )}

      <SectionHeading title="Needs attention" aside={attention.length ? `${attention.length} ${attention.length === 1 ? 'area' : 'areas'}` : undefined} />
      {attention.length === 0 ? (
        <AttentionCard tone="success" icon={<CircleCheck size={16} />} title="All clear" description="No open movements, missing entries or upcoming renewals." />
      ) : (
        <div className="attention-grid">
          {attention.map((a) => (
            <AttentionCard key={a.key} tone={a.tone} icon={a.icon} title={a.title} count={a.rows.length} description={a.description}
              footer={a.rows.length > ATTENTION_ROWS ? (
                <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <GhostButton size="sm" className="attention-more" style={{ padding: 0 }} onClick={() => setExpanded((e) => ({ ...e, [a.key]: !e[a.key] }))}>
                    {expanded[a.key] ? 'Show fewer' : `+${a.rows.length - ATTENTION_ROWS} more`}
                  </GhostButton>
                  {!readOnly && a.more && <GhostButton size="sm" className="attention-more" style={{ padding: 0 }} onClick={() => onTabChange(a.more!.tab)}>{a.more.label}</GhostButton>}
                </span>
              ) : undefined}>
              <ul className={expanded[a.key] ? 'attention-list expanded' : 'attention-list'}>
                {a.rows.slice(0, expanded[a.key] ? undefined : ATTENTION_ROWS).map((r) => (
                  <li key={r.id}><span style={{ minWidth: 0 }}>{r.main}</span><span className="attention-meta">{r.meta}</span></li>
                ))}
              </ul>
            </AttentionCard>
          ))}
        </div>
      )}

      <SectionHeading
        title="Recent movements"
        aside={!readOnly && <GhostButton size="sm" onClick={() => onTabChange('triplog')}>View all in Trip Log</GhostButton>}
      />
      {recent.length === 0 ? (
        <EmptyState>No movements recorded yet.</EmptyState>
      ) : (
        <DataTable minWidth={640}>
          <thead>
            <tr><th>Trip No.</th><th>Loading date</th><th>Vehicle</th><th>Driver</th><th>Status</th></tr>
          </thead>
          <tbody>
            {recent.map((t) => (
              <tr key={t.id}>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>{t.waybillNo}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{t.loadDate}</td>
                <td className="cell-strong" style={{ whiteSpace: 'nowrap' }}>{t.vehicle}</td>
                <td>{t.driver}</td>
                <td><TripStatusBadge status={t.status} /></td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}
