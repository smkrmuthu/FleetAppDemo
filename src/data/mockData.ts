import type { AppNotification, DriverMaster, MonthlyExpense, Role, TabId, UserAccount } from '../types';

export const MONTHLY_EXPENSES: MonthlyExpense[] = [
  { id: 'e1', date: '01 Sep', vehicle: 'TN38 AB 4412', driver: 'Murugan S', category: 'Detention / halting charges', amount: 28600, remarks: 'EWB 2710 0345 6789 · yard halt', documents: [] },
  { id: 'e2', date: '02 Sep', vehicle: 'TN45 CQ 9087', driver: 'Rafiq A', category: 'Permit / tax', amount: 12400, remarks: 'Sept transit permit', documents: [] },
  { id: 'e3', date: '04 Sep', vehicle: 'KA01 MD 7731', driver: 'Prakash N', category: 'Detention / halting charges', amount: 19800, remarks: '2 days, EWB 1145 0032 8871', documents: [] },
  { id: 'e4', date: '06 Sep', vehicle: 'TN52 BK 2290', driver: 'Ilango R', category: 'Loan / lease', amount: 56200, remarks: 'EMI', documents: [] },
  { id: 'e5', date: '07 Sep', vehicle: 'TN38 AB 4412', driver: 'Murugan S', category: 'Insurance', amount: 18400, remarks: 'Goods-in-transit insurance, Q3', documents: [] },
  { id: 'e6', date: '09 Sep', vehicle: 'TN45 CQ 9087', driver: 'Rafiq A', category: 'Maintenance', amount: 5200, remarks: 'Oil change', documents: [] }
];

// Fixed swatches for the descriptions that ship by default, so they don't
// visually reshuffle just because this app updated. A description added
// later (Master > Expense descriptions) gets a swatch from CATEGORY_TINT_FALLBACKS
// instead, picked deterministically by name so it's stable across reloads.
const CATEGORY_TINT: Record<string, string> = {
  'Loading charges': 'var(--color-accent-700)',
  'Unloading charges': 'var(--color-accent-500)',
  'Weighbridge fee': 'var(--color-neutral-900)',
  'Detention / halting charges': 'var(--color-accent)',
  'Maintenance': 'var(--color-neutral-500)',
  'Insurance': 'var(--color-neutral-800)',
  'Tyres': 'var(--color-accent-300)',
  'Permit / tax': 'var(--color-neutral-300)',
  'Loan / lease': 'var(--color-accent-400)',
  'Fine': 'var(--color-accent-600)'
};
const CATEGORY_TINT_FALLBACKS = ['var(--color-accent-800)', 'var(--color-neutral-600)', 'var(--color-accent-200)', 'var(--color-neutral-400)'];

export function categoryTint(name: string): string {
  if (CATEGORY_TINT[name]) return CATEGORY_TINT[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return CATEGORY_TINT_FALLBACKS[Math.abs(hash) % CATEGORY_TINT_FALLBACKS.length];
}

export const TRIP_EXPENSE_TINT: Record<string, string> = {
  diesel: 'var(--color-accent-700)',
  adblue: 'var(--color-neutral-600)',
  toll: 'var(--color-accent-400)',
  other: 'var(--color-neutral-400)'
};

export const TRIP_EXPENSE_LABEL: Record<string, string> = {
  diesel: 'Diesel',
  adblue: 'AdBlue',
  toll: 'Toll',
  other: 'Other'
};

// Every screen a role can open. The first one is where that role lands after
// signing in. 'addtrip' is the Add / Edit Movement form: it is reached from the
// "+ Add Movement" buttons, not from the sidebar.
export const ROLE_TABS: Record<Role, TabId[]> = {
  Driver: ['addtrip', 'movements', 'triplog', 'settings', 'help'],
  Office: ['addtrip', 'movements', 'triplog', 'summary', 'expenses', 'report', 'settings', 'help'],
  Manager: ['dashboard', 'summary', 'addtrip', 'movements', 'fuel', 'triplog', 'expenses', 'report', 'people', 'master', 'schema', 'settings', 'help'],
  // Read-only: looks at the numbers, changes nothing.
  Viewer: ['dashboard', 'summary', 'report', 'settings', 'help']
};

export const TAB_LABELS: Record<TabId, string> = {
  dashboard: 'Dashboard',
  summary: 'Movement Summary',
  addtrip: 'Add Movement',
  movements: 'Movements',
  fuel: 'Fuel & Expenses',
  triplog: 'Trip Log',
  expenses: 'Monthly Expenses',
  report: 'Monthly Report',
  people: 'People',
  master: 'Masters',
  schema: 'Data Model',
  settings: 'Settings',
  help: 'Help'
};

export const USER_ROWS: UserAccount[] = [
  { name: 'Manager', role: 'Manager', phone: 'mgr@demo.com', branch: 'Chennai HQ', seen: 'Today, 09:12', access: 'All screens, month close', isManager: true },
  { name: 'Office Admin', role: 'Documentation', phone: 'office@demo.com', branch: 'Chennai HQ', seen: 'Today, 08:40', access: 'Movements, expenses, summary', isManager: false },
  { name: 'Driver', role: 'Driver', phone: 'driver@demo.com', branch: 'Chennai HQ', seen: 'Today, 07:05', access: 'Own movements only', isManager: false }
];

export const DRIVER_MASTER: DriverMaster[] = [
  { name: 'Murugan S', licence: 'TN38 20110004412', expiry: '14 Mar 2028', expiring: false, vehicle: 'TN38 AB 4412', credential: 'Yard pass · valid' },
  { name: 'Rafiq A', licence: 'KL07 20140091877', expiry: '02 Nov 2026', expiring: true, vehicle: 'TN45 CQ 9087', credential: 'Yard pass · valid' },
  { name: 'Prakash N', licence: 'KA01 20090037741', expiry: '27 Jun 2027', expiring: false, vehicle: 'KA01 MD 7731', credential: 'Hazmat endorsed' },
  { name: 'Ilango R', licence: 'TN52 20160112290', expiry: '09 Oct 2026', expiring: true, vehicle: 'TN52 BK 2290', credential: 'Yard pass · renew' }
];

export const NOTIFICATIONS: AppNotification[] = [
  { id: 'n1', kind: 'approval', message: 'Ilango R logged TN52 BK 2290 — pending approval', tab: 'triplog', createdAt: '11 Sep, 12:40', read: false, relatedTripId: 't8' },
  { id: 'n2', kind: 'approval', message: 'Prakash N logged KA01 MD 7731 — pending approval', tab: 'triplog', createdAt: '10 Sep, 10:15', read: false, relatedTripId: 't7' },
  { id: 'n3', kind: 'alert', message: "Ilango R's licence expires 09 Oct 2026", tab: 'people', createdAt: '10 Sep, 06:00', read: false },
  { id: 'n4', kind: 'alert', message: "Rafiq A's licence expires 02 Nov 2026", tab: 'people', createdAt: '10 Sep, 06:00', read: false },
  { id: 'n5', kind: 'alert', message: 'TN52 BK 2290 fitness certificate renewal due 04 Nov 2026', tab: 'people', createdAt: '10 Sep, 06:00', read: false },
  { id: 'n6', kind: 'alert', message: 'TN45 CQ 9087 fitness certificate renewal due 29 Sep 2026', tab: 'people', createdAt: '10 Sep, 06:00', read: false }
];

export const SCAN_FIELDS = [
  { label: 'Vendor', value: 'IOCL Krishnagiri' },
  { label: 'Date', value: '11 Sep 2026' },
  { label: 'Diesel litres', value: '162.40' },
  { label: 'Price / litre', value: '₹95.00' },
  { label: 'Amount', value: '₹15,428' },
  { label: 'Vehicle on bill', value: 'TN38 AB 4412' }
];

export const SCHEMA_ENTITIES = [
  { name: 'orgs', tag: 'tenant root', note: 'Every other table carries org_id; row-level security keys off it. One org can be one transporter or one client company — the same schema serves either.', fields: [{ n: 'id', t: 'uuid pk' }, { n: 'name', t: 'text' }, { n: 'currency', t: 'char(3)' }, { n: 'fy_start_month', t: 'int' }] },
  { name: 'users', tag: 'auth', note: 'Role decides which screens and which rows are visible.', fields: [{ n: 'id', t: 'uuid pk' }, { n: 'org_id', t: 'fk orgs' }, { n: 'role', t: 'driver|office|manager' }, { n: 'phone', t: 'text unique' }, { n: 'driver_id', t: 'fk drivers' }] },
  { name: 'vehicles', tag: 'master', note: 'Soft-deleted, never removed — old trips must still resolve. Fitness certificate renewal drives a reminder job, same as licence expiry.', fields: [{ n: 'id', t: 'uuid pk' }, { n: 'org_id', t: 'fk orgs' }, { n: 'reg_no', t: 'text' }, { n: 'model', t: 'text' }, { n: 'tare_kg', t: 'int' }, { n: 'fc_date', t: 'date' }, { n: 'fc_renewal_due', t: 'date' }, { n: 'active', t: 'bool' }] },
  { name: 'drivers', tag: 'master', note: 'Licence expiry drives a reminder job.', fields: [{ n: 'id', t: 'uuid pk' }, { n: 'org_id', t: 'fk orgs' }, { n: 'name', t: 'text' }, { n: 'licence_no', t: 'text' }, { n: 'licence_expiry', t: 'date' }] },
  { name: 'trips', tag: 'fact · hot', note: 'The whole trade record now lives directly on the trip — a plain waybill and item reference, not a shipment/container hierarchy. Partitioned monthly on load_date.', fields: [{ n: 'id', t: 'uuid pk' }, { n: 'org_id', t: 'fk orgs' }, { n: 'vehicle_id', t: 'fk vehicles' }, { n: 'driver_id', t: 'fk drivers' }, { n: 'waybill_no', t: 'text' }, { n: 'item_no', t: 'text' }, { n: 'load_date', t: 'date' }, { n: 'unload_date', t: 'date' }, { n: 'from_loc / to_loc', t: 'text' }, { n: 'weight_kg', t: 'int' }, { n: 'odo_start / odo_end', t: 'int' }, { n: 'revenue_paise', t: 'bigint' }, { n: 'status', t: 'draft|pending|approved' }] },
  { name: 'trip_expenses', tag: 'fact · hot', note: "One row per fuel stop or cost line, so a 3-day trip with two diesel fill-ups and an AdBlue top-up is three rows, not one flattened total. details is required when kind = 'other'.", fields: [{ n: 'id', t: 'uuid pk' }, { n: 'trip_id', t: 'fk trips' }, { n: 'spent_on', t: 'date' }, { n: 'kind', t: 'diesel|adblue|toll|other' }, { n: 'litres', t: 'numeric' }, { n: 'rate_paise', t: 'bigint' }, { n: 'amount_paise', t: 'bigint' }, { n: 'details', t: 'text' }, { n: 'receipt_id', t: 'fk receipts' }] },
  { name: 'trip_documents', tag: 'fact', note: 'Any supporting file a driver attaches to a trip — waybill copy, weighbridge slip — beyond the fuel receipts already linked from trip_expenses.', fields: [{ n: 'id', t: 'uuid pk' }, { n: 'trip_id', t: 'fk trips' }, { n: 'receipt_id', t: 'fk receipts' }, { n: 'doc_type', t: 'waybill|weighbridge|other' }] },
  { name: 'monthly_expenses', tag: 'fact', note: 'Fixed vehicle-side costs: permits, insurance, EMI, halting charges — costs that belong to the truck for the month, not to one trip.', fields: [{ n: 'id', t: 'uuid pk' }, { n: 'org_id', t: 'fk orgs' }, { n: 'vehicle_id', t: 'fk vehicles' }, { n: 'spent_on', t: 'date' }, { n: 'category', t: 'enum' }, { n: 'amount_paise', t: 'bigint' }, { n: 'remarks', t: 'text' }] },
  { name: 'receipts', tag: 'blob + OCR', note: 'File in object storage; parsed fields kept with a confidence score — fuel bills today, odometer photos next.', fields: [{ n: 'id', t: 'uuid pk' }, { n: 'org_id', t: 'fk orgs' }, { n: 'storage_key', t: 'text' }, { n: 'ocr_json', t: 'jsonb' }, { n: 'confidence', t: 'numeric' }, { n: 'uploaded_by', t: 'fk users' }] },
  { name: 'audit_log', tag: 'append only', note: "Who changed what, when — a closed month can still be explained.", fields: [{ n: 'id', t: 'bigserial pk' }, { n: 'org_id', t: 'fk orgs' }, { n: 'entity / entity_id', t: 'text / uuid' }, { n: 'action', t: 'text' }, { n: 'diff', t: 'jsonb' }, { n: 'actor_id', t: 'fk users' }, { n: 'at', t: 'timestamptz' }] }
];

export const SCHEMA_RELATIONS = [
  'orgs 1 ──< users · vehicles · drivers · trips · monthly_expenses',
  'vehicles 1 ──< trips ──< trip_expenses >── receipts',
  'trips 1 ──< trip_documents >── receipts',
  'drivers 1 ──< trips (driver_id nullable for office entries)',
  'vehicles 1 ──< monthly_expenses (no trip link — fixed cost)',
  'users 1 ──< audit_log (actor_id) · receipts (uploaded_by)'
];

export const SCHEMA_ENDPOINTS = [
  { method: 'POST', path: '/trips', desc: 'Idempotent on the client uuid — safe to retry from a phone with no signal.' },
  { method: 'GET', path: '/trips?from&to&vehicle&driver&cursor', desc: 'Keyset pagination on (load_date, id). No offset scans.' },
  { method: 'POST', path: '/trips/:id/expenses', desc: 'Add one fuel/AdBlue/toll/other line to an open trip — called once per stop, not once per trip.' },
  { method: 'POST', path: '/receipts:upload-url', desc: 'Signed URL; the file never passes through the API. OCR runs as a queued job.' },
  { method: 'POST', path: '/trips/:id/documents', desc: 'Attach an uploaded receipt as a general trip document (waybill copy, weighbridge slip).' },
  { method: 'GET', path: '/summary?month&vehicle', desc: 'Reads vehicle_month, not raw trips — constant cost as the log grows.' },
  { method: 'POST', path: '/monthly-expenses', desc: 'Office and manager only; writes an audit_log row with the diff.' },
  { method: 'POST', path: '/months/2026-09:close', desc: 'Freezes the month; later edits become adjustments, never silent rewrites.' }
];

export const SCHEMA_SCALING = [
  { label: 'Multi-tenant by design', body: 'org_id on every table plus row-level security means one deployment can host many transport companies — or many fleets within one — without cross-tenant leakage.' },
  { label: 'Partitioning', body: 'trips and trip_expenses partition by month. A query for September touches one partition; closed months can be moved to cheaper storage untouched. Holds at 100+ vehicles per org the same way it holds at 4.' },
  { label: 'Read path', body: 'Summary and report screens read a materialised monthly rollup per vehicle, refreshed on write. Dashboards never scan raw trips.' },
  { label: 'Offline first', body: 'iOS and Android queue trips and expense lines locally with a client-generated uuid; the API is idempotent on that id, so a retry after signal returns never duplicates a trip or a fuel stop.' },
  { label: 'Files', body: 'Receipts and documents go to object storage with a signed upload URL; OCR runs as a queued job and writes back to receipts.ocr_json — the same pipeline for fuel bills today and odometer photos next.' }
];
