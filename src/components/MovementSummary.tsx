import { useState } from 'react';
import type { DriverMaster, MonthlyExpense, Trip, Vehicle } from '../types';
import type { VehicleAgg } from '../utils/aggregate';
import { aggregateByVehicle, isFastag } from '../utils/aggregate';
import { dateInRange, formatDateRange, formatNum, rupees, tripCost, yearOptions } from '../utils/calc';
import { MonthYearFilter } from './MonthYearFilter';
import { exportSummaryExcel, exportSummaryPdf, type Stat, type SummaryData } from '../lib/reports';
import { useExport } from '../lib/useExport';

interface Props {
  trips: Trip[];
  expenses: MonthlyExpense[];
  vehicles: Vehicle[];
  drivers: DriverMaster[];
  vehicleFilter: string;
  driverFilter: string;
  dateFrom: string;
  dateTo: string;
  onVehicleFilter: (v: string) => void;
  onDriverFilter: (v: string) => void;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
  onResetFilters: () => void;
}

// Money figures carry paise now, so a big revenue can be 14+ characters wide —
// step the size down for longer values so they stay inside their tile.
function statValueSize(value: string): number {
  if (value.length > 15) return 18;
  if (value.length > 12) return 20;
  if (value.length > 10) return 22;
  return 24;
}

export function MovementSummary({ trips, expenses, vehicles, drivers, vehicleFilter, driverFilter, dateFrom, dateTo, onVehicleFilter, onDriverFilter, onDateFrom, onDateTo, onResetFilters }: Props) {
  const rows = trips.filter(
    (t) => (vehicleFilter === 'all' || t.vehicle === vehicleFilter) &&
      (!driverFilter || t.driver === driverFilter) &&
      dateInRange(t.loadDate, dateFrom, dateTo)
  );
  const expenseRows = expenses.filter((e) => dateInRange(e.date, dateFrom, dateTo));

  const totals = rows.reduce(
    (a, t) => {
      const c = tripCost(t);
      a.km += t.km;
      a.tons += t.tons;
      a.exp += c.expense;
      a.rev += t.revenue;
      return a;
    },
    { km: 0, tons: 0, exp: 0, rev: 0 }
  );
  const monthlyTotal = expenseRows.reduce((a, e) => a + e.amount, 0);
  // Fastag is a toll: shown with trip expense, not fixed costs. Moved, not added,
  // so profit (which uses the raw totals) is unaffected.
  const fastagTotal = expenseRows.filter(isFastag).reduce((a, e) => a + e.amount, 0);
  const tripExpenseShown = totals.exp + fastagTotal;
  const fixedShown = monthlyTotal - fastagTotal;

  const byVehicle = aggregateByVehicle(rows, expenseRows, vehicles);

  type SortKey = 'id' | 'model' | 'trips' | 'km' | 'tons' | 'tripExpense' | 'monthly' | 'revenue' | 'profit' | 'costPerKm';
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

  function toggleSort(key: SortKey) {
    setSort((prev) => (!prev || prev.key !== key ? { key, dir: 'desc' } : prev.dir === 'desc' ? { key, dir: 'asc' } : null));
  }

  function sortValue(b: VehicleAgg, key: SortKey): number | string {
    if (key === 'id') return b.id;
    if (key === 'model') return b.model;
    if (key === 'costPerKm') return b.km ? b.cost / b.km : -1;
    if (key === 'tripExpense') return b.ledgerTripExpense;
    if (key === 'monthly') return b.ledgerMonthly;
    return b[key];
  }

  const sortedByVehicle = sort
    ? [...byVehicle].sort((a, b) => {
        const av = sortValue(a, sort.key);
        const bv = sortValue(b, sort.key);
        const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
        return sort.dir === 'asc' ? cmp : -cmp;
      })
    : byVehicle;

  function sortHeader(key: SortKey, label: string, align: 'left' | 'right' = 'left') {
    const dir = sort?.key === key ? sort.dir : null;
    return (
      <th style={align === 'right' ? { textAlign: 'right' } : undefined} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
        <button
          type="button" className="btn btn-ghost" onClick={() => toggleSort(key)}
          style={{
            padding: 0, font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', color: 'inherit',
            display: 'inline-flex', gap: 6, alignItems: 'center', flexDirection: align === 'right' ? 'row-reverse' : 'row'
          }}
          title={dir === 'asc' ? 'Ascending — click for descending' : dir === 'desc' ? 'Descending — click to stop sorting' : `Not sorted — click to sort by ${label}`}
        >
          {label} <span aria-hidden="true">{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}</span>
        </button>
      </th>
    );
  }

  const avgPerKm = totals.km ? tripExpenseShown / totals.km : 0;
  const profit = totals.rev - totals.exp - monthlyTotal;
  const stats: Stat[] = [
    { label: 'Movements', value: formatNum(rows.length), raw: rows.length, fmt: 'int', note: 'gated this month' },
    { label: 'Vehicles', value: formatNum(byVehicle.filter((b) => b.trips).length), raw: byVehicle.filter((b) => b.trips).length, fmt: 'int', note: `active of ${vehicles.length}` },
    { label: 'Total km', value: formatNum(totals.km), raw: totals.km, fmt: 'int', note: 'odometer based' },
    { label: 'Total tons', value: formatNum(totals.tons, 2), raw: totals.tons, fmt: 'dec', note: 'loading weight' },
    { label: 'Trip expense', value: rupees(tripExpenseShown), raw: tripExpenseShown, fmt: 'money', note: 'diesel, toll, other' },
    { label: 'Fixed costs', value: rupees(fixedShown), raw: fixedShown, fmt: 'money', note: 'permits, insurance, EMI' },
    { label: 'Avg ₹/km', value: totals.km ? rupees(avgPerKm) : '₹0', raw: avgPerKm, fmt: 'money', note: 'running cost' },
    { label: 'Revenue', value: rupees(totals.rev), raw: totals.rev, fmt: 'money', note: 'billed to consignee' },
    { label: 'Profit', value: rupees(profit), raw: profit, fmt: 'money', note: 'after monthly expenses' }
  ];

  const rangeLabel = formatDateRange(dateFrom, dateTo);
  const filterNote = vehicleFilter === 'all' ? `All vehicles, ${rangeLabel}` : `${vehicleFilter}, ${rangeLabel}`;

  const { busy, error, run } = useExport();
  const exportData = (): SummaryData => ({
    period: { from: dateFrom, to: dateTo, label: rangeLabel },
    filterNote: `Vehicle: ${vehicleFilter === 'all' ? 'all' : vehicleFilter}   Driver: ${driverFilter || 'all'}`,
    stats, byVehicle, trips: rows, expenses: expenseRows
  });

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div className="kicker">{rangeLabel}</div>
          <h1>Movement Summary</h1>
          <p style={{ color: 'var(--color-neutral-700)', marginTop: 6, fontSize: 13 }}>Fleet-wide totals — movements, distance, cost and profit — for the selected period.</p>
        </div>
        <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => run('xlsx', () => exportSummaryExcel(exportData()))}>
              {busy === 'xlsx' ? 'Preparing…' : 'Export Excel'}
            </button>
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => run('pdf', () => exportSummaryPdf(exportData()))}>
              {busy === 'pdf' ? 'Preparing…' : 'Print / Save PDF'}
            </button>
          </div>
          {error && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 12 }}>{error}</div>}
        </div>
      </div>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20, background: 'var(--color-surface)' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', marginBottom: 12 }}>Filters</div>
        <div className="filters-grid">
          <div className="field"><label>Loading date from</label><input className="input" type="date" value={dateFrom} onChange={(e) => onDateFrom(e.target.value)} /></div>
          <div className="field"><label>Loading date to</label><input className="input" type="date" value={dateTo} onChange={(e) => onDateTo(e.target.value)} /></div>
          <MonthYearFilter dateFrom={dateFrom} dateTo={dateTo} onDateFrom={onDateFrom} onDateTo={onDateTo} years={yearOptions([...trips.map((t) => t.loadDate), ...expenses.map((e) => e.date)])} />
          <div className="field">
            <label>Vehicle</label>
            <select className="input" value={vehicleFilter} onChange={(e) => onVehicleFilter(e.target.value)}>
              <option value="all">All vehicles</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Driver</label>
            <select className="input" value={driverFilter} onChange={(e) => onDriverFilter(e.target.value)}>
              <option value="">All drivers</option>
              {drivers.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-ghost" style={{ justifySelf: 'start' }} onClick={onResetFilters}>Reset filters</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 'var(--space-4)', marginBottom: 28 }}>
        {stats.map((s) => (
          <div key={s.label} className="card kpi-card" style={{ minWidth: 0 }}>
            <div className="stat-label">{s.label}</div>
            <div
              style={{
                fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: statValueSize(s.value), letterSpacing: '-0.02em', lineHeight: 1.15, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                // A loss shows in red, a profit in green — same colours as the Vehicle-wise table below.
                ...(s.label === 'Profit' ? { color: s.raw < 0 ? 'var(--color-accent-700)' : 'var(--color-profit)' } : {})
              }}
            >
              {s.value}
            </div>
            <div className="kpi-sub">{s.note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 12 }}>
        <h2 style={{ fontSize: 'var(--fs-section)' }}>Vehicle-wise</h2>
        <span style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>{filterNote}</span>
      </div>
      <div className="scroll-x" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
        <table className="table" style={{ minWidth: 940 }}>
          <thead>
            <tr>
              {sortHeader('id', 'Vehicle')}
              {sortHeader('model', 'Model')}
              {sortHeader('trips', 'Trips', 'right')}
              {sortHeader('km', 'KM', 'right')}
              {sortHeader('tons', 'Tons', 'right')}
              {sortHeader('tripExpense', 'Trip expense', 'right')}
              {sortHeader('monthly', 'Monthly expense', 'right')}
              {sortHeader('revenue', 'Revenue', 'right')}
              {sortHeader('profit', 'Profit', 'right')}
              {sortHeader('costPerKm', '₹/km', 'right')}
            </tr>
          </thead>
          <tbody>
            {sortedByVehicle.map((b) => (
              <tr key={b.id}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{b.id}</td>
                <td style={{ color: 'var(--color-neutral-700)' }}>{b.model}</td>
                <td style={{ textAlign: 'right' }}>{formatNum(b.trips)}</td>
                <td style={{ textAlign: 'right' }}>{formatNum(b.km)}</td>
                <td style={{ textAlign: 'right' }}>{formatNum(b.tons, 2)}</td>
                <td style={{ textAlign: 'right' }}>{rupees(b.ledgerTripExpense)}</td>
                <td style={{ textAlign: 'right' }}>{rupees(b.ledgerMonthly)}</td>
                <td style={{ textAlign: 'right' }}>{rupees(b.revenue)}</td>
                <td style={{ textAlign: 'right' }}>
                  <span style={{ color: b.profit >= 0 ? 'var(--color-profit)' : 'var(--color-accent-700)', fontWeight: 700 }}>{rupees(b.profit)}</span>
                </td>
                <td style={{ textAlign: 'right' }}>{b.km ? rupees(b.cost / b.km) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
