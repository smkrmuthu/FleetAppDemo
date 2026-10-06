import { useEffect, useRef } from 'react';
import type { DriverLeave, TripDocument, TripExpenseLine, TripFormState, TripStop, VehicleUnavailability } from '../types';
import { TRIP_EXPENSE_LABEL } from '../data/mockData';
import { formatDisplayDate, formatDisplayDateTime } from '../lib/api';
import { overlappingLeaves, overlappingUnavailability, rupees, toNumber } from '../utils/calc';

type Action = 'create' | 'start' | 'save' | 'complete';

interface Props {
  action: Action;
  form: TripFormState;
  // The saved values when editing, so what changed can be flagged; null for a new movement.
  original: TripFormState | null;
  lines: TripExpenseLine[];
  originalLines: TripExpenseLine[];
  stops: TripStop[];
  originalStops: TripStop[];
  documents: TripDocument[];
  originalDocuments: TripDocument[];
  showFinancials: boolean;
  wasCompleted: boolean;
  totals: { km: number; expense: number; profit: number };
  leaves: DriverLeave[];
  unavailability: VehicleUnavailability[];
  onConfirm: () => void;
  onBack: () => void;
  // Set when the review is shown as a dialog over the Trip Log rather than inside the form.
  standalone?: {
    // Things still missing that stop the movement being completed.
    blockers: string[];
    onEdit: () => void;
    busy: boolean;
  };
}

type FieldKind = 'date' | 'text' | 'tons' | 'km' | 'money';
const FIELDS: { key: keyof TripFormState; label: string; kind: FieldKind; financial?: boolean; onlyIfSet?: boolean }[] = [
  { key: 'waybillNo', label: 'Trip number', kind: 'text' },
  { key: 'loadDate', label: 'Loading date', kind: 'date' },
  { key: 'unloadDate', label: 'Unloading date', kind: 'date' },
  { key: 'vehicle', label: 'Vehicle', kind: 'text' },
  { key: 'driver', label: 'Driver', kind: 'text' },
  { key: 'itemNo', label: 'Item no.', kind: 'text' },
  { key: 'from', label: 'Loading point', kind: 'text' },
  { key: 'fromNote', label: 'Loading point note', kind: 'text', onlyIfSet: true },
  { key: 'to', label: 'Final unloading point', kind: 'text' },
  { key: 'toNote', label: 'Final unloading note', kind: 'text', onlyIfSet: true },
  { key: 'tons', label: 'Loading weight', kind: 'tons' },
  { key: 'odoStart', label: 'Odometer start', kind: 'km' },
  { key: 'odoEnd', label: 'Odometer end', kind: 'km' },
  { key: 'revenue', label: 'Revenue', kind: 'money', financial: true },
  { key: 'remarks', label: 'Remarks', kind: 'text' }
];

function show(kind: FieldKind, v: string): string {
  if (kind === 'money') return rupees(toNumber(v));
  if (!v || !v.trim()) return '—';
  if (kind === 'date') return formatDisplayDate(v);
  if (kind === 'tons') return `${v} t`;
  if (kind === 'km') return `${Number(v).toLocaleString('en-IN')} km`;
  return v;
}

// New lines carry an ISO date, saved ones already a display date.
const lineDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? formatDisplayDate(d) : d);

function lineDetail(l: TripExpenseLine): string {
  if (l.litres != null && l.ratePerLitre != null) return `${l.litres.toFixed(2)} L × ₹${l.ratePerLitre.toFixed(2)}`;
  if (l.litres != null) return `${l.litres.toFixed(2)} L`;
  return l.details ?? '—';
}

const TITLE: Record<Action, string> = {
  create: 'Review before adding this movement',
  start: 'Review before adding this movement',
  save: 'Review before saving',
  complete: 'Review before completing this movement'
};

const NOTE: Partial<Record<Action | 'createOpen', string>> = {
  start: 'This saves as an open movement — you or documentation can keep adding entries and complete it later.',
  create: 'This records the movement as complete — a driver can no longer edit or delete it.',
  // No end odometer yet: saved as an open movement instead of an approved
  // one, same as 'start' — see the create-without-odoEnd case in the worker.
  createOpen: 'This saves as an open movement — the end odometer is still missing. Add it and approve the movement once the trip is finished.',
  complete: 'This marks the movement complete and locks it — a driver can no longer edit or delete it.'
};

const muted = { color: 'var(--color-neutral-700)' } as const;
const changedColor = 'var(--color-accent-700)';

export function MovementReview({ action, form, original, lines, originalLines, stops, originalStops, documents, originalDocuments, showFinancials, wasCompleted, totals, leaves, unavailability, onConfirm, onBack, standalone }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!standalone) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [standalone]);

  const editing = original !== null;
  // Note rows only appear when there is a note now, or there was one before.
  const fields = FIELDS.filter((f) => (showFinancials || !f.financial) && (!f.onlyIfSet || form[f.key] || (original && original[f.key])));
  const changedCount = editing ? fields.filter((f) => form[f.key] !== original[f.key]).length : 0;

  const originalLineIds = new Set(originalLines.map((l) => l.id));
  const newLineIds = new Set(lines.filter((l) => !originalLineIds.has(l.id)).map((l) => l.id));
  const removedLines = originalLines.filter((l) => !lines.some((x) => x.id === l.id));
  const originalDocIds = new Set(originalDocuments.map((d) => d.id));
  const removedDocs = originalDocuments.filter((d) => !documents.some((x) => x.id === d.id));
  const lineChanges = newLineIds.size + removedLines.length;
  const docChanges = documents.filter((d) => !originalDocIds.has(d.id)).length + removedDocs.length;
  const stopSig = (list: TripStop[]) => list.map((st) => `${st.location}|${st.date ?? ''}|${st.odo ?? ''}|${st.note ?? ''}`).join('\n');
  const stopsChanged = editing && stopSig(stops) !== stopSig(originalStops);
  const anyChange = changedCount + lineChanges + docChanges > 0 || stopsChanged;
  const leaveConflicts = overlappingLeaves(leaves, form.driver, form.loadDate, form.unloadDate);
  const noteKey: Action | 'createOpen' = action === 'create' && !form.odoEnd ? 'createOpen' : action;
  const vehicleConflicts = overlappingUnavailability(unavailability, form.vehicle, form.loadDate, form.unloadDate);

  const tag = (text: string, color: string) => (
    <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, color, border: `1px solid ${color}`, padding: '0 5px', marginLeft: 6 }}>{text}</span>
  );

  return (
    <div ref={rootRef} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginTop: standalone ? 0 : 16, background: 'var(--color-surface)' }}>
      <div style={{ background: 'var(--color-text)', color: 'var(--color-bg)', padding: '8px 12px', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {TITLE[action]}
      </div>

      {editing && (
        <div style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--color-neutral-300)', ...(anyChange ? {} : muted) }}>
          {anyChange
            ? <>Changes from the saved version are marked in <span style={{ color: changedColor, fontWeight: 700 }}>red</span>, with the previous value beneath.</>
            : 'Nothing has been changed from the saved version.'}
        </div>
      )}

      {leaveConflicts.length > 0 && (
        <div role="status" style={{ padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--color-neutral-300)', background: 'var(--color-accent-100)', color: 'var(--color-accent-800)', display: 'grid', gap: 4 }}>
          <strong>{form.driver} is recorded on leave during these dates:</strong>
          {leaveConflicts.map((l) => (
            <div key={l.id}>{formatDisplayDateTime(l.startsAt)} → {formatDisplayDateTime(l.endsAt)}{l.remarks ? ` — ${l.remarks}` : ''}</div>
          ))}
        </div>
      )}

      {vehicleConflicts.length > 0 && (
        <div role="status" style={{ padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--color-neutral-300)', background: 'var(--color-accent-100)', color: 'var(--color-accent-800)', display: 'grid', gap: 4 }}>
          <strong>{form.vehicle} is recorded unavailable during these dates:</strong>
          {vehicleConflicts.map((w) => (
            <div key={w.id}>{formatDisplayDateTime(w.startsAt)} → {formatDisplayDateTime(w.endsAt)}{w.remarks ? ` — ${w.remarks}` : ''}</div>
          ))}
        </div>
      )}

      <dl style={{ margin: 0, padding: '4px 12px', fontSize: 13 }}>
        {fields.map((f) => {
          const changed = editing && form[f.key] !== original[f.key];
          return (
            <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--color-neutral-300)' }}>
              <dt style={muted}>{f.label}{changed && tag('Changed', changedColor)}</dt>
              <dd style={{ margin: 0, textAlign: 'right', overflowWrap: 'anywhere' }}>
                <span style={{ fontWeight: 600, color: changed ? changedColor : undefined }}>
                  {f.key === 'waybillNo' && !editing && !form.waybillNo.trim() ? 'Assigned automatically once you save' : show(f.kind, form[f.key])}
                </span>
                {changed && (
                  <div style={{ fontSize: 11, ...muted, fontWeight: 400 }}>was {show(f.kind, original[f.key])}</div>
                )}
              </dd>
            </div>
          );
        })}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--color-neutral-300)' }}>
          <dt style={muted}>Distance</dt>
          <dd style={{ margin: 0, fontWeight: 600 }}>{totals.km.toLocaleString('en-IN')} km</dd>
        </div>
      </dl>

      <div style={{ padding: '10px 12px 4px', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', ...muted }}>
        Stops ({stops.length}){stopsChanged && tag('Changed', changedColor)}
      </div>
      {stops.length === 0 ? (
        <div style={{ padding: '0 12px 10px', fontSize: 13, ...muted }}>None — direct from the loading point to the final unloading point.</div>
      ) : (
        <ol style={{ margin: 0, padding: '0 12px 8px 32px', fontSize: 13, color: stopsChanged ? changedColor : undefined }}>
          {stops.map((st) => (
            <li key={st.id} style={{ padding: '2px 0' }}>
              <span style={{ fontWeight: 600 }}>{st.location}</span>
              <span style={{ fontWeight: 600 }}>{' · '}{st.odo ? `${st.odo.toLocaleString('en-IN')} km` : 'no reading'}</span>
              {st.note && <span style={{ color: 'var(--color-neutral-700)' }}> — {st.note}</span>}
            </li>
          ))}
        </ol>
      )}
      {stopsChanged && (
        <div style={{ padding: '0 12px 10px', fontSize: 11, ...muted }}>
          was {originalStops.length === 0 ? 'no stops' : originalStops.map((st) => `${st.location}${st.odo ? ` (${st.odo.toLocaleString('en-IN')} km)` : ''}`).join(' → ')}
        </div>
      )}

      <div style={{ padding: '10px 12px 4px', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', ...muted }}>
        Fuel &amp; expense entries ({lines.length})
      </div>
      {lines.length === 0 && removedLines.length === 0 ? (
        <div style={{ padding: '0 12px 10px', fontSize: 13, ...muted }}>None.</div>
      ) : (
        <div className="scroll-x" style={{ padding: '0 12px 8px' }}>
          <table className="table" style={{ minWidth: 480, fontSize: 13 }}>
            <thead>
              <tr><th>Date</th><th>Kind</th><th>Detail</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const isNew = editing && newLineIds.has(l.id);
                return (
                  <tr key={l.id} style={isNew ? { color: changedColor } : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>{lineDate(l.date)}</td>
                    <td>{TRIP_EXPENSE_LABEL[l.kind]}{isNew && tag('New', changedColor)}</td>
                    <td>{lineDetail(l)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{rupees(l.amount)}</td>
                  </tr>
                );
              })}
              {removedLines.map((l) => (
                <tr key={l.id} style={{ color: changedColor, textDecoration: 'line-through' }}>
                  <td style={{ whiteSpace: 'nowrap' }}>{lineDate(l.date)}</td>
                  <td>{TRIP_EXPENSE_LABEL[l.kind]}<span style={{ textDecoration: 'none', display: 'inline-block' }}>{tag('Removed', changedColor)}</span></td>
                  <td>{lineDetail(l)}</td>
                  <td style={{ textAlign: 'right' }}>{rupees(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ padding: '6px 12px 4px', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', ...muted }}>
        Supporting documents ({documents.length})
      </div>
      {documents.length === 0 && removedDocs.length === 0 ? (
        <div style={{ padding: '0 12px 10px', fontSize: 13, ...muted }}>None.</div>
      ) : (
        <ul style={{ margin: 0, padding: '0 12px 10px 28px', fontSize: 13 }}>
          {documents.map((d) => {
            const isNew = editing && !originalDocIds.has(d.id);
            return <li key={d.id} style={isNew ? { color: changedColor } : undefined}>{d.filename}{isNew && tag('New', changedColor)}</li>;
          })}
          {removedDocs.map((d) => (
            <li key={d.id} style={{ color: changedColor }}><span style={{ textDecoration: 'line-through' }}>{d.filename}</span>{tag('Removed', changedColor)}</li>
          ))}
        </ul>
      )}

      <div style={{ borderTop: '1px solid var(--color-neutral-300)', padding: '10px 12px', display: 'grid', gap: 4, fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={muted}>Total trip expense</span><span style={{ fontWeight: 700 }}>{rupees(totals.expense)}</span></div>
        {showFinancials && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={muted}>Profit</span>
            <span style={{ fontWeight: 700, color: totals.profit >= 0 ? 'var(--color-profit)' : 'var(--color-accent-700)' }}>{rupees(totals.profit)}</span>
          </div>
        )}
        {NOTE[noteKey] && !wasCompleted && <div style={{ ...muted, marginTop: 6 }}>{NOTE[noteKey]}</div>}
        {wasCompleted && <div style={{ ...muted, marginTop: 6 }}>This movement is already complete. Saving replaces what is recorded, and the change is kept in the audit log.</div>}
      </div>

      {standalone && standalone.blockers.length > 0 && (
        <div role="alert" style={{ borderTop: '1px solid var(--color-neutral-300)', padding: '10px 12px', fontSize: 13, color: changedColor, display: 'grid', gap: 2 }}>
          <strong>This movement can't be completed yet:</strong>
          {standalone.blockers.map((b) => <div key={b}>• {b}</div>)}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 12, borderTop: '1px solid var(--color-neutral-300)' }}>
        {standalone && standalone.blockers.length > 0 ? (
          <button type="button" className="btn btn-primary" onClick={standalone.onEdit}>Edit movement</button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={standalone?.busy} onClick={onConfirm}>
            {standalone?.busy ? 'Completing…' : action === 'complete' ? 'Confirm & complete' : 'Confirm & save'}
          </button>
        )}
        <button type="button" className="btn btn-ghost" disabled={standalone?.busy} onClick={onBack}>{standalone ? 'Cancel' : 'Back to edit'}</button>
      </div>
    </div>
  );
}
