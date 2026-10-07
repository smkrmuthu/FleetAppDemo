import { describe, expect, it } from 'vitest';
import { buildLanes, findTown, projectTowns } from './routeGeo';

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

describe('buildLanes', () => {
  it('groups repeat trips on the same lane and marks it open if any trip is open', () => {
    const { lanes, skipped } = buildLanes([
      { from: 'Chennai Yard', to: 'Hosur Warehouse', open: false },
      { from: 'Chennai', to: 'Hosur', open: true },
      { from: 'Hosur', to: 'Chennai', open: false }
    ]);
    expect(skipped).toBe(0);
    expect(lanes).toHaveLength(2);
    expect(lanes[0]).toMatchObject({ trips: 2, open: true });
    expect(lanes[0]!.from.name).toBe('Chennai');
  });

  it('counts trips it cannot place instead of guessing', () => {
    const { lanes, skipped } = buildLanes([
      { from: 'Unknown Yard', to: 'Hosur', open: false },
      { from: 'Chennai', to: 'Chennai Port', open: false },
      { from: 'Madurai', to: 'Tuticorin', open: false }
    ]);
    expect(lanes).toHaveLength(1);
    expect(skipped).toBe(2);
  });
});

describe('projectTowns', () => {
  it('keeps every town inside the box and puts north above south', () => {
    const towns = [
      { name: 'North', lat: 17, lon: 78 },
      { name: 'South', lat: 9, lon: 78 },
      { name: 'East', lat: 13, lon: 80 }
    ];
    const proj = projectTowns(towns, 400, 300, 30);
    const pts = towns.map(proj.project);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(400);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(300);
    }
    expect(pts[0]!.y).toBeLessThan(pts[1]!.y);
  });
});
