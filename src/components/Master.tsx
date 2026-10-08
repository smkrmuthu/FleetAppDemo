import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { DriverLeave, DriverMaster, MasterSettings, Vehicle, VehicleUnavailability } from '../types';
import { formatDisplayDateTime } from '../lib/api';
import { BackupPanel } from './BackupPanel';
import { Pager, usePaging } from './Pager';
import { formatLeaveDuration, leaveDurationMinutes } from '../utils/calc';

interface Props {
  vehicles: Vehicle[];
  drivers: DriverMaster[];
  settings: MasterSettings;
  onSave: (patch: Partial<MasterSettings>) => Promise<string | null>;
  onSetDefaultDriver: (vehicleId: string, driver: string) => Promise<string | null>;
  leaves: DriverLeave[];
  onAddLeave: (l: { driver: string; startsAt: string; endsAt: string; remarks?: string }) => Promise<string | null>;
  onRemoveLeave: (id: string) => void;
  unavailability: VehicleUnavailability[];
  onAddUnavailability: (w: { vehicle: string; startsAt: string; endsAt: string; remarks?: string }) => Promise<string | null>;
  onUpdateUnavailability: (id: string, w: { vehicle: string; startsAt: string; endsAt: string; remarks?: string }) => Promise<string | null>;
  onRemoveUnavailability: (id: string) => void;
  categories: string[];
  onAddCategory: (name: string) => Promise<string | null>;
  onRemoveCategory: (name: string) => void;
  transporters: string[];
  onAddTransporter: (name: string) => Promise<string | null>;
  onRemoveTransporter: (name: string) => void;
  isManager: boolean;
}

function blankUnavailabilityForm(defaultVehicle: string) {
  return { vehicle: defaultVehicle, startsAt: '', endsAt: '', remarks: '' };
}

function blankLeaveForm(defaultDriver: string) {
  return { driver: defaultDriver, startsAt: '', endsAt: '', remarks: '' };
}

const fmt = (n: number | null) => (n === null ? '' : String(n));

export function Master({
  vehicles, drivers, settings, onSave, onSetDefaultDriver, leaves, onAddLeave, onRemoveLeave,
  unavailability, onAddUnavailability, onUpdateUnavailability, onRemoveUnavailability, categories, onAddCategory, onRemoveCategory,
  transporters, onAddTransporter, onRemoveTransporter, isManager
}: Props) {
  const rates = settings;
  const [driverQuery, setDriverQuery] = useState('');
  const [diesel, setDiesel] = useState(fmt(rates.dieselRate));
  const [adblue, setAdblue] = useState(fmt(rates.adblueRate));
  const [rateError, setRateError] = useState('');
  const [rateSaved, setRateSaved] = useState(false);
  const [savingRates, setSavingRates] = useState(false);
  const [rowStatus, setRowStatus] = useState<Record<string, string>>({});
  const [point, setPoint] = useState(settings.loadingPoint ?? '');
  const [pointError, setPointError] = useState('');
  const [pointSaved, setPointSaved] = useState(false);
  const [savingPoint, setSavingPoint] = useState(false);

  // Rates arrive after the first render (they're fetched with everything
  // else), so the form has to follow them in.
  useEffect(() => {
    setDiesel(fmt(rates.dieselRate));
    setAdblue(fmt(rates.adblueRate));
  }, [rates.dieselRate, rates.adblueRate]);

  useEffect(() => {
    setPoint(settings.loadingPoint ?? '');
  }, [settings.loadingPoint]);

  const pointDirty = point.trim() !== (settings.loadingPoint ?? '');

  async function savePoint() {
    setPointError('');
    setPointSaved(false);
    setSavingPoint(true);
    const err = await onSave({ loadingPoint: point.trim() || null });
    setSavingPoint(false);
    if (err) setPointError(err);
    else setPointSaved(true);
  }

  const dirty = diesel.trim() !== fmt(rates.dieselRate) || adblue.trim() !== fmt(rates.adblueRate);

  function parseRate(label: string, raw: string): { ok: true; value: number | null } | { ok: false; error: string } {
    const t = raw.trim();
    if (!t) return { ok: true, value: null };
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: `${label} rate must be a number above 0.` };
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false, error: `${label} rate can have at most 2 decimal places.` };
    if (n > 1000) return { ok: false, error: `${label} rate looks too high — check it.` };
    return { ok: true, value: n };
  }

  async function saveRates() {
    const d = parseRate('Diesel', diesel);
    if (!d.ok) return setRateError(d.error);
    const a = parseRate('AdBlue', adblue);
    if (!a.ok) return setRateError(a.error);
    setRateError('');
    setRateSaved(false);
    setSavingRates(true);
    const err = await onSave({ dieselRate: d.value, adblueRate: a.value });
    setSavingRates(false);
    if (err) setRateError(err);
    else setRateSaved(true);
  }

  async function changeDefaultDriver(vehicleId: string, driver: string) {
    const takenBy = driver ? vehicles.find((v) => v.id !== vehicleId && v.defaultDriver === driver) : undefined;
    if (takenBy) {
      setRowStatus((s) => ({ ...s, [vehicleId]: `${driver} is already the default driver of ${takenBy.id}.` }));
      return;
    }
    setRowStatus((s) => ({ ...s, [vehicleId]: 'Saving…' }));
    const err = await onSetDefaultDriver(vehicleId, driver);
    setRowStatus((s) => ({ ...s, [vehicleId]: err ?? 'Saved' }));
    if (!err) setTimeout(() => setRowStatus((s) => (s[vehicleId] === 'Saved' ? { ...s, [vehicleId]: '' } : s)), 2000);
  }

  const [leaveForm, setLeaveForm] = useState(() => blankLeaveForm(drivers[0]?.name ?? ''));
  const [leaveError, setLeaveError] = useState('');
  const [savingLeave, setSavingLeave] = useState(false);
  const sortedLeaves = [...leaves].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const leavePaging = usePaging(sortedLeaves.length, 'leaves');

  async function addLeave() {
    if (!leaveForm.driver) return setLeaveError('Select a driver.');
    if (!leaveForm.startsAt || !leaveForm.endsAt) return setLeaveError('Enter both the start and end date and time.');
    if (leaveForm.endsAt <= leaveForm.startsAt) return setLeaveError('End must be after start.');
    setLeaveError('');
    setSavingLeave(true);
    const err = await onAddLeave({
      driver: leaveForm.driver, startsAt: leaveForm.startsAt, endsAt: leaveForm.endsAt, remarks: leaveForm.remarks.trim() || undefined
    });
    setSavingLeave(false);
    if (err) setLeaveError(err);
    else setLeaveForm((f) => blankLeaveForm(f.driver));
  }

  const [unavailForm, setUnavailForm] = useState(() => blankUnavailabilityForm(vehicles[0]?.id ?? ''));
  const [unavailError, setUnavailError] = useState('');
  const [savingUnavail, setSavingUnavail] = useState(false);
  const sortedUnavailability = [...unavailability].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const unavailPaging = usePaging(sortedUnavailability.length, 'unavail');
  const shownVehicles = vehicles.filter((v) => !driverQuery.trim() || `${v.id} ${v.model}`.toLowerCase().includes(driverQuery.trim().toLowerCase()));
  const defaultPaging = usePaging(shownVehicles.length, driverQuery, 10); // each row's driver list is long, so keep the page short

  // The id of the window being edited, or null when the form is adding a new one.
  const [editingUnavailId, setEditingUnavailId] = useState<string | null>(null);

  function startEditUnavailability(w: VehicleUnavailability) {
    setEditingUnavailId(w.id);
    setUnavailError('');
    setUnavailForm({ vehicle: w.vehicle, startsAt: w.startsAt, endsAt: w.endsAt, remarks: w.remarks ?? '' });
    document.getElementById('unavail-vehicle')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function cancelEditUnavailability() {
    setEditingUnavailId(null);
    setUnavailError('');
    setUnavailForm((f) => blankUnavailabilityForm(f.vehicle));
  }

  async function addUnavailability() {
    if (!unavailForm.vehicle) return setUnavailError('Select a truck.');
    if (!unavailForm.startsAt || !unavailForm.endsAt) return setUnavailError('Enter both the start and end date and time.');
    if (unavailForm.endsAt <= unavailForm.startsAt) return setUnavailError('End must be after start.');
    setUnavailError('');
    setSavingUnavail(true);
    const payload = {
      vehicle: unavailForm.vehicle, startsAt: unavailForm.startsAt, endsAt: unavailForm.endsAt, remarks: unavailForm.remarks.trim() || undefined
    };
    const err = editingUnavailId ? await onUpdateUnavailability(editingUnavailId, payload) : await onAddUnavailability(payload);
    setSavingUnavail(false);
    if (err) return setUnavailError(err);
    setEditingUnavailId(null);
    setUnavailForm((f) => blankUnavailabilityForm(f.vehicle));
  }

  const [newTransporter, setNewTransporter] = useState('');
  const [transporterError, setTransporterError] = useState('');
  const [savingTransporter, setSavingTransporter] = useState(false);

  async function addTransporter() {
    const name = newTransporter.trim();
    if (!name) return setTransporterError('Enter a transporter name.');
    if (transporters.some((t) => t.toLowerCase() === name.toLowerCase())) return setTransporterError('That transporter already exists.');
    setTransporterError('');
    setSavingTransporter(true);
    const err = await onAddTransporter(name);
    setSavingTransporter(false);
    if (err) setTransporterError(err);
    else setNewTransporter('');
  }

  const [newCategory, setNewCategory] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return setCategoryError('Enter a description.');
    if (categories.some((c) => c.toLowerCase() === name.toLowerCase())) return setCategoryError('That description already exists.');
    setCategoryError('');
    setSavingCategory(true);
    const err = await onAddCategory(name);
    setSavingCategory(false);
    if (err) setCategoryError(err);
    else setNewCategory('');
  }

  return (
    <section>
      <div style={{ marginBottom: 18 }}>
        <div className="kicker">Office and Manager</div>
        <h1>Masters</h1>
        <p style={{ color: 'var(--color-neutral-700)', marginTop: 6, fontSize: 13 }}>
          Reference values the rest of the app picks up — set them once here instead of typing them on every movement.
        </p>
      </div>

      <h2 style={{ fontSize: 'var(--fs-section)', margin: 'var(--space-8) 0 12px' }}>Fuel rates</h2>
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 30, background: 'var(--color-surface)' }}>
        <form
          className="filters-grid"
          onSubmit={(e) => { e.preventDefault(); saveRates(); }}
        >
          <div className="field">
            <label htmlFor="rate-diesel">Diesel (₹ per litre)</label>
            <input
              id="rate-diesel" className="input" type="number" step="0.01" inputMode="decimal" placeholder="e.g. 95.60"
              value={diesel} onChange={(e) => { setDiesel(e.target.value); setRateSaved(false); }}
            />
          </div>
          <div className="field">
            <label htmlFor="rate-adblue">AdBlue (₹ per litre)</label>
            <input
              id="rate-adblue" className="input" type="number" step="0.01" inputMode="decimal" placeholder="e.g. 62"
              value={adblue} onChange={(e) => { setAdblue(e.target.value); setRateSaved(false); }}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={!dirty || savingRates}>
            {savingRates ? 'Saving…' : 'Save rates'}
          </button>
          {rateError && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{rateError}</div>}
          {rateSaved && !rateError && <div role="status" style={{ color: 'var(--color-profit)', fontSize: 13, fontWeight: 600 }}>Saved — new fuel entries will start from these rates.</div>}
        </form>
        <p style={{ color: 'var(--color-neutral-700)', fontSize: 12, marginTop: 12, marginBottom: 0, maxWidth: '74ch', lineHeight: 1.6 }}>
          Used as the starting rate whenever someone adds a Diesel or AdBlue entry in Add Movement. It can still be changed on an
          individual entry (a different pump, say). Entries already saved keep the rate they were saved with, so changing a
          rate here never alters past movements. Clear a box to remove that rate.
        </p>
      </div>

      <h2 style={{ fontSize: 'var(--fs-section)', margin: 'var(--space-8) 0 12px' }}>Default loading point</h2>
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 30, background: 'var(--color-surface)' }}>
        <form className="filters-grid" onSubmit={(e) => { e.preventDefault(); savePoint(); }}>
          <div className="field field-span-2">
            <label htmlFor="default-loading-point">Loading point</label>
            <input
              id="default-loading-point" className="input" type="text" placeholder="e.g. Bharathi Cements" maxLength={200}
              value={point} onChange={(e) => { setPoint(e.target.value); setPointSaved(false); }}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={!pointDirty || savingPoint}>
            {savingPoint ? 'Saving…' : 'Save loading point'}
          </button>
          {pointError && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{pointError}</div>}
          {pointSaved && !pointError && <div role="status" style={{ color: 'var(--color-profit)', fontSize: 13, fontWeight: 600 }}>Saved — new movements will start from this place.</div>}
        </form>
        <p style={{ color: 'var(--color-neutral-700)', fontSize: 12, marginTop: 12, marginBottom: 0, maxWidth: '74ch', lineHeight: 1.6 }}>
          Filled in as the route's starting point (A) on every new movement. It's only a starting value — whoever adds the
          movement can change it or erase it. Clear the box to have no default.
        </p>
      </div>

      <h2 style={{ fontSize: 'var(--fs-section)', margin: 'var(--space-8) 0 12px' }}>Default drivers</h2>
      <p style={{ color: 'var(--color-neutral-700)', fontSize: 13, marginTop: -4, marginBottom: 12, maxWidth: '74ch', lineHeight: 1.6 }}>
        When a truck is picked in Add Movement, its default driver is filled in for you. It's only a starting point — the driver
        can be changed on the movement. Changes here save as soon as you pick.
      </p>
      {vehicles.length > 10 && (
        <div className="fleet-search" style={{ marginBottom: 12, display: 'block' }}>
          <Search size={15} aria-hidden="true" />
          <input className="input" type="search" placeholder="Search trucks by reg no or model" aria-label="Search trucks" value={driverQuery} onChange={(e) => setDriverQuery(e.target.value)} />
        </div>
      )}
      <div className="scroll-x" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
        <table className="table" style={{ minWidth: 640 }}>
          <thead>
            <tr><th>Truck</th><th>Model</th><th>Default driver</th></tr>
          </thead>
          <tbody>
            {defaultPaging.slice(shownVehicles).map((v) => {
              const current = v.defaultDriver ?? '';
              const known = !current || drivers.some((d) => d.name === current);
              const status = rowStatus[v.id];
              return (
                <tr key={v.id}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{v.id}</td>
                  <td style={{ color: 'var(--color-neutral-700)' }}>{v.model}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <select
                        className="input" style={{ maxWidth: 260 }} aria-label={`Default driver for ${v.id}`}
                        value={current} onChange={(e) => changeDefaultDriver(v.id, e.target.value)}
                      >
                        <option value="">No default driver</option>
                        {!known && <option value={current}>{current} (removed)</option>}
                        {drivers.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
                      </select>
                      {status && (
                        <span role="status" style={{ fontSize: 12, color: status === 'Saving…' || status === 'Saved' ? 'var(--color-neutral-700)' : 'var(--color-accent-700)' }}>
                          {status}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {shownVehicles.length === 0 && (
              <tr><td colSpan={3} style={{ color: 'var(--color-neutral-700)' }}>{vehicles.length === 0 ? 'No trucks yet — add one under People.' : 'No trucks match.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager attached page={defaultPaging.page} pageSize={defaultPaging.size} total={shownVehicles.length} onPage={defaultPaging.setPage} />

      <h2 style={{ fontSize: 'var(--fs-section)', margin: 'var(--space-8) 0 12px' }}>Driver leave</h2>
      <p style={{ color: 'var(--color-neutral-700)', fontSize: 13, marginTop: -4, marginBottom: 12, maxWidth: '74ch', lineHeight: 1.6 }}>
        Record when a driver is off, down to the date and time — a half-day, an overnight break, or several days away.
      </p>
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20, background: 'var(--color-surface)' }}>
        <form className="filters-grid" onSubmit={(e) => { e.preventDefault(); addLeave(); }}>
          <div className="field">
            <label htmlFor="leave-driver">Driver</label>
            <select
              id="leave-driver" className="input" value={leaveForm.driver}
              onChange={(e) => setLeaveForm((f) => ({ ...f, driver: e.target.value }))}
            >
              <option value="">Select driver</option>
              {drivers.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="leave-from">From</label>
            <input
              id="leave-from" className="input" type="datetime-local" value={leaveForm.startsAt}
              onChange={(e) => setLeaveForm((f) => ({ ...f, startsAt: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="leave-to">To</label>
            <input
              id="leave-to" className="input" type="datetime-local" value={leaveForm.endsAt}
              onChange={(e) => setLeaveForm((f) => ({ ...f, endsAt: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="leave-remarks">Remarks</label>
            <input
              id="leave-remarks" className="input" type="text" placeholder="Optional" maxLength={300}
              value={leaveForm.remarks} onChange={(e) => setLeaveForm((f) => ({ ...f, remarks: e.target.value }))}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={savingLeave}>
            {savingLeave ? 'Saving…' : 'Add leave'}
          </button>
          {leaveError && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{leaveError}</div>}
        </form>
      </div>
      <div className="scroll-x" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
        <table className="table" style={{ minWidth: 640 }}>
          <thead>
            <tr><th>Driver</th><th>From</th><th>To</th><th>Duration</th><th>Remarks</th><th className="col-actions"></th></tr>
          </thead>
          <tbody>
            {leavePaging.slice(sortedLeaves).map((l) => (
              <tr key={l.id}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{l.driver}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDisplayDateTime(l.startsAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDisplayDateTime(l.endsAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatLeaveDuration(leaveDurationMinutes(l.startsAt, l.endsAt))}</td>
                <td style={{ color: 'var(--color-neutral-700)' }}>{l.remarks ?? '—'}</td>
                <td className="col-actions">
                  <button type="button" className="btn btn-ghost" style={{ color: 'var(--color-accent-700)' }} onClick={() => onRemoveLeave(l.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {sortedLeaves.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--color-neutral-700)' }}>No leave recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager attached page={leavePaging.page} pageSize={leavePaging.size} total={sortedLeaves.length} onPage={leavePaging.setPage} />

      <h2 style={{ fontSize: 'var(--fs-section)', margin: 'var(--space-8) 0 12px' }}>Truck unavailability</h2>
      <p style={{ color: 'var(--color-neutral-700)', fontSize: 13, marginTop: -4, marginBottom: 12, maxWidth: '74ch', lineHeight: 1.6 }}>
        Record when a truck is off the road — servicing, a breakdown, or any other downtime. A truck can't be picked in
        Add Movement for a trip that falls inside one of its recorded windows.
      </p>
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20, background: 'var(--color-surface)' }}>
        <form className="filters-grid" onSubmit={(e) => { e.preventDefault(); addUnavailability(); }}>
          <div className="field">
            <label htmlFor="unavail-vehicle">Truck</label>
            <select
              id="unavail-vehicle" className="input" value={unavailForm.vehicle}
              onChange={(e) => setUnavailForm((f) => ({ ...f, vehicle: e.target.value }))}
            >
              <option value="">Select truck</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="unavail-from">From</label>
            <input
              id="unavail-from" className="input" type="datetime-local" value={unavailForm.startsAt}
              onChange={(e) => setUnavailForm((f) => ({ ...f, startsAt: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="unavail-to">To</label>
            <input
              id="unavail-to" className="input" type="datetime-local" value={unavailForm.endsAt}
              onChange={(e) => setUnavailForm((f) => ({ ...f, endsAt: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="unavail-remarks">Remarks</label>
            <input
              id="unavail-remarks" className="input" type="text" placeholder="Optional" maxLength={300}
              value={unavailForm.remarks} onChange={(e) => setUnavailForm((f) => ({ ...f, remarks: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, justifySelf: 'start' }}>
            <button type="submit" className="btn btn-primary" disabled={savingUnavail}>
              {savingUnavail ? 'Saving…' : editingUnavailId ? 'Save changes' : 'Add unavailability'}
            </button>
            {editingUnavailId && (
              <button type="button" className="btn btn-ghost" disabled={savingUnavail} onClick={cancelEditUnavailability}>Cancel</button>
            )}
          </div>
          {unavailError && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{unavailError}</div>}
        </form>
      </div>
      <div className="scroll-x" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 30, background: 'var(--color-surface)' }}>
        <table className="table" style={{ minWidth: 640 }}>
          <thead>
            <tr><th>Truck</th><th>From</th><th>To</th><th>Duration</th><th>Remarks</th><th className="col-actions"></th></tr>
          </thead>
          <tbody>
            {unavailPaging.slice(sortedUnavailability).map((w) => (
              <tr key={w.id} style={editingUnavailId === w.id ? { background: 'var(--color-accent-100)' } : undefined}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{w.vehicle}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDisplayDateTime(w.startsAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDisplayDateTime(w.endsAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatLeaveDuration(leaveDurationMinutes(w.startsAt, w.endsAt))}</td>
                <td style={{ color: 'var(--color-neutral-700)' }}>{w.remarks ?? '—'}</td>
                <td className="col-actions">
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn btn-ghost" style={{ color: 'var(--color-text)' }} onClick={() => startEditUnavailability(w)}>Edit</button>
                    <button type="button" className="btn btn-ghost" style={{ color: 'var(--color-accent-700)' }} onClick={() => { if (editingUnavailId === w.id) cancelEditUnavailability(); onRemoveUnavailability(w.id); }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {sortedUnavailability.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--color-neutral-700)' }}>No unavailability recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager attached page={unavailPaging.page} pageSize={unavailPaging.size} total={sortedUnavailability.length} onPage={unavailPaging.setPage} />

      <h2 style={{ fontSize: 'var(--fs-section)', margin: 'var(--space-8) 0 12px' }}>Transporters</h2>
      <p style={{ color: 'var(--color-neutral-700)', fontSize: 13, marginTop: -4, marginBottom: 12, maxWidth: '74ch', lineHeight: 1.6 }}>
        The list offered under "Transporter" in Add Movement. Removing one only stops it being offered for new movements —
        anything already logged under it keeps its name.
      </p>
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20, background: 'var(--color-surface)' }}>
        <form className="filters-grid" onSubmit={(e) => { e.preventDefault(); addTransporter(); }}>
          <div className="field field-span-2">
            <label htmlFor="new-transporter">Transporter name</label>
            <input
              id="new-transporter" className="input" type="text" placeholder="e.g. Sri Murugan Transports" maxLength={120}
              value={newTransporter} onChange={(e) => { setNewTransporter(e.target.value); setTransporterError(''); }}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={savingTransporter}>
            {savingTransporter ? 'Adding…' : 'Add transporter'}
          </button>
          {transporterError && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{transporterError}</div>}
        </form>
      </div>
      <div className="scroll-x" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 30, background: 'var(--color-surface)' }}>
        <table className="table" style={{ minWidth: 360 }}>
          <thead>
            <tr><th>Transporter</th><th className="col-actions"></th></tr>
          </thead>
          <tbody>
            {transporters.map((name) => (
              <tr key={name}>
                <td style={{ fontWeight: 600 }}>{name}</td>
                <td className="col-actions">
                  <button type="button" className="btn btn-ghost" style={{ color: 'var(--color-accent-700)' }} onClick={() => onRemoveTransporter(name)}>Delete</button>
                </td>
              </tr>
            ))}
            {transporters.length === 0 && (
              <tr><td colSpan={2} style={{ color: 'var(--color-neutral-700)' }}>No transporters yet — add one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 'var(--fs-section)', margin: 'var(--space-8) 0 12px' }}>Expense descriptions</h2>
      <p style={{ color: 'var(--color-neutral-700)', fontSize: 13, marginTop: -4, marginBottom: 12, maxWidth: '74ch', lineHeight: 1.6 }}>
        The list offered under "Description" when logging a Monthly Expense. Removing one only stops it being offered for
        new entries — anything already logged under it is unaffected.
      </p>
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20, background: 'var(--color-surface)' }}>
        <form className="filters-grid" onSubmit={(e) => { e.preventDefault(); addCategory(); }}>
          <div className="field field-span-2">
            <label htmlFor="new-category">Description</label>
            <input
              id="new-category" className="input" type="text" placeholder="e.g. Toll" maxLength={60}
              value={newCategory} onChange={(e) => { setNewCategory(e.target.value); setCategoryError(''); }}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={savingCategory}>
            {savingCategory ? 'Adding…' : 'Add description'}
          </button>
          {categoryError && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{categoryError}</div>}
        </form>
      </div>
      <div className="scroll-x" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
        <table className="table" style={{ minWidth: 360 }}>
          <thead>
            <tr><th>Description</th><th className="col-actions"></th></tr>
          </thead>
          <tbody>
            {categories.map((name) => (
              <tr key={name}>
                <td style={{ fontWeight: 600 }}>{name}</td>
                <td className="col-actions">
                  <button type="button" className="btn btn-ghost" style={{ color: 'var(--color-accent-700)' }} onClick={() => onRemoveCategory(name)}>Delete</button>
                </td>
              </tr>
            ))}
            {categories.length === 0 && (
              <tr><td colSpan={2} style={{ color: 'var(--color-neutral-700)' }}>No descriptions yet — add one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isManager && (
        <div style={{ marginTop: 32 }}>
          <BackupPanel />
        </div>
      )}
    </section>
  );
}
