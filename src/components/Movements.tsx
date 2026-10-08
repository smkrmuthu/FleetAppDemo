import { useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import type { Role, Trip } from '../types';
import { parseDisplayDate } from '../lib/api';
import { formatNum, todayIso } from '../utils/calc';
import { Pager, usePaging } from './Pager';
import { DataTable, EmptyState, FilterBar, FormField, GhostButton, KpiCard, PageHeader, PrimaryButton, SecondaryButton, TripStatusBadge } from './ui';

interface Props {
  trips: Trip[];
  role: Role;
  onAddMovement: () => void;
  onEdit: (t: Trip) => void;
  onDelete: (t: Trip) => void;
  onOpenTripLog: () => void;
}

// Whole days between a "YYYY-MM-DD" date and today.
function daysSince(iso: string): number | null {
  if (!iso) return null;
  const start = new Date(`${iso}T00:00:00`);
  const today = new Date(`${todayIso()}T00:00:00`);
  return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86_400_000));
}

// Movements still in progress: drafts being filled in and completed trips
// waiting for approval. Approved movements live in the Trip Log.
export function Movements({ trips, role, onAddMovement, onEdit, onDelete, onOpenTripLog }: Props) {
  const [status, setStatus] = useState<'all' | 'draft' | 'pending'>('all');
  const [vehicle, setVehicle] = useState('all');
  const isDriver = role === 'Driver';

  const open = trips.filter((t) => t.status !== 'approved');
  const rows = open
    .filter((t) => (status === 'all' || t.status === status) && (vehicle === 'all' || t.vehicle === vehicle))
    .map((t) => ({ t, iso: parseDisplayDate(t.loadDate) }))
    .sort((a, b) => a.iso.localeCompare(b.iso));
  const drafts = open.filter((t) => t.status === 'draft').length;
  const pending = open.filter((t) => t.status === 'pending').length;
  const oldest = open.reduce<number | null>((max, t) => {
    const d = daysSince(parseDisplayDate(t.loadDate));
    return d === null ? max : Math.max(max ?? 0, d);
  }, null);
  const vehicleOptions = [...new Set(open.map((t) => t.vehicle))].sort();
  const paging = usePaging(rows.length, `${status}|${vehicle}`);

  return (
    <section>
      <PageHeader
        eyebrow={`Operations · ${open.length} open`}
        title="Movements"
        description="Movements still in progress: drafts being filled in on the road, and completed trips waiting for approval. Approved movements move to the Trip Log."
        actions={
          <>
            <SecondaryButton onClick={onOpenTripLog}>Trip Log</SecondaryButton>
            <PrimaryButton icon={<Plus size={16} />} onClick={onAddMovement}>Add Movement</PrimaryButton>
          </>
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 'var(--space-4)' }}>
        <KpiCard label="Open movements" value={formatNum(open.length)} sub="Drafts and pending approval" />
        <KpiCard label="Drafts" value={formatNum(drafts)} sub="Still being filled in" />
        <KpiCard label="Pending approval" value={formatNum(pending)} sub="Completed, not yet approved" />
        <KpiCard label="Oldest open" value={oldest === null ? '—' : formatNum(oldest)} unit={oldest === null ? undefined : oldest === 1 ? 'day' : 'days'} sub="Since loading date" />
      </div>

      <FilterBar style={{ marginBottom: 'var(--space-4)' }}>
        <FormField label="Status" htmlFor="mv-status">
          <select id="mv-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All open</option>
            <option value="draft">Drafts</option>
            <option value="pending">Pending approval</option>
          </select>
        </FormField>
        <FormField label="Vehicle" htmlFor="mv-vehicle">
          <select id="mv-vehicle" className="input" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
            <option value="all">All vehicles</option>
            {vehicleOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </FormField>
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState>
          {open.length === 0 ? 'Nothing in progress — every movement is approved.' : 'No open movements match these filters.'}
        </EmptyState>
      ) : (
        <>
        <DataTable minWidth={880}>
          <thead>
            <tr>
              <th>Trip No.</th>
              <th>Loading date</th>
              <th>Vehicle</th>
              <th>Driver</th>
              <th>Route</th>
              <th className="num">Open for</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paging.slice(rows).map(({ t, iso }) => {
              const days = daysSince(iso);
              return (
                <tr key={t.id}>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>{t.waybillNo}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{t.loadDate}</td>
                  <td className="cell-strong" style={{ whiteSpace: 'nowrap' }}>{t.vehicle}</td>
                  <td>{t.driver}</td>
                  <td style={{ color: 'var(--color-text-secondary)' }}>
                    {t.from || '—'} <ArrowRight size={12} style={{ verticalAlign: -1 }} aria-label="to" /> {t.to || '—'}
                  </td>
                  <td className="num" style={{ color: days !== null && days > 7 ? 'var(--color-warning-text)' : undefined, fontWeight: days !== null && days > 7 ? 600 : undefined }}>
                    {days === null ? '—' : `${formatNum(days)} ${days === 1 ? 'day' : 'days'}`}
                  </td>
                  <td><TripStatusBadge status={t.status} short /></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <GhostButton size="sm" onClick={() => onEdit(t)}>Open</GhostButton>
                    {(t.status === 'draft' || !isDriver) && (
                      <GhostButton size="sm" onClick={() => onDelete(t)} style={{ color: 'var(--color-text-secondary)' }}>Delete</GhostButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
        <Pager attached page={paging.page} pageSize={paging.size} total={rows.length} onPage={paging.setPage} />
        </>
      )}
      {!isDriver && pending > 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 'var(--space-3)' }}>
          Approve completed movements from the <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={onOpenTripLog}>Trip Log</button> — it shows the full review before approval.
        </p>
      )}
    </section>
  );
}
