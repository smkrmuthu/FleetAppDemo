import { describe, expect, it } from 'vitest';
import { groupRoutes, knownPosition, lookupPlace, placeKey, readCache, rememberPlace, searchName, type KeyValueStore } from './placeGeo';

const memoryStore = (): KeyValueStore => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('placeKey', () => {
  it('treats a town with and without its site word as one place', () => {
    expect(placeKey('Chennai Yard')).toBe('Chennai');
    expect(placeKey('chennai')).toBe('Chennai');
    expect(placeKey('Hosur Warehouse')).toBe('Hosur');
  });

  it('strips site words from a place it does not know, and ignores "no place" entries', () => {
    expect(placeKey('Palladam Godown')).toBe('Palladam');
    for (const none of ['', '-', '—', 'N/A', 'nil', '  ']) expect(placeKey(none)).toBe('');
  });
});

describe('groupRoutes', () => {
  it('groups movements on the same path and marks the lane open if any is open', () => {
    const { groups, skipped } = groupRoutes([
      { from: 'Chennai Yard', to: 'Hosur Warehouse', open: false },
      { from: 'Chennai', to: 'Hosur', open: true },
      { from: 'Hosur', to: 'Chennai', open: false }
    ]);
    expect(skipped).toBe(0);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ path: ['Chennai', 'Hosur'], trips: 2, open: true });
  });

  it('runs a lane through the stops, and counts a place repeated in a row once', () => {
    const { groups } = groupRoutes([{ from: 'Chennai Yard', stops: ['Salem Plant', 'Salem'], to: 'Madurai Factory', open: false }]);
    expect(groups[0]!.path).toEqual(['Chennai', 'Salem', 'Madurai']);
  });

  it('keeps a movement with one place as a single place, and skips ones with none', () => {
    const { groups, singles, skipped } = groupRoutes([
      { from: 'Chennai Yard', to: 'Chennai Port', open: true },
      { from: 'Erode', to: '—', open: false },
      { from: '', to: '-', open: false }
    ]);
    expect(groups).toEqual([]);
    expect(singles.map((s) => [s.place, s.trips, s.open]).sort()).toEqual([['Chennai', 1, true], ['Erode', 1, false]]);
    expect(skipped).toBe(1);
  });

  it('puts the busiest lane first, with ties in a steady order', () => {
    const { groups } = groupRoutes([
      { from: 'Madurai', to: 'Salem', open: false },
      { from: 'Erode', to: 'Hosur', open: false },
      { from: 'Erode', to: 'Hosur', open: false }
    ]);
    expect(groups.map((g) => g.path.join('>'))).toEqual(['Erode>Hosur', 'Madurai>Salem']);
  });
});

describe('knownPosition and the remembered searches', () => {
  it('knows the built-in towns without a search, and remembers searched places', () => {
    const store = memoryStore();
    expect(knownPosition('Erode', readCache(store))).toMatchObject({ lat: 11.34 });
    expect(knownPosition('Palladam', readCache(store))).toBeUndefined();
    rememberPlace(store, 'Palladam', { lat: 10.99, lon: 77.28 });
    expect(knownPosition('Palladam', readCache(store))).toEqual({ lat: 10.99, lon: 77.28 });
  });

  it('remembers "not found" for a week, then tries again', () => {
    const store = memoryStore();
    const t0 = 1_000_000;
    rememberPlace(store, 'Nowhere', null, t0);
    expect(knownPosition('Nowhere', readCache(store), t0 + 86_400_000)).toBeNull();
    expect(knownPosition('Nowhere', readCache(store), t0 + 8 * 86_400_000)).toBeUndefined();
  });
});

describe('lookupPlace', () => {
  it('searches southern India for the place without its site words', async () => {
    const asked: string[] = [];
    const found = await lookupPlace('Palladam Godown', async (u) => {
      asked.push(u);
      return { ok: true, json: async () => [{ lat: '10.99', lon: '77.28' }] };
    });
    expect(found).toEqual({ lat: 10.99, lon: 77.28 });
    expect(searchName('Palladam Godown')).toBe('Palladam');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('q=Palladam');
    expect(asked[0]).toContain('bounded=1');
  });

  it('says not found for an empty answer, and throws when the search itself fails', async () => {
    expect(await lookupPlace('Nowhere', async () => ({ ok: true, json: async () => [] }))).toBeNull();
    await expect(lookupPlace('Nowhere', async () => ({ ok: false, json: async () => [] }))).rejects.toThrow();
  });
});
