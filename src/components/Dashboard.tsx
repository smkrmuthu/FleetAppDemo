import { useState, type ReactNode } from 'react';
import {
  CalendarClock, CircleCheck, ClipboardList, Droplet, FileWarning, Fuel, Gauge, IndianRupee, Plus, Route, Truck, UserX, Wrench
} from 'lucide-react';
import type { DriverLeave, DriverMaster, MonthlyExpense, TabId, Trip, Vehicle, VehicleUnavailability } from '../types';
import { parseDisplayDate } from '../lib/api';
import { dieselLitres, dueStatus, formatDateRange, formatNum, rupees, tripCost, tripDurationDays, yearOptions } from '../utils/calc';
import { MonthYearFilter } from './MonthYearFilter';
import {
  AttentionCard, ChartCard, DataTable, EmptyState, FilterBar, FormField, GhostButton, KpiCard, PageHeader, PrimaryButton,
  SecondaryButton, SectionHeading, StatusBadge, TripStatusBadge, type Tone
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

export function Dashboard({ trips, expenses, vehicles, drivers, leaves, unavailability, onTabChange, onEditTrip, readOnly = false }: Props) {
  const [dateFrom, setDateFrom] = useState(() => currentMonthRange().from);
  const [dateTo, setDateTo] = useState(() => currentMonthRange().to);
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
  const vehicleStats = vehicles
    .map((v) => {
      const vTrips = monthTrips.filter((t) => t.vehicle === v.id);
      const km = vTrips.reduce((a, t) => a + t.km, 0);
      const dieselL = vTrips.reduce((a, t) => a + dieselLitres(t.expenses), 0);
      const tons = vTrips.reduce((a, t) => a + t.tons, 0);
      const onRoadDays = vTrips.reduce((a, t) => a + (tripDurationDays(t.loadDate, t.unloadDate) ?? 0), 0);
      const tripExpense = vTrips.reduce((a, t) => a + tripCost(t).expense, 0);
      const fixed = monthExpenses.filter((e) => e.vehicle === v.id).reduce((a, e) => a + e.amount, 0);
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

  const recent = trips.slice(0, 6);
  const utilisation = vehicleStats.map((v) => ({ id: v.id, pct: periodDays ? Math.min(100, (v.onRoadDays / periodDays) * 100) : 0, days: v.onRoadDays }));
  const mileageMax = Math.max(1, ...vehicleStats.map((v) => v.mileage), fleetMileage) * 1.1;
  const moneyMax = Math.max(1, ...vehicleStats.flatMap((v) => [v.expense, v.revenue]));

  return (
    <section>
      <PageHeader
        eyebrow={`${readOnly ? 'Overview' : 'Manager'} · ${label}`}
        title="Dashboard"
        description="Where the fleet stands for the selected period, and what needs attention today."
        actions={!readOnly && (
          <>
            <SecondaryButton onClick={() => onTabChange('triplog')}>Trip Log</SecondaryButton>
            <SecondaryButton onClick={() => onTabChange('people')}>People</SecondaryButton>
            <SecondaryButton onClick={() => onTabChange('master')}>Masters</SecondaryButton>
            <PrimaryButton icon={<Plus size={16} />} onClick={() => onTabChange('addtrip')}>Add Movement</PrimaryButton>
          </>
        )}
      />

      <div className="kpi-grid" style={{ marginBottom: 'var(--space-4)' }}>
        <KpiCard icon={<Truck size={14} />} label="Total Trips" value={formatNum(monthTrips.length)}
          sub={`${formatNum(approvedCount)} approved · ${formatNum(monthTrips.length - approvedCount)} open`} />
        <KpiCard icon={<Route size={14} />} label="Total Distance" value={formatNum(totals.km)} unit="km"
          sub={totals.trips ? `${formatNum(totals.km / totals.trips)} km per trip` : 'No trips in period'} />
        <KpiCard icon={<Gauge size={14} />} label="Diesel Consumed" value={formatNum(totals.dieselL)} unit="L"
          sub={fleetMileage ? `Fleet average ${fleetMileage.toFixed(2)} km/L` : 'No diesel posted'} />
        <KpiCard icon={<IndianRupee size={14} />} label="Total Expense" value={rupees(totalExpense).replace(/\.\d+$/, '')}
          sub={idleFixed > 0
            ? `Includes ${rupees(idleFixed).replace(/\.\d+$/, '')} fixed costs on idle trucks`
            : <>Revenue {rupees(totals.revenue).replace(/\.\d+$/, '')}{totals.revenue === 0 && totalExpense > 0 && <> · <span style={{ color: 'var(--color-error)' }}>not recorded</span></>}</>} />
      </div>

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

      <SectionHeading title="Fleet performance" aside={`By truck · ${label}`} />
      {vehicleStats.length === 0 ? (
        <EmptyState>No movements in this period.</EmptyState>
      ) : (
        <DataTable minWidth={960}>
          <thead>
            <tr>
              <th>Truck</th><th className="num">Trips</th><th className="num">KM</th>
              <th className="num">On-road days</th><th className="num">Diesel (L)</th>
              <th className="num">Load (t)</th><th className="num">Mileage (km/L)</th>
              <th className="num">Expense</th><th className="num">Revenue</th><th className="num">₹/ton</th>
            </tr>
          </thead>
          <tbody>
            {vehicleStats.map((v) => {
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
              <td>Fleet</td>
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
      )}

      {vehicleStats.length > 0 && (
        <>
          <SectionHeading title="Trends" aside="By truck" />
          <div className="chart-grid">
            <ChartCard title="Fleet utilisation" subtitle={`On-road days out of ${periodDays} in the period`}>
              <BarRows max={100} rows={utilisation.map((u) => ({ id: u.id, value: u.pct, label: `${Math.round(u.pct)}% · ${u.days}d`, color: 'var(--chart-primary)' }))} />
            </ChartCard>
            <ChartCard title="Fuel efficiency" subtitle="km per litre of diesel"
              legend={[{ label: 'km/L', color: 'var(--chart-neutral)' }, { label: 'Below average', color: 'var(--color-warning)' }, { label: 'Fleet average', color: 'var(--color-text)' }]}>
              <BarRows max={mileageMax} rows={vehicleStats.map((v) => ({
                id: v.id, value: v.mileage, label: v.mileage ? v.mileage.toFixed(2) : '—',
                color: lowMileage(v.mileage) ? 'var(--color-warning)' : 'var(--chart-neutral)', marker: fleetMileage || undefined
              }))} />
            </ChartCard>
            <ChartCard title="Expense vs revenue" subtitle="Trip costs plus fixed costs, against revenue"
              legend={[{ label: 'Expense', color: 'var(--chart-primary)' }, { label: 'Revenue', color: 'var(--chart-positive)' }]}>
              <PairRows max={moneyMax} rows={vehicleStats.map((v) => ({ id: v.id, a: v.expense, b: v.revenue, aLabel: rupees(v.expense), bLabel: rupees(v.revenue) }))} />
            </ChartCard>
          </div>
        </>
      )}

      <SectionHeading title="Needs attention" aside={attention.length ? `${attention.length} ${attention.length === 1 ? 'area' : 'areas'}` : undefined} />
      {attention.length === 0 ? (
        <AttentionCard tone="success" icon={<CircleCheck size={16} />} title="All clear" description="No open movements, missing entries or upcoming renewals." />
      ) : (
        <div className="attention-grid">
          {attention.map((a) => (
            <AttentionCard key={a.key} tone={a.tone} icon={a.icon} title={a.title} count={a.rows.length} description={a.description}
              footer={!readOnly && a.more && a.rows.length > ATTENTION_ROWS
                ? <GhostButton size="sm" className="attention-more" style={{ padding: 0 }} onClick={() => onTabChange(a.more!.tab)}>+{a.rows.length - ATTENTION_ROWS} more · {a.more.label}</GhostButton>
                : undefined}>
              <ul className="attention-list">
                {a.rows.slice(0, ATTENTION_ROWS).map((r) => (
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
