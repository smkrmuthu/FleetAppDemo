import { describe, expect, it } from 'vitest';
import { decodePolyline, encodePolyline, fetchRoadRoute, knownRoute, laneKey, rememberRoute, routeUrl, waypoints, type Pt } from './roadRoute';
import type { KeyValueStore } from './placeGeo';

const memory = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
};
const chennaiToSalem: Pt[] = [[13.08, 80.27], [11.66, 78.15]];

describe('polyline', () => {
  it('decodes the standard example', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });
  it('round-trips', () => {
    const pts: Pt[] = [[13.08123, 80.27123], [12.9, 79.9], [11.66, 78.15]];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });
});

describe('waypoints and keys', () => {
  it('joins consecutive places at the same spot into one waypoint', () => {
    expect(waypoints([[13.08, 80.27], [13.0805, 80.2705], [11.66, 78.15]])).toEqual([[13.08, 80.27], [11.66, 78.15]]);
    expect(waypoints([[13.08, 80.27], [13.0805, 80.2705]])).toHaveLength(1);
  });
  it('writes longitude first in the request, as the routing service wants', () => {
    expect(routeUrl('https://x', chennaiToSalem)).toContain('/route/v1/driving/80.27000,13.08000;78.15000,11.66000?');
  });
  it('names a lane by its places to about 100 m', () => {
    expect(laneKey(chennaiToSalem)).toBe('13.080,80.270;11.660,78.150');
  });
});

describe('fetchRoadRoute', () => {
  const answer = (body: unknown, ok = true) => async () => ({ ok, json: async () => body });
  it('returns the road route', async () => {
    const line = await fetchRoadRoute(chennaiToSalem, answer({ code: 'Ok', routes: [{ geometry: encodePolyline([[13.08, 80.27], [12.5, 79.4], [11.66, 78.15]]) }] }));
    expect(line).toEqual([[13.08, 80.27], [12.5, 79.4], [11.66, 78.15]]);
  });
  it('returns null when there is no road between the places', async () => {
    expect(await fetchRoadRoute(chennaiToSalem, answer({ code: 'NoRoute' }))).toBeNull();
  });
  it('does not ask when the lane stays in one spot', async () => {
    let asked = 0;
    expect(await fetchRoadRoute([[13.08, 80.27], [13.0801, 80.2701]], async () => { asked++; return { ok: true, json: async () => ({}) }; })).toBeNull();
    expect(asked).toBe(0);
  });
  it('tries the second server when the first fails, and throws when both do', async () => {
    const asked: string[] = [];
    const line = await fetchRoadRoute(chennaiToSalem, async (u) => {
      asked.push(u.split('/route/')[0]!);
      return asked.length === 1 ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ code: 'Ok', routes: [{ geometry: encodePolyline(chennaiToSalem) }] }) };
    });
    expect(asked).toHaveLength(2);
    expect(line).toEqual(chennaiToSalem);
    await expect(fetchRoadRoute(chennaiToSalem, async () => { throw new Error('offline'); })).rejects.toThrow();
  });
});

describe('remembered routes', () => {
  it('remembers a route and a "no road" answer, and asks again after a week', () => {
    const store = memory(); const t0 = 1_000_000;
    rememberRoute(store, 'a', chennaiToSalem, t0);
    rememberRoute(store, 'b', null, t0);
    expect(knownRoute(store, 'a', t0 + 5)).toEqual(chennaiToSalem);
    expect(knownRoute(store, 'b', t0 + 5)).toBeNull();
    expect(knownRoute(store, 'b', t0 + 8 * 86_400_000)).toBeUndefined();
    expect(knownRoute(store, 'never')).toBeUndefined();
  });
  it('keeps only the 60 most recent routes', () => {
    const store = memory();
    for (let i = 0; i < 65; i++) rememberRoute(store, `k${i}`, chennaiToSalem, i);
    expect(knownRoute(store, 'k0', 100)).toBeUndefined();
    expect(knownRoute(store, 'k64', 100)).toEqual(chennaiToSalem);
  });
  it('copes with missing or junk storage', () => {
    expect(knownRoute(null, 'a')).toBeUndefined();
    expect(knownRoute({ getItem: () => 'junk', setItem: () => {} }, 'a')).toBeUndefined();
  });
});
