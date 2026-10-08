import { describe, expect, it } from 'vitest';
import { findTown } from './routeGeo';

describe('findTown', () => {
  it('matches a town inside a longer place name, ignoring case', () => {
    expect(findTown('Chennai Yard')?.name).toBe('Chennai');
    expect(findTown('SRIPERUMBUDUR ICD')?.name).toBe('Sriperumbudur');
    expect(findTown('Kochi port')?.name).toBe('Cochin');
  });

  it('returns null for a place it does not know', () => {
    expect(findTown('Some Village Godown')).toBeNull();
    expect(findTown('')).toBeNull();
  });
});
