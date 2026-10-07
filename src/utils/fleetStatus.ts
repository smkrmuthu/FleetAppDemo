import type { Trip, Vehicle, VehicleUnavailability } from '../types';
import { parseDisplayDate } from '../lib/api';
import { dueStatus } from './calc';

// What a truck is doing right now, worked out only from what has been
// recorded: a started-but-not-completed movement means it is on the road, a
// completed one awaiting approval means it is waiting on the office, and a
// recorded unavailability window means it is off the road. There is no GPS.
export type TruckState = 'road' | 'pending' | 'idle' | 'offroad';

export interface TruckFlag { label: string; expired: boolean; days: number }

export interface TruckRow {
  id: string;
  model: string;
  state: TruckState;
  // Which movement the route line shows: the one in progress, the one
  // awaiting approval, or just the most recent one.
  routeKind: 'live' | 'pending' | 'last' | null;
  from: string;
  to: string;
  tripDate: string;
  driver: string;
  flags: TruckFlag[];
  periodTrips: number;
  periodKm: number;
  periodMileage: number;
}

export interface PeriodStat { trips: number; km: number; mileage: number }

const COMPLIANCE: [string, (v: Vehicle) => string][] = [
  ['Tax', (v) => v.taxDate],
  ['Insurance', (v) => v.inspectionDate],
  ['NP', (v) => v.npDate],
  ['FC', (v) => v.fcDate],
  ['Pollution', (v) => v.pollutionDate]
];

export function complianceFlags(v: Vehicle, now: Date = new Date()): TruckFlag[] {
  return COMPLIANCE
    .map(([name, get]) => ({ name, status: dueStatus(get(v), now) }))
    .filter((x): x is { name: string; status: NonNullable<ReturnType<typeof dueStatus>> } => x.status !== null)
    .map((x) => ({
      label: x.status.expired ? `${x.name} expired` : `${x.name} ${x.status.label.toLowerCase()}`,
      expired: x.status.expired,
      days: x.status.days
    }))
    .sort((a, b) => a.days - b.days);
}

export function buildTruckRows(args: {
  vehicles: Vehicle[];
  trips: Trip[];
  unavailability: VehicleUnavailability[];
  // "YYYY-MM-DDTHH:MM", the same local format the windows are stored in
  now: string;
  periodStats: Record<string, PeriodStat>;
  nowDate?: Date;
}): TruckRow[] {
  const { vehicles, trips, unavailability, now, periodStats, nowDate } = args;
  return vehicles.map((v) => {
    const vTrips = trips
      .filter((t) => t.vehicle === v.id)
      .sort((a, b) => {
        const d = parseDisplayDate(b.loadDate).localeCompare(parseDisplayDate(a.loadDate));
        return d !== 0 ? d : b.id.localeCompare(a.id);
      });
    const live = vTrips.find((t) => t.status === 'draft');
    const pending = vTrips.find((t) => t.status === 'pending');
    const offroad = unavailability.some((w) => w.vehicle === v.id && w.startsAt <= now && now <= w.endsAt);
    const state: TruckState = offroad ? 'offroad' : live ? 'road' : pending ? 'pending' : 'idle';
    const routeTrip = state === 'road' ? live : state === 'pending' ? pending : vTrips[0];
    const routeKind = !routeTrip ? null : routeTrip === live ? 'live' : routeTrip === pending ? 'pending' : 'last';
    const stat = periodStats[v.id];
    return {
      id: v.id,
      model: v.model,
      state,
      routeKind,
      from: routeTrip?.from ?? '',
      to: routeTrip?.to ?? '',
      tripDate: routeTrip?.loadDate ?? '',
      driver: routeTrip?.driver || v.defaultDriver || '',
      flags: complianceFlags(v, nowDate).slice(0, 2),
      periodTrips: stat?.trips ?? 0,
      periodKm: stat?.km ?? 0,
      periodMileage: stat?.mileage ?? 0
    };
  });
}
