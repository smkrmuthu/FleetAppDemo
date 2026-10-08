import { lazy, Suspense, useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { groupRoutes } from '../utils/placeGeo';
import { StatusBadge } from './ui';
import { usePlacePositions } from './usePlacePositions';
import { useRoadRoutes } from './useRoadRoutes';
import { laneKey } from '../utils/roadRoute';
import type { MapLane, MapSpot } from './RouteMap';

const RouteMap = lazy(() => import('./RouteMap'));

// The lanes trucks ran in the period, on a map (OpenStreetMap) with the same
// lanes listed beside it. Positions come from the place names on each
// movement; lines follow the likely road route where one is found, otherwise
// they are straight. There is no GPS, so none of it is the road actually
// driven. A place that cannot be found stays in the list.
//
// With a big fleet there can be hundreds of lanes: the map draws the busiest
// MAX_LANES, and asks for road routes (one request a second) for the busiest
// ROAD_LANES; the rest are straight lines. Routes are remembered on the device.
const MAX_LANES = 24;
const ROAD_LANES = 10;
export function RouteNetwork({ trips, periodLabel }: { trips: { from: string; to: string; stops?: string[]; open: boolean }[]; periodLabel: string }) {
  // The dashboard hands over a fresh array on every render; key on the content so the map is not redrawn (and re-zoomed) each time.
  const tripSig = trips.map((t) => `${t.from}\u0001${(t.stops ?? []).join('\u0003')}\u0001${t.to}\u0001${t.open ? 1 : 0}`).join('\u0002');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { groups: allGroups, singles: allSingles, skipped } = useMemo(() => groupRoutes(trips), [tripSig]);
  const groups = useMemo(() => allGroups.slice(0, MAX_LANES), [allGroups]);
  const singles = useMemo(() => allSingles.slice(0, 12), [allSingles]);
  const keys = useMemo(() => [...new Set([...groups.flatMap((g) => g.path), ...singles.map((s) => s.place)])], [groups, singles]);
  const { positions, pending, missing } = usePlacePositions(keys);

  // Each lane is drawn through the places that have a position, in order. A lane
  // with only one placed place is marked instead; the places not found are noted.
  const fresh: MapLane[] = [];
  const freshSpots: MapSpot[] = [];
  const spotAt = new Map<string, MapSpot>();
  const addSpot = (name: string, at: [number, number], trips: number, open: boolean) => {
    const prev = spotAt.get(name.toLowerCase());
    if (prev) { prev.trips += trips; prev.open = prev.open || open; return; }
    const spot = { name, at, trips, open };
    spotAt.set(name.toLowerCase(), spot);
    freshSpots.push(spot);
  };
  for (const g of groups) {
    const placed = g.path.flatMap((name) => {
      const p = positions.get(name.toLowerCase());
      return p ? [{ name, at: [p.lat, p.lon] as [number, number] }] : [];
    });
    if (placed.length >= 2) fresh.push({ names: placed.map((p) => p.name), points: placed.map((p) => p.at), trips: g.trips, open: g.open });
    else if (placed.length === 1) addSpot(placed[0]!.name, placed[0]!.at, g.trips, g.open);
  }
  for (const s of singles) {
    const p = positions.get(s.place.toLowerCase());
    if (p) addSpot(s.place, [p.lat, p.lon], s.trips, s.open);
  }
  const spotSig = JSON.stringify(freshSpots);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spots = useMemo(() => freshSpots, [spotSig]);
  const { roads, pending: roadsPending } = useRoadRoutes(fresh.slice(0, ROAD_LANES));
  const laneSig = JSON.stringify(fresh) + fresh.map((l) => (roads.has(laneKey(l.points)) ? 'R' : 'S')).join('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lanes: MapLane[] = useMemo(() => fresh.map((l) => ({ ...l, line: roads.get(laneKey(l.points)) })), [laneSig]);
  const routed = lanes.filter((l) => l.line).length;
  const tag = lanes.length === 0 ? 'Approximate positions'
    : routed === lanes.length ? 'Likely road routes · not GPS'
    : roadsPending > 0 ? `Finding roads… ${routed} of ${lanes.length}`
    : routed === 0 ? 'Straight lines · not road routes'
    : `Roads for ${routed} of ${lanes.length} lanes · rest straight`;
  const shownOf = allGroups.length > MAX_LANES ? ` · busiest ${MAX_LANES} of ${allGroups.length} lanes` : '';

  const unplaced = (g: { path: string[] }) => g.path.filter((p) => positions.has(p.toLowerCase())).length < 2;

  return (
    <div className="card map-card">
      <div className="map-canvas">
        <div className="map-tag"><StatusBadge>{tag}</StatusBadge></div>
        {groups.length === 0 && singles.length === 0 ? (
          <div className="map-empty">No routes to show for this period</div>
        ) : lanes.length === 0 && spots.length === 0 ? (
          <div className="map-empty">{pending.length ? `Locating ${pending.length} ${pending.length === 1 ? 'place' : 'places'}…` : 'None of the places could be found on the map. The routes are listed beside it.'}</div>
        ) : (
          <Suspense fallback={<div className="map-empty">Loading map…</div>}>
            <RouteMap lanes={lanes} spots={spots} />
          </Suspense>
        )}
      </div>

      <div className="map-side">
        <div>
          <h3>Route network</h3>
          <div className="map-sub">Lanes run in {periodLabel}{shownOf}</div>
        </div>
        {groups.length === 0 && singles.length === 0 ? (
          <div className="map-sub">Routes appear here once movements with a loading and an unloading place are recorded.</div>
        ) : (
          <ul className="lane-list">
            {groups.slice(0, 8).map((g) => (
              <li key={g.path.join('>')}>
                <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 6px', minWidth: 0 }}>
                  {g.path.map((place, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {i > 0 && <ArrowRight size={13} aria-hidden="true" style={{ color: 'var(--color-sidebar-muted)', flex: 'none' }} />}
                      {place}
                    </span>
                  ))}
                  {unplaced(g) && !pending.length && <span className="map-sub" title="Not on the map">· not mapped</span>}
                </span>
                <span className="lane-count">{g.trips}×</span>
              </li>
            ))}
          </ul>
        )}
        {allGroups.length > 8 && <div className="map-sub">+{allGroups.length - 8} more lanes</div>}
        {singles.length > 0 && (
          <ul className="lane-list">
            {singles.slice(0, 6).map((s) => (
              <li key={s.place}>
                <span style={{ minWidth: 0 }}>{s.place} <span className="map-sub" title="The other end is not recorded yet, or both ends are the same place, so it is marked without a line">· one place only</span></span>
                <span className="lane-count">{s.trips}×</span>
              </li>
            ))}
          </ul>
        )}
        <div className="map-legend"><span><i /> Completed</span><span><i className="open" /> Open movement</span></div>
        {(pending.length > 0 || missing.length > 0 || skipped > 0) && (
          <div className="map-sub">
            {pending.length > 0 && <>Locating {pending.length} more {pending.length === 1 ? 'place' : 'places'}…</>}
            {!pending.length && missing.length > 0 && <> Not found on the map: {missing.join(', ')}.</>}
            {skipped > 0 && <> {skipped} {skipped === 1 ? 'movement has' : 'movements have'} no loading or unloading place recorded.</>}
          </div>
        )}
      </div>
    </div>
  );
}
