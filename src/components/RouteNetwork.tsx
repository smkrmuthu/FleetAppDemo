import { useId } from 'react';
import { ArrowRight } from 'lucide-react';
import { projectTowns, type Lane } from '../utils/routeGeo';
import { StatusBadge } from './ui';

const W = 640;
const H = 460;

interface Placed { name: string; x: number; y: number; dx: number; dy: number; anchor: 'start' | 'end' | 'middle' }

// Puts each town's name beside its dot, trying a few positions so labels of
// neighbouring towns don't sit on top of one another or on another town's dot.
function placeLabels(points: { name: string; x: number; y: number }[]): Placed[] {
  const charW = 7.4;
  const spots: { dx: number; dy: number; anchor: Placed['anchor'] }[] = [
    { dx: 16, dy: 4, anchor: 'start' }, { dx: -16, dy: 4, anchor: 'end' },
    { dx: 0, dy: -17, anchor: 'middle' }, { dx: 0, dy: 27, anchor: 'middle' },
    { dx: 16, dy: -13, anchor: 'start' }, { dx: -16, dy: 21, anchor: 'end' },
    { dx: 16, dy: 21, anchor: 'start' }, { dx: -16, dy: -13, anchor: 'end' }
  ];
  const taken: { x0: number; x1: number; y0: number; y1: number }[] = points.map((p) => ({ x0: p.x - 11, x1: p.x + 11, y0: p.y - 11, y1: p.y + 11 }));
  return points.map((p) => {
    const w = p.name.length * charW;
    const boxFor = (c: (typeof spots)[number]) => {
      const x0 = c.anchor === 'start' ? p.x + c.dx : c.anchor === 'end' ? p.x + c.dx - w : p.x - w / 2;
      return { x0, x1: x0 + w, y0: p.y + c.dy - 11, y1: p.y + c.dy + 4 };
    };
    const free = (b: ReturnType<typeof boxFor>) =>
      b.x0 >= 6 && b.x1 <= W - 6 && b.y0 >= 6 && b.y1 <= H - 6 &&
      !taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
    const chosen = spots.find((c) => free(boxFor(c))) ?? spots[0]!;
    taken.push(boxFor(chosen));
    return { name: p.name, x: p.x, y: p.y, ...chosen };
  });
}

// Dark map-style panel of the lanes trucks ran in the period. Town positions
// are approximate (looked up from the place names on each movement) and the
// layout is for orientation only, so the panel says so.
export function RouteNetwork({ lanes, skipped, periodLabel }: { lanes: Lane[]; skipped: number; periodLabel: string }) {
  const uid = useId().replace(/:/g, '');
  const towns = [...new Map(lanes.flatMap((l) => [l.from, l.to]).map((t) => [t.name, t])).values()];
  const proj = towns.length ? projectTowns(towns, W, H, 56) : null;
  const openTowns = new Set(lanes.filter((l) => l.open).map((l) => l.to.name));

  return (
    <div className="card map-card">
      <div className="map-canvas">
        <div className="map-tag"><StatusBadge>Illustrative layout</StatusBadge></div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Route network, ${periodLabel}`}>
          <defs>
            <pattern id={`dots-${uid}`} width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.2" fill="#fff" fillOpacity="0.09" />
            </pattern>
            <marker id={`arrow-${uid}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="#C3CAD1" />
            </marker>
            <marker id={`arrow-open-${uid}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="var(--color-primary)" />
            </marker>
          </defs>
          <rect width={W} height={H} fill={`url(#dots-${uid})`} />
          {!proj && (
            <text x={W / 2} y={H / 2} textAnchor="middle" fill="#7C8792" fontSize="14">No routes to show for this period</text>
          )}
          {proj && lanes.map((l, i) => {
            const a = proj.project(l.from);
            const b = proj.project(l.to);
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            // bow each lane to one side, so a lane and its return trip don't overlap
            const bow = Math.min(46, len * 0.22) * (l.from.name < l.to.name ? 1 : -1);
            const cx = mx + (-dy / len) * bow, cy = my + (dx / len) * bow;
            return (
              <path
                key={`${l.from.name}>${l.to.name}`}
                d={`M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}`}
                fill="none"
                stroke={l.open ? 'var(--color-primary)' : '#C3CAD1'}
                strokeOpacity={l.open ? 1 : 0.55}
                strokeWidth={1.6 + Math.min(4, l.trips - 1)}
                strokeLinecap="round"
                markerEnd={`url(#${l.open ? 'arrow-open-' : 'arrow-'}${uid})`}
                style={{ animationDelay: `${i * 60}ms` }}
              />
            );
          })}
          {proj && placeLabels(towns.map((t) => ({ name: t.name, ...proj.project(t) }))).map((l) => {
            const open = openTowns.has(l.name);
            return (
              <g key={l.name}>
                <circle cx={l.x} cy={l.y} r="10" fill="none" stroke={open ? 'var(--color-primary)' : '#fff'} strokeOpacity={open ? 0.5 : 0.18} strokeWidth="2" />
                <circle cx={l.x} cy={l.y} r="4.5" fill="#fff" />
                <text x={l.x + l.dx} y={l.y + l.dy} textAnchor={l.anchor} fill="#E8ECEF" fontSize="12.5" fontWeight="600">{l.name}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="map-side">
        <div>
          <h3>Route network</h3>
          <div className="map-sub">Lanes run in {periodLabel}</div>
        </div>
        {lanes.length === 0 ? (
          <div className="map-sub">Routes appear here once movements with known places are recorded.</div>
        ) : (
          <ul className="lane-list">
            {lanes.slice(0, 6).map((l) => (
              <li key={`${l.from.name}>${l.to.name}`}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {l.from.name} <ArrowRight size={13} aria-hidden="true" style={{ color: 'var(--color-sidebar-muted)', flex: 'none' }} /> {l.to.name}
                </span>
                <span className="lane-count">{l.trips}×</span>
              </li>
            ))}
          </ul>
        )}
        <div className="map-legend"><span><i /> Completed</span><span><i className="open" /> Open movement</span></div>
        <div className="map-sub">
          Towns are placed by approximate position from the place names on each movement, for orientation only.
          {skipped > 0 && <> {skipped} {skipped === 1 ? 'movement' : 'movements'} with an unrecognised place {skipped === 1 ? 'is' : 'are'} not shown.</>}
        </div>
      </div>
    </div>
  );
}
