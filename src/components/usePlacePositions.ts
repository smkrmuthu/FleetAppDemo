import { useEffect, useRef, useState } from 'react';
import { SEARCH_GAP_MS, browserStore, knownPosition, lookupPlace, readCache, rememberPlace, type LatLon } from '../utils/placeGeo';

export interface PlacePositions {
  positions: Map<string, LatLon>;
  // places still waiting to be searched
  pending: string[];
  // places that were searched and not found, or could not be searched (offline)
  missing: string[];
}

// Positions for the given places. Known towns and remembered searches are
// instant; the rest are searched one at a time in the background (about one a
// second, as OpenStreetMap asks) and the result is remembered on this device.
export function usePlacePositions(keys: string[]): PlacePositions {
  const store = browserStore();
  const [, setTick] = useState(0);
  const failed = useRef(new Set<string>());
  const sig = keys.map((k) => k.toLowerCase()).join('|');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const key of keys) {
        if (cancelled) return;
        if (failed.current.has(key.toLowerCase()) || knownPosition(key, readCache(store)) !== undefined) continue;
        try {
          rememberPlace(store, key, await lookupPlace(key));
        } catch {
          failed.current.add(key.toLowerCase());
        }
        if (cancelled) return;
        setTick((n) => n + 1);
        await new Promise((r) => setTimeout(r, SEARCH_GAP_MS));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const cache = readCache(store);
  const positions = new Map<string, LatLon>();
  const pending: string[] = [];
  const missing: string[] = [];
  for (const key of keys) {
    const pos = knownPosition(key, cache);
    if (pos) positions.set(key.toLowerCase(), pos);
    else if (pos === null || failed.current.has(key.toLowerCase())) missing.push(key);
    else pending.push(key);
  }
  return { positions, pending, missing };
}
