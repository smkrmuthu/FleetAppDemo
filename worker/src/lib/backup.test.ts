import { describe, expect, it } from 'vitest';
import { dependencyOrder, toNdjson } from './backup';

const edge = (child: string, column: string, parent: string) => ({ child, column, parent });

describe('dependencyOrder', () => {
  it('puts parents before children', () => {
    const { order, deferred } = dependencyOrder(
      ['trip_expenses', 'trips', 'vehicles', 'orgs'],
      [edge('trips', 'vehicle_id', 'vehicles'), edge('trips', 'org_id', 'orgs'), edge('vehicles', 'org_id', 'orgs'), edge('trip_expenses', 'trip_id', 'trips')]
    );
    expect(order).toEqual(['orgs', 'vehicles', 'trips', 'trip_expenses']);
    expect(deferred).toEqual([]);
  });

  it('breaks a cycle by deferring one link, and says which', () => {
    // a truck's default driver and a driver's default truck
    const { order, deferred } = dependencyOrder(
      ['drivers', 'vehicles', 'orgs'],
      [edge('vehicles', 'default_driver', 'drivers'), edge('drivers', 'default_vehicle', 'vehicles'), edge('vehicles', 'org_id', 'orgs'), edge('drivers', 'org_id', 'orgs')]
    );
    expect(order[0]).toBe('orgs');
    expect(new Set(order)).toEqual(new Set(['drivers', 'vehicles', 'orgs']));
    expect(deferred).toHaveLength(1);
    // the deferred link is the one pointing at a table loaded later
    const d = deferred[0];
    expect(order.indexOf(d.parent)).toBeGreaterThan(order.indexOf(d.child));
  });

  it('ignores self-references and links to unknown tables', () => {
    const { order, deferred } = dependencyOrder(['a', 'b'], [edge('a', 'parent_id', 'a'), edge('b', 'x', 'ghost')]);
    expect(order).toEqual(['a', 'b']);
    expect(deferred).toEqual([]);
  });

  it('includes every table exactly once', () => {
    const tables = ['c', 'b', 'a', 'd'];
    const { order } = dependencyOrder(tables, [edge('a', 'x', 'b'), edge('b', 'x', 'c'), edge('c', 'x', 'a')]);
    expect([...order].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('toNdjson', () => {
  it('writes one JSON object per line and nothing for no rows', () => {
    expect(toNdjson([{ a: 1 }, { a: 2 }])).toBe('{"a":1}\n{"a":2}\n');
    expect(toNdjson([])).toBe('');
  });
});
