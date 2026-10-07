// Approximate positions of the towns, yards and ports that appear in trip
// routes, used only to lay out the dashboard's illustrative route network.
// Trips store free-text places ("Chennai Yard", "Sriperumbudur ICD"), so a
// place is matched by the first known town name it contains. Anything that
// matches nothing is left off the map (and counted), never guessed.

export interface Town { name: string; lat: number; lon: number }

const TOWNS: { keys: string[]; town: Town }[] = [
  { keys: ['chennai', 'madras'], town: { name: 'Chennai', lat: 13.08, lon: 80.27 } },
  { keys: ['ennore'], town: { name: 'Ennore', lat: 13.21, lon: 80.32 } },
  { keys: ['sriperumbudur'], town: { name: 'Sriperumbudur', lat: 12.97, lon: 79.94 } },
  { keys: ['hosur'], town: { name: 'Hosur', lat: 12.74, lon: 77.83 } },
  { keys: ['bengaluru', 'bangalore'], town: { name: 'Bengaluru', lat: 12.97, lon: 77.59 } },
  { keys: ['coimbatore'], town: { name: 'Coimbatore', lat: 11.0, lon: 76.96 } },
  { keys: ['tirupur', 'tiruppur'], town: { name: 'Tirupur', lat: 11.11, lon: 77.34 } },
  { keys: ['erode'], town: { name: 'Erode', lat: 11.34, lon: 77.72 } },
  { keys: ['salem'], town: { name: 'Salem', lat: 11.66, lon: 78.15 } },
  { keys: ['trichy', 'tiruchirappalli', 'tiruchi'], town: { name: 'Trichy', lat: 10.8, lon: 78.69 } },
  { keys: ['madurai'], town: { name: 'Madurai', lat: 9.92, lon: 78.12 } },
  { keys: ['tuticorin', 'thoothukudi'], town: { name: 'Tuticorin', lat: 8.76, lon: 78.13 } },
  { keys: ['cochin', 'kochi', 'ernakulam'], town: { name: 'Cochin', lat: 9.93, lon: 76.27 } },
  { keys: ['tirupati'], town: { name: 'Tirupati', lat: 13.63, lon: 79.42 } },
  { keys: ['krishnapatnam'], town: { name: 'Krishnapatnam', lat: 14.25, lon: 80.12 } },
  { keys: ['nellore'], town: { name: 'Nellore', lat: 14.44, lon: 79.99 } },
  { keys: ['vijayawada'], town: { name: 'Vijayawada', lat: 16.51, lon: 80.65 } },
  { keys: ['hyderabad'], town: { name: 'Hyderabad', lat: 17.38, lon: 78.48 } },
  { keys: ['visakhapatnam', 'vizag'], town: { name: 'Visakhapatnam', lat: 17.69, lon: 83.22 } }
];

export function findTown(place: string): Town | null {
  const p = place.toLowerCase();
  for (const { keys, town } of TOWNS) if (keys.some((k) => p.includes(k))) return town;
  return null;
}

export interface Lane { from: Town; to: Town; trips: number; open: boolean }

// Groups trips into lanes (one per from→to pair of known towns). Trips with a
// place that isn't recognised, or that start and end in the same town, are
// counted in `skipped` instead.
export function buildLanes(trips: { from: string; to: string; open: boolean }[]): { lanes: Lane[]; skipped: number } {
  const byKey = new Map<string, Lane>();
  let skipped = 0;
  for (const t of trips) {
    const a = findTown(t.from);
    const b = findTown(t.to);
    if (!a || !b || a.name === b.name) { skipped++; continue; }
    const key = `${a.name}>${b.name}`;
    const lane = byKey.get(key);
    if (lane) { lane.trips++; lane.open = lane.open || t.open; }
    else byKey.set(key, { from: a, to: b, trips: 1, open: t.open });
  }
  return { lanes: [...byKey.values()].sort((x, y) => y.trips - x.trips), skipped };
}

export interface Projection { width: number; height: number; project: (t: Town) => { x: number; y: number } }

// Fits the towns used by `lanes` into a width × height box, keeping the
// map's proportions (about 1° of longitude per degree of latitude).
export function projectTowns(towns: Town[], width: number, height: number, pad = 44): Projection {
  const lats = towns.map((t) => t.lat);
  const lons = towns.map((t) => t.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const spanLat = Math.max(0.5, maxLat - minLat);
  const spanLon = Math.max(0.5, maxLon - minLon);
  const scale = Math.min((width - pad * 2) / spanLon, (height - pad * 2) / spanLat);
  const offX = (width - spanLon * scale) / 2;
  const offY = (height - spanLat * scale) / 2;
  return {
    width, height,
    project: (t) => ({ x: offX + (t.lon - minLon) * scale, y: offY + (maxLat - t.lat) * scale })
  };
}
