import { describe, expect, it } from 'vitest';
import { dieselLitres, rupees, tripCost } from './calc';
import type { Trip, TripExpenseLine } from '../types';

const line = (kind: TripExpenseLine['kind'], amount: number, litres?: number): TripExpenseLine => ({ id: `${kind}${amount}`, date: '01 Oct 2026', kind, amount, litres });
const tripWith = (revenue: number, expenses: TripExpenseLine[]) => ({ revenue, expenses }) as unknown as Trip;

describe('tripCost', () => {
  it('splits trip expense by kind and subtracts it from revenue', () => {
    const c = tripCost(tripWith(100000, [line('diesel', 24000, 240), line('adblue', 500), line('toll', 300), line('other', 1200)]));
    expect(c).toMatchObject({ diesel: 24000, adblue: 500, toll: 300, other: 1200, expense: 26000, profit: 74000 });
  });

  it('reports a loss as a negative profit', () => {
    expect(tripCost(tripWith(1000, [line('diesel', 5000)])).profit).toBe(-4000);
  });
});

describe('dieselLitres', () => {
  it('adds up diesel litres only', () => {
    expect(dieselLitres([line('diesel', 100, 20.5), line('diesel', 100, 10.25), line('adblue', 50, 3)])).toBeCloseTo(30.75, 2);
  });
});

describe('rupees', () => {
  it('shows paise and Indian digit grouping', () => {
    expect(rupees(1234567.5)).toBe('₹12,34,567.50');
    expect(rupees(0)).toBe('₹0.00');
  });
});
