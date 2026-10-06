import { useState } from 'react';
import type { DriverMaster, UserAccount, Vehicle } from '../types';
import { BRANCH_OPTIONS, parseDisplayDate, type VehicleEdit } from '../lib/api';
import { dueStatus, vehicleAge } from '../utils/calc';
import { DualScroll } from './DualScroll';
import { RecordDialog, type DialogField } from './RecordDialog';

// Every date on a truck that expires or falls due, most urgent first.
function dueItems(v: Vehicle) {
  return [
    { name: 'Tax', date: v.taxDate }, { name: 'Insurance', date: v.inspectionDate }, { name: 'NP', date: v.npDate },
    { name: 'FC', date: v.fcDate }, { name: 'Pollution', date: v.pollutionDate }
  ]
    .map((i) => ({ name: i.name, status: dueStatus(i.date) }))
    .filter((i): i is { name: string; status: NonNullable<ReturnType<typeof dueStatus>> } => i.status !== null)
    .sort((a, b) => a.status.days - b.status.days);
}

// A date cell: plain when fine or not recorded, tagged when expired or due soon.
function dueCell(date: string) {
  const status = dueStatus(date);
  if (!status) return <span style={{ whiteSpace: 'nowrap' }}>{date}</span>;
  return <span className={status.expired ? 'tag tag-accent' : 'tag tag-outline'} title={status.label} style={{ whiteSpace: 'nowrap' }}>{date}</span>;
}

// A minimal, focused dialog — just the two password fields — rather than
// folding this into the account Edit dialog, since a password is never
// something to display back, only ever set.
function ChangePasswordDialog({
  userName, onSave, onClose
}: {
  userName: string;
  onSave: (password: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError("Passwords don't match.");
    setError('');
    setSaving(true);
    const err = await onSave(password);
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(32,30,29,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div style={{ background: 'var(--color-bg)', border: '2px solid var(--color-text)', width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '18px 20px 14px', borderBottom: '2px solid var(--color-divider)' }}>
          <div>
            <div className="kicker">Change password</div>
            <h2 style={{ fontSize: 22, letterSpacing: '-0.01em', marginTop: 2 }}>{userName}</h2>
          </div>
          <button type="button" className="btn btn-ghost" aria-label="Close" onClick={onClose} style={{ fontSize: 18, lineHeight: 1, padding: '2px 8px' }}>×</button>
        </div>
        <form style={{ padding: 20, display: 'grid', gap: 14 }} onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input id="new-password" className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirm password</label>
            <input id="confirm-password" className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save password'}</button>
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// A Manager creating an account directly, with an initial password they set
// themselves — there's no SMS/email invite step yet (see the API comment).
function AddUserDialog({ onSave, onClose }: { onSave: (u: { name: string; phone: string; role: string; password: string; branchId: string; userId: string }) => Promise<string | null>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('driver');
  const [branchId, setBranchId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return setError('Enter a name.');
    if (!phone.trim()) return setError('Enter a mobile number.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError("Passwords don't match.");
    setError('');
    setSaving(true);
    const err = await onSave({ name: name.trim(), phone: phone.trim(), role, password, branchId, userId: userId.trim() });
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(32,30,29,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div style={{ background: 'var(--color-bg)', border: '2px solid var(--color-text)', width: '100%', maxWidth: 460 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '18px 20px 14px', borderBottom: '2px solid var(--color-divider)' }}>
          <div>
            <div className="kicker">New account</div>
            <h2 style={{ fontSize: 22, letterSpacing: '-0.01em', marginTop: 2 }}>Add user</h2>
          </div>
          <button type="button" className="btn btn-ghost" aria-label="Close" onClick={onClose} style={{ fontSize: 18, lineHeight: 1, padding: '2px 8px' }}>×</button>
        </div>
        <form style={{ padding: 20, display: 'grid', gap: 14 }} onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="field">
            <label htmlFor="new-user-name">Name</label>
            <input id="new-user-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="new-user-phone">Mobile</label>
            <input id="new-user-phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 4 }}>This is what they'll sign in with.</div>
          </div>
          <div className="field">
            <label htmlFor="new-user-userid">User ID (optional)</label>
            <input id="new-user-userid" className="input" value={userId} onChange={(e) => setUserId(e.target.value)} />
            <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 4 }}>An alternate sign-in name, if you'd rather they not use the mobile number.</div>
          </div>
          <div className="field">
            <label htmlFor="new-user-role">Role</label>
            <select id="new-user-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="driver">Driver</option>
              <option value="office">Documentation (Office)</option>
              <option value="manager">Manager</option>
              <option value="viewer">Viewer (read-only)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-user-branch">Branch</label>
            <select id="new-user-branch" className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">None</option>
              {BRANCH_OPTIONS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-user-password">Password</label>
            <input id="new-user-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="new-user-confirm">Confirm password</label>
            <input id="new-user-confirm" className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add user'}</button>
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const blankVehicle = {
  id: '', model: '', fcDate: '', regDate: '', batchNo: '', taxDate: '', inspectionDate: '', npDate: '', pollutionDate: '', owner: ''
};

interface Props {
  vehicles: Vehicle[];
  drivers: DriverMaster[];
  users: (UserAccount & { id: string })[];
  onAddUser: (u: { name: string; phone: string; role: string; password: string; branchId: string; userId: string }) => Promise<string | null>;
  onAddVehicle: (v: Vehicle) => Promise<string | null>;
  onRemoveVehicle: (id: string) => void;
  onAddDriver: (d: DriverMaster) => Promise<string | null>;
  onRemoveDriver: (name: string) => void;
  onRemoveUser: (id: string) => void;
  onUpdateVehicle: (id: string, v: VehicleEdit) => Promise<string | null>;
  onUpdateDriver: (name: string, d: { licence: string; expiry: string; credential: string }) => Promise<string | null>;
  onUpdateUser: (id: string, u: { name: string; phone: string; role: string; branchId: string; userId: string }) => Promise<string | null>;
  onChangeUserPassword: (id: string, password: string) => Promise<string | null>;
  canDeleteAccounts: boolean;
  canEditAccounts: boolean;
}

export function People({
  vehicles, drivers, users, onAddUser, onAddVehicle, onRemoveVehicle, onAddDriver, onRemoveDriver, onRemoveUser,
  onUpdateVehicle, onUpdateDriver, onUpdateUser, onChangeUserPassword, canDeleteAccounts, canEditAccounts
}: Props) {
  const [dialog, setDialog] = useState<{ kind: 'user' | 'truck' | 'driver'; key: string; edit: boolean } | null>(null);
  const [passwordFor, setPasswordFor] = useState<{ id: string; name: string } | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [newVehicle, setNewVehicle] = useState(blankVehicle);
  const [newDriver, setNewDriver] = useState({ name: '', licence: '', expiry: '' });
  const [vehicleError, setVehicleError] = useState('');
  const [driverError, setDriverError] = useState('');

  async function addVehicle() {
    if (!newVehicle.id.trim()) {
      setVehicleError('Enter the truck\'s registration number.');
      return;
    }
    setVehicleError('');
    const err = await onAddVehicle({
      id: newVehicle.id.trim(),
      model: newVehicle.model.trim() || '—',
      fcDate: newVehicle.fcDate || '—',
      regDate: newVehicle.regDate || '—',
      batchNo: newVehicle.batchNo.trim() || '—',
      taxDate: newVehicle.taxDate || '—',
      inspectionDate: newVehicle.inspectionDate || '—',
      npDate: newVehicle.npDate || '—',
      pollutionDate: newVehicle.pollutionDate || '—',
      owner: newVehicle.owner.trim() || '—'
    });
    if (err) setVehicleError(err);
    else setNewVehicle(blankVehicle);
  }

  async function addDriver() {
    if (!newDriver.name.trim()) {
      setDriverError('Enter the driver\'s name.');
      return;
    }
    setDriverError('');
    const err = await onAddDriver({
      name: newDriver.name.trim(),
      licence: newDriver.licence.trim() || '—',
      expiry: newDriver.expiry || '—',
      expiring: false,
      vehicle: '—',
      credential: '—'
    });
    if (err) setDriverError(err);
    else setNewDriver({ name: '', licence: '', expiry: '' });
  }

  const blank = (v: string) => (v === '—' ? '' : v);
  const rowBtn = { color: 'var(--color-text)' } as const;
  const actions = { display: 'flex', justifyContent: 'flex-end', gap: 4, whiteSpace: 'nowrap' } as const;

  function renderDialog() {
    if (!dialog) return null;
    const close = () => setDialog(null);

    if (dialog.kind === 'truck') {
      const v = vehicles.find((x) => x.id === dialog.key);
      if (!v) return null;
      const fields: DialogField[] = [
        { key: 'reg', label: 'Registration no', display: v.id, value: v.id, locked: true, hint: "The registration number is how trips refer to this truck, so it can't be changed. To correct it, add the right one and delete this one." },
        { key: 'regDate', label: 'Reg Date', type: 'date', display: v.regDate, value: parseDisplayDate(v.regDate) },
        { key: 'batchNo', label: 'Batch #', display: v.batchNo, value: blank(v.batchNo) },
        { key: 'taxDate', label: 'Tax Date', type: 'date', display: v.taxDate, value: parseDisplayDate(v.taxDate), flag: dueStatus(v.taxDate) },
        { key: 'inspectionDate', label: 'Insurance', type: 'date', display: v.inspectionDate, value: parseDisplayDate(v.inspectionDate), flag: dueStatus(v.inspectionDate) },
        { key: 'npDate', label: 'NP Date', type: 'date', display: v.npDate, value: parseDisplayDate(v.npDate), flag: dueStatus(v.npDate) },
        { key: 'fcDate', label: 'FC Date', type: 'date', display: v.fcDate, value: parseDisplayDate(v.fcDate), flag: dueStatus(v.fcDate) },
        { key: 'pollutionDate', label: 'Pollution Cert Date', type: 'date', display: v.pollutionDate, value: parseDisplayDate(v.pollutionDate), flag: dueStatus(v.pollutionDate) },
        { key: 'owner', label: 'Owner', display: v.owner, value: blank(v.owner) },
        { key: 'model', label: 'Model', display: v.model, value: blank(v.model) },
        {
          key: 'defaultDriver', label: 'Default driver', type: 'select', display: v.defaultDriver ?? '', value: v.defaultDriver ?? '',
          options: [{ value: '', label: 'No default driver' }, ...drivers.map((d) => ({ value: d.name, label: d.name }))],
          hint: 'Filled in automatically when this truck is picked in Add Movement. Also editable under Master.'
        }
      ];
      return (
        <RecordDialog
          key={`truck-${v.id}-${dialog.edit}`} title={v.id} subtitle="Truck" fields={fields} startInEdit={dialog.edit} canEdit onClose={close}
          onSave={(x) => onUpdateVehicle(v.id, {
            regDate: x.regDate, batchNo: x.batchNo, taxDate: x.taxDate, inspectionDate: x.inspectionDate, npDate: x.npDate,
            fcDate: x.fcDate, pollutionDate: x.pollutionDate, owner: x.owner, model: x.model, defaultDriver: x.defaultDriver
          })}
        />
      );
    }

    if (dialog.kind === 'driver') {
      const d = drivers.find((x) => x.name === dialog.key);
      if (!d) return null;
      const fields: DialogField[] = [
        { key: 'name', label: 'Name', display: d.name, value: d.name, locked: true, hint: "A driver's name is how their trips are recorded, so it can't be changed. To correct it, add the right name and delete this one." },
        { key: 'licence', label: 'Licence no', display: d.licence, value: blank(d.licence) },
        { key: 'expiry', label: 'Licence expiry', type: 'date', display: d.expiry, value: parseDisplayDate(d.expiry) },
        { key: 'credential', label: 'Credential', display: d.credential, value: blank(d.credential) }
      ];
      return (
        <RecordDialog
          key={`driver-${d.name}-${dialog.edit}`} title={d.name} subtitle="Driver" fields={fields} startInEdit={dialog.edit} canEdit onClose={close}
          onSave={(x) => onUpdateDriver(d.name, { licence: x.licence, expiry: x.expiry, credential: x.credential })}
        />
      );
    }

    const u = users.find((x) => x.id === dialog.key);
    if (!u) return null;
    const fields: DialogField[] = [
      { key: 'name', label: 'Name', display: u.name, value: u.name, required: true },
      { key: 'phone', label: 'Mobile', type: 'tel', display: u.phone, value: u.phone, required: true, hint: 'This is the number they sign in with.' },
      { key: 'userId', label: 'User ID', display: u.userId || '—', value: u.userId ?? '', hint: "An alternate sign-in name, if you'd rather they not use the mobile number." },
      {
        key: 'role', label: 'Role', type: 'select', display: u.role, value: u.roleKey ?? 'driver',
        options: [{ value: 'driver', label: 'Driver' }, { value: 'office', label: 'Documentation (Office)' }, { value: 'manager', label: 'Manager' }, { value: 'viewer', label: 'Viewer (read-only)' }],
        hint: 'Changes what they can see the next time they sign in.'
      },
      { key: 'branchId', label: 'Branch', type: 'select', display: u.branch, value: u.branchId ?? '', options: [{ value: '', label: 'None' }, ...BRANCH_OPTIONS.map((b) => ({ value: b.id, label: b.name }))] },
      { key: 'access', label: 'Can see', display: u.access, value: u.access, viewOnly: true },
      { key: 'seen', label: 'Last active', display: u.seen, value: u.seen, viewOnly: true }
    ];
    return (
      <RecordDialog
        key={`user-${u.id}-${dialog.edit}`} title={u.name} subtitle="User account" fields={fields} startInEdit={dialog.edit} canEdit={canEditAccounts} onClose={close}
        onSave={(x) => onUpdateUser(u.id, { name: x.name, phone: x.phone, role: x.role, branchId: x.branchId, userId: x.userId })}
      />
    );
  }

  return (
    <section>
      {renderDialog()}
      {passwordFor && (
        <ChangePasswordDialog
          userName={passwordFor.name}
          onClose={() => setPasswordFor(null)}
          onSave={(password) => onChangeUserPassword(passwordFor.id, password)}
        />
      )}
      {addingUser && <AddUserDialog onClose={() => setAddingUser(false)} onSave={onAddUser} />}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div className="kicker">Demo Logistics · {users.length} accounts, 3 branches</div>
          <h1 style={{ fontSize: 34, letterSpacing: '-0.02em' }}>People</h1>
          <p style={{ color: 'var(--color-neutral-700)', marginTop: 6, fontSize: 13 }}>Manage the fleet's trucks, drivers and user accounts.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {canEditAccounts && <button type="button" className="btn btn-primary" onClick={() => setAddingUser(true)}>Add user</button>}
        </div>
      </div>

      <h2 style={{ fontSize: 20, marginBottom: 12 }}>User accounts</h2>
      <div className="scroll-x" style={{ border: '2px solid var(--color-divider)', marginBottom: 30 }}>
        <table className="table" style={{ minWidth: 1150 }}>
          <thead>
            <tr>
              <th>Name</th><th>Role</th><th>Mobile</th><th>User ID</th><th>Branch</th><th>Can see</th><th>Last active</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{u.name}</td>
                <td>{u.isManager ? <span className="tag tag-accent">{u.role}</span> : <span className="tag tag-outline">{u.role}</span>}</td>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{u.phone}</td>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{u.userId || '—'}</td>
                <td>{u.branch}</td>
                <td style={{ color: 'var(--color-neutral-700)' }}>{u.access}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{u.seen}</td>
                <td className="col-actions">
                  <div style={actions}>
                    <button type="button" className="btn btn-ghost" style={rowBtn} onClick={() => setDialog({ kind: 'user', key: u.id, edit: false })}>View</button>
                    {canEditAccounts && <button type="button" className="btn btn-ghost" style={rowBtn} onClick={() => setDialog({ kind: 'user', key: u.id, edit: true })}>Edit</button>}
                    {canEditAccounts && <button type="button" className="btn btn-ghost" style={rowBtn} onClick={() => setPasswordFor({ id: u.id, name: u.name })}>Change password</button>}
                    {canDeleteAccounts && <button type="button" className="btn btn-ghost" onClick={() => onRemoveUser(u.id)}>Delete account</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 20, marginBottom: 12 }}>Trucks</h2>
      <div style={{ border: '2px solid var(--color-divider)', padding: 16, marginBottom: 16 }}>
        <div className="filters-grid">
          <div className="field"><label>Reg No</label><input className="input" type="text" placeholder="TN00 XX 0000" value={newVehicle.id} onChange={(e) => setNewVehicle((v) => ({ ...v, id: e.target.value }))} /></div>
          <div className="field"><label>Reg Date</label><input className="input" type="date" value={newVehicle.regDate} onChange={(e) => setNewVehicle((v) => ({ ...v, regDate: e.target.value }))} /></div>
          <div className="field"><label>Batch #</label><input className="input" type="text" placeholder="Batch no" value={newVehicle.batchNo} onChange={(e) => setNewVehicle((v) => ({ ...v, batchNo: e.target.value }))} /></div>
          <div className="field"><label>Tax Date</label><input className="input" type="date" value={newVehicle.taxDate} onChange={(e) => setNewVehicle((v) => ({ ...v, taxDate: e.target.value }))} /></div>
          <div className="field"><label>Insurance</label><input className="input" type="date" value={newVehicle.inspectionDate} onChange={(e) => setNewVehicle((v) => ({ ...v, inspectionDate: e.target.value }))} /></div>
          <div className="field"><label>NP Date</label><input className="input" type="date" value={newVehicle.npDate} onChange={(e) => setNewVehicle((v) => ({ ...v, npDate: e.target.value }))} /></div>
          <div className="field"><label>FC Date</label><input className="input" type="date" value={newVehicle.fcDate} onChange={(e) => setNewVehicle((v) => ({ ...v, fcDate: e.target.value }))} /></div>
          <div className="field"><label>Pollution Cert Date</label><input className="input" type="date" value={newVehicle.pollutionDate} onChange={(e) => setNewVehicle((v) => ({ ...v, pollutionDate: e.target.value }))} /></div>
          <div className="field"><label>Owner</label><input className="input" type="text" placeholder="Owner name" value={newVehicle.owner} onChange={(e) => setNewVehicle((v) => ({ ...v, owner: e.target.value }))} /></div>
          <div className="field"><label>Model</label><input className="input" type="text" placeholder="Make and model" value={newVehicle.model} onChange={(e) => setNewVehicle((v) => ({ ...v, model: e.target.value }))} /></div>
          <button type="button" className="btn btn-primary" style={{ justifySelf: 'start' }} onClick={addVehicle}>Add truck</button>
          {vehicleError && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{vehicleError}</div>}
        </div>
      </div>
      <div style={{ marginBottom: 30 }}>
      <DualScroll>
        <table className="table" style={{ minWidth: 1500 }}>
          <thead>
            <tr>
              <th>Reg No</th><th>Reg Date</th><th>Age</th><th>Batch #</th><th>Tax Date</th><th>Insurance</th><th>NP Date</th>
              <th>FC Date</th><th>Pollution Cert Date</th><th>Owner</th><th>Model</th><th>Due</th><th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{v.id}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{v.regDate}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{vehicleAge(v.regDate)}</td>
                <td>{v.batchNo}</td>
                <td>{dueCell(v.taxDate)}</td>
                <td>{dueCell(v.inspectionDate)}</td>
                <td>{dueCell(v.npDate)}</td>
                <td>{dueCell(v.fcDate)}</td>
                <td>{dueCell(v.pollutionDate)}</td>
                <td>{v.owner}</td>
                <td style={{ color: 'var(--color-neutral-700)' }}>{v.model}</td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 320 }}>
                    {dueItems(v).map((item) => (
                      <span key={item.name} className={item.status.expired ? 'tag tag-accent' : 'tag tag-outline'} title={`${item.name}: ${item.status.label}`}>
                        {item.name} · {item.status.label}
                      </span>
                    ))}
                    {dueItems(v).length === 0 && <span style={{ color: 'var(--color-neutral-700)' }}>—</span>}
                  </div>
                </td>
                <td className="col-actions">
                  <div style={actions}>
                    <button type="button" className="btn btn-ghost" style={rowBtn} onClick={() => setDialog({ kind: 'truck', key: v.id, edit: false })}>View</button>
                    <button type="button" className="btn btn-ghost" style={rowBtn} onClick={() => setDialog({ kind: 'truck', key: v.id, edit: true })}>Edit</button>
                    <button type="button" className="btn btn-ghost" onClick={() => onRemoveVehicle(v.id)}>Delete truck</button>
                  </div>
                </td>
              </tr>
            ))}
            {vehicles.length === 0 && (
              <tr><td colSpan={13} style={{ color: 'var(--color-neutral-700)' }}>No trucks yet.</td></tr>
            )}
          </tbody>
        </table>
      </DualScroll>
      </div>

      <h2 style={{ fontSize: 20, marginBottom: 12 }}>Drivers</h2>
      <div style={{ border: '2px solid var(--color-divider)', padding: 16, marginBottom: 16 }}>
        <div className="filters-grid">
          <div className="field"><label>Name</label><input className="input" type="text" placeholder="Driver name" value={newDriver.name} onChange={(e) => setNewDriver((d) => ({ ...d, name: e.target.value }))} /></div>
          <div className="field"><label>Licence no</label><input className="input" type="text" placeholder="Licence no" value={newDriver.licence} onChange={(e) => setNewDriver((d) => ({ ...d, licence: e.target.value }))} /></div>
          <div className="field"><label>Licence expiry</label><input className="input" type="date" value={newDriver.expiry} onChange={(e) => setNewDriver((d) => ({ ...d, expiry: e.target.value }))} /></div>
          <button type="button" className="btn btn-primary" style={{ justifySelf: 'start' }} onClick={addDriver}>Add driver</button>
          {driverError && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{driverError}</div>}
        </div>
      </div>
      <div className="scroll-x" style={{ border: '2px solid var(--color-divider)' }}>
        <table className="table" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>Driver</th><th>Licence no</th><th>Expiry</th><th>Credential</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => (
              <tr key={d.name}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{d.name}</td>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{d.licence}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{d.expiring ? <span className="tag tag-accent">{d.expiry}</span> : <span>{d.expiry}</span>}</td>
                <td style={{ color: 'var(--color-neutral-700)' }}>{d.credential}</td>
                <td className="col-actions">
                  <div style={actions}>
                    <button type="button" className="btn btn-ghost" style={rowBtn} onClick={() => setDialog({ kind: 'driver', key: d.name, edit: false })}>View</button>
                    <button type="button" className="btn btn-ghost" style={rowBtn} onClick={() => setDialog({ kind: 'driver', key: d.name, edit: true })}>Edit</button>
                    <button type="button" className="btn btn-ghost" onClick={() => onRemoveDriver(d.name)}>Delete driver</button>
                  </div>
                </td>
              </tr>
            ))}
            {drivers.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--color-neutral-700)' }}>No drivers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ color: 'var(--color-neutral-700)', maxWidth: '74ch', lineHeight: 1.6, marginTop: 16 }}>
        A truck's tax, inspection, NP, FC and pollution dates are highlighted in the Due column once they are within 60
        days or past. Office and Manager can add, edit or remove trucks and drivers; only a Manager can edit or delete
        a user account.
      </p>
    </section>
  );
}
