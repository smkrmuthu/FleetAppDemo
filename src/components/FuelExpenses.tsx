import { useMemo, useRef, useState } from 'react';
import type { DriverMaster, FuelEntry, MasterSettings, Role, Trip, TripDocument, TripExpenseLine, Vehicle } from '../types';
import { parseDisplayDate, scanReceipt, type ScannedReceipt } from '../lib/api';
import { dateInRange, formatDateRange, rupees, todayIso, toNumber, yearOptions } from '../utils/calc';
import { MonthYearFilter } from './MonthYearFilter';
import { exportFuelExcel, exportFuelPdf, type FuelRow } from '../lib/reports';
import { useExport } from '../lib/useExport';
import { SortableTh, type SortDir } from './SortableTh';

const round2 = (n: number) => Math.round(n * 100) / 100;

function normalizeReg(v: string): string {
  return v.replace(/\s+/g, '').toUpperCase();
}

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
  trips: Trip[];
  vehicles: Vehicle[];
  drivers: DriverMaster[];
  master: MasterSettings;
  role: Role;
  // Shared with the other screens (the same From / To dates follow you between tabs).
  dateFrom: string;
  dateTo: string;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
  onResetFilters: () => void;
  // Posts one diesel line to a trip (and the scanned bill, if any, to that
  // trip's documents). `ok: false` means nothing was saved; `ok: true` with a
  // message means it was saved but something minor (the bill photo) wasn't.
  onPost: (trip: Trip, line: TripExpenseLine, bill: TripDocument | null) => Promise<{ ok: boolean; message: string | null }>;
  // Saves changes to an existing entry. Resolves to an error message, or null.
  onUpdate: (trip: Trip, line: TripExpenseLine) => Promise<string | null>;
  onDelete: (trip: Trip, line: TripExpenseLine) => Promise<string | null>;
  // Fuel saved without a trip. Office picks the trip later with Edit, which moves
  // the entry onto that trip. Each resolves to an error message, or null.
  unassigned: FuelEntry[];
  onPostUnassigned: (vehicle: string, line: TripExpenseLine) => Promise<string | null>;
  onUpdateUnassigned: (id: string, line: TripExpenseLine, tripId?: string) => Promise<string | null>;
  onDeleteUnassigned: (id: string) => Promise<string | null>;
}

// One row of the list: a diesel line on a trip, or an entry with no trip yet.
interface Row {
  trip: Trip | null;
  vehicle: string;
  line: TripExpenseLine;
}

type SortKey = 'date' | 'vehicle' | 'trip' | 'litres' | 'rate' | 'amount' | 'remarks';

export function FuelExpenses({ trips, vehicles, drivers, master, role, dateFrom, dateTo, onDateFrom, onDateTo, onResetFilters, onPost, onUpdate, onDelete, unassigned, onPostUnassigned, onUpdateUnassigned, onDeleteUnassigned }: Props) {
  // Only trips that are still open can take fuel from here.
  const openTrips = useMemo(() => trips.filter((t) => t.status === 'draft'), [trips]);
  // This tab is for Office and Manager only (drivers don't get it).
  const vehicleOptions = vehicles;

  const [date, setDate] = useState(todayIso());
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [litres, setLitres] = useState('');
  const [rateOverride, setRateOverride] = useState<string | null>(null);
  const [tripId, setTripId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  // The entry being edited, if any. Its truck stays fixed; the trip is fixed too
  // unless the entry has none yet (then Office can pick it).
  const [editing, setEditing] = useState<Row | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });
  const [truckFilter, setTruckFilter] = useState('all');
  const { busy, error: exportError, run } = useExport();
  const formRef = useRef<HTMLDivElement>(null);

  const [scanning, setScanning] = useState(false);
  const [scanFile, setScanFile] = useState<{ base64: string; mimeType: string; filename: string } | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const rateText = rateOverride ?? (master.dieselRate === null ? '' : String(master.dieselRate));
  const litresN = round2(toNumber(litres));
  const rateN = round2(toNumber(rateText));
  const amount = round2(litresN * rateN);

  const tripsForVehicle = openTrips.filter((t) => t.vehicle === vehicle);
  // An entry on a trip that is no longer open (a manager correcting it) still needs its trip in the list.
  if (editing?.trip && editing.vehicle === vehicle && !tripsForVehicle.some((t) => t.id === editing.trip!.id)) tripsForVehicle.push(editing.trip);
  const selectedTrip = tripsForVehicle.find((t) => t.id === tripId) ?? null;

  function chooseVehicle(id: string) {
    setVehicle(id);
    setDriver(vehicles.find((v) => v.id === id)?.defaultDriver ?? '');
    const forVehicle = openTrips.filter((t) => t.vehicle === id);
    setTripId(forVehicle.length === 1 ? forVehicle[0].id : '');
    setError('');
    setNotice('');
  }

  function startEdit(row: Row) {
    const { trip, line } = row;
    setEditing(row);
    setDate(parseDisplayDate(line.date) || line.date);
    setVehicle(row.vehicle);
    setDriver(vehicles.find((v) => v.id === row.vehicle)?.defaultDriver ?? '');
    setTripId(trip ? trip.id : '');
    setLitres(line.litres != null ? line.litres.toFixed(2) : '');
    setRateOverride(line.ratePerLitre != null ? line.ratePerLitre.toFixed(2) : '');
    setRemarks(line.details ?? '');
    setScanFile(null);
    setError('');
    setNotice('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelEdit() {
    setEditing(null);
    setVehicle('');
    setDriver('');
    setTripId('');
    setLitres('');
    setRateOverride(null);
    setRemarks('');
    setDate(todayIso());
    setError('');
  }

  async function saveEdit() {
    if (!editing) return;
    setError('');
    if (!date) { setError('Enter the date.'); return; }
    if (!litresN) { setError('Enter the litres.'); return; }
    if (!rateN) { setError('Enter the rate per litre.'); return; }
    setSaving(true);
    const updated: TripExpenseLine = {
      ...editing.line, date, litres: litresN, ratePerLitre: rateN, amount,
      details: remarks.trim() ? remarks.trim() : undefined
    };
    const err = editing.trip
      ? await onUpdate(editing.trip, updated)
      : await onUpdateUnassigned(editing.line.id, updated, selectedTrip?.id);
    setSaving(false);
    if (err) { setError(err); return; }
    const assigned = !editing.trip && selectedTrip;
    cancelEdit();
    setNotice(assigned ? `Fuel entry saved and assigned to trip ${selectedTrip.waybillNo}.` : 'Fuel entry updated.');
  }

  async function onScanChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (scanInputRef.current) scanInputRef.current.value = '';
    if (!file) return;
    setScanning(true);
    setError('');
    setNotice('');
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const r: ScannedReceipt = await scanReceipt(base64, mimeType);
      if ((r.fuelType ?? '').toLowerCase().includes('adblue')) {
        setError('That looks like an AdBlue bill — only diesel is posted from this tab.');
        return;
      }
      if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) setDate(r.date);
      if (r.litres) setLitres(String(round2(r.litres)));
      if (r.ratePerLitre) setRateOverride(String(round2(r.ratePerLitre)));
      setScanFile({ base64, mimeType, filename: file.name });
      if (!vehicle && r.vehicleNo) {
        const match = vehicleOptions.find((v) => normalizeReg(v.id) === normalizeReg(r.vehicleNo!));
        if (match) chooseVehicle(match.id);
      }
      setNotice('Bill read — check the figures, pick the trip (or leave it for later), then save.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the bill — enter it manually.');
    } finally {
      setScanning(false);
    }
  }

  async function post() {
    setError('');
    setNotice('');
    if (!vehicle) { setError('Choose a vehicle.'); return; }
    if (!date) { setError('Enter the date.'); return; }
    if (!litresN) { setError('Enter the litres.'); return; }
    if (!rateN) { setError('Enter the rate per litre.'); return; }
    setSaving(true);
    const line: TripExpenseLine = {
      id: 'x' + Date.now(), date, kind: 'diesel', litres: litresN, ratePerLitre: rateN, amount,
      ...(remarks.trim() ? { details: remarks.trim() } : {})
    };
    if (!selectedTrip) {
      // No trip yet: keep the fill on its own; Office picks the trip later with Edit.
      const err = await onPostUnassigned(vehicle, line);
      setSaving(false);
      if (err) { setError(err); return; }
      setNotice(`Saved ${litresN.toFixed(2)} L (${rupees(amount)}) for ${vehicle} without a trip — choose the trip later with Edit.${scanFile ? ' The bill photo was not kept: attach it on the trip once it is assigned.' : ''}`);
    } else {
      const bill: TripDocument | null = scanFile ? { id: 'x' + Date.now(), filename: scanFile.filename, mimeType: scanFile.mimeType, base64: scanFile.base64 } : null;
      const res = await onPost(selectedTrip, line, bill);
      setSaving(false);
      if (!res.ok) { setError(res.message ?? 'Could not post the fuel entry'); return; }
      setNotice(`Posted ${litresN.toFixed(2)} L (${rupees(amount)}) to trip ${selectedTrip.waybillNo}.${res.message ? ' ' + res.message : ''}`);
    }
    setLitres('');
    setRateOverride(null);
    setRemarks('');
    setScanFile(null);
  }

  async function remove({ trip, line, vehicle: truck }: Row) {
    if (!window.confirm(`Delete this fuel entry — ${line.litres?.toFixed(2) ?? ''} L, ${rupees(line.amount)} ${trip ? `on trip ${trip.waybillNo}` : `for ${truck} (no trip yet)`}? This cannot be undone.`)) return;
    const err = trip ? await onDelete(trip, line) : await onDeleteUnassigned(line.id);
    if (err) { setError(err); return; }
    if (editing?.line.id === line.id) cancelEdit();
  }

  // Every diesel line across the trips this person can see (including fuel
  // logged before this tab existed), in the chosen order.
  function toggleSort(key: SortKey) {
    // A new column starts ascending; clicking the same column flips it.
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }
  function sortValue(e: Row, key: SortKey): number | string {
    switch (key) {
      case 'date': return parseDisplayDate(e.line.date);
      case 'vehicle': return e.vehicle;
      case 'trip': return e.trip?.waybillNo ?? '';
      case 'litres': return e.line.litres ?? -1;
      case 'rate': return e.line.ratePerLitre ?? -1;
      case 'amount': return e.line.amount;
      case 'remarks': return (e.line.details ?? '').toLowerCase();
    }
  }
  const allEntries: Row[] = [
    ...trips.flatMap((t) => t.expenses.filter((l) => l.kind === 'diesel').map((l): Row => ({ trip: t, vehicle: t.vehicle, line: l }))),
    ...unassigned.map((u): Row => ({
      trip: null, vehicle: u.vehicle,
      line: { id: u.id, date: u.date, kind: 'diesel', litres: u.litres, ratePerLitre: u.ratePerLitre, amount: u.amount, details: u.details }
    }))
  ];
  const entries = allEntries
    .filter((e) => dateInRange(e.line.date, dateFrom, dateTo) && (truckFilter === 'all' || e.vehicle === truckFilter))
    .sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string, undefined, { numeric: true }) : (av as number) - (bv as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  const totalLitres = entries.reduce((a, e) => a + (e.line.litres ?? 0), 0);
  const totalAmount = entries.reduce((a, e) => a + e.line.amount, 0);
  const notAssigned = entries.filter((e) => !e.trip).length;
  const fuelRows = (): FuelRow[] => entries.map(({ trip, line, vehicle: truck }) => ({
    date: line.date, vehicle: truck, tripNo: trip ? trip.waybillNo : 'Not assigned', litres: line.litres ?? null, rate: line.ratePerLitre ?? null,
    amount: line.amount, remarks: line.details ?? ''
  }));
  const filterNote = `${formatDateRange(dateFrom, dateTo) || 'All dates'} · ${truckFilter === 'all' ? 'All trucks' : truckFilter}`;
  const th = (key: SortKey, label: string, align: 'left' | 'right' = 'left') => (
    <SortableTh label={label} align={align} active={sort.key === key} dir={sort.dir} onSort={() => toggleSort(key)} />
  );

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div className="kicker">Diesel</div>
          <h1>Fuel &amp; Expenses</h1>
          <p style={{ color: 'var(--color-neutral-700)', marginTop: 6, fontSize: 13 }}>
            Enter a diesel fill. Choose the trip now, or leave it empty and let Office assign it later with Edit. The trip must still be open.
          </p>
        </div>
        <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-secondary" disabled={!!busy || entries.length === 0} onClick={() => run('xlsx', () => exportFuelExcel(fuelRows()))}>
              {busy === 'xlsx' ? 'Preparing…' : 'Export Excel'}
            </button>
            <button type="button" className="btn btn-primary" disabled={!!busy || entries.length === 0} onClick={() => run('pdf', () => exportFuelPdf(fuelRows(), filterNote))}>
              {busy === 'pdf' ? 'Preparing…' : 'Print / Save PDF'}
            </button>
          </div>
          {exportError && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 12 }}>{exportError}</div>}
        </div>
      </div>

      <div ref={formRef} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 24, background: 'var(--color-surface)' }}>
        {editing && (
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent-700)', marginBottom: 12 }}>
            {editing.trip
              ? "Editing fuel entry · truck and trip can't be changed — delete and re-enter to move it"
              : 'Editing fuel entry with no trip yet · choose the trip to assign it'}
          </div>
        )}
        <div className="filters-grid" style={{ alignItems: 'start' }}>
          <div className="field">
            <label htmlFor="fuel-date">Date</label>
            <input id="fuel-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="fuel-vehicle">Vehicle #</label>
            <select id="fuel-vehicle" className="input" value={vehicle} onChange={(e) => chooseVehicle(e.target.value)} disabled={!!editing}>
              <option value="">Select vehicle</option>
              {vehicleOptions.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fuel-driver">Driver</label>
            <select id="fuel-driver" className="input" value={driver} onChange={(e) => setDriver(e.target.value)}>
              <option value="">No driver</option>
              {drivers.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 4 }}>Truck's default driver — for reference, not saved.</div>
          </div>
          <div className="field">
            <label htmlFor="fuel-litres">Litres</label>
            <input id="fuel-litres" className="input" type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={litres} onChange={(e) => setLitres(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="fuel-rate">Rate / litre (₹)</label>
            <input id="fuel-rate" className="input" type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={rateText} onChange={(e) => setRateOverride(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="fuel-amount">Amount (₹)</label>
            <input id="fuel-amount" className="input" type="text" readOnly tabIndex={-1} value={amount.toFixed(2)} style={{ background: 'var(--color-surface)' }} />
          </div>
          <div className="field">
            <label htmlFor="fuel-trip">Trip #</label>
            <select id="fuel-trip" className="input" value={tripId} onChange={(e) => setTripId(e.target.value)} disabled={!vehicle || !!editing?.trip}>
              <option value="">{!vehicle ? 'Select a vehicle first' : tripsForVehicle.length === 0 ? 'No open trips — save without a trip' : 'No trip yet (assign later)'}</option>
              {tripsForVehicle.map((t) => (
                <option key={t.id} value={t.id}>{t.waybillNo} · {t.loadDate} · {t.from} → {t.to}</option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 4 }}>Optional — can be assigned later with Edit.</div>
          </div>
          <div className="field">
            <label htmlFor="fuel-remarks">Remarks</label>
            <input id="fuel-remarks" className="input" type="text" placeholder="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>

        {editing ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
            <button type="button" className="btn btn-primary" style={{ width: 150, justifyContent: 'center' }} onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            <button type="button" className="btn btn-secondary" style={{ width: 150, justifyContent: 'center' }} onClick={cancelEdit} disabled={saving}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
            <button type="button" className="btn btn-primary" onClick={post} disabled={saving}>{saving ? 'Saving…' : 'Save entry'}</button>
            <span style={{ color: 'var(--color-neutral-500)', fontSize: 12 }}>or</span>
            <input ref={scanInputRef} type="file" accept="image/*" capture="environment" onChange={onScanChosen} style={{ display: 'none' }} />
            <button type="button" className="btn btn-secondary" disabled={scanning} onClick={() => scanInputRef.current?.click()}>
              {scanning && <span className="spinner" style={{ marginRight: 8 }} />}
              {scanning ? 'Reading bill…' : 'Scan a fuel bill'}
            </button>
            {scanFile && <span style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>Bill attached: {scanFile.filename}</span>}
          </div>
        )}

        {error && <div role="alert" style={{ marginTop: 12, border: '1px solid var(--color-accent-200)', borderRadius: 'var(--radius-md)', color: 'var(--color-accent-700)', padding: '10px 14px', fontSize: 13 }}>{error}</div>}
        {notice && !error && <div role="status" style={{ marginTop: 12, fontSize: 13, color: 'var(--color-profit)', fontWeight: 600 }}>{notice}</div>}
      </div>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20, background: 'var(--color-surface)' }}>
        <div className="filters-grid">
          <div className="field"><label htmlFor="fuel-from">Date from</label><input id="fuel-from" className="input" type="date" value={dateFrom} onChange={(e) => onDateFrom(e.target.value)} /></div>
          <div className="field"><label htmlFor="fuel-to">Date to</label><input id="fuel-to" className="input" type="date" value={dateTo} onChange={(e) => onDateTo(e.target.value)} /></div>
          <MonthYearFilter dateFrom={dateFrom} dateTo={dateTo} onDateFrom={onDateFrom} onDateTo={onDateTo} years={yearOptions(allEntries.map((e) => e.line.date))} />
          <div className="field">
            <label htmlFor="fuel-truck-filter">Truck no</label>
            <select id="fuel-truck-filter" className="input" value={truckFilter} onChange={(e) => setTruckFilter(e.target.value)}>
              <option value="all">All trucks</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-ghost" style={{ justifySelf: 'start' }} onClick={() => { setTruckFilter('all'); onResetFilters(); }}>Reset filters</button>
        </div>
      </div>

      <h2 style={{ fontSize: 'var(--fs-section)', marginBottom: 12 }}>
        Fuel entries <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-neutral-700)' }}>{entries.length}{entries.length !== allEntries.length ? ` of ${allEntries.length}` : ''}</span>
        {notAssigned > 0 && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-accent-700)', marginLeft: 12 }}>{notAssigned} not assigned to a trip yet</span>}
      </h2>
      {entries.length === 0 ? (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, color: 'var(--color-neutral-700)', background: 'var(--color-surface)' }}>
          {allEntries.length === 0 ? 'No fuel entries yet.' : 'No fuel entries match the selected filters.'}
        </div>
      ) : (
        <div className="scroll-x" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
          <table className="table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                {th('date', 'Date')}{th('vehicle', 'Vehicle')}{th('trip', 'Trip #')}{th('litres', 'Litres', 'right')}{th('rate', 'Rate', 'right')}
                {th('amount', 'Amount', 'right')}{th('remarks', 'Remarks')}<th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => {
                const { trip, line } = row;
                return (
                <tr key={line.id} style={editing?.line.id === line.id ? { background: 'var(--color-accent-100)' } : undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}>{line.date}</td>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{row.vehicle}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{trip ? trip.waybillNo : <span className="badge badge-warning">Not assigned</span>}</td>
                  <td style={{ textAlign: 'right' }}>{line.litres != null ? line.litres.toFixed(2) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{line.ratePerLitre != null ? rupees(line.ratePerLitre) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupees(line.amount)}</td>
                  <td style={{ color: 'var(--color-neutral-700)' }}>{line.details ?? '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {(!trip || trip.status === 'draft' || role === 'Manager') && (
                      <>
                        <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => startEdit(row)}>
                          Edit
                        </button>
                        <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12, color: 'var(--color-accent-700)' }} onClick={() => remove(row)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, background: 'var(--color-surface)' }}>
                <td colSpan={3}>Total ({entries.length} {entries.length === 1 ? 'entry' : 'entries'})</td>
                <td style={{ textAlign: 'right' }}>{totalLitres.toFixed(2)}</td>
                <td></td>
                <td style={{ textAlign: 'right' }}>{rupees(totalAmount)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
