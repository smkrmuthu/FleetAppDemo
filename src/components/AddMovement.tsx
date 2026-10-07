import { useEffect, useRef, useState } from 'react';
import type { DriverLeave, DriverMaster, MasterSettings, Trip, TripDocument, TripExpenseLine, TripFormState, TripStop, Vehicle, VehicleUnavailability } from '../types';
import { TRIP_EXPENSE_LABEL } from '../data/mockData';
import { dieselLitres, overlappingLeaves, overlappingUnavailability, rupees, todayIso, toNumber } from '../utils/calc';
import { MovementReview } from './MovementReview';
import { fetchDocumentBlobUrl, fetchNextTripNumberPreview, formatDisplayDateTime, parseDisplayDate } from '../lib/api';

// Mirrors the server's allowlist (worker/src/lib/fileValidation.ts) so a
// driver gets an immediate, specific message instead of a generic save
// error — the server's magic-byte check remains the actual security
// boundary, this is purely a UX shortcut for the obvious rejects.
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

function blankForm(driver = '', from = ''): TripFormState {
  return {
    loadDate: todayIso(), unloadDate: '', vehicle: '', driver,
    waybillNo: '', itemNo: '', from, fromNote: '', to: '', toNote: '', tons: '', odoStart: '', odoEnd: '',
    revenue: '0', remarks: '', transporter: ''
  };
}

export function formFromTrip(trip: Trip): TripFormState {
  const clear = (v: string) => (v === '—' ? '' : v);
  return {
    loadDate: parseDisplayDate(trip.loadDate) || todayIso(), unloadDate: parseDisplayDate(clear(trip.unloadDate)), vehicle: trip.vehicle, driver: trip.driver,
    waybillNo: clear(trip.waybillNo), itemNo: clear(trip.itemNo), from: clear(trip.from), fromNote: trip.fromNote ?? '', to: clear(trip.to), toNote: trip.toNote ?? '',
    tons: trip.tons ? String(trip.tons) : '', odoStart: trip.odoStart != null ? String(trip.odoStart) : '',
    odoEnd: trip.odoEnd != null ? String(trip.odoEnd) : '', revenue: String(trip.revenue ?? 0), remarks: trip.remarks ?? '', transporter: trip.transporter ?? ''
  };
}

// Trip Movement only takes "other" expenses now — fuel is posted from the Fuel
// Expenses tab (and toll is Fastag under Monthly Expenses).
interface NewLine { date: string; amount: string; details: string }

function blankLine(): NewLine {
  return { date: todayIso(), amount: '0', details: '' };
}

// Toll isn't entered per trip any more — Fastag is recorded under Monthly
// Expenses and shown as Toll in the Monthly Report. (Existing trips that
// already carry a toll line keep it.)
const MAX_STOPS = 20;

// Column sizes shared by every Route row so the odometer boxes line up.
const ROUTE_PLACE = '2 1 180px';
const ROUTE_DATE = '1 1 130px';
const ROUTE_ODO = '0 1 110px';
const ROUTE_NOTE = '1 1 120px';
const ROUTE_ACTIONS = 96;
const ROUTE_ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' };

function routeBadge(kind: 'start' | 'stop' | 'end'): React.CSSProperties {
  const filled = kind !== 'stop';
  return {
    flex: 'none', width: 24, height: 24, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700,
    background: kind === 'end' ? 'var(--color-accent)' : kind === 'start' ? 'var(--color-text)' : 'transparent',
    color: filled ? '#fff' : 'var(--color-text)',
    border: filled ? 'none' : '2px solid var(--color-text)'
  };
}

type SubmitAction = 'create' | 'start' | 'save' | 'complete';

interface Props {
  onSubmit: (action: SubmitAction, trip: Trip) => void;
  driverOnly: boolean;
  vehicles: Vehicle[];
  drivers: DriverMaster[];
  master: MasterSettings;
  leaves: DriverLeave[];
  unavailability: VehicleUnavailability[];
  transporters: string[];
  defaultDriverName?: string;
  editingTrip?: Trip | null;
  onCancelEdit?: () => void;
}

export function AddMovement({ onSubmit, driverOnly, vehicles, drivers, master, leaves, unavailability, transporters, defaultDriverName, editingTrip, onCancelEdit }: Props) {
  const showFinancials = !driverOnly;
  const isEditing = !!editingTrip;
  const isCompleted = editingTrip?.status === 'approved';
  const [form, setForm] = useState<TripFormState>(() => (editingTrip ? formFromTrip(editingTrip) : blankForm(defaultDriverName, master.loadingPoint ?? '')));
  const [lines, setLines] = useState<TripExpenseLine[]>(() => editingTrip?.expenses ?? []);
  const [newLine, setNewLine] = useState<NewLine>(blankLine());
  const [documents, setDocuments] = useState<TripDocument[]>(() => editingTrip?.documents ?? []);
  const [stops, setStops] = useState<TripStop[]>(() => editingTrip?.stops ?? []);
  const [lastAddedStop, setLastAddedStop] = useState<string | null>(null);
  // The Master loading point is only a starting value: it fills A until the
  // user types (or erases) it themselves, and follows the setting if that
  // arrives after the form has opened.
  const [fromTouched, setFromTouched] = useState(false);
  // A preview only, for a new movement — harmless to drop into the form since
  // the server assigns the real number itself and ignores whatever this
  // sends. Can differ from what's actually assigned if someone else's trip
  // is saved first.
  function loadTripNoPreview() {
    fetchNextTripNumberPreview().then((n) => setForm((f) => (f.waybillNo ? f : { ...f, waybillNo: n }))).catch(() => { /* leave blank — it's shown for real once saved */ });
  }
  useEffect(() => {
    if (!isEditing) loadTripNoPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [viewingDoc, setViewingDoc] = useState<string | null>(null);
  const [docErrorMsg, setDocErrorMsg] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmAction, setConfirmAction] = useState<SubmitAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing || fromTouched || master.loadingPoint === null) return;
    setForm((f) => (f.from === master.loadingPoint ? f : { ...f, from: master.loadingPoint! }));
  }, [isEditing, fromTouched, master.loadingPoint]);

  useEffect(() => {
    const count = Object.keys(errors).length;
    if (count === 0) return;
    setToast(`${count} field${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention`);
    errorBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [errors]);

  const set = (k: keyof TripFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value } as TripFormState));
    setErrors({});
  };

  // A truck's default driver is only a starting point, filled in whenever the
  // truck is picked or changed — on a new movement or an existing one alike.
  // The dropdown right next to it stays fully editable.
  const defaultDriverFor = (vehicleId: string): string => {
    const name = vehicles.find((v) => v.id === vehicleId)?.defaultDriver;
    return name && drivers.some((d) => d.name === name) ? name : '';
  };

  // Trip numbers are assigned by the server (DEMO-00001, DEMO-00002, ...) the
  // moment a movement is created, and never editable from here — the field
  // just displays whatever the trip already has, or is blank until saved.
  const onVehicleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const vehicleId = e.target.value;
    const defaultDriver = defaultDriverFor(vehicleId);
    setForm((f) => ({ ...f, vehicle: vehicleId, driver: defaultDriver || f.driver }));
    setErrors({});
  };

  const onLoadDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, loadDate: e.target.value }));
    setErrors({});
  };

  function addLine() {
    const amount = toNumber(newLine.amount);
    if (!amount || !newLine.details.trim()) return;
    const line: TripExpenseLine = { id: 'x' + Date.now(), date: newLine.date, kind: 'other', amount, details: newLine.details.trim() };
    setLines((prev) => [...prev, line]);
    setNewLine(blankLine());
  }

  // Edit = put the entry back in the form above and take it off the list; press
  // Add entry to save it again. Fuel lines are edited on the Fuel Expenses tab.
  function editLine(l: TripExpenseLine) {
    setNewLine({ date: parseDisplayDate(l.date) || l.date, amount: String(l.amount), details: l.details ?? '' });
    setLines((prev) => prev.filter((x) => x.id !== l.id));
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  function addStop() {
    const id = 's' + Date.now() + Math.random().toString(36).slice(2, 6);
    const lastDate = stops.slice().reverse().find((st) => st.date)?.date || form.loadDate;
    setStops((prev) => (prev.length >= MAX_STOPS ? prev : [...prev, { id, location: '', date: lastDate, note: '' }]));
    setLastAddedStop(id);
  }

  function updateStop(id: string, patch: Partial<TripStop>) {
    setStops((prev) => prev.map((st) => (st.id === id ? { ...st, ...patch } : st)));
    setErrors({});
  }

  function moveStop(index: number, by: -1 | 1) {
    setStops((prev) => {
      const j = index + by;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function removeStop(id: string) {
    setStops((prev) => prev.filter((st) => st.id !== id));
  }

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

  async function viewDocument(doc: TripDocument) {
    if (doc.base64) {
      const byteChars = atob(doc.base64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: doc.mimeType || 'application/octet-stream' }));
      window.open(url, '_blank');
      return;
    }
    if (!editingTrip) return;
    setViewingDoc(doc.id);
    try {
      const url = await fetchDocumentBlobUrl(editingTrip.id, doc.id);
      window.open(url, '_blank');
    } catch {
      setDocErrorMsg('Could not open that file — try again.');
    } finally {
      setViewingDoc(null);
    }
  }

  const km = Math.max(0, toNumber(form.odoEnd) - toNumber(form.odoStart));
  const expense = lines.reduce((a, l) => a + l.amount, 0);
  const profit = toNumber(form.revenue) - expense;
  const litres = dieselLitres(lines);
  const kmpl = litres ? (km / litres).toFixed(2) + ' km/l' : '—';
  const driverLeaveConflicts = overlappingLeaves(leaves, form.driver, form.loadDate, form.unloadDate);
  const vehicleConflicts = overlappingUnavailability(unavailability, form.vehicle, form.loadDate, form.unloadDate);

  // Blank rows are ignored; a note or reading with no place is an error.
  const cleanStops: TripStop[] = stops
    .map((st) => ({ ...st, location: st.location.trim(), date: st.date || undefined, odo: st.odo && st.odo > 0 ? st.odo : undefined, note: (st.note ?? '').trim() }))
    .filter((st) => st.location);

  // requireOdoEnd is narrower than completing: an Office/Manager "Add
  // movement" is completing=true (it still requires the loading weight and
  // start odometer up front) but requireOdoEnd=false — the end odometer is
  // often not yet known, and the trip is saved as a still-open movement
  // instead of an approved one until it's genuinely finished.
  function validate(completing: boolean, requireOdoEnd: boolean): Record<string, string> {
    const errs: Record<string, string> = {};
    const orphan = stops.findIndex((st) => !st.location.trim() && ((st.note ?? '').trim() || st.odo));
    if (orphan >= 0) errs.stops = `Stop ${orphan + 1} has a note or reading but no place — enter the place or remove the stop.`;
    else if (requireOdoEnd && cleanStops.some((st) => !st.odo)) {
      errs.stops = `Odometer reading is required at stop ${cleanStops.findIndex((st) => !st.odo) + 1} to complete this movement.`;
    } else {
      // readings only ever go up along the route: start, each stop, end
      let prev = toNumber(form.odoStart) > 0 ? toNumber(form.odoStart) : 0;
      for (let i = 0; i < cleanStops.length; i++) {
        const r = cleanStops[i].odo;
        if (r === undefined) continue;
        if (prev && r < prev) { errs.stops = `Stop ${i + 1} odometer (${r}) can't be lower than the previous reading (${prev}).`; break; }
        prev = r;
      }
      if (!errs.stops && prev && form.odoEnd && toNumber(form.odoEnd) < prev) {
        errs.odoEnd = `Odometer end can't be lower than the last stop's reading (${prev}).`;
      }
    }
    if (!errs.stops) {
      const missingDate = cleanStops.findIndex((st) => !st.date);
      if (missingDate >= 0) errs.stops = `Stop ${missingDate + 1} needs a date.`;
    }
    // Stop dates must only advance along the route: loading date -> Stop 1 -> Stop 2 -> ... -> unloading date
    if (!errs.stops) {
      let prevDate = form.loadDate;
      let prevLabel = `loading date (${form.loadDate})`;
      for (let i = 0; i < stops.length; i++) {
        const stDate = stops[i].date;
        if (!stDate) continue;
        if (stDate < prevDate) {
          errs.stops = `Stop ${i + 1} date (${stDate}) cannot be earlier than ${prevLabel}.`;
          break;
        }
        if (form.unloadDate && stDate > form.unloadDate) {
          errs.stops = `Stop ${i + 1} date (${stDate}) cannot be later than unloading date (${form.unloadDate}).`;
          break;
        }
        prevDate = stDate;
        prevLabel = `Stop ${i + 1} date (${stDate})`;
      }
    }
    if (!form.vehicle) errs.vehicle = 'Select a vehicle.';
    else if (overlappingUnavailability(unavailability, form.vehicle, form.loadDate, form.unloadDate).length > 0) {
      errs.vehicle = 'This truck is recorded unavailable for these dates — pick another truck or a different date.';
    }
    if (!form.driver) errs.driver = 'Select a driver.';
    if (completing) {
      if (toNumber(form.tons) <= 0) errs.tons = 'Loading weight is required to complete this movement.';
      if (toNumber(form.odoStart) <= 0) errs.odoStart = 'Odometer start is required to complete this movement.';
    }
    if (requireOdoEnd && toNumber(form.odoEnd) <= 0) errs.odoEnd = 'Odometer end is required to complete this movement.';
    if (form.odoEnd && toNumber(form.odoEnd) <= toNumber(form.odoStart)) {
      errs.odoEnd = 'Odometer end must be greater than odometer start.';
    }
    if (form.unloadDate) {
      const lastStopWithDate = stops.slice().reverse().find((st) => st.date);
      if (lastStopWithDate?.date && form.unloadDate < lastStopWithDate.date) {
        const lastIdx = stops.indexOf(lastStopWithDate) + 1;
        errs.unloadDate = `Unloading date (${form.unloadDate}) cannot be earlier than Stop ${lastIdx} date (${lastStopWithDate.date}).`;
      } else if (form.unloadDate < form.loadDate) {
        errs.unloadDate = 'Unloading date cannot be before the loading date.';
      }
    }
    return errs;
  }

  function buildTrip(): Trip {
    return {
      id: editingTrip?.id ?? 't' + Date.now(),
      loadDate: form.loadDate, unloadDate: form.unloadDate || form.loadDate, vehicle: form.vehicle, driver: form.driver,
      waybillNo: form.waybillNo || '—', itemNo: form.itemNo || '—', from: form.from || '—', to: form.to || '—',
      tons: toNumber(form.tons), km,
      odoStart: form.odoStart ? toNumber(form.odoStart) : undefined,
      odoEnd: form.odoEnd ? toNumber(form.odoEnd) : undefined,
      revenue: toNumber(form.revenue),
      fromNote: form.fromNote.trim(), toNote: form.toNote.trim(),
      remarks: form.remarks.trim(),
      transporter: form.transporter,
      status: editingTrip?.status ?? 'pending',
      expenses: lines,
      stops: cleanStops,
      documents
    };
  }

  function tryAction(action: SubmitAction, completing: boolean) {
    // 'create' is Office/Manager's initial Add Movement — the end odometer
    // isn't required there (see validate's comment); every other completing
    // action ('complete', or 'save' on an already-approved movement) does.
    const requireOdoEnd = completing && action !== 'create';
    const errs = validate(completing, requireOdoEnd);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setConfirmAction(action);
  }

  function confirmSubmit() {
    if (!confirmAction) return;
    onSubmit(confirmAction, buildTrip());
  }

  function resetForm() {
    if (editingTrip) {
      setForm(formFromTrip(editingTrip));
      setLines(editingTrip.expenses);
      setDocuments(editingTrip.documents);
      setStops(editingTrip.stops);
    } else {
      setForm(blankForm(defaultDriverName, master.loadingPoint ?? ''));
      setFromTouched(false);
      setLines([]);
      setDocuments([]);
      setStops([]);
      loadTripNoPreview();
    }
    setErrors({});
    setConfirmAction(null);
  }

  const errorClass = (key: string) => (errors[key] ? 'input input-error' : 'input');

  return (
    <section>
      {toast && (
        <div
          role="alert"
          style={{
            position: 'fixed', top: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 100,
            background: 'var(--color-accent)', color: '#fff', padding: '10px 22px', fontSize: 13, fontWeight: 700,
            letterSpacing: '0.02em', boxShadow: '0 6px 20px rgba(0,0,0,0.25)'
          }}
        >
          {toast}
        </div>
      )}
      <div style={{ marginBottom: 18 }}>
        <div className="kicker">Driver or documentation resource</div>
        <h1>{isEditing ? 'Edit Movement' : 'Add Movement'}</h1>
        <p style={{ color: 'var(--color-neutral-700)', marginTop: 6, fontSize: 13 }}>
          {isCompleted
            ? 'This movement is complete. Changes you save replace what is recorded and are kept in the audit log.'
            : isEditing ? 'Update an open movement, add entries to it, or mark it complete.' : 'Add a new movement and its expense entries as you go. Fuel is posted from Fuel & Expenses.'}
        </p>
      </div>
      <div className="movement-grid">
        <div style={{ background: 'var(--color-surface)', padding: 20, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
          <div className="filters-grid" style={{ alignItems: 'stretch' }}>
            <div className="field"><label>Trip number</label>
              <input
                className="input" type="text" placeholder="Loading…" value={form.waybillNo === '—' ? '' : form.waybillNo}
                disabled title="Assigned automatically by the server — it can't be changed"
              />
              <div style={{ fontSize: 11, color: 'var(--color-neutral-700)', marginTop: 4 }}>
                {isEditing ? "Assigned automatically — can't be changed." : 'Preview — confirmed once you save.'}
              </div>
            </div>
            <div className="field"><label>Loading date</label><input className="input" type="date" max={stops.find((s) => s.date)?.date || form.unloadDate || undefined} value={form.loadDate} onChange={onLoadDateChange} /></div>
            <div className="field"><label>Unloading date</label><input className={errorClass('unloadDate')} type="date" min={stops.slice().reverse().find((st) => st.date)?.date || form.loadDate} value={form.unloadDate} onChange={set('unloadDate')} /></div>
            <div className="field">
              <label>Vehicle *</label>
              <select className={errorClass('vehicle')} value={form.vehicle} onChange={onVehicleChange}>
                <option value="">Select vehicle</option>
                {vehicles.map((v) => {
                  const unavailable = overlappingUnavailability(unavailability, v.id, form.loadDate, form.unloadDate).length > 0;
                  return (
                    <option key={v.id} value={v.id} disabled={unavailable && v.id !== form.vehicle}>
                      {v.id}{unavailable ? ' (unavailable for these dates)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="field">
              <label>Driver *</label>
              <select className={errorClass('driver')} value={form.driver} onChange={set('driver')}>
                <option value="">Select driver</option>
                {drivers.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Item no</label><input className="input" type="text" placeholder="ITM-0000" value={form.itemNo} onChange={set('itemNo')} /></div>
            <div className="field"><label>Loading weight (tons)</label><input className={errorClass('tons')} type="number" step="any" inputMode="decimal" value={form.tons} onChange={set('tons')} /></div>
            {showFinancials && (
              <div className="field"><label>Revenue (₹)</label><input className="input" type="number" step="any" inputMode="decimal" value={form.revenue} onChange={set('revenue')} /></div>
            )}
            <div className="field field-span-2"><label>Remarks</label><input className="input" type="text" placeholder="Remarks" value={form.remarks} onChange={set('remarks')} /></div>
            <div className="field">
              <label htmlFor="movement-transporter">Transporter</label>
              <select id="movement-transporter" className="input" value={form.transporter} onChange={set('transporter')}>
                <option value="">Select transporter</option>
                {/* A transporter since removed from Master still shows on the movement it was saved with. */}
                {form.transporter && !transporters.includes(form.transporter) && <option value={form.transporter}>{form.transporter} (removed)</option>}
                {transporters.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {vehicleConflicts.length > 0 && !confirmAction && (
            <div role="status" style={{ border: '1px solid var(--color-accent-200)', borderRadius: 'var(--radius-md)', background: 'var(--color-accent-100)', color: 'var(--color-accent-800)', padding: '10px 14px', marginTop: 16, fontSize: 13, display: 'grid', gap: 4 }}>
              <strong>{form.vehicle} is recorded unavailable during these dates:</strong>
              {vehicleConflicts.map((w) => (
                <div key={w.id}>{formatDisplayDateTime(w.startsAt)} → {formatDisplayDateTime(w.endsAt)}{w.remarks ? ` — ${w.remarks}` : ''}</div>
              ))}
            </div>
          )}

          {driverLeaveConflicts.length > 0 && !confirmAction && (
            <div role="status" style={{ border: '1px solid var(--color-accent-200)', borderRadius: 'var(--radius-md)', background: 'var(--color-accent-100)', color: 'var(--color-accent-800)', padding: '10px 14px', marginTop: 16, fontSize: 13, display: 'grid', gap: 4 }}>
              <strong>{form.driver} is recorded on leave during these dates:</strong>
              {driverLeaveConflicts.map((l) => (
                <div key={l.id}>{formatDisplayDateTime(l.startsAt)} → {formatDisplayDateTime(l.endsAt)}{l.remarks ? ` — ${l.remarks}` : ''}</div>
              ))}
              <div>You can still save this movement — double-check the driver or dates first.</div>
            </div>
          )}

          <div style={{ marginTop: 20, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', marginBottom: 12 }}>
              Route
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="route-head" style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--color-neutral-700)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                <span style={{ width: 24, flex: 'none' }} />
                <span style={{ flex: ROUTE_PLACE }}>Place</span>
                <span style={{ flex: ROUTE_DATE }}>Date</span>
                <span style={{ flex: ROUTE_ODO }}>Odometer (km)</span>
                <span style={{ flex: ROUTE_NOTE }}>Note</span>
                <span style={{ width: ROUTE_ACTIONS, flex: 'none' }} />
              </div>

              <div style={ROUTE_ROW}>
                <span style={routeBadge('start')} aria-hidden="true">A</span>
                <input className="input" type="text" aria-label="Loading point" placeholder="Loading point (yard / factory)" value={form.from} onChange={(e) => { setFromTouched(true); set('from')(e); }} style={{ flex: ROUTE_PLACE, minWidth: 0 }} />
                <input className="input" type="date" max={stops.find((s) => s.date)?.date || form.unloadDate || undefined} aria-label="Loading date" value={form.loadDate} onChange={onLoadDateChange} style={{ flex: ROUTE_DATE, minWidth: 0 }} />
                <input className={errorClass('odoStart')} type="number" inputMode="numeric" aria-label="Odometer at start (km)" placeholder="Start odo" value={form.odoStart} onChange={set('odoStart')} style={{ flex: ROUTE_ODO, minWidth: 0 }} />
                <input className="input" type="text" aria-label="Loading point note" placeholder="Note (optional)" value={form.fromNote} onChange={set('fromNote')} style={{ flex: ROUTE_NOTE, minWidth: 0 }} />
                <span className="route-spacer" style={{ width: ROUTE_ACTIONS, flex: 'none' }} />
              </div>

              {stops.map((st, i) => {
                const minStopDate = stops.slice(0, i).reverse().find((s) => s.date)?.date || form.loadDate;
                const maxStopDate = stops.slice(i + 1).find((s) => s.date)?.date || form.unloadDate || undefined;
                return (
                  <div key={st.id} style={ROUTE_ROW}>
                    <span style={routeBadge('stop')} aria-hidden="true">{i + 1}</span>
                    <input
                      className="input" type="text" aria-label={`Stop ${i + 1} place`} placeholder={`Stop ${i + 1} — place`}
                      value={st.location} autoFocus={st.id === lastAddedStop}
                      onChange={(e) => updateStop(st.id, { location: e.target.value })}
                      style={{ flex: ROUTE_PLACE, minWidth: 0 }}
                    />
                    <input
                      className="input" type="date" min={minStopDate} max={maxStopDate}
                      aria-label={`Stop ${i + 1} date`}
                      value={st.date ?? ''}
                      onChange={(e) => updateStop(st.id, { date: e.target.value })}
                      style={{ flex: ROUTE_DATE, minWidth: 0 }}
                    />
                    <input
                      className="input" type="number" inputMode="numeric" aria-label={`Stop ${i + 1} odometer`} placeholder="Odo (km)"
                      value={st.odo ?? ''} onChange={(e) => updateStop(st.id, { odo: e.target.value ? Number(e.target.value) : undefined })}
                      style={{ flex: ROUTE_ODO, minWidth: 0 }}
                    />
                    <input
                      className="input" type="text" aria-label={`Stop ${i + 1} note`} placeholder="Note (optional)"
                      value={st.note ?? ''} onChange={(e) => updateStop(st.id, { note: e.target.value })}
                      style={{ flex: ROUTE_NOTE, minWidth: 0 }}
                    />
                    <span style={{ display: 'flex', width: ROUTE_ACTIONS, flex: 'none', justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-ghost" aria-label={`Move stop ${i + 1} up`} disabled={i === 0} onClick={() => moveStop(i, -1)} style={{ padding: '4px 8px' }}>↑</button>
                      <button type="button" className="btn btn-ghost" aria-label={`Move stop ${i + 1} down`} disabled={i === stops.length - 1} onClick={() => moveStop(i, 1)} style={{ padding: '4px 8px' }}>↓</button>
                      <button type="button" className="btn btn-ghost" aria-label={`Remove stop ${i + 1}`} onClick={() => removeStop(st.id)} style={{ padding: '4px 8px' }}>✕</button>
                    </span>
                  </div>
                );
              })}

              <div style={ROUTE_ROW}>
                <span style={routeBadge('end')} aria-hidden="true">B</span>
                <input className="input" type="text" aria-label="Final unloading point" placeholder="Final unloading point (warehouse / yard)" value={form.to} onChange={set('to')} style={{ flex: ROUTE_PLACE, minWidth: 0 }} />
                <input className={errorClass('unloadDate')} type="date" min={stops.slice().reverse().find((st) => st.date)?.date || form.loadDate} aria-label="Unloading date" value={form.unloadDate} onChange={set('unloadDate')} style={{ flex: ROUTE_DATE, minWidth: 0 }} />
                <input className={errorClass('odoEnd')} type="number" inputMode="numeric" aria-label="Odometer at trip end (km)" placeholder="End odo" value={form.odoEnd} onChange={set('odoEnd')} style={{ flex: ROUTE_ODO, minWidth: 0 }} />
                <input className="input" type="text" aria-label="Final unloading point note" placeholder="Note (optional)" value={form.toNote} onChange={set('toNote')} style={{ flex: ROUTE_NOTE, minWidth: 0 }} />
                <span className="route-spacer" style={{ width: ROUTE_ACTIONS, flex: 'none' }} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={addStop} disabled={stops.length >= MAX_STOPS}>Add stop</button>
              <span style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>
                {stops.length === 0 ? 'Optional — add stops between the loading point and the final unloading point.' : 'Stops are visited in this order, before the final unloading point.'}
              </span>
            </div>
          </div>

          <div style={{ marginTop: 20, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', marginBottom: 12 }}>
              Expense entries
            </div>
            <div className="filters-grid" style={{ alignItems: 'end', marginBottom: 12 }}>
              <div className="field">
                <label>Date</label>
                <input className="input" type="date" value={newLine.date} onChange={(e) => setNewLine((l) => ({ ...l, date: e.target.value }))} />
              </div>
              <div className="field">
                <label>Amount (₹)</label>
                <input className="input" type="number" step="any" inputMode="decimal" value={newLine.amount} onChange={(e) => setNewLine((l) => ({ ...l, amount: e.target.value }))} />
              </div>
              <div className="field">
                <label>Details *</label>
                <input className="input" type="text" placeholder="What was this for?" value={newLine.details} onChange={(e) => setNewLine((l) => ({ ...l, details: e.target.value }))} />
              </div>
              <div>
                <button type="button" className="btn btn-secondary" onClick={addLine}>Add entry</button>
              </div>
            </div>

            {lines.length > 0 && (
              <div className="scroll-x" style={{ border: '1px solid var(--color-neutral-300)' }}>
                <table className="table" style={{ minWidth: 620 }}>
                  <thead>
                    <tr><th>Date</th><th>Kind</th><th>Details</th><th style={{ textAlign: 'right' }}>Litres</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{l.date}</td>
                        <td>{TRIP_EXPENSE_LABEL[l.kind]}</td>
                        <td style={{ color: 'var(--color-neutral-700)' }}>{l.details ?? '—'}</td>
                        <td style={{ textAlign: 'right' }}>{l.litres != null ? l.litres.toFixed(2) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{rupees(l.amount)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {l.kind === 'other' && (
                            <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => editLine(l)}>Edit</button>
                          )}
                          {/* Fuel lines belong to Office/Manager; a driver can't change them (the server refuses it). */}
                          {!(driverOnly && l.kind !== 'other') && (
                            <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => removeLine(l.id)}>Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>Total</td>
                      <td style={{ textAlign: 'right' }}>{rupees(lines.reduce((a, l) => a + l.amount, 0))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-neutral-700)', marginBottom: 12 }}>Supporting documents</div>
            <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf" onChange={onFilesChosen} style={{ marginBottom: docErrorMsg || documents.length ? 10 : 0 }} />
            {docErrorMsg && (
              <div style={{ fontSize: 12, color: 'var(--color-accent-800)', marginBottom: 10 }}>{docErrorMsg}</div>
            )}
            {documents.length > 0 && (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                {documents.map((d) => (
                  <li key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 13, background: 'var(--color-surface)', padding: '6px 10px' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</span>
                    <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button type="button" className="btn btn-ghost" style={{ padding: '0 4px', fontSize: 12 }} disabled={viewingDoc === d.id} onClick={() => viewDocument(d)}>
                        {viewingDoc === d.id ? 'Opening…' : 'View'}
                      </button>
                      <button type="button" className="btn btn-ghost" style={{ padding: '0 4px', fontSize: 12 }} onClick={() => removeDocument(d.id)}>Remove</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {Object.keys(errors).length > 0 && (
            <div ref={errorBoxRef} style={{ border: '1px solid var(--color-accent-200)', borderRadius: 'var(--radius-md)', color: 'var(--color-accent-700)', padding: '10px 14px', marginTop: 16, fontSize: 13, display: 'grid', gap: 4 }}>
              {Object.values(errors).map((msg) => <div key={msg}>{msg}</div>)}
            </div>
          )}

          {confirmAction ? (
            <MovementReview
              action={confirmAction}
              leaves={leaves}
              unavailability={unavailability}
              form={{ ...form, unloadDate: form.unloadDate || form.loadDate }}
              original={editingTrip ? formFromTrip(editingTrip) : null}
              lines={lines}
              originalLines={editingTrip?.expenses ?? []}
              stops={cleanStops}
              originalStops={editingTrip?.stops ?? []}
              documents={documents}
              originalDocuments={editingTrip?.documents ?? []}
              showFinancials={showFinancials}
              wasCompleted={isCompleted}
              totals={{ km, expense, profit }}
              onConfirm={confirmSubmit}
              onBack={() => setConfirmAction(null)}
            />
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingTop: 16, marginTop: 16, borderTop: '1px solid var(--color-border)' }}>
              {isEditing ? (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => tryAction('save', isCompleted)}>Save changes</button>
                  {!driverOnly && !isCompleted && (
                    <button type="button" className="btn btn-secondary" onClick={() => tryAction('complete', true)}>Complete movement</button>
                  )}
                  <button type="button" className="btn btn-ghost" onClick={onCancelEdit}>Cancel edit</button>
                </>
              ) : driverOnly ? (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => tryAction('start', false)}>Add movement</button>
                  <button type="button" className="btn btn-ghost" onClick={resetForm}>Clear</button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => tryAction('create', true)}>Add movement</button>
                  <button type="button" className="btn btn-ghost" onClick={resetForm}>Clear</button>
                </>
              )}
            </div>
          )}

        </div>

        <div className="movement-sidebar">
          <div style={{ background: 'var(--color-surface)', padding: 20, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', display: 'grid', gap: 18 }}>
            <div>
              <div className="stat-label" style={{ marginBottom: 4 }}>Distance</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 22 }}>{km.toLocaleString('en-IN')} km</div>
            </div>
            <div>
              <div className="stat-label" style={{ marginBottom: 4 }}>Trip expense</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 22 }}>{rupees(expense)}</div>
            </div>
            {showFinancials && (
              <div>
                <div className="stat-label" style={{ marginBottom: 4 }}>Profit</div>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 22, color: profit >= 0 ? 'var(--color-profit)' : 'var(--color-accent-700)' }}>{rupees(profit)}</div>
              </div>
            )}
            <div>
              <div className="stat-label" style={{ marginBottom: 4 }}>Mileage</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 22 }}>{kmpl}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
