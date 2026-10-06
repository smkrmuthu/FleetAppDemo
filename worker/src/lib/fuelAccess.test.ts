import { describe, expect, it } from 'vitest';
import { fuelLineBlocked } from './fuelAccess';

describe('fuelLineBlocked', () => {
  it('stops a driver adding, editing or deleting diesel, AdBlue or toll lines', () => {
    for (const kind of ['diesel', 'adblue', 'toll']) expect(fuelLineBlocked('driver', kind)).toBe(true);
  });

  it('still lets a driver handle plain "other" expense lines', () => {
    expect(fuelLineBlocked('driver', 'other')).toBe(false);
  });

  it('never blocks Office or Manager', () => {
    for (const role of ['office', 'manager'] as const) {
      for (const kind of ['diesel', 'adblue', 'toll', 'other']) expect(fuelLineBlocked(role, kind)).toBe(false);
    }
  });
});
