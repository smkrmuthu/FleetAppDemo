import { Fragment, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { TripStatusBadge } from './ui';
import type { DriverLeave, DriverMaster, Role, Trip, Vehicle, VehicleUnavailability } from '../types';
import { formFromTrip } from './AddMovement';
import { MovementReview } from './MovementReview';
import { DualScroll } from './DualScroll';
import { exportTripLog } from '../lib/reports';
import { useExport } from '../lib/useExport';
import { TRIP_EXPENSE_LABEL } from '../data/mockData';
import { fetchDocumentBlobUrl, parseDisplayDate } from '../lib/api';
import { dateInRange, formatDateRange, formatDuration, formatNum, overlappingUnavailability, rupees, tripCost, tripDurationDays, yearOptions } from '../utils/calc';
import { MonthYearFilter } from './MonthYearFilter';
import { SortableTh, type SortDir } from './SortableTh';

const DETAIL_COLUMNS = 9; // Trip No., Loading date, Duration, Vehicle, Driver, Tons, Odo Meter start, KM, Status

// Everything that used to sit in its own column — item no., the fuel/expense
// breakdown, revenue/profit, odometer, docs, remarks — now lives here,
// opened per trip instead of stretching the table sideways for everyone.
function TripDetailBody({ t, showFinancials }: { t: Trip; showFinancials: boolean }) {
  const c = tripCost(t);
  const [openingDoc, setOpeningDoc] = useState<string | null>(null);
  const [docError, setDocError] = useState('');
  async function openDocument(docId: string) {
    setOpeningDoc(docId);
    setDocError('');
    try {
      window.open(await fetchDocumentBlobUrl(t.id, docId), '_blank');
    } catch {
      setDocError('Could not open that file — try again.');
    } finally {
      setOpeningDoc(null);
    }
  }
  const dash = (v: string) => (v === '—' ? '' : v);
  const stat = (label: string, value: string) => (
    <div>
      <div className="stat-label" style={{ marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
  return (
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
            {stat('Trip no.', t.waybillNo)}
            {stat('Loading date', t.loadDate)}
            {stat('Unloading date', t.unloadDate)}
            {stat('Item no.', dash(t.itemNo) || '—')}
            {stat('Transporter', t.transporter || '—')}
            {stat('Odometer', t.odoStart != null && t.odoEnd != null ? `${formatNum(t.odoStart)} → ${formatNum(t.odoEnd)} km` : '—')}
            {stat('Diesel', rupees(c.diesel))}
            {stat('AdBlue', c.adblue ? rupees(c.adblue) : '—')}
            {stat('Other', rupees(c.other))}
            {stat('Trip expense', rupees(c.expense))}
            {showFinancials && stat('Revenue', rupees(t.revenue))}
            {showFinancials && stat('Profit', rupees(c.profit))}
            {stat('Documents', t.documents.length ? String(t.documents.length) : '—')}
          </div>

          <div>
            <div className="stat-label" style={{ marginBottom: 6 }}>Route</div>
            <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              <div><strong>A</strong> — {dash(t.from) || '—'}{t.fromNote && <span style={{ color: 'var(--color-neutral-700)' }}> ({t.fromNote})</span>}</div>
              {t.stops.map((st, i) => (
                <div key={st.id}>
                  <strong>{i + 1}</strong> — {st.location}{st.odo ? ` · ${formatNum(st.odo)} km` : ''}{st.note && <span style={{ color: 'var(--color-neutral-700)' }}> ({st.note})</span>}
                </div>
              ))}
              <div><strong>B</strong> — {dash(t.to) || '—'}{t.toNote && <span style={{ color: 'var(--color-neutral-700)' }}> ({t.toNote})</span>}</div>
            </div>
          </div>

          {t.expenses.length > 0 && (
            <div>
              <div className="stat-label" style={{ marginBottom: 6 }}>Fuel &amp; expense entries</div>
              <div style={{ display: 'grid', gap: 3, fontSize: 13 }}>
                {t.expenses.map((l) => (
                  <div key={l.id} style={{ color: 'var(--color-neutral-700)' }}>
                    {l.date} — {TRIP_EXPENSE_LABEL[l.kind]}
                    {l.litres != null ? ` · ${l.litres.toFixed(2)} L${l.ratePerLitre != null ? ` × ₹${l.ratePerLitre.toFixed(2)}` : ''}` : ''}
                    {l.details ? ` — ${l.details}` : ''}
                    {' — '}<strong style={{ color: 'var(--color-text)' }}>{rupees(l.amount)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {t.documents.length > 0 && (
            <div>
              <div className="stat-label" style={{ marginBottom: 6 }}>Documents</div>
              <div style={{ display: 'grid', gap: 2, fontSize: 13, color: 'var(--color-neutral-700)' }}>
                {t.documents.map((d) => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{d.filename}</span>
                    <button type="button" className="btn btn-ghost" style={{ padding: '0 4px', fontSize: 12 }} disabled={openingDoc === d.id} onClick={() => openDocument(d.id)}>
                      {openingDoc === d.id ? 'Opening…' : 'View'}
                    </button>
                  </div>
                ))}
                {docError && <div role="alert" style={{ color: 'var(--color-accent-700)' }}>{docError}</div>}
              </div>
            </div>
          )}

          {dash(t.remarks ?? '') && (
            <div>
              <div className="stat-label" style={{ marginBottom: 4 }}>Remarks</div>
              <div style={{ fontSize: 13 }}>{t.remarks}</div>
            </div>
          )}
        </div>
  );
}

function TripDetail({ t, showFinancials }: { t: Trip; showFinancials: boolean }) {
  return (
    <tr>
      <td colSpan={DETAIL_COLUMNS} style={{ background: 'var(--color-surface)', padding: '16px 20px 20px' }}>
        <TripDetailBody t={t} showFinancials={showFinancials} />
      </td>
    </tr>
  );
}

interface Props {
  trips: Trip[];
  vehicles: Vehicle[];
  drivers: DriverMaster[];
  leaves: DriverLeave[];
  unavailability: VehicleUnavailability[];
  vehicleFilter: string;
  driverFilter: string;
  dateFrom: string;
  dateTo: string;
  onVehicleFilter: (v: string) => void;
  onDriverFilter: (v: string) => void;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
  onResetFilters: () => void;
  onAddMovement: () => void;
  onApprove: (tripId: string) => Promise<void>;
  onBackup: () => Promise<void>;
  onEdit: (trip: Trip) => void;
  onDelete: (trip: Trip) => void;
  role: Role;
}

export function TripLog({ trips, vehicles, drivers, leaves, unavailability, vehicleFilter, driverFilter, dateFrom, dateTo, onVehicleFilter, onDriverFilter, onDateFrom, onDateTo, onResetFilters, onAddMovement, onApprove, onBackup, onEdit, onDelete, role }: Props) {
  const isDriver = role === 'Driver';
  const isOffice = role === 'Office';
  const isManager = role === 'Manager';
  const showFinancials = !isDriver;
  const showActions = !isDriver;
  const { busy: exporting, error: exportError, run: runExport } = useExport();
  const [completing, setCompleting] = useState<Trip | null>(null);
  const [completingBusy, setCompletingBusy] = useState(false);
  const [viewing, setViewing] = useState<Trip | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (!completing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !completingBusy) setCompleting(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [completing, completingBusy]);

  // What's still missing before a movement can be completed (mirrors the server's checks).
  function completionBlockers(t: Trip): string[] {
    const out: string[] = [];
    if (!t.tons) out.push('Loading weight is required.');
    if (!t.odoStart) out.push('Odometer start is required.');
    if (!t.odoEnd) out.push('Odometer end is required.');
    else if (t.odoStart && t.odoEnd <= t.odoStart) out.push('Odometer end must be greater than odometer start.');
    t.stops.forEach((st, i) => { if (!st.odo) out.push(`Odometer reading is required at stop ${i + 1} (${st.location}).`); });
    const vehicleConflicts = overlappingUnavailability(unavailability, t.vehicle, t.loadDate, t.unloadDate);
    if (vehicleConflicts.length > 0) out.push(`${t.vehicle} is recorded unavailable during these dates.`);
    return out;
  }

  async function confirmComplete(t: Trip) {
    setCompletingBusy(true);
    await onApprove(t.id);
    setCompletingBusy(false);
    setCompleting(null);
  }

  // Always sorted by loading date (never raw entry order) — entry order
  // grouped trips by whichever vehicle was being logged in one sitting,
  // which read as random once loading dates were the thing being scanned.
  type SortKey = 'tripNo' | 'loadDate' | 'duration' | 'vehicle' | 'driver' | 'tons' | 'odoStart' | 'km' | 'status';
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'loadDate', dir: 'desc' });
  function toggleSort(key: SortKey) {
    // A new column starts ascending; clicking the same column flips it.
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }
  const STATUS_RANK: Record<string, number> = { draft: 0, pending: 1, approved: 2 };
  function sortValue(t: Trip, key: SortKey): number | string {
    switch (key) {
      case 'tripNo': return t.waybillNo;
      case 'loadDate': return parseDisplayDate(t.loadDate);
      case 'duration': return tripDurationDays(t.loadDate, t.unloadDate) ?? -1;
      case 'vehicle': return t.vehicle;
      case 'driver': return t.driver;
      case 'tons': return t.tons;
      case 'odoStart': return t.odoStart ?? -1;
      case 'km': return t.km;
      case 'status': return STATUS_RANK[t.status] ?? 0;
    }
  }
  const filteredRows = trips.filter(
    (t) => (vehicleFilter === 'all' || t.vehicle === vehicleFilter) &&
      (!driverFilter || t.driver === driverFilter) &&
      dateInRange(t.loadDate, dateFrom, dateTo)
  );
  const rows = [...filteredRows].sort((a, b) => {
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    let cmp = typeof av === 'string' ? av.localeCompare(bv as string, undefined, { numeric: true }) : (av as number) - (bv as number);
    if (cmp === 0 && sort.key !== 'loadDate') cmp = -parseDisplayDate(a.loadDate).localeCompare(parseDisplayDate(b.loadDate));
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div className="kicker">{rows.length} movements · {formatDateRange(dateFrom, dateTo)}</div>
          <h1>Trip Log</h1>
          <p style={{ color: 'var(--color-neutral-700)', marginTop: 6, fontSize: 13 }}>Every movement in one place — open a draft to complete it, or delete what's still open. Completed movements can be viewed by everyone; only a Manager can correct them.</p>
        </div>
        {showActions && (
          <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button" className="btn btn-secondary" disabled={!!exporting}
              onClick={() => runExport('xlsx', () => exportTripLog(
                rows, showFinancials,
                { from: dateFrom, to: dateTo, label: formatDateRange(dateFrom, dateTo) },
                `Vehicle: ${vehicleFilter === 'all' ? 'all' : vehicleFilter}   Driver: ${driverFilter || 'all'}`
              ))}
            >
              {exporting === 'xlsx' ? 'Preparing…' : 'Export Excel'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={!!exporting} onClick={() => runExport('backup', onBackup)}>
              {exporting === 'backup' ? 'Preparing backup…' : 'Backup data'}
            </button>
            <button type="button" className="btn btn-primary" onClick={onAddMovement}><Plus size={16} aria-hidden="true" />Add Movement</button>
            </div>
            {exportError && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 12 }}>{exportError}</div>}
          </div>
        )}
      </div>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20, background: 'var(--color-surface)' }}>
        <div className="filters-grid">
          <div className="field"><label>Loading date from</label><input className="input" type="date" value={dateFrom} onChange={(e) => onDateFrom(e.target.value)} /></div>
          <div className="field"><label>Loading date to</label><input className="input" type="date" value={dateTo} onChange={(e) => onDateTo(e.target.value)} /></div>
          <MonthYearFilter dateFrom={dateFrom} dateTo={dateTo} onDateFrom={onDateFrom} onDateTo={onDateTo} years={yearOptions(trips.map((t) => t.loadDate))} />
          <div className="field">
            <label>Vehicle</label>
            <select className="input" value={vehicleFilter} onChange={(e) => onVehicleFilter(e.target.value)}>
              <option value="all">All vehicles</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
            </select>
          </div>
          {!isDriver && (
            <div className="field">
              <label>Driver</label>
              <select className="input" value={driverFilter} onChange={(e) => onDriverFilter(e.target.value)}>
                <option value="">All drivers</option>
                {drivers.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
            </div>
          )}
          <button type="button" className="btn btn-ghost" style={{ justifySelf: 'start' }} onClick={onResetFilters}>Reset filters</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, color: 'var(--color-neutral-700)', background: 'var(--color-surface)' }}>
          No movements match the selected filters.
        </div>
      ) : (
        <DualScroll>
          <table className="table" style={{ minWidth: 1020 }}>
            <thead>
              <tr>
                <SortableTh className="col-first" label="Trip No." active={sort.key === 'tripNo'} dir={sort.dir} onSort={() => toggleSort('tripNo')} />
                <SortableTh label="Loading Date" active={sort.key === 'loadDate'} dir={sort.dir} onSort={() => toggleSort('loadDate')} />
                <SortableTh label="Duration" active={sort.key === 'duration'} dir={sort.dir} onSort={() => toggleSort('duration')} />
                <SortableTh label="Vehicle" active={sort.key === 'vehicle'} dir={sort.dir} onSort={() => toggleSort('vehicle')} />
                <SortableTh label="Driver" active={sort.key === 'driver'} dir={sort.dir} onSort={() => toggleSort('driver')} />
                <SortableTh label="Tons" align="right" active={sort.key === 'tons'} dir={sort.dir} onSort={() => toggleSort('tons')} />
                <SortableTh label="Odo Meter start" align="right" active={sort.key === 'odoStart'} dir={sort.dir} onSort={() => toggleSort('odoStart')} />
                <SortableTh label="KM" align="right" active={sort.key === 'km'} dir={sort.dir} onSort={() => toggleSort('km')} />
                <SortableTh label="Status" active={sort.key === 'status'} dir={sort.dir} onSort={() => toggleSort('status')} />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const isOpen = expanded.has(t.id);
                return (
                  <Fragment key={t.id}>
                    <tr>
                      <td className="col-first" style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            type="button" className="btn btn-ghost" onClick={() => toggleExpanded(t.id)}
                            aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${t.waybillNo}`}
                            style={{ padding: '2px 6px', fontSize: 12, lineHeight: 1 }}
                          >
                            {isOpen ? '▾' : '▸'}
                          </button>
                          <span style={{ fontWeight: 600 }}>{t.waybillNo}</span>
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{t.loadDate}</td>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--color-neutral-700)' }}>{formatDuration(tripDurationDays(t.loadDate, t.unloadDate))}</td>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{t.vehicle}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{t.driver}</td>
                      <td style={{ textAlign: 'right' }}>{formatNum(t.tons, 2)}</td>
                      <td style={{ textAlign: 'right' }}>{t.odoStart != null ? formatNum(t.odoStart) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{formatNum(t.km)}</td>
                      <td style={{ minWidth: 200 }}>
                        {t.status !== 'approved' ? (
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px' }}>
                            <TripStatusBadge status={t.status} short />
                            {(isDriver || isOffice || isManager) && (
                              <button type="button" className="btn btn-ghost" style={{ padding: '0 6px', fontSize: 12 }} onClick={() => onEdit(t)}>
                                Edit
                              </button>
                            )}
                            {!isDriver && (
                              <button type="button" className="btn btn-ghost" style={{ padding: '0 6px', fontSize: 12 }} onClick={() => setCompleting(t)}>
                                Complete Trip
                              </button>
                            )}
                            {(t.status === 'draft' || !isDriver) && (
                              <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12, color: 'var(--color-accent-700)' }} onClick={() => onDelete(t)}>
                                Delete
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px' }}>
                            <TripStatusBadge status="approved" />
                            {isManager ? (
                              <button type="button" className="btn btn-ghost" style={{ padding: '0 6px', fontSize: 12 }} onClick={() => onEdit(t)}>
                                View / Edit
                              </button>
                            ) : (
                              <button type="button" className="btn btn-ghost" style={{ padding: '0 6px', fontSize: 12 }} onClick={() => setViewing(t)}>
                                View
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {isOpen && <TripDetail t={t} showFinancials={showFinancials} />}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, background: 'var(--color-surface)' }}>
                <td colSpan={5}>Total ({rows.length} {rows.length === 1 ? 'movement' : 'movements'})</td>
                <td style={{ textAlign: 'right' }}>{formatNum(rows.reduce((s, t) => s + t.tons, 0), 2)}</td>
                <td></td>
                <td style={{ textAlign: 'right' }}>{formatNum(rows.reduce((s, t) => s + t.km, 0))}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </DualScroll>
      )}

      {viewing && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(23, 33, 43, 0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setViewing(null); }}
        >
          <div role="dialog" aria-modal="true" aria-label="Movement details" style={{ width: '100%', maxWidth: 760, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 24, display: 'grid', gap: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div className="kicker">Completed movement · view only</div>
                <h2 style={{ fontSize: 24, letterSpacing: '-0.02em', margin: 0 }}>{viewing.waybillNo}</h2>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => setViewing(null)}>Close</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
              <div><div className="stat-label" style={{ marginBottom: 2 }}>Vehicle</div><div style={{ fontWeight: 600 }}>{viewing.vehicle}</div></div>
              <div><div className="stat-label" style={{ marginBottom: 2 }}>Driver</div><div style={{ fontWeight: 600 }}>{viewing.driver}</div></div>
              <div><div className="stat-label" style={{ marginBottom: 2 }}>Duration</div><div style={{ fontWeight: 600 }}>{formatDuration(tripDurationDays(viewing.loadDate, viewing.unloadDate))}</div></div>
              <div><div className="stat-label" style={{ marginBottom: 2 }}>Tons / KM</div><div style={{ fontWeight: 600 }}>{formatNum(viewing.tons, 2)} / {formatNum(viewing.km)}</div></div>
            </div>
            <TripDetailBody t={viewing} showFinancials={showFinancials} />
          </div>
        </div>
      )}

      {completing && (() => {
        const c = tripCost(completing);
        return (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(23, 33, 43, 0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto' }}
            onMouseDown={(e) => { if (e.target === e.currentTarget && !completingBusy) setCompleting(null); }}
          >
            <div role="dialog" aria-modal="true" aria-label="Complete movement" style={{ width: '100%', maxWidth: 640 }}>
              <MovementReview
                action="complete"
                leaves={leaves}
                unavailability={unavailability}
                form={formFromTrip(completing)}
                original={null}
                lines={completing.expenses}
                originalLines={[]}
                stops={completing.stops}
                originalStops={[]}
                documents={completing.documents}
                originalDocuments={[]}
                showFinancials={showFinancials}
                wasCompleted={false}
                totals={{ km: completing.km, expense: c.expense, profit: c.profit }}
                onConfirm={() => confirmComplete(completing)}
                onBack={() => setCompleting(null)}
                standalone={{ blockers: completionBlockers(completing), busy: completingBusy, onEdit: () => { const t = completing; setCompleting(null); onEdit(t); } }}
              />
            </div>
          </div>
        );
      })()}
    </section>
  );
}
