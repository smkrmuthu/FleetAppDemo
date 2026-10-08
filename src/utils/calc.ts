import type { DriverLeave, Trip, TripExpenseLine, VehicleUnavailability } from '../types';
import { parseDisplayDate } from '../lib/api';

// Date#toISOString() normalizes to UTC, which silently shifts the date by
// a day in any timezone ahead of UTC (e.g. IST) once local time is past
// midnight but not yet UTC midnight — build the string from the local
// Y/M/D components instead.
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function toNumber(v: string | number | undefined | null): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function rupees(v: number): string {
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Whole rupees, switching to lakh / crore once a figure is too wide for a big
// KPI tile: ₹9,85,000 · ₹12.40 L · ₹2.02 Cr.
export function rupeesCompact(v: number): string {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e6) return `₹${(v / 1e5).toFixed(2)} L`;
  return rupees(v).replace(/\.\d+$/, '');
}

export function formatNum(v: number, decimals = 0): string {
  return v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export interface TripCost {
  diesel: number;
  adblue: number;
  toll: number;
  other: number;
  expense: number;
  profit: number;
}

export function tripCost(t: Trip): TripCost {
  let diesel = 0, adblue = 0, toll = 0, other = 0;
  for (const line of t.expenses) {
    if (line.kind === 'diesel') diesel += line.amount;
    else if (line.kind === 'adblue') adblue += line.amount;
    else if (line.kind === 'toll') toll += line.amount;
    else other += line.amount;
  }
  const expense = diesel + adblue + toll + other;
  return { diesel, adblue, toll, other, expense, profit: t.revenue - expense };
}

export function dieselLitres(lines: TripExpenseLine[]): number {
  return lines.filter((l) => l.kind === 'diesel').reduce((a, l) => a + (l.litres ?? 0), 0);
}

// Trip/expense dates are stored as display strings ("14 Sep 2026") once
// they come back from the API — parse back to ISO to compare against a
// `type="date"` filter input's value.
// Every calendar year that appears among a set of display dates ("27 Sep 2026"),
// newest first, always including the current year even if it's not in the data —
// so a Month/Year filter always has today's year to pick.
export function yearOptions(displayDates: string[]): number[] {
  const years = new Set<number>([new Date().getFullYear()]);
  for (const d of displayDates) {
    const iso = parseDisplayDate(d);
    if (iso) years.add(Number(iso.slice(0, 4)));
  }
  return [...years].sort((a, b) => b - a);
}

export function dateInRange(displayDate: string, from: string, to: string): boolean {
  const iso = parseDisplayDate(displayDate);
  if (!iso) return true;
  return (!from || iso >= from) && (!to || iso <= to);
}

export const DUE_SOON_DAYS = 60;

export interface DueStatus { label: string; expired: boolean; days: number }

// Whether an expiry-type date ("05 Nov 2026") has passed or is coming up within
// DUE_SOON_DAYS. Null when there's no date or it's comfortably in the future.
export function dueStatus(displayDate: string, now: Date = new Date()): DueStatus | null {
  const iso = parseDisplayDate(displayDate);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: days === -1 ? 'Expired yesterday' : `Expired ${-days} days ago`, expired: true, days };
  if (days === 0) return { label: 'Due today', expired: false, days };
  if (days <= DUE_SOON_DAYS) return { label: days === 1 ? 'Due tomorrow' : `Due in ${days} days`, expired: false, days };
  return null;
}

// How old a vehicle is, from its registration date ("05 Nov 2024") to today,
// as "3 yr 2 mo". '—' when there's no registration date (or it's in the future).
export function vehicleAge(regDate: string, now: Date = new Date()): string {
  const iso = parseDisplayDate(regDate);
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  if (now.getDate() < d) months -= 1;
  if (months < 0) return '—';
  if (months < 1) return 'Under 1 month';
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return [years ? `${years} yr` : '', rem ? `${rem} mo` : ''].filter(Boolean).join(' ');
}

// Unloading date minus loading date, in whole days. Null when either display
// date is missing or unparseable (a trip that hasn't been given dates yet).
// Counted inclusively — a trip loaded on the 22nd and unloaded the 23rd
// spans 2 calendar days (the 22nd and the 23rd), not the 1-day difference
// between them. Same-day is 1 day, never 0.
export function tripDurationDays(loadDate: string, unloadDate: string): number | null {
  const from = parseDisplayDate(loadDate);
  const to = parseDisplayDate(unloadDate);
  if (!from || !to) return null;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const diff = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
  return diff + 1;
}

// A movement has only whole loading/unloading dates, no time — so it's
// treated as spanning the full day(s) from loadDate 00:00 to unloadDate (or
// loadDate, if that's not set yet) 23:59 for the purpose of catching an
// overlap with a driver's leave, which is recorded down to the minute.
export function overlappingLeaves(leaves: DriverLeave[], driver: string, loadDate: string, unloadDate: string): DriverLeave[] {
  if (!driver || !loadDate) return [];
  const tripStart = `${loadDate}T00:00`;
  const tripEnd = `${unloadDate || loadDate}T23:59`;
  return leaves.filter((l) => l.driver === driver && tripStart <= l.endsAt && l.startsAt <= tripEnd);
}

// Same overlap rule as overlappingLeaves, for a truck's recorded downtime
// windows instead of a driver's leave.
export function overlappingUnavailability(windows: VehicleUnavailability[], vehicle: string, loadDate: string, unloadDate: string): VehicleUnavailability[] {
  if (!vehicle || !loadDate) return [];
  const tripStart = `${loadDate}T00:00`;
  const tripEnd = `${unloadDate || loadDate}T23:59`;
  return windows.filter((w) => w.vehicle === vehicle && tripStart <= w.endsAt && w.startsAt <= tripEnd);
}

function daysBetweenIso(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

// For a Monthly Expense row, the loading date of the trip that most plausibly
// goes with it: the trip (for the same vehicle) whose loading-to-unloading
// span covers the expense's date, or failing that, whichever trip's span is
// closest to it. Expenses aren't linked to a specific trip, so this is a
// best-effort match, not a guarantee — '—' when the vehicle has no trips.
export function matchingLoadingDate(trips: Trip[], vehicle: string, expenseDate: string): string {
  const expenseIso = parseDisplayDate(expenseDate);
  if (!vehicle || !expenseIso) return '—';
  let best: string | null = null;
  let bestDist = Infinity;
  for (const t of trips) {
    if (t.vehicle !== vehicle) continue;
    const loadIso = parseDisplayDate(t.loadDate);
    if (!loadIso) continue;
    const unloadIso = parseDisplayDate(t.unloadDate) || loadIso;
    if (expenseIso >= loadIso && expenseIso <= unloadIso) return t.loadDate;
    const dist = Math.min(Math.abs(daysBetweenIso(loadIso, expenseIso)), Math.abs(daysBetweenIso(unloadIso, expenseIso)));
    if (dist < bestDist) { bestDist = dist; best = t.loadDate; }
  }
  return best ?? '—';
}

export function formatDuration(days: number | null): string {
  if (days === null) return '—';
  const n = Math.max(days, 1);
  return n === 1 ? '1 day' : `${n} days`;
}

// A leave has a real start/end time, not just dates, so its length is a
// straight minute count rather than the inclusive day counting above.
function parseNaiveDateTime(s: string): number | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
}

export function leaveDurationMinutes(startsAt: string, endsAt: string): number | null {
  const a = parseNaiveDateTime(startsAt);
  const b = parseNaiveDateTime(endsAt);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 60000);
}

export function formatLeaveDuration(minutes: number | null): string {
  if (minutes === null || minutes < 0) return '—';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hr' : 'hrs'}`);
  if (mins) parts.push(`${mins} min`);
  return parts.length ? parts.join(' ') : '0 min';
}

const RANGE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDateRange(from: string, to: string): string {
  if (!from || !to) return '';
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d} ${RANGE_MONTHS[Number(m) - 1]} ${y}`;
  };
  return `${fmt(from)} – ${fmt(to)}`;
}
