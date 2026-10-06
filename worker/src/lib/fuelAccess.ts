import type { Role } from '../types';

// Fuel (diesel, AdBlue, toll lines on a trip) is entered by Office and
// Manager only. A Driver may still add plain "other" expense lines to their
// own open trip. Enforced on the API so hiding the Fuel Expenses tab can't
// be bypassed.
export function fuelLineBlocked(role: Role, kind: string): boolean {
  return role === 'driver' && kind !== 'other';
}

export const FUEL_BLOCKED_MESSAGE = 'Fuel is entered by Office or Manager';
