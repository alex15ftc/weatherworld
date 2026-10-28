// What every planned thing takes up on the ground in the Roblox world (map miles, at the Roblox
// map's studs a mile, scale.js), and where those footprints overlap: the check that roads, cul-de-sacs, rivers, lots and
// areas each have ground of their own.
//   roads        each edge of the road graph (streets.js) as a strip its cross-section wide
//                (HALF_MI), each cul-de-sac as a circle of bulbMi;
//   rivers       the channel as drawn in Roblox (0.18 studs a metre of width, 12 to 220 studs) with
//                its banks, and a corridor round it (the valley sides) that lots keep out of;
//   lots         gas stations, schools, campuses, the land-use superblocks (malls, community
//                centres, travel centres, industrial parks, larger parks), airfield fences and the
//                NWS offices' buildings and radar compounds.
// Conflicts, by type:
//   road         two road strips overlap without meeting at a node (grade-separated crossings of
//                an interstate or ramp, and ramps inside their interchange, are allowed);
//   culDeSac     a cul-de-sac overlaps another, a road other than its own street, a lot or a river;
//   lot          a road strip reaches into a lot;
//   river        a road runs along a river inside its channel, or crosses one at a slant (longer,
//                skewed bridges than a road should need); a lot reaches into a river's corridor.
import { HALF_MI } from './streets.js';
import { pointInPoly } from './airfields.js';
import { AT_1000, STUDS } from './scale.js';

export const FOOTPRINT_DEFAULTS = Object.freeze({
  bulbMi: STUDS(35),      // a cul-de-sac's radius (RoadNet.bulbSpec; streets.js bulbMi)
  bankMi: STUDS(18),      // the banks a bridge spans beyond the water (Bridges.BANK_EXTRA)
  valleyMi: AT_1000(0.03), // lots keep this much further from a river's banks
  skewSin: 0.5,           // a road crossing a river at a slant flatter than this is a conflict
  interchangeMi: AT_1000(0.35), // ramps within this of their crossing are the interchange's own
  cellMi: 0.25
});

// Distance between segments p0-p1 and q0-q1 (points as [x, y]).
export function segmentDistance(p0, p1, q0, q1) {
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = cross(p0, p1, q0), d2 = cross(p0, p1, q1), d3 = cross(q0, q1, p0), d4 = cross(q0, q1, p1);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  const toSeg = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
  };
  return Math.min(toSeg(p0, q0, q1), toSeg(p1, q0, q1), toSeg(q0, p0, p1), toSeg(q1, p0, p1));
}

// Distance from a segment to a polygon (0 when it reaches inside).
export function segmentPolyDistance(a, b, poly) {
  if (pointInPoly(a[0], a[1], poly) || pointInPoly(b[0], b[1], poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, segmentDistance(a, b, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

const riverHalf = widthM => STUDS(Math.min(220, Math.max(12, widthM * 0.18))) / 2;
// Beyond a footprint's own half-width, how far to look for others (the widest road's half-width).
const LOOK = HALF_MI.interstate + STUDS(9);

// Every footprint conflict on the map. Returns { counts: { type: n }, list: [{ type, what, x, y }] }.
export function findConflicts(map, options = {}) {
  const p = { ...FOOTPRINT_DEFAULTS, ...options };
  const graph = map.streets.graph, fac = map.facilities;
  const edges = graph.edges.filter(e => e.alive);
  const list = [], counts = {};
  const report = (type, what, x, y) => { counts[type] = (counts[type] ?? 0) + 1; list.push({ type, what, x: Math.round(x * 1e4) / 1e4, y: Math.round(y * 1e4) / 1e4 }); };

  // A grid of the footprints.
  const cells = new Map(), C = p.cellMi;
  const index = (item, x0, y0, x1, y1) => {
    for (let X = Math.floor(x0 / C); X <= Math.floor(x1 / C); X++) for (let Y = Math.floor(y0 / C); Y <= Math.floor(y1 / C); Y++) {
      const k = X * 8192 + Y; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(item);
    }
  };
  const near = (x0, y0, x1, y1) => {
    const found = new Set();
    for (let X = Math.floor(x0 / C); X <= Math.floor(x1 / C); X++) for (let Y = Math.floor(y0 / C); Y <= Math.floor(y1 / C); Y++) for (const it of cells.get(X * 8192 + Y) ?? []) found.add(it);
    return found;
  };
  const roads = edges.map(e => ({ kind: 'road', e, a: [e.a.x, e.a.y], b: [e.b.x, e.b.y], half: HALF_MI[e.kind] }));
  for (const r of roads) index(r, Math.min(r.a[0], r.b[0]) - r.half, Math.min(r.a[1], r.b[1]) - r.half, Math.max(r.a[0], r.b[0]) + r.half, Math.max(r.a[1], r.b[1]) + r.half);
  const bulbs = graph.nodes.filter(n => n.edges.length === 1 && n.end === 1).map(n => ({ kind: 'bulb', n, x: n.x, y: n.y }));
  for (const b of bulbs) index(b, b.x - p.bulbMi, b.y - p.bulbMi, b.x + p.bulbMi, b.y + p.bulbMi);
  const rivers = [];
  for (const river of map.rivers) for (let k = 2; k < river.points.length; k += 2) {
    const half = riverHalf(river.widthsM[k / 2]);
    rivers.push({ kind: 'river', name: river.name, a: [river.points[k - 2], river.points[k - 1]], b: [river.points[k], river.points[k + 1]], half });
  }
  for (const r of rivers) { const reach = r.half + p.bankMi + p.valleyMi; index(r, Math.min(r.a[0], r.b[0]) - reach, Math.min(r.a[1], r.b[1]) - reach, Math.max(r.a[0], r.b[0]) + reach, Math.max(r.a[1], r.b[1]) + reach); }
  const lots = [];
  const lot = (what, poly) => { const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]); const it = { kind: 'lot', what, poly, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }; lots.push(it); index(it, ...it.box); };
  for (const g of fac.gasStations) lot('gas station', g.lot);
  for (const s of fac.schools) lot('school', s.lot);
  for (const c of fac.campuses) lot('campus', c.area);
  for (const z of fac.landUse.areas) {
    const xs = z.poly.map(q => q[0]), ys = z.poly.map(q => q[1]), small = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (z.kind === 'mall' || z.kind === 'travel' || z.tier === 'community' || z.kind === 'industrial' || (z.kind === 'park' && small > AT_1000(0.15))) lot(z.kind, z.poly);
  }
  for (const a of map.airfields ?? []) { lot('airfield', a.fence); for (const poly of [a.nws?.building, a.radar?.compound]) if (poly) lot('NWS office', poly); }

  const crossings = map.crossings ?? [];
  const inInterchange = (x, y) => crossings.some(c => c.type === 'interchange' && Math.hypot(c.x - x, c.y - y) < p.interchangeMi);
  const crosses = (r, o) => segmentDistance(r.a, r.b, o.a, o.b) === 0;
  // Whether two roads cross here: these two edges, or either and the next edge of the other road
  // (a bridge over a road's bend spans the chords either side of it).
  const pieces = e => [e, ...[e.a, e.b].flatMap(n => n.edges.filter(f => f !== e && f.kind === e.kind))];
  const seg = e => ({ a: [e.a.x, e.a.y], b: [e.b.x, e.b.y] });
  const crossesNear = (r, o) => crosses(r, o) || pieces(r.e).some(e => pieces(o.e).some(f => (e !== r.e || f !== o.e) && crosses(seg(e), seg(f))));
  // The junctions: nodes where roads of different kinds or routes meet. Two roads overlapping
  // close enough to a junction both run into are inside that junction (its wide corners where
  // they meet at a slant), not in conflict.
  const junctionCells = new Map();
  for (const n of graph.nodes) {
    if (n.edges.length < 3 && new Set(n.edges.map(e => `${e.kind}${e.road ?? ''}`)).size < 2) continue;
    const k = Math.floor(n.x / C) * 8192 + Math.floor(n.y / C);
    if (!junctionCells.has(k)) junctionCells.set(k, []); junctionCells.get(k).push(n);
  }
  const sameRoad = (e, f) => e.kind === f.kind && (e.road ?? -1) === (f.road ?? -1);
  const inJunction = (r, o, x, y) => {
    const ex = r.b[0] - r.a[0], ey = r.b[1] - r.a[1], fx = o.b[0] - o.a[0], fy = o.b[1] - o.a[1];
    const sin = Math.abs(ex * fy - ey * fx) / (Math.hypot(ex, ey) * Math.hypot(fx, fy));
    const reach = (r.half + o.half) / Math.max(sin, 0.2) + AT_1000(0.02);
    for (let X = Math.floor((x - reach) / C); X <= Math.floor((x + reach) / C); X++) for (let Y = Math.floor((y - reach) / C); Y <= Math.floor((y + reach) / C); Y++) {
      for (const n of junctionCells.get(X * 8192 + Y) ?? []) {
        if (Math.hypot(n.x - x, n.y - y) > reach) continue;
        if (n.edges.some(e => sameRoad(e, r.e)) && n.edges.some(e => sameRoad(e, o.e))) return true;
      }
    }
    return false;
  };
  // The nearest points of two segments' middles (for where an overlap is).
  const between = (r, o) => {
    let best = null;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, x = r.a[0] + (r.b[0] - r.a[0]) * t, y = r.a[1] + (r.b[1] - r.a[1]) * t;
      const d = segmentDistance([x, y], [x, y], o.a, o.b);
      if (!best || d < best.d) best = { d, x, y };
    }
    return best;
  };
  // Whether two edges are joined by one edge between their ends.
  const linked = (e, f) => {
    for (const n of [e.a, e.b]) for (const g of n.edges) { const m = g.a === n ? g.b : g.a; if (m === f.a || m === f.b) return true; }
    return false;
  };

  // Roads against roads, lots and rivers.
  for (const r of roads) {
    const reach = r.half + LOOK;
    for (const o of near(Math.min(r.a[0], r.b[0]) - reach, Math.min(r.a[1], r.b[1]) - reach, Math.max(r.a[0], r.b[0]) + reach, Math.max(r.a[1], r.b[1]) + reach)) {
      if (o.kind === 'road') {
        if (o.e.id <= r.e.id) continue;
        const e = r.e, f = o.e;
        if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
        // Pieces of one straight road either side of a short piece, and roads one short edge
        // apart at a junction, are the junction's own.
        if (linked(e, f)) continue;
        if (e.road !== undefined && e.road === f.road) continue;   // pieces of one route (its curves)
        const ex = r.b[0] - r.a[0], ey = r.b[1] - r.a[1], fx = o.b[0] - o.a[0], fy = o.b[1] - o.a[1];
        const cos = Math.abs(ex * fx + ey * fy) / (Math.hypot(ex, ey) * Math.hypot(fx, fy));
        if (cos > 0.995 && e.kind === f.kind && Math.abs((o.a[0] - r.a[0]) * ey - (o.a[1] - r.a[1]) * ex) / Math.hypot(ex, ey) < 1e-4) continue;
        const separated = e.kind === 'interstate' || f.kind === 'interstate' || e.kind === 'ramp' || f.kind === 'ramp';
        if (separated && crossesNear(r, o)) continue;
        if ((e.kind === 'ramp' && f.kind === 'interstate') || (f.kind === 'ramp' && e.kind === 'interstate')) continue;   // merging
        const d = segmentDistance(r.a, r.b, o.a, o.b);
        if (d >= r.half + o.half) continue;
        const { x: mx, y: my } = between(r, o);
        if ((e.kind === 'ramp' || f.kind === 'ramp') && inInterchange(mx, my)) continue;
        if (inJunction(r, o, mx, my)) continue;
        report('road', `${e.kind} / ${f.kind}`, mx, my);
      } else if (o.kind === 'lot') {
        if (r.e.kind === 'local' && (o.what === 'airfield' || o.what === 'campus')) continue;   // the airfield's or campus's own roads
        if (segmentPolyDistance(r.a, r.b, o.poly) < r.half) {
          const [x, y] = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2];
          report('lot', `${r.e.kind} into ${o.what}`, x, y);
        }
      } else if (o.kind === 'river') {
        const d = segmentDistance(r.a, r.b, o.a, o.b);
        if (d >= r.half + o.half) continue;
        const rx = r.b[0] - r.a[0], ry = r.b[1] - r.a[1], sx = o.b[0] - o.a[0], sy = o.b[1] - o.a[1];
        const sin = Math.abs(rx * sy - ry * sx) / (Math.hypot(rx, ry) * Math.hypot(sx, sy));
        const x = (r.a[0] + r.b[0]) / 2, y = (r.a[1] + r.b[1]) / 2;
        if (d > 0 && sin < p.skewSin) report('river', `${r.e.kind} along ${o.name ?? 'a river'}`, x, y);
        else if (d === 0 && sin < p.skewSin) report('river', `${r.e.kind} crosses ${o.name ?? 'a river'} at a slant`, x, y);
      }
    }
  }
  // Cul-de-sacs.
  for (const b of bulbs) {
    const own = b.n.edges[0], r0 = p.bulbMi;
    for (const o of near(b.x - r0 - LOOK, b.y - r0 - LOOK, b.x + r0 + LOOK, b.y + r0 + LOOK)) {
      if (o.kind === 'bulb') { if (o.n.id > b.n.id && Math.hypot(o.x - b.x, o.y - b.y) < 2 * r0) report('culDeSac', 'two cul-de-sacs', (b.x + o.x) / 2, (b.y + o.y) / 2); }
      else if (o.kind === 'road') {
        if (o.e === own || o.e.a === own.a || o.e.a === own.b || o.e.b === own.a || o.e.b === own.b) continue;
        if (segmentDistance([b.x, b.y], [b.x, b.y], o.a, o.b) < r0 + o.half) report('culDeSac', `cul-de-sac on a ${o.e.kind}`, b.x, b.y);
      } else if (o.kind === 'lot') { if (segmentPolyDistance([b.x, b.y], [b.x, b.y], o.poly) < r0) report('culDeSac', `cul-de-sac in a ${o.what}`, b.x, b.y); }
      else if (o.kind === 'river') { if (segmentDistance([b.x, b.y], [b.x, b.y], o.a, o.b) < r0 + o.half + p.bankMi) report('culDeSac', 'cul-de-sac on a river bank', b.x, b.y); }
    }
  }
  // Lots in river corridors.
  for (const l of lots) {
    const reach = STUDS(110) + p.bankMi + p.valleyMi;   // the widest river's half-width, banks and valley
    for (const o of near(l.box[0] - reach, l.box[1] - reach, l.box[2] + reach, l.box[3] + reach)) {
      if (o.kind !== 'river') continue;
      if (segmentPolyDistance(o.a, o.b, l.poly) < o.half + p.bankMi + p.valleyMi) { report('river', `${l.what} in a river corridor`, (l.box[0] + l.box[2]) / 2, (l.box[1] + l.box[3]) / 2); break; }
    }
  }
  return { counts, list };
}

// Conflicts counted by type and by what (for reports).
export function describeConflicts({ list }) {
  const byWhat = {};
  for (const c of list) byWhat[`${c.type}: ${c.what}`] = (byWhat[`${c.type}: ${c.what}`] ?? 0) + 1;
  return Object.fromEntries(Object.entries(byWhat).sort((a, b) => b[1] - a[1]));
}
