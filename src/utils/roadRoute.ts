import type { KeyValueStore } from './placeGeo';

// The likely road route through a lane's places, from a public routing service
// (OSRM, run by the OpenStreetMap community). Only the positions of the places
// are sent. The route is what a car would usually drive, not what the truck
// did: there is no GPS. Answers are remembered on this device.

export type Pt = [number, number]; // [lat, lon]

const SERVERS = ['https://routing.openstreetmap.de/routed-car', 'https://router.project-osrm.org'];
// The public servers ask for about one request a second.
export const ROUTE_GAP_MS = 1100;

// A lane's identity: its places' positions, to about 100 m.
export function laneKey(points: Pt[]): string {
  return points.map(([la, lo]) => `${la.toFixed(3)},${lo.toFixed(3)}`).join(';');
}

// Consecutive places at the same spot are one waypoint; a lane that never leaves
// one spot (everything within about 100 m) has no road to find.
export function waypoints(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.abs(prev[0] - p[0]) > 0.001 || Math.abs(prev[1] - p[1]) > 0.001) out.push(p);
  }
  return out;
}

export function routeUrl(base: string, points: Pt[]): string {
  const coords = points.map(([la, lo]) => `${lo.toFixed(5)},${la.toFixed(5)}`).join(';');
  return `${base}/route/v1/driving/${coords}?overview=full&geometries=polyline&continue_straight=false`;
}

// Decodes an encoded polyline (precision 5) into [lat, lon] points.
export function decodePolyline(str: string): Pt[] {
  const pts: Pt[] = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let shift = 0, result = 0, b: number;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lon += next();
    pts.push([lat / 1e5, lon / 1e5]);
  }
  return pts;
}

type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

// The road route through the places, or null when the service finds no road
// between them. Throws when the service itself could not be reached, so a
// failure is never remembered as "no road". Tries the second server if the first fails.
export async function fetchRoadRoute(points: Pt[], fetchImpl: FetchLike = (u) => fetch(u)): Promise<Pt[] | null> {
  const wp = waypoints(points);
  if (wp.length < 2) return null;
  let lastError: unknown = new Error('routing failed');
  for (const base of SERVERS) {
    try {
      const res = await fetchImpl(routeUrl(base, wp));
      if (!res.ok) throw new Error('routing failed');
      const data = (await res.json()) as { code?: string; routes?: { geometry?: string }[] };
      if (data.code === 'NoRoute') return null;
      const geometry = data.routes?.[0]?.geometry;
      if (data.code !== 'Ok' || typeof geometry !== 'string') throw new Error('routing failed');
      const line = decodePolyline(geometry);
      return line.length >= 2 ? line : null;
    } catch (e) { lastError = e; }
  }
  throw lastError;
}

// --- remembered routes ------------------------------------------------------

const CACHE_KEY = 'fleet_road_routes_v1';
const MAX_ROUTES = 60;
const MISS_RETRY_MS = 7 * 86_400_000;

// Each route is kept as the encoded string it arrived in (about 4 bytes a point).
interface Entry { line: string | null; at: number }

export function encodePolyline(points: Pt[]): string {
  let out = '', pLat = 0, pLon = 0;
  const put = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    out += String.fromCharCode(n + 63);
  };
  for (const [la, lo] of points) {
    const a = Math.round(la * 1e5), b = Math.round(lo * 1e5);
    put(a - pLat); put(b - pLon); pLat = a; pLon = b;
  }
  return out;
}

function readAll(store: KeyValueStore | null): Record<string, Entry> {
  try {
    const raw = store?.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

// A remembered road route: the points, null for "no road found" (until it is
// worth asking again), or undefined when it has to be asked for.
export function knownRoute(store: KeyValueStore | null, key: string, now = Date.now()): Pt[] | null | undefined {
  const hit = readAll(store)[key];
  if (!hit) return undefined;
  if (hit.line) return decodePolyline(hit.line);
  return now - hit.at < MISS_RETRY_MS ? null : undefined;
}

export function rememberRoute(store: KeyValueStore | null, key: string, line: Pt[] | null, now = Date.now()) {
  const all = readAll(store);
  all[key] = { line: line ? encodePolyline(line) : null, at: now };
  const keys = Object.keys(all);
  if (keys.length > MAX_ROUTES) {
    for (const k of keys.sort((a, b) => all[a]!.at - all[b]!.at).slice(0, keys.length - MAX_ROUTES)) delete all[k];
  }
  try { store?.setItem(CACHE_KEY, JSON.stringify(all)); } catch { /* storage full or blocked: routes are just asked for again */ }
}
