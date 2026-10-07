import type { MonthlyExpense, Trip, Vehicle } from '../types';
import { tripCost } from './calc';

export interface VehicleAgg {
  id: string;
  model: string;
  trips: number;
  km: number;
  tons: number;
  diesel: number;
  adblue: number;
  toll: number;
  other: number;
  tripExpense: number;
  monthly: number;
  // Monthly Report ledger view: Fastag is a toll, so it is shown under Toll and
  // taken out of Monthly. Total cost / profit are unaffected — `cost` still
  // counts it exactly once.
  ledgerToll: number;
  ledgerMonthly: number;
  // Trip expense with Fastag counted as toll (Movement Summary view).
  ledgerTripExpense: number;
  cost: number;
  revenue: number;
  profit: number;
}

// A monthly expense whose description is "Fastag" (any capitalisation).
export const isFastag = (e: MonthlyExpense) => e.category.trim().toLowerCase() === 'fastag';

export function aggregateByVehicle(trips: Trip[], expenses: MonthlyExpense[], vehicles: Vehicle[]): VehicleAgg[] {
  return vehicles.map((v) => {
    const rows = trips.filter((t) => t.vehicle === v.id);
    const agg = rows.reduce(
      (a, t) => {
        const c = tripCost(t);
        a.km += t.km;
        a.tons += t.tons;
        a.diesel += c.diesel;
        a.adblue += c.adblue;
        a.toll += c.toll;
        a.other += c.other;
        a.tripExpense += c.expense;
        a.revenue += t.revenue;
        return a;
      },
      { km: 0, tons: 0, diesel: 0, adblue: 0, toll: 0, other: 0, tripExpense: 0, revenue: 0 }
    );
    const monthly = expenses.filter((e) => e.vehicle === v.id).reduce((a, e) => a + e.amount, 0);
    const fastag = expenses.filter((e) => e.vehicle === v.id && isFastag(e)).reduce((a, e) => a + e.amount, 0);
    const cost = agg.tripExpense + monthly;
    return {
      id: v.id, model: v.model, trips: rows.length, monthly, ledgerToll: agg.toll + fastag, ledgerMonthly: monthly - fastag, ledgerTripExpense: agg.tripExpense + fastag,
      cost, profit: agg.revenue - cost, ...agg
    };
  });
}

// The "Total" row under a per-vehicle table: every amount summed across the
// rows shown. Ratios (margin, ₹/km) are not carried here — compute them from
// these totals, never by adding the rows' own ratios together.
export function totalOfVehicles(rows: VehicleAgg[]): VehicleAgg {
  const sum = (pick: (r: VehicleAgg) => number) => rows.reduce((a, r) => a + pick(r), 0);
  return {
    id: 'Total', model: '',
    trips: sum((r) => r.trips), km: sum((r) => r.km), tons: sum((r) => r.tons),
    diesel: sum((r) => r.diesel), adblue: sum((r) => r.adblue), toll: sum((r) => r.toll), other: sum((r) => r.other),
    tripExpense: sum((r) => r.tripExpense), monthly: sum((r) => r.monthly),
    ledgerToll: sum((r) => r.ledgerToll), ledgerMonthly: sum((r) => r.ledgerMonthly), ledgerTripExpense: sum((r) => r.ledgerTripExpense),
    cost: sum((r) => r.cost), revenue: sum((r) => r.revenue), profit: sum((r) => r.profit)
  };
}
