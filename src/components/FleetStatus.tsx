import { useMemo, useState } from 'react';
import { LayoutGrid, List, Search, Truck, User } from 'lucide-react';
import { formatNum } from '../utils/calc';
import type { TruckRow, TruckState } from '../utils/fleetStatus';
import { Pager } from './Pager';
import { StatusBadge, type Tone } from './ui';

const STATE: Record<TruckState, { label: string; tone: Tone; color: string }> = {
  road: { label: 'On the road', tone: 'success', color: 'var(--color-success)' },
  pending: { label: 'Awaiting approval', tone: 'warning', color: 'var(--color-warning)' },
  idle: { label: 'Idle', tone: 'neutral', color: 'var(--chart-neutral)' },
  offroad: { label: 'Off the road', tone: 'neutral', color: 'var(--color-text-secondary)' }
};
const ORDER: TruckState[] = ['road', 'pending', 'offroad', 'idle'];

const CAPTION: Record<NonNullable<TruckRow['routeKind']>, (date: string) => string> = {
  live: (d) => `In progress · loaded ${d}`,
  pending: (d) => `Completed · loaded ${d} · awaiting approval`,
  last: (d) => `Last movement · loaded ${d}`
};

const CARDS_STEP = 12;
const LIST_PAGE = 20;

type Filter = 'all' | TruckState | 'flagged';

function TruckCard({ row }: { row: TruckRow }) {
  const s = STATE[row.state];
  return (
    <div className="card truck-card" data-state={row.state}>
      <div className="truck-head">
        <div style={{ minWidth: 0 }}>
          <div className="truck-reg">{row.id}</div>
          <div className="truck-model">{row.model || '—'}</div>
        </div>
        <StatusBadge tone={s.tone} dot>{s.label}</StatusBadge>
      </div>

      {row.routeKind ? (
        <div>
          <div className="route-line" aria-hidden="true">
            <span className="route-dot" />
            <span className="route-track" />
            {row.state === 'road' && <Truck size={16} strokeWidth={2} style={{ color: 'var(--color-success)' }} />}
            {row.state === 'road' && <span className="route-track" />}
            <span className="route-dot end" />
          </div>
          <div className="route-labels"><span title={row.from}>{row.from || '—'}</span><span title={row.to}>{row.to || '—'}</span></div>
          <div className="route-caption">{CAPTION[row.routeKind](row.tripDate)}</div>
        </div>
      ) : (
        <div className="route-caption" style={{ fontSize: 12 }}>No movements recorded yet.</div>
      )}

      <div className="truck-stats">
        <div><div className="truck-stat-value">{formatNum(row.periodTrips)}</div><div className="truck-stat-label">Trips</div></div>
        <div><div className="truck-stat-value">{formatNum(row.periodKm)}</div><div className="truck-stat-label">KM</div></div>
        <div><div className="truck-stat-value">{row.periodMileage ? row.periodMileage.toFixed(2) : '—'}</div><div className="truck-stat-label">km/L</div></div>
      </div>

      <div className="truck-foot">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <User size={14} aria-hidden="true" />{row.driver || 'No driver assigned'}
        </span>
        {row.flags.length > 0 && (
          <span className="truck-chips">
            {row.flags.map((f) => <StatusBadge key={f.label} tone={f.expired ? 'error' : 'warning'}>{f.label}</StatusBadge>)}
          </span>
        )}
      </div>
    </div>
  );
}

// The fleet at a glance, then the trucks. With a handful of trucks every one
// gets a card; with hundreds you start from the counts (click one to filter),
// search by registration, driver, model or place, and open more as needed.
// Only recorded movements and availability feed this; there is no live tracking.
export function FleetStatus({ rows }: { rows: TruckRow[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [shown, setShown] = useState(CARDS_STEP);
  const [page, setPage] = useState(0);

  const counts = useMemo(() => {
    const c: Record<TruckState, number> = { road: 0, pending: 0, idle: 0, offroad: 0 };
    let flagged = 0;
    for (const r of rows) { c[r.state]++; if (r.flags.length) flagged++; }
    return { ...c, flagged };
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => filter === 'all' || (filter === 'flagged' ? r.flags.length > 0 : r.state === filter))
      .filter((r) => !q || [r.id, r.model, r.driver, r.from, r.to].some((x) => x.toLowerCase().includes(q)))
      // busiest first: on the road, awaiting approval, off the road, idle; then those with alerts
      .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || Number(b.flags.some((f) => f.expired)) - Number(a.flags.some((f) => f.expired)) || b.flags.length - a.flags.length || a.id.localeCompare(b.id));
  }, [rows, filter, query]);

  const choose = (f: Filter) => { setFilter(f); setShown(CARDS_STEP); setPage(0); };
  const compact = rows.length <= CARDS_STEP;
  const chips: { key: Filter; label: string; n: number; color?: string }[] = [
    { key: 'all', label: 'All trucks', n: rows.length },
    ...ORDER.map((s) => ({ key: s as Filter, label: STATE[s].label, n: counts[s], color: STATE[s].color })),
    { key: 'flagged', label: 'Alerts', n: counts.flagged, color: 'var(--color-error)' }
  ];

  return (
    <div className="fleet-status">
      {!compact && (
        <div className="card fleet-summary">
          <div className="state-bar" role="img" aria-label={ORDER.map((s) => `${counts[s]} ${STATE[s].label.toLowerCase()}`).join(', ')}>
            {ORDER.map((s) => counts[s] > 0 && <span key={s} style={{ flex: counts[s], background: STATE[s].color }} title={`${STATE[s].label}: ${counts[s]}`} />)}
          </div>
          <div className="state-chips">
            {chips.map((c) => (
              <button key={c.key} type="button" className="state-chip" aria-pressed={filter === c.key} onClick={() => choose(c.key)}>
                {c.color && <i style={{ background: c.color }} />}
                <b>{formatNum(c.n)}</b> {c.label}
              </button>
            ))}
          </div>
          <div className="fleet-toolbar">
            <label className="fleet-search">
              <Search size={15} aria-hidden="true" />
              <input className="input" type="search" placeholder="Search truck, driver, model or place" value={query}
                onChange={(e) => { setQuery(e.target.value); setShown(CARDS_STEP); setPage(0); }} aria-label="Search trucks" />
            </label>
            <div className="view-toggle" role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')}><LayoutGrid size={14} /> Cards</button>
              <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={14} /> List</button>
            </div>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)' }}>No trucks match.</div>
      ) : view === 'cards' || compact ? (
        <>
          <div className="fleet-grid">{visible.slice(0, compact ? undefined : shown).map((r) => <TruckCard key={r.id} row={r} />)}</div>
          {!compact && visible.length > shown && (
            <div className="show-more">
              <span>Showing {Math.min(shown, visible.length)} of {formatNum(visible.length)} trucks</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShown(shown + CARDS_STEP)}>Show {Math.min(CARDS_STEP, visible.length - shown)} more</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView('list')}>Open as list</button>
            </div>
          )}
        </>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="scroll-x">
            <table className="table" style={{ minWidth: 860 }}>
              <thead>
                <tr><th>Truck</th><th>Status</th><th>Driver</th><th>Route</th><th className="num">Trips</th><th className="num">KM</th><th className="num">km/L</th><th>Alerts</th></tr>
              </thead>
              <tbody>
                {visible.slice(page * LIST_PAGE, (page + 1) * LIST_PAGE).map((r) => (
                  <tr key={r.id}>
                    <td className="cell-strong" style={{ whiteSpace: 'nowrap' }}>{r.id}<div className="truck-model">{r.model || '—'}</div></td>
                    <td><StatusBadge tone={STATE[r.state].tone} dot>{STATE[r.state].label}</StatusBadge></td>
                    <td>{r.driver || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.from ? `${r.from} → ${r.to}` : '—'}</td>
                    <td className="num">{formatNum(r.periodTrips)}</td>
                    <td className="num">{formatNum(r.periodKm)}</td>
                    <td className="num">{r.periodMileage ? r.periodMileage.toFixed(2) : '—'}</td>
                    <td><span className="truck-chips">{r.flags.map((f) => <StatusBadge key={f.label} tone={f.expired ? 'error' : 'warning'}>{f.label}</StatusBadge>)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={LIST_PAGE} total={visible.length} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
