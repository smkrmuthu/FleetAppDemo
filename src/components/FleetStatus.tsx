import { Truck, User } from 'lucide-react';
import { formatNum } from '../utils/calc';
import type { TruckRow, TruckState } from '../utils/fleetStatus';
import { StatusBadge, type Tone } from './ui';

const STATE: Record<TruckState, { label: string; tone: Tone }> = {
  road: { label: 'On the road', tone: 'success' },
  pending: { label: 'Awaiting approval', tone: 'warning' },
  idle: { label: 'Idle', tone: 'neutral' },
  offroad: { label: 'Off the road', tone: 'neutral' }
};

const CAPTION: Record<NonNullable<TruckRow['routeKind']>, (date: string) => string> = {
  live: (d) => `In progress · loaded ${d}`,
  pending: (d) => `Completed · loaded ${d} · awaiting approval`,
  last: (d) => `Last movement · loaded ${d}`
};

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

// One card per truck: what it is doing now, its route, and its numbers for the
// selected period. Only recorded movements and availability feed this; there
// is no live tracking behind it.
export function FleetStatus({ rows }: { rows: TruckRow[] }) {
  return <div className="fleet-grid">{rows.map((r) => <TruckCard key={r.id} row={r} />)}</div>;
}
