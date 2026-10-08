import { useEffect, useMemo, useRef, useState } from 'react';
import { browserStore } from '../utils/placeGeo';
import { ROUTE_GAP_MS, fetchRoadRoute, knownRoute, laneKey, rememberRoute, waypoints, type Pt } from '../utils/roadRoute';

export interface RoadRoutes {
  // lane key (see laneKey) -> the road route, for lanes that have one
  roads: Map<string, Pt[]>;
  // lanes still waiting for an answer
  pending: number;
}

// Road routes for the given lanes. Remembered routes are instant; the others
// are asked for one at a time in the background (about one a second, as the
// public routing servers ask) and remembered on this device. A lane whose route
// cannot be found stays a straight line.
export function useRoadRoutes(lanes: { points: Pt[] }[]): RoadRoutes {
  const store = browserStore();
  const [tick, setTick] = useState(0);
  const failed = useRef(new Set<string>());
  const byKey = new Map<string, Pt[]>();
  for (const l of lanes) byKey.set(laneKey(l.points), l.points);
  const sig = [...byKey.keys()].join('|');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const [key, points] of byKey) {
        if (cancelled) return;
        if (failed.current.has(key) || waypoints(points).length < 2 || knownRoute(store, key) !== undefined) continue;
        try {
          rememberRoute(store, key, await fetchRoadRoute(points));
        } catch {
          failed.current.add(key);
        }
        if (cancelled) return;
        setTick((n) => n + 1);
        await new Promise((r) => setTimeout(r, ROUTE_GAP_MS));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return useMemo(() => {
    const roads = new Map<string, Pt[]>();
    let pending = 0;
    for (const [key, points] of byKey) {
      if (waypoints(points).length < 2) continue;
      const hit = knownRoute(store, key);
      if (hit) roads.set(key, hit);
      else if (hit === undefined && !failed.current.has(key)) pending++;
    }
    return { roads, pending };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, tick]);
}
