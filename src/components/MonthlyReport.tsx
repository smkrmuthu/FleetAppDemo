import type { DriverMaster, MonthlyExpense, Trip, Vehicle } from '../types';
import { aggregateByVehicle } from '../utils/aggregate';
import { dateInRange, formatDateRange, formatNum, rupees, tripCost, yearOptions } from '../utils/calc';
import { MonthYearFilter } from './MonthYearFilter';
import { exportReportExcel, exportReportPdf, type ReportData, type Stat } from '../lib/reports';
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

export function MonthlyReport({ trips: allTrips, expenses: allExpenses, vehicles, drivers, vehicleFilter, driverFilter, dateFrom, dateTo, onVehicleFilter, onDriverFilter, onDateFrom, onDateTo, onResetFilters }: Props) {
  const trips = allTrips.filter(
    (t) => (vehicleFilter === 'all' || t.vehicle === vehicleFilter) &&
      (!driverFilter || t.driver === driverFilter) &&
      dateInRange(t.loadDate, dateFrom, dateTo)
  );
  const expenses = allExpenses.filter((e) => dateInRange(e.date, dateFrom, dateTo));
  const rangeLabel = formatDateRange(dateFrom, dateTo);

  const totals = trips.reduce(
    (a, t) => {
      const c = tripCost(t);
      a.tons += t.tons;
      a.exp += c.expense;
      a.rev += t.revenue;
      return a;
    },
    { tons: 0, exp: 0, rev: 0 }
  );
  const monthlyTotal = expenses.reduce((a, e) => a + e.amount, 0);
  const profit = totals.rev - totals.exp - monthlyTotal;

  const byVehicle = aggregateByVehicle(trips, expenses, vehicles);
  const maxPerKm = Math.max(...byVehicle.map((b) => (b.km ? b.cost / b.km : 0)), 1);

  const totalCost = totals.exp + monthlyTotal;
  const costPerTon = totals.tons ? totalCost / totals.tons : 0;
  const headline: (Stat & { pos?: boolean })[] = [
    { label: 'Revenue', value: rupees(totals.rev), raw: totals.rev, fmt: 'money', note: `${trips.length} movements billed` },
    { label: 'Total cost', value: rupees(totalCost), raw: totalCost, fmt: 'money', note: 'haulage + fixed' },
    { label: 'Profit', value: rupees(profit), raw: profit, fmt: 'money', note: 'before overheads', pos: profit >= 0 },
    { label: 'Cost / ton', value: totals.tons ? rupees(costPerTon) : '₹0', raw: costPerTon, fmt: 'money', note: 'all-in' }
  ];

  const { busy, error, run } = useExport();
  const exportData = (): ReportData => ({
    period: { from: dateFrom, to: dateTo, label: rangeLabel },
    headline, byVehicle, trips, expenses
  });

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div className="kicker">Manager only · {rangeLabel}</div>
          <h1 style={{ fontSize: 34, letterSpacing: '-0.02em' }}>Monthly Report</h1>
          <p style={{ color: 'var(--color-neutral-700)', marginTop: 6, fontSize: 13 }}>The full financial picture — revenue, cost, profit and per-vehicle economics.</p>
        </div>
        <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => run('xlsx', () => exportReportExcel(exportData()))}>
              {busy === 'xlsx' ? 'Preparing…' : 'Export Excel'}
            </button>
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => run('pdf', () => exportReportPdf(exportData()))}>
              {busy === 'pdf' ? 'Preparing…' : 'Print / Save PDF'}
            </button>
          </div>
          {error && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 12 }}>{error}</div>}
        </div>
      </div>

      <div style={{ border: '2px solid var(--color-divider)', padding: 16, marginBottom: 20 }}>
        <div className="filters-grid">
          <div className="field"><label>Loading date from</label><input className="input" type="date" value={dateFrom} onChange={(e) => onDateFrom(e.target.value)} /></div>
          <div className="field"><label>Loading date to</label><input className="input" type="date" value={dateTo} onChange={(e) => onDateTo(e.target.value)} /></div>
          <MonthYearFilter dateFrom={dateFrom} dateTo={dateTo} onDateFrom={onDateFrom} onDateTo={onDateTo} years={yearOptions([...allTrips.map((t) => t.loadDate), ...allExpenses.map((e) => e.date)])} />
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 2, background: 'var(--color-divider)', border: '2px solid var(--color-divider)', marginBottom: 26 }}>
        {headline.map((h) => (
          <div key={h.label} style={{ background: 'var(--color-bg)', padding: 20 }}>
            <div className="stat-label">{h.label}</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 34, letterSpacing: '-0.02em', lineHeight: 1, color: h.label === 'Profit' ? (h.pos ? 'var(--color-profit)' : 'var(--color-accent-700)') : undefined }}>{h.value}</div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 8 }}>{h.note}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 20, marginBottom: 12 }}>Cost per kilometre, by vehicle</h2>
      <div style={{ border: '2px solid var(--color-divider)', padding: 20, marginBottom: 28 }}>
        {byVehicle.map((b) => {
          const perKm = b.km ? b.cost / b.km : 0;
          return (
            <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) 90px', alignItems: 'center', gap: 14, padding: '9px 0', borderBottom: '1px solid var(--color-neutral-300)' }}>
              <div style={{ fontWeight: 600 }}>{b.id}</div>
              <div style={{ height: 18, background: 'var(--color-neutral-200)' }}>
                <div style={{ height: 18, background: 'var(--color-accent)', width: `${Math.round((perKm / maxPerKm) * 100)}%` }} />
              </div>
              <div style={{ textAlign: 'right', fontWeight: 700 }}>{rupees(perKm)}/km</div>
            </div>
          );
        })}
      </div>

      <h2 style={{ fontSize: 20, marginBottom: 12 }}>Vehicle-wise ledger</h2>
      <div className="scroll-x" style={{ border: '2px solid var(--color-divider)' }}>
        <table className="table" style={{ minWidth: 1100 }}>
          <thead>
            <tr>
              <th>Vehicle</th><th style={{ textAlign: 'right' }}>Trips</th><th style={{ textAlign: 'right' }}>KM</th>
              <th style={{ textAlign: 'right' }}>Tons</th><th style={{ textAlign: 'right' }}>Diesel</th>
              <th style={{ textAlign: 'right' }}>Toll</th><th style={{ textAlign: 'right' }}>Other</th>
              <th style={{ textAlign: 'right' }}>Monthly</th><th style={{ textAlign: 'right' }}>Total cost</th>
              <th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Profit</th><th style={{ textAlign: 'right' }}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {byVehicle.map((b) => (
              <tr key={b.id}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{b.id}</td>
                <td style={{ textAlign: 'right' }}>{formatNum(b.trips)}</td>
                <td style={{ textAlign: 'right' }}>{formatNum(b.km)}</td>
                <td style={{ textAlign: 'right' }}>{formatNum(b.tons, 1)}</td>
                <td style={{ textAlign: 'right' }}>{rupees(b.diesel)}</td>
                <td style={{ textAlign: 'right' }}>{rupees(b.ledgerToll)}</td>
                <td style={{ textAlign: 'right' }}>{rupees(b.other)}</td>
                <td style={{ textAlign: 'right' }}>{rupees(b.ledgerMonthly)}</td>
                <td style={{ textAlign: 'right' }}>{rupees(b.cost)}</td>
                <td style={{ textAlign: 'right' }}>{rupees(b.revenue)}</td>
                <td style={{ textAlign: 'right' }}>
                  <span style={{ color: b.profit >= 0 ? 'var(--color-profit)' : 'var(--color-accent-700)', fontWeight: 700 }}>{rupees(b.profit)}</span>
                </td>
                <td style={{ textAlign: 'right' }}>{b.revenue ? Math.round((b.profit / b.revenue) * 100) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
