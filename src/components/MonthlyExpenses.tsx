import { useRef, useState } from 'react';
import type { DriverMaster, ExpenseFormState, MonthlyExpense, Trip, TripDocument, Vehicle } from '../types';
import { categoryTint } from '../data/mockData';
import { fetchMonthlyExpenseDocumentBlobUrl, parseDisplayDate } from '../lib/api';
import { dateInRange, formatDateRange, matchingLoadingDate, rupees, todayIso, toNumber, yearOptions } from '../utils/calc';
import { MonthYearFilter } from './MonthYearFilter';

function blankExpense(defaultVehicle: string, defaultCategory: string): ExpenseFormState {
  return { date: todayIso(), vehicle: defaultVehicle, driver: '', category: defaultCategory, amount: '0', remarks: '' };
}

// Mirrors the server's allowlist (worker/src/lib/fileValidation.ts) so a
// rejected file gets an immediate, specific message — the server's
// magic-byte check remains the actual security boundary.
const ACCEPTED_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({ base64: result.slice(result.indexOf(',') + 1), mimeType: file.type || 'image/jpeg' });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface Props {
  expenses: MonthlyExpense[];
  trips: Trip[];
  vehicles: Vehicle[];
  drivers: DriverMaster[];
  dateFrom: string;
  dateTo: string;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
  onResetFilters: () => void;
  onAdd: (e: MonthlyExpense) => void;
  onUpdate: (e: MonthlyExpense, newDocs: TripDocument[], removedDocIds: string[]) => Promise<string | null>;
  onDelete: (e: MonthlyExpense) => void;
  categories: string[];
}

export function MonthlyExpenses({ expenses: allExpenses, trips, vehicles, drivers, categories, dateFrom, dateTo, onDateFrom, onDateTo, onResetFilters, onAdd, onUpdate, onDelete }: Props) {
  const [exp, setExp] = useState<ExpenseFormState>(() => blankExpense(vehicles[0]?.id ?? '', categories[0] ?? ''));
  const [documents, setDocuments] = useState<TripDocument[]>([]);
  const [docErrorMsg, setDocErrorMsg] = useState('');
  const [viewingDoc, setViewingDoc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Editing reuses the add form: `editingId` is the expense being changed,
  // `existingDocs` the bills it still has, `removedDocIds` the ones taken off
  // (deleted only when Save is pressed).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [existingDocs, setExistingDocs] = useState<TripDocument[]>([]);
  const [removedDocIds, setRemovedDocIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [truckFilter, setTruckFilter] = useState('all');
  const [dateSort, setDateSort] = useState<'asc' | 'desc'>('asc');
  const expenses = allExpenses
    .filter((e) => dateInRange(e.date, dateFrom, dateTo) && (truckFilter === 'all' || e.vehicle === truckFilter))
    .sort((a, b) => {
      const cmp = parseDisplayDate(a.date).localeCompare(parseDisplayDate(b.date));
      return dateSort === 'asc' ? cmp : -cmp;
    });

  const set = (k: keyof ExpenseFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setExp((f) => ({ ...f, [k]: e.target.value } as ExpenseFormState));

  async function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    const rejected: string[] = [];
    for (const file of files) {
      // An empty file.type (common for camera captures on some devices) is
      // let through — fileToBase64 falls back to image/jpeg for those, and
      // the server's magic-byte check is the real gate either way.
      if (file.type && !ACCEPTED_DOCUMENT_TYPES.includes(file.type)) {
        rejected.push(file.name);
        continue;
      }
      try {
        const { base64, mimeType } = await fileToBase64(file);
        setDocuments((prev) => [...prev, { id: 'x' + Date.now() + Math.random().toString(36).slice(2), filename: file.name, mimeType, base64 }]);
      } catch {
        // a file that failed to read locally is simply skipped
      }
    }
    setDocErrorMsg(rejected.length ? `${rejected.join(', ')} — only photos and PDF files are supported.` : '');
  }

  function removeDocument(id: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }

  async function viewDocument(expenseId: string, doc: TripDocument) {
    if (doc.base64) {
      const byteChars = atob(doc.base64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: doc.mimeType || 'application/octet-stream' }));
      window.open(url, '_blank');
      return;
    }
    setViewingDoc(doc.id);
    try {
      const url = await fetchMonthlyExpenseDocumentBlobUrl(expenseId, doc.id);
      window.open(url, '_blank');
    } catch {
      setDocErrorMsg('Could not open that file — try again.');
    } finally {
      setViewingDoc(null);
    }
  }

  function startEdit(e: MonthlyExpense) {
    setEditingId(e.id);
    setExp({
      date: parseDisplayDate(e.date), vehicle: e.vehicle, driver: e.driver === '—' ? '' : e.driver,
      category: e.category, amount: String(e.amount), remarks: e.remarks === '—' ? '' : e.remarks
    });
    setExistingDocs(e.documents);
    setRemovedDocIds([]);
    setDocuments([]);
    setDocErrorMsg('');
    setSaveError('');
    document.getElementById('expense-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelEdit() {
    setEditingId(null);
    setExistingDocs([]);
    setRemovedDocIds([]);
    setDocuments([]);
    setDocErrorMsg('');
    setSaveError('');
    setExp(blankExpense(vehicles[0]?.id ?? '', categories[0] ?? ''));
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!toNumber(exp.amount)) { setSaveError('Enter an amount.'); return; }
    setSaving(true);
    setSaveError('');
    const err = await onUpdate(
      { id: editingId, date: exp.date, vehicle: exp.vehicle, driver: exp.driver || '—', category: exp.category, amount: toNumber(exp.amount), remarks: exp.remarks || '—', documents: existingDocs },
      documents, removedDocIds
    );
    setSaving(false);
    if (err) setSaveError(err);
    else cancelEdit();
  }

  function addExpense() {
    if (!toNumber(exp.amount)) return;
    onAdd({
      id: 'e' + Date.now(), date: exp.date, vehicle: exp.vehicle, driver: exp.driver || '—',
      category: exp.category, amount: toNumber(exp.amount), remarks: exp.remarks || '—', documents
    });
    setExp((f) => ({ ...f, amount: '0', remarks: '' }));
    setDocuments([]);
    setDocErrorMsg('');
  }

  const byKind = new Map<string, number>();
  expenses.forEach((e) => byKind.set(e.category, (byKind.get(e.category) || 0) + e.amount));

  return (
    <section>
      <div style={{ marginBottom: 18 }}>
        <div className="kicker">Admin and documentation resource · {formatDateRange(dateFrom, dateTo)}</div>
        <h1>Monthly Expenses</h1>
        <p style={{ color: 'var(--color-neutral-700)', marginTop: 6, fontSize: 13 }}>Record fixed costs — permits, insurance, EMIs — that aren't tied to a single trip.</p>
      </div>

      <div id="expense-form" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 24, background: 'var(--color-surface)' }}>
        {editingId && (
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent-700)', marginBottom: 12 }}>Editing expense</div>
        )}
        <div className="filters-grid">
          <div className="field"><label>Date</label><input className="input" type="date" value={exp.date} onChange={set('date')} /></div>
          <div className="field">
            <label>Vehicle</label>
            <select className="input" value={exp.vehicle} onChange={set('vehicle')}>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Driver</label>
            <select className="input" value={exp.driver} onChange={set('driver')}>
              <option value="">No driver</option>
              {drivers.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Description</label>
            <select className="input" value={exp.category} onChange={set('category')}>
              {categories.length === 0 && <option value="">Add one under Master first</option>}
              {exp.category && !categories.includes(exp.category) && <option value={exp.category}>{exp.category} (removed)</option>}
              {categories.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="field"><label>Amount (₹)</label><input className="input" type="number" value={exp.amount} onChange={set('amount')} /></div>
          <div className="field"><label>Remarks</label><input className="input" type="text" placeholder="Remarks" value={exp.remarks} onChange={set('remarks')} /></div>
          {editingId ? (
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" style={{ width: 150, justifyContent: 'center' }} onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
              <button type="button" className="btn btn-secondary" style={{ width: 150, justifyContent: 'center' }} onClick={cancelEdit} disabled={saving}>Cancel</button>
              {saveError && <span style={{ fontSize: 13, color: 'var(--color-accent-800)' }}>{saveError}</span>}
            </div>
          ) : (
            <button type="button" className="btn btn-primary" style={{ justifySelf: 'start' }} onClick={addExpense} disabled={categories.length === 0}>Add expense</button>
          )}
        </div>

        <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', marginBottom: 12 }}>Bills</div>
          <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf" onChange={onFilesChosen} style={{ marginBottom: docErrorMsg || documents.length ? 10 : 0 }} />
          {docErrorMsg && (
            <div style={{ fontSize: 12, color: 'var(--color-accent-800)', marginBottom: 10 }}>{docErrorMsg}</div>
          )}
          {editingId && existingDocs.filter((d) => !removedDocIds.includes(d.id)).length > 0 && (
            <ul style={{ margin: '0 0 6px', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
              {existingDocs.filter((d) => !removedDocIds.includes(d.id)).map((d) => (
                <li key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 13, background: 'var(--color-surface)', padding: '6px 10px' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</span>
                  <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button type="button" className="btn btn-ghost" style={{ padding: '0 4px', fontSize: 12 }} disabled={viewingDoc === d.id} onClick={() => viewDocument(editingId, d)}>View</button>
                    <button type="button" className="btn btn-ghost" style={{ padding: '0 4px', fontSize: 12 }} onClick={() => setRemovedDocIds((prev) => [...prev, d.id])}>Remove</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {documents.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
              {documents.map((d) => (
                <li key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 13, background: 'var(--color-surface)', padding: '6px 10px' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</span>
                  <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button type="button" className="btn btn-ghost" style={{ padding: '0 4px', fontSize: 12 }} onClick={() => viewDocument('', d)}>View</button>
                    <button type="button" className="btn btn-ghost" style={{ padding: '0 4px', fontSize: 12 }} onClick={() => removeDocument(d.id)}>Remove</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20, background: 'var(--color-surface)' }}>
        <div className="filters-grid">
          <div className="field"><label>Date from</label><input className="input" type="date" value={dateFrom} onChange={(e) => onDateFrom(e.target.value)} /></div>
          <div className="field"><label>Date to</label><input className="input" type="date" value={dateTo} onChange={(e) => onDateTo(e.target.value)} /></div>
          <MonthYearFilter dateFrom={dateFrom} dateTo={dateTo} onDateFrom={onDateFrom} onDateTo={onDateTo} years={yearOptions(allExpenses.map((e) => e.date))} />
          <div className="field">
            <label>Truck no</label>
            <select className="input" value={truckFilter} onChange={(e) => setTruckFilter(e.target.value)}>
              <option value="all">All trucks</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-ghost" style={{ justifySelf: 'start' }} onClick={() => { setTruckFilter('all'); onResetFilters(); }}>Reset filters</button>
        </div>
      </div>

      {byKind.size > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', borderTop: '1px solid var(--color-border)', borderLeft: '1px solid var(--color-border)', marginBottom: 24 }}>
          {Array.from(byKind.entries()).map(([label, value]) => (
            <div key={label} style={{ background: 'var(--color-bg)', padding: '14px 16px', display: 'flex', gap: 12, borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ width: 6, flex: 'none', background: categoryTint(label) }} />
              <div>
                <div className="stat-label">{label}</div>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 22 }}>{rupees(value)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 'var(--fs-section)', marginBottom: 12 }}>Monthly Expenses Log</h2>
      {expenses.length === 0 ? (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, color: 'var(--color-neutral-700)', background: 'var(--color-surface)' }}>
          {truckFilter === 'all' ? 'No expenses recorded for this date range.' : `No expenses recorded for ${truckFilter} in this date range.`}
        </div>
      ) : (
      <div className="scroll-x" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
        <table className="table" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th aria-sort={dateSort === 'asc' ? 'ascending' : 'descending'}>
                <button
                  type="button" className="btn btn-ghost" onClick={() => setDateSort((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  style={{ padding: 0, font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', color: 'inherit', display: 'inline-flex', gap: 6, alignItems: 'center' }}
                  title={dateSort === 'asc' ? 'Oldest first — click for newest first' : 'Newest first — click for oldest first'}
                >
                  Date <span aria-hidden="true">{dateSort === 'asc' ? '▲' : '▼'}</span>
                </button>
              </th><th>Vehicle</th><th>Loading date</th><th>Driver</th><th>Description</th><th>Remarks</th><th style={{ textAlign: 'right' }}>Amount</th><th>Bills</th><th></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} style={e.id === editingId ? { background: 'var(--color-accent-100)' } : undefined}>
                <td style={{ whiteSpace: 'nowrap' }}>{e.date}</td>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{e.vehicle}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--color-neutral-700)' }}>{matchingLoadingDate(trips, e.vehicle, e.date)}</td>
                <td>{e.driver}</td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 4, height: 15, background: categoryTint(e.category), display: 'inline-block' }} />
                    {e.category}
                  </span>
                </td>
                <td style={{ color: 'var(--color-neutral-700)' }}>{e.remarks}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupees(e.amount)}</td>
                <td>
                  {e.documents.length === 0 ? (
                    <span style={{ color: 'var(--color-neutral-700)' }}>—</span>
                  ) : (
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {e.documents.map((d) => (
                        <button
                          key={d.id} type="button" className="btn btn-ghost" style={{ padding: 0, fontSize: 12, justifyContent: 'flex-start', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          disabled={viewingDoc === d.id} onClick={() => viewDocument(e.id, d)} title={d.filename}
                        >
                          {viewingDoc === d.id ? 'Opening…' : d.filename}
                        </button>
                      ))}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => startEdit(e)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12, color: 'var(--color-accent-700)' }} onClick={() => { if (editingId === e.id) cancelEdit(); onDelete(e); }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}
