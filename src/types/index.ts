export type Role = 'Driver' | 'Office' | 'Manager' | 'Viewer';

export type TabId = 'dashboard' | 'summary' | 'addtrip' | 'fuel' | 'triplog' | 'expenses' | 'report' | 'people' | 'master' | 'schema';

// 'draft' is a trip a driver has started but not yet completed — a
// multi-day trip logs fuel stops against it before Complete flips it to
// 'pending' for approval.
export type TripStatus = 'draft' | 'pending' | 'approved';

export interface Vehicle {
  id: string;
  model: string;
  fcDate: string;
  // Registration and compliance details. Dates are display dates ("05 Nov 2024"),
  // '—' when not recorded. A vehicle's age is worked out from regDate.
  regDate: string;
  batchNo: string;
  taxDate: string;
  inspectionDate: string;
  npDate: string;
  pollutionDate: string;
  owner: string;
  // '' when the truck has no default driver.
  defaultDriver?: string;
}

export interface MasterSettings {
  dieselRate: number | null;
  adblueRate: number | null;
  loadingPoint: string | null; // where new movements start from
}

// A driver's time off, with both the date and time it starts/ends.
export interface DriverLeave {
  id: string;
  driver: string;
  startsAt: string; // "2026-09-25T09:00", local, no timezone
  endsAt: string;
  remarks?: string;
}

export interface VehicleUnavailability {
  id: string;
  vehicle: string;
  startsAt: string; // "2026-09-25T09:00", local, no timezone
  endsAt: string;
  remarks?: string;
}

export interface DriverMaster {
  name: string;
  licence: string;
  expiry: string;
  expiring: boolean;
  vehicle: string;
  credential: string;
}

export type NotificationKind = 'approval' | 'alert';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  message: string;
  tab: TabId;
  createdAt: string;
  read: boolean;
  relatedTripId?: string;
}

export interface UserAccount {
  name: string;
  role: string;
  phone: string;
  branch: string;
  access: string;
  seen: string;
  isManager: boolean;
  roleKey?: 'driver' | 'office' | 'manager' | 'viewer';
  branchId?: string;
  userId?: string;
}

// A trip can run several days with several fuel/AdBlue stops along the way —
// each stop is its own line rather than one flat total for the whole trip.
export type TripExpenseKind = 'diesel' | 'adblue' | 'toll' | 'other';

export interface TripExpenseLine {
  id: string;
  date: string;
  kind: TripExpenseKind;
  litres?: number;
  ratePerLitre?: number;
  amount: number;
  details?: string;
}

// `base64` is only ever set for a document staged locally in the Add
// Movement form before it's uploaded — a document that came back from the
// API never carries it.
// An intermediate stop between a trip's loading point and its final unloading point.
export interface TripStop {
  id: string;
  location: string;
  date?: string;
  odo?: number; // odometer reading (km) at this stop
  note?: string;
}

export interface TripDocument {
  id: string;
  filename: string;
  mimeType?: string;
  base64?: string;
}

export interface Trip {
  id: string;
  loadDate: string;
  unloadDate: string;
  vehicle: string;
  driver: string;
  waybillNo: string;
  itemNo: string;
  from: string;
  fromNote?: string;
  to: string;
  toNote?: string;
  tons: number;
  km: number;
  odoStart?: number;
  odoEnd?: number;
  revenue: number;
  status: TripStatus;
  remarks?: string;
  transporter?: string;
  expenses: TripExpenseLine[];
  stops: TripStop[];
  documents: TripDocument[];
}

// A diesel fill saved without a trip (Office assigns the trip later).
export interface FuelEntry {
  id: string;
  vehicle: string;
  date: string; // display date
  litres: number;
  ratePerLitre: number;
  amount: number;
  details?: string;
}

// A free-text description name, managed under Master > Expense descriptions
// (add/remove), not a fixed set baked into the app.
export type ExpenseCategory = string;

export interface MonthlyExpense {
  id: string;
  date: string;
  vehicle: string;
  driver: string;
  category: ExpenseCategory;
  amount: number;
  remarks: string;
  documents: TripDocument[];
}

export interface TripFormState {
  loadDate: string;
  unloadDate: string;
  vehicle: string;
  driver: string;
  waybillNo: string;
  itemNo: string;
  from: string;
  fromNote: string;
  to: string;
  toNote: string;
  tons: string;
  odoStart: string;
  odoEnd: string;
  revenue: string;
  remarks: string;
  transporter: string;
}

export interface ExpenseFormState {
  date: string;
  vehicle: string;
  driver: string;
  category: ExpenseCategory;
  amount: string;
  remarks: string;
}
