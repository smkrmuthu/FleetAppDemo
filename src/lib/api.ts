import type {
  AppNotification, DriverLeave, DriverMaster, ExpenseCategory, FuelEntry, MasterSettings, MonthlyExpense, NotificationKind, VehicleUnavailability,
  Role, TabId, Trip, TripDocument, TripExpenseKind, TripExpenseLine, TripStop, UserAccount, Vehicle
} from '../types';

const API_BASE = 'https://fleet-ledger-demo-api.smkrmuthu.workers.dev/v1';
const TOKEN_KEY = 'fleet_ledger_token';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Called when the server rejects the stored sign-in (expired, or the account
// was disabled/deleted) so the app can return to the sign-in screen.
let onSessionEnded: (() => void) | null = null;
export function setSessionEndedHandler(fn: (() => void) | null) {
  onSessionEnded = fn;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith('/auth/password')) {
      clearToken();
      onSessionEnded?.();
    }
    throw new ApiError(body?.error?.message ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

// ── money & dates ────────────────────────────────────────────────────────
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}
function paiseToRupees(paise: number | null | undefined): number {
  return (paise ?? 0) / 100;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}
// "2026-09-25T09:00" → "25 Sep 2026, 09:00" — same naive local reading as
// formatDisplayDate, just with the time kept alongside it.
export function formatDisplayDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [datePart, timePart] = iso.split('T');
  const date = formatDisplayDate(datePart);
  return timePart ? `${date}, ${timePart.slice(0, 5)}` : date;
}

export function parseDisplayDate(display: string): string {
  const m = display.match(/^(\d{2}) (\w{3}) (\d{4})$/);
  if (!m) return '';
  const monthIdx = MONTHS.indexOf(m[2]);
  if (monthIdx < 0) return '';
  return `${m[3]}-${String(monthIdx + 1).padStart(2, '0')}-${m[1]}`;
}
function formatSeen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso);
  const now = new Date();
  const sameDay = then.toDateString() === now.toDateString();
  const time = then.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (sameDay) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return formatDisplayDate(iso.slice(0, 10));
}

// ── role & category mapping ─────────────────────────────────────────────
type ApiRole = 'driver' | 'office' | 'manager' | 'viewer';
const ROLE_FROM_API: Record<ApiRole, Role> = { driver: 'Driver', office: 'Office', manager: 'Manager', viewer: 'Viewer' };
const ROLE_ACCESS: Record<ApiRole, string> = {
  manager: 'All screens, month close',
  office: 'Movements, expenses, summary',
  driver: 'Own movements only',
  viewer: 'Dashboard, summary & report (read-only)'
};

// Forms fall back to the '—' placeholder for an empty optional field (it's
// what the read side already displays for "no value") — treat it the same
// as empty when going the other way, into a wire payload.
function orUndefined(value: string): string | undefined {
  return value && value !== '—' ? value : undefined;
}
function stopToApi(st: TripStop) {
  return { location: st.location, date: st.date || undefined, odo: st.odo || undefined, note: st.note || undefined };
}

// For PATCH: undefined = leave alone, null = clear, string = set.
function orNullOpt(value: string | undefined): string | null | undefined {
  return value === undefined ? undefined : orUndefined(value) ?? null;
}
function orUndefinedOpt(value: string | undefined): string | undefined {
  return value === undefined ? undefined : orUndefined(value);
}

const BRANCH_NAME: Record<string, string> = {
  'branch-chennai': 'Chennai HQ',
  'branch-cochin': 'Cochin',
  'branch-hosur': 'Hosur'
};

export const BRANCH_OPTIONS = Object.entries(BRANCH_NAME).map(([id, name]) => ({ id, name }));

// ── auth ─────────────────────────────────────────────────────────────────
// `identifier` is either the phone number or a user's optional User ID.
export async function login(identifier: string, password: string): Promise<{ role: Role; name: string }> {
  const res = await request<{ access: string; user: { name: string; role: ApiRole } }>('/auth/password', {
    method: 'POST',
    body: JSON.stringify({ identifier, password })
  });
  setToken(res.access);
  return { role: ROLE_FROM_API[res.user.role], name: res.user.name };
}

export async function restoreSession(): Promise<{ role: Role; name: string } | null> {
  if (!getToken()) return null;
  try {
    const me = await request<{ name: string; role: ApiRole }>('/auth/me');
    return { role: ROLE_FROM_API[me.role], name: me.name };
  } catch {
    clearToken();
    return null;
  }
}

// ── vehicles ─────────────────────────────────────────────────────────────
interface ApiVehicle {
  id: string; model: string | null; fcDate: string | null; defaultDriver: string | null;
  regDate: string | null; batchNo: string | null; taxDate: string | null; inspectionDate: string | null; npDate: string | null; pollutionDate: string | null; owner: string | null;
}

// What can be changed on a truck. Dates are ISO ("2026-09-25"); '' clears a field.
export interface VehicleEdit {
  model?: string; fcDate?: string; defaultDriver?: string;
  regDate?: string; batchNo?: string; taxDate?: string; inspectionDate?: string; npDate?: string; pollutionDate?: string; owner?: string;
}

function vehicleFromApi(v: ApiVehicle): Vehicle {
  return {
    id: v.id, model: v.model ?? '—', fcDate: formatDisplayDate(v.fcDate), defaultDriver: v.defaultDriver ?? '',
    regDate: formatDisplayDate(v.regDate), batchNo: v.batchNo ?? '—', taxDate: formatDisplayDate(v.taxDate), inspectionDate: formatDisplayDate(v.inspectionDate),
    npDate: formatDisplayDate(v.npDate), pollutionDate: formatDisplayDate(v.pollutionDate), owner: v.owner ?? '—'
  };
}

export async function fetchVehicles(): Promise<Vehicle[]> {
  const res = await request<{ vehicles: ApiVehicle[] }>('/vehicles');
  return res.vehicles.map(vehicleFromApi);
}

export async function createVehicle(v: { id: string; model: string; fcDate: string; regDate: string; batchNo: string; taxDate: string; inspectionDate: string; npDate: string; pollutionDate: string; owner: string }): Promise<void> {
  await request('/vehicles', {
    method: 'POST',
    body: JSON.stringify({
      regNo: v.id, model: v.model, fcDate: orUndefined(v.fcDate),
      regDate: orUndefined(v.regDate), batchNo: orUndefined(v.batchNo), taxDate: orUndefined(v.taxDate), inspectionDate: orUndefined(v.inspectionDate),
      npDate: orUndefined(v.npDate), pollutionDate: orUndefined(v.pollutionDate), owner: orUndefined(v.owner)
    })
  });
}

export async function updateVehicle(id: string, v: VehicleEdit): Promise<void> {
  // Only send what was given — the API treats a missing key as "leave alone"
  // and '' as "clear it".
  const body: Record<string, string> = {};
  if (v.model !== undefined) body.model = v.model;
  if (v.fcDate !== undefined) body.fcDate = v.fcDate;
  if (v.defaultDriver !== undefined) body.defaultDriver = v.defaultDriver;
  for (const k of ['regDate', 'batchNo', 'taxDate', 'inspectionDate', 'npDate', 'pollutionDate', 'owner'] as const) {
    if (v[k] !== undefined) body[k] = v[k];
  }
  await request(`/vehicles/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function deleteVehicle(id: string): Promise<void> {
  await request(`/vehicles/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── drivers ──────────────────────────────────────────────────────────────
interface ApiDriver {
  id: string; fullName: string; licenceNo: string | null; licenceExpiry: string | null; expiring: boolean; credential: string | null; defaultVehicle: string | null;
}

function driverFromApi(d: ApiDriver): DriverMaster {
  return { name: d.fullName, licence: d.licenceNo ?? '—', expiry: formatDisplayDate(d.licenceExpiry), expiring: d.expiring, vehicle: d.defaultVehicle ?? '—', credential: d.credential ?? '—' };
}

export async function fetchDrivers(): Promise<DriverMaster[]> {
  const res = await request<{ drivers: ApiDriver[] }>('/drivers');
  return res.drivers.map(driverFromApi);
}

export async function createDriver(d: { name: string; licence: string; expiry: string }): Promise<void> {
  await request('/drivers', {
    method: 'POST',
    body: JSON.stringify({ fullName: d.name, licenceNo: orUndefined(d.licence), licenceExpiry: orUndefined(d.expiry) })
  });
}

export async function updateDriver(name: string, d: { licence: string; expiry: string; credential: string }): Promise<void> {
  await request(`/drivers/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify({ licenceNo: d.licence, licenceExpiry: d.expiry, credential: d.credential })
  });
}

export async function deleteDriver(name: string): Promise<void> {
  await request(`/drivers/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// ── users ────────────────────────────────────────────────────────────────
interface ApiUser {
  id: string; fullName: string; role: ApiRole; phone: string; branchId: string | null; userId: string | null; lastSeenAt: string | null;
}

function userFromApi(u: ApiUser): UserAccount & { id: string } {
  const roleLabel = u.role === 'office' ? 'Documentation' : u.role === 'manager' ? 'Manager' : u.role === 'viewer' ? 'Viewer (read-only)' : 'Driver';
  return {
    id: u.id, name: u.fullName, role: roleLabel, phone: u.phone,
    branch: (u.branchId && BRANCH_NAME[u.branchId]) ?? '—',
    access: ROLE_ACCESS[u.role], seen: formatSeen(u.lastSeenAt), isManager: u.role === 'manager',
    roleKey: u.role, branchId: u.branchId ?? '', userId: u.userId ?? ''
  };
}

export async function fetchUsers(): Promise<(UserAccount & { id: string })[]> {
  const res = await request<{ users: ApiUser[] }>('/users');
  return res.users.map(userFromApi);
}

// The server route is still named /invite (a real SMS/email invite flow is
// future work — see its own comment) but a Manager sets the password
// directly here, so the account is usable immediately.
export async function createUser(u: { name: string; phone: string; role: string; password: string; branchId: string; userId: string }): Promise<void> {
  await request('/users/invite', {
    method: 'POST',
    body: JSON.stringify({ fullName: u.name, phone: u.phone, role: u.role, password: u.password, branchId: orUndefined(u.branchId), userId: orUndefined(u.userId) })
  });
}

export async function updateUser(id: string, u: { name: string; phone: string; role: string; branchId: string; userId: string }): Promise<void> {
  await request(`/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fullName: u.name, phone: u.phone, role: u.role, branchId: u.branchId, userId: u.userId })
  });
}

export async function deleteUser(id: string): Promise<void> {
  await request(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function changeUserPassword(id: string, password: string): Promise<void> {
  await request(`/users/${encodeURIComponent(id)}/password`, { method: 'POST', body: JSON.stringify({ password }) });
}

// ── fuel entries not yet on a trip (Office, Manager) ─────────────────────
interface ApiFuelEntry { id: string; vehicleId: string; spentOn: string; litres: number; ratePaise: number; amountPaise: number; details: string | null }

export async function fetchFuelEntries(): Promise<FuelEntry[]> {
  const res = await request<{ fuelEntries: ApiFuelEntry[] }>('/fuel-entries');
  return res.fuelEntries.map((e) => ({
    id: e.id, vehicle: e.vehicleId, date: formatDisplayDate(e.spentOn), litres: e.litres,
    ratePerLitre: paiseToRupees(e.ratePaise), amount: paiseToRupees(e.amountPaise), details: e.details ?? undefined
  }));
}

export async function createFuelEntry(vehicle: string, line: TripExpenseLine): Promise<void> {
  await request('/fuel-entries', {
    method: 'POST',
    body: JSON.stringify({ vehicleId: vehicle, spentOn: line.date, litres: line.litres, ratePaise: rupeesToPaise(line.ratePerLitre ?? 0), amountPaise: rupeesToPaise(line.amount), details: line.details })
  });
}

// With `tripId` the entry is moved onto that trip (it leaves this list).
export async function updateFuelEntry(id: string, line: TripExpenseLine, tripId?: string): Promise<void> {
  await request(`/fuel-entries/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ spentOn: line.date, litres: line.litres, ratePaise: rupeesToPaise(line.ratePerLitre ?? 0), amountPaise: rupeesToPaise(line.amount), details: line.details ?? null, tripId })
  });
}

export async function deleteFuelEntry(id: string): Promise<void> {
  await request(`/fuel-entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── data backup (Manager) ────────────────────────────────────────────────
export interface BackupStatus {
  keepDays: number;
  latest: { date: string; finishedAt: string; totalRows: number; bytes: number; files: { total: number; copiedThisRun: number } } | null;
  lastError: { at: string; message: string } | null;
}

export async function fetchBackupStatus(): Promise<BackupStatus> {
  return request<BackupStatus>('/admin/backups');
}

export async function runBackupNow(): Promise<void> {
  await request('/admin/backups/run', { method: 'POST' });
}

// ── monthly expenses ─────────────────────────────────────────────────────
interface ApiMonthlyExpense {
  id: string; vehicleId: string; driverId: string | null; spentOn: string; category: string; amountPaise: number; remarks: string | null;
  documents?: { id: string; filename: string; mimeType: string | null }[];
}

function monthlyExpenseFromApi(e: ApiMonthlyExpense): MonthlyExpense {
  return {
    id: e.id, date: formatDisplayDate(e.spentOn), vehicle: e.vehicleId, driver: e.driverId ?? '—',
    category: e.category, amount: paiseToRupees(e.amountPaise), remarks: e.remarks ?? '—',
    documents: (e.documents ?? []).map((d) => ({ id: d.id, filename: d.filename, mimeType: d.mimeType ?? undefined }))
  };
}

export async function deleteMonthlyExpense(id: string): Promise<void> {
  await request(`/monthly-expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchMonthlyExpenses(): Promise<MonthlyExpense[]> {
  const res = await request<{ monthlyExpenses: ApiMonthlyExpense[] }>('/monthly-expenses');
  return res.monthlyExpenses.map(monthlyExpenseFromApi);
}

export async function createMonthlyExpense(e: { vehicle: string; driver: string; date: string; category: ExpenseCategory; amount: number; remarks: string; documents: TripDocument[] }): Promise<void> {
  await request('/monthly-expenses', {
    method: 'POST',
    body: JSON.stringify({
      vehicleId: e.vehicle, driverId: orUndefined(e.driver), spentOn: e.date,
      category: e.category, amountPaise: rupeesToPaise(e.amount), remarks: e.remarks || undefined,
      documents: e.documents.filter((d) => d.base64).map((d) => ({ filename: d.filename, mimeType: d.mimeType || 'application/octet-stream', base64: d.base64 }))
    })
  });
}

export async function updateMonthlyExpense(id: string, e: { vehicle: string; driver: string; date: string; category: ExpenseCategory; amount: number; remarks: string }): Promise<void> {
  await request(`/monthly-expenses/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      vehicleId: e.vehicle, driverId: orUndefined(e.driver) ?? null, spentOn: e.date,
      category: e.category, amountPaise: rupeesToPaise(e.amount), remarks: orUndefined(e.remarks) ?? null
    })
  });
}

export async function uploadMonthlyExpenseDocument(expenseId: string, doc: TripDocument): Promise<TripDocument> {
  const res = await request<{ id: string; filename: string; mimeType: string | null }>(`/monthly-expenses/${encodeURIComponent(expenseId)}/documents`, {
    method: 'POST',
    body: JSON.stringify({ filename: doc.filename, mimeType: doc.mimeType || 'application/octet-stream', base64: doc.base64 })
  });
  return { id: res.id, filename: res.filename, mimeType: res.mimeType ?? undefined };
}

export async function deleteMonthlyExpenseDocument(expenseId: string, docId: string): Promise<void> {
  await request(`/monthly-expenses/${encodeURIComponent(expenseId)}/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
}

export async function fetchMonthlyExpenseDocumentBlobUrl(expenseId: string, docId: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/monthly-expenses/${encodeURIComponent(expenseId)}/documents/${encodeURIComponent(docId)}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) throw new ApiError('Could not load the file', res.status);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── expense descriptions (Master) ───────────────────────────────────────
export async function fetchExpenseCategories(): Promise<string[]> {
  const res = await request<{ expenseCategories: string[] }>('/expense-categories');
  return res.expenseCategories;
}

export async function createExpenseCategory(name: string): Promise<void> {
  await request('/expense-categories', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function deleteExpenseCategory(name: string): Promise<void> {
  await request(`/expense-categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// ── transporters (Master) ────────────────────────────────────────────────
export async function fetchTransporters(): Promise<string[]> {
  const res = await request<{ transporters: string[] }>('/transporters');
  return res.transporters;
}

export async function createTransporter(name: string): Promise<void> {
  await request('/transporters', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function deleteTransporter(name: string): Promise<void> {
  await request(`/transporters/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// ── trips ────────────────────────────────────────────────────────────────
interface ApiTripExpense {
  id: string; spentOn: string; kind: TripExpenseKind; litres: number | null; ratePaise: number | null; amountPaise: number; details: string | null;
}
interface ApiTripDocument {
  id: string; filename: string; mimeType: string | null;
}
interface ApiTrip {
  id: string; vehicleId: string; driverId: string | null; waybillNo: string | null; itemNo: string | null;
  loadDate: string; unloadDate: string | null; fromLoc: string | null; fromNote?: string | null; toLoc: string | null; toNote?: string | null; weightKg: number | null;
  odoStart: number | null; odoEnd: number | null; revenuePaise: number; status: 'draft' | 'pending' | 'approved' | 'void';
  expenses: ApiTripExpense[];
  documents?: ApiTripDocument[];
  stops?: { id: string; location: string; date: string | null; odo: number | null; note: string | null }[];
  remarks?: string | null;
  transporter?: string | null;
}

function tripFromApi(t: ApiTrip): Trip {
  return {
    id: t.id, loadDate: formatDisplayDate(t.loadDate), unloadDate: formatDisplayDate(t.unloadDate),
    vehicle: t.vehicleId, driver: t.driverId ?? '—', waybillNo: t.waybillNo ?? '—', itemNo: t.itemNo ?? '—',
    from: t.fromLoc ?? '—', fromNote: t.fromNote ?? undefined, to: t.toLoc ?? '—', toNote: t.toNote ?? undefined, tons: (t.weightKg ?? 0) / 1000, km: Math.max(0, (t.odoEnd ?? 0) - (t.odoStart ?? 0)),
    odoStart: t.odoStart ?? undefined, odoEnd: t.odoEnd ?? undefined,
    revenue: paiseToRupees(t.revenuePaise), status: t.status === 'void' ? 'approved' : t.status, remarks: t.remarks ?? undefined,
    transporter: t.transporter ?? undefined,
    expenses: t.expenses.map((e) => ({
      id: e.id, date: formatDisplayDate(e.spentOn), kind: e.kind, litres: e.litres ?? undefined,
      ratePerLitre: e.ratePaise != null ? paiseToRupees(e.ratePaise) : undefined, amount: paiseToRupees(e.amountPaise), details: e.details ?? undefined
    })),
    stops: (t.stops ?? []).map((st) => ({ id: st.id, location: st.location, date: st.date ?? undefined, odo: st.odo ?? undefined, note: st.note ?? undefined })),
    documents: (t.documents ?? []).map((d) => ({ id: d.id, filename: d.filename, mimeType: d.mimeType ?? undefined }))
  };
}

export async function fetchTrips(params: { vehicleId?: string; status?: string } = {}): Promise<Trip[]> {
  const qs = new URLSearchParams();
  if (params.vehicleId) qs.set('vehicle_id', params.vehicleId);
  if (params.status) qs.set('status', params.status);
  qs.set('limit', '200');
  const res = await request<{ trips: ApiTrip[] }>(`/trips?${qs.toString()}`);
  return res.trips.map(tripFromApi);
}

// Every trip, page by page (fetchTrips only returns the newest 200). Used by the
// full backup, which must not silently stop at the first page.
export async function fetchAllTrips(): Promise<Trip[]> {
  const all: Trip[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 500; page++) {
    const qs = new URLSearchParams({ limit: '200' });
    if (cursor) qs.set('cursor', cursor);
    const res: { trips: ApiTrip[]; nextCursor: string | null } = await request(`/trips?${qs.toString()}`);
    all.push(...res.trips.map(tripFromApi));
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return all;
}

// A preview only — see the route's own comment. The real number is
// assigned atomically inside createTrip and can differ from this.
export async function fetchNextTripNumberPreview(): Promise<string> {
  const res = await request<{ number: string }>('/trips/next-number');
  return res.number;
}

export interface NewTripInput {
  id: string; vehicle: string; driver: string; waybillNo: string; itemNo: string; loadDate: string; unloadDate: string;
  from: string; fromNote?: string; to: string; toNote?: string; tons: number; odoStart: number; odoEnd: number; revenue: number; remarks?: string; transporter?: string;
  expenses: TripExpenseLine[];
  stops?: TripStop[];
  documents?: TripDocument[];
  draft?: boolean;
}

export async function createTrip(t: NewTripInput): Promise<Trip> {
  const res = await request<ApiTrip>('/trips', {
    method: 'POST',
    body: JSON.stringify({
      id: t.id, vehicleId: t.vehicle, driverId: orUndefined(t.driver), waybillNo: orUndefined(t.waybillNo),
      itemNo: orUndefined(t.itemNo), loadDate: t.loadDate, unloadDate: orUndefined(t.unloadDate),
      fromLoc: orUndefined(t.from), fromNote: t.fromNote || undefined, toLoc: orUndefined(t.to), toNote: t.toNote || undefined, weightKg: Math.round(t.tons * 1000) || undefined,
      odoStart: t.odoStart || undefined, odoEnd: t.odoEnd || undefined, revenuePaise: rupeesToPaise(t.revenue),
      remarks: t.remarks || undefined, transporter: t.transporter || undefined, draft: t.draft || undefined,
      stops: (t.stops ?? []).map(stopToApi),
      expenses: t.expenses.map((l) => ({
        spentOn: l.date, kind: l.kind, litres: l.litres, ratePaise: l.ratePerLitre != null ? rupeesToPaise(l.ratePerLitre) : undefined,
        amountPaise: rupeesToPaise(l.amount), details: l.details
      })),
      documents: (t.documents ?? []).filter((d) => d.base64).map((d) => ({ filename: d.filename, mimeType: d.mimeType || 'application/octet-stream', base64: d.base64 }))
    })
  });
  return tripFromApi({ ...res, expenses: (res as any).expenses ?? [], documents: (res as any).documents ?? [] });
}

export interface TripPatchInput {
  vehicle?: string; driver?: string; waybillNo?: string; itemNo?: string; loadDate?: string; unloadDate?: string;
  from?: string; fromNote?: string; to?: string; toNote?: string; tons?: number; odoStart?: number; odoEnd?: number; revenue?: number; remarks?: string; transporter?: string;
  stops?: TripStop[]; // when present, replaces the whole ordered list
}

export async function updateTrip(id: string, patch: TripPatchInput): Promise<Trip> {
  const res = await request<ApiTrip>(`/trips/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      vehicleId: patch.vehicle, driverId: orUndefined(patch.driver ?? ''), waybillNo: orUndefinedOpt(patch.waybillNo), itemNo: orNullOpt(patch.itemNo),
      loadDate: patch.loadDate, unloadDate: orNullOpt(patch.unloadDate), fromLoc: orNullOpt(patch.from), fromNote: orNullOpt(patch.fromNote),
      toLoc: orNullOpt(patch.to), toNote: orNullOpt(patch.toNote), weightKg: patch.tons != null ? Math.round(patch.tons * 1000) : undefined,
      odoStart: patch.odoStart, odoEnd: patch.odoEnd, revenuePaise: patch.revenue != null ? rupeesToPaise(patch.revenue) : undefined,
      remarks: orNullOpt(patch.remarks), transporter: orNullOpt(patch.transporter),
      stops: patch.stops?.map(stopToApi)
    })
  });
  return tripFromApi({ ...res, expenses: [] });
}

export async function completeTrip(id: string, odoEnd: number, unloadDate?: string, remarks?: string): Promise<void> {
  await request(`/trips/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ odoEnd, unloadDate: orUndefined(unloadDate ?? ''), remarks: orUndefined(remarks ?? '') })
  });
}

export async function addTripExpense(tripId: string, line: TripExpenseLine): Promise<void> {
  await request(`/trips/${encodeURIComponent(tripId)}/expenses`, {
    method: 'POST',
    body: JSON.stringify({
      spentOn: line.date, kind: line.kind, litres: line.litres,
      ratePaise: line.ratePerLitre != null ? rupeesToPaise(line.ratePerLitre) : undefined,
      amountPaise: rupeesToPaise(line.amount), details: line.details
    })
  });
}

export async function updateTripExpense(tripId: string, expenseId: string, line: TripExpenseLine): Promise<void> {
  await request(`/trips/${encodeURIComponent(tripId)}/expenses/${encodeURIComponent(expenseId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      spentOn: line.date, kind: line.kind, litres: line.litres,
      ratePaise: line.ratePerLitre != null ? rupeesToPaise(line.ratePerLitre) : undefined,
      amountPaise: rupeesToPaise(line.amount), details: line.details
    })
  });
}

export async function deleteTripExpense(tripId: string, expenseId: string): Promise<void> {
  await request(`/trips/${encodeURIComponent(tripId)}/expenses/${encodeURIComponent(expenseId)}`, { method: 'DELETE' });
}

export async function approveTrip(id: string): Promise<void> {
  await request(`/trips/${encodeURIComponent(id)}/approve`, { method: 'POST' });
}

export async function deleteTrip(id: string): Promise<void> {
  await request(`/trips/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function uploadTripDocument(tripId: string, doc: TripDocument): Promise<TripDocument> {
  const res = await request<{ id: string; filename: string; mimeType: string | null }>(`/trips/${encodeURIComponent(tripId)}/documents`, {
    method: 'POST',
    body: JSON.stringify({ filename: doc.filename, mimeType: doc.mimeType || 'application/octet-stream', base64: doc.base64 })
  });
  return { id: res.id, filename: res.filename, mimeType: res.mimeType ?? undefined };
}

export async function deleteTripDocument(tripId: string, docId: string): Promise<void> {
  await request(`/trips/${encodeURIComponent(tripId)}/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
}

export async function fetchDocumentBlobUrl(tripId: string, docId: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/trips/${encodeURIComponent(tripId)}/documents/${encodeURIComponent(docId)}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) throw new ApiError('Could not load the file', res.status);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── receipt scanning ─────────────────────────────────────────────────────
export interface ScannedReceipt {
  date?: string;
  vehicleNo?: string;
  fuelType?: string;
  litres: number;
  ratePerLitre: number;
  amount: number;
  vendor?: string;
}

export async function scanReceipt(imageBase64: string, mimeType: string): Promise<ScannedReceipt> {
  return request<ScannedReceipt>('/receipts/scan', {
    method: 'POST',
    body: JSON.stringify({ imageBase64, mimeType })
  });
}

// ── notifications ────────────────────────────────────────────────────────
interface ApiNotification {
  id: string; kind: NotificationKind; message: string; tab: TabId; relatedTripId: string | null; read: boolean; createdAt: string;
}

function notificationFromApi(n: ApiNotification): AppNotification {
  return { id: n.id, kind: n.kind, message: n.message, tab: n.tab, read: n.read, relatedTripId: n.relatedTripId ?? undefined, createdAt: formatSeen(n.createdAt) };
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  const res = await request<{ notifications: ApiNotification[] }>('/notifications');
  return res.notifications.map(notificationFromApi);
}

export async function markNotificationRead(id: string): Promise<void> {
  await request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead(): Promise<void> {
  await request('/notifications/read-all', { method: 'POST' });
}

// ── master values ────────────────────────────────────────────────────────
export async function fetchMasterSettings(): Promise<MasterSettings> {
  return request<MasterSettings>('/settings');
}

export async function updateMasterSettings(r: Partial<MasterSettings>): Promise<MasterSettings> {
  return request<MasterSettings>('/settings', { method: 'PATCH', body: JSON.stringify(r) });
}

// ── driver leave ────────────────────────────────────────────────────────────
interface ApiDriverLeave {
  id: string; driverId: string; startsAt: string; endsAt: string; remarks: string | null;
}

function driverLeaveFromApi(l: ApiDriverLeave): DriverLeave {
  return { id: l.id, driver: l.driverId, startsAt: l.startsAt, endsAt: l.endsAt, remarks: l.remarks ?? undefined };
}

export async function fetchDriverLeaves(): Promise<DriverLeave[]> {
  const res = await request<{ driverLeaves: ApiDriverLeave[] }>('/driver-leaves');
  return res.driverLeaves.map(driverLeaveFromApi);
}

export async function createDriverLeave(l: { driver: string; startsAt: string; endsAt: string; remarks?: string }): Promise<void> {
  await request('/driver-leaves', {
    method: 'POST',
    body: JSON.stringify({ driverId: l.driver, startsAt: l.startsAt, endsAt: l.endsAt, remarks: l.remarks || undefined })
  });
}

export async function deleteDriverLeave(id: string): Promise<void> {
  await request(`/driver-leaves/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── vehicle unavailability ───────────────────────────────────────────────
interface ApiVehicleUnavailability {
  id: string; vehicleId: string; startsAt: string; endsAt: string; remarks: string | null;
}

function vehicleUnavailabilityFromApi(w: ApiVehicleUnavailability): VehicleUnavailability {
  return { id: w.id, vehicle: w.vehicleId, startsAt: w.startsAt, endsAt: w.endsAt, remarks: w.remarks ?? undefined };
}

export async function fetchVehicleUnavailability(): Promise<VehicleUnavailability[]> {
  const res = await request<{ vehicleUnavailability: ApiVehicleUnavailability[] }>('/vehicle-unavailability');
  return res.vehicleUnavailability.map(vehicleUnavailabilityFromApi);
}

export async function createVehicleUnavailability(w: { vehicle: string; startsAt: string; endsAt: string; remarks?: string }): Promise<void> {
  await request('/vehicle-unavailability', {
    method: 'POST',
    body: JSON.stringify({ vehicleId: w.vehicle, startsAt: w.startsAt, endsAt: w.endsAt, remarks: w.remarks || undefined })
  });
}

export async function updateVehicleUnavailability(id: string, w: { vehicle: string; startsAt: string; endsAt: string; remarks?: string }): Promise<void> {
  await request(`/vehicle-unavailability/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ vehicleId: w.vehicle, startsAt: w.startsAt, endsAt: w.endsAt, remarks: w.remarks || undefined })
  });
}

export async function deleteVehicleUnavailability(id: string): Promise<void> {
  await request(`/vehicle-unavailability/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
