import { describe, expect, it } from 'vitest';
import type { Trip, Vehicle, VehicleUnavailability } from '../types';
import { buildTruckRows, complianceFlags } from './fleetStatus';

const vehicle = (id: string, extra: Partial<Vehicle> = {}): Vehicle => ({
  id, model: 'Model', fcDate: '—', regDate: '—', batchNo: '—', taxDate: '—', inspectionDate: '—', npDate: '—', pollutionDate: '—', owner: '—', ...extra
});

const trip = (id: string, vehicleId: string, loadDate: string, status: Trip['status'], extra: Partial<Trip> = {}): Trip => ({
  id, loadDate, unloadDate: '—', vehicle: vehicleId, driver: 'Driver A', waybillNo: id, itemNo: '', from: 'Chennai', to: 'Hosur',
  tons: 0, km: 0, revenue: 0, status, expenses: [], stops: [], documents: [], ...extra
});

const NOW = '2026-10-07T10:00';
const NOW_DATE = new Date(2026, 9, 7);

describe('buildTruckRows', () => {
  it('shows a started movement as on the road, ahead of one awaiting approval', () => {
    const rows = buildTruckRows({
      vehicles: [vehicle('T1')],
      trips: [trip('a', 'T1', '03 Oct 2026', 'pending'), trip('b', 'T1', '06 Oct 2026', 'draft', { to: 'Cochin' })],
      unavailability: [], now: NOW, periodStats: {}, nowDate: NOW_DATE
    });
    expect(rows[0]).toMatchObject({ state: 'road', routeKind: 'live', to: 'Cochin' });
  });

  it('shows awaiting approval when nothing is in progress, and idle when everything is approved', () => {
    const rows = buildTruckRows({
      vehicles: [vehicle('T1'), vehicle('T2'), vehicle('T3')],
      trips: [trip('a', 'T1', '03 Oct 2026', 'pending'), trip('b', 'T2', '02 Oct 2026', 'approved'), trip('c', 'T2', '04 Oct 2026', 'approved', { to: 'Erode' })],
      unavailability: [], now: NOW, periodStats: {}, nowDate: NOW_DATE
    });
    expect(rows[0]).toMatchObject({ state: 'pending', routeKind: 'pending' });
    expect(rows[1]).toMatchObject({ state: 'idle', routeKind: 'last', to: 'Erode' });
    expect(rows[2]).toMatchObject({ state: 'idle', routeKind: null, from: '', to: '' });
  });

  it('puts a truck off the road only while its unavailability window is open', () => {
    const w = (startsAt: string, endsAt: string): VehicleUnavailability => ({ id: 'w', vehicle: 'T1', startsAt, endsAt });
    const base = { vehicles: [vehicle('T1')], trips: [trip('a', 'T1', '06 Oct 2026', 'draft')], now: NOW, periodStats: {}, nowDate: NOW_DATE };
    expect(buildTruckRows({ ...base, unavailability: [w('2026-10-06T09:00', '2026-10-08T09:00')] })[0]!.state).toBe('offroad');
    expect(buildTruckRows({ ...base, unavailability: [w('2026-10-01T09:00', '2026-10-02T09:00')] })[0]!.state).toBe('road');
  });

  it("falls back to the truck's default driver and carries the period stats", () => {
    const rows = buildTruckRows({
      vehicles: [vehicle('T1', { defaultDriver: 'Murugan S' })], trips: [], unavailability: [], now: NOW,
      periodStats: { T1: { trips: 3, km: 900, mileage: 2.8 } }, nowDate: NOW_DATE
    });
    expect(rows[0]).toMatchObject({ driver: 'Murugan S', periodTrips: 3, periodKm: 900, periodMileage: 2.8 });
  });
});

describe('complianceFlags', () => {
  it('lists expired items first, then those due soon, and ignores far-off or missing dates', () => {
    const flags = complianceFlags(vehicle('T1', { fcDate: '01 Oct 2026', taxDate: '20 Oct 2026', npDate: '01 Jan 2030', pollutionDate: '—' }), NOW_DATE);
    expect(flags.map((f) => f.label)).toEqual(['FC expired', 'Tax due in 13 days']);
    expect(flags[0]!.expired).toBe(true);
    expect(flags[1]!.expired).toBe(false);
  });
});
