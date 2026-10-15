// The road rules applied to the map's roads, for drawing them as they will be built:
//   - interstates meet nothing at grade: a road crossing one is carried over it (an overpass or
//     interchange from crossings.js) or stops short of it either side;
//   - gravel and dirt roads never reach a highway (an interstate, expressway, US route, state
//     highway or interchange ramp): they stop GRAVEL_GAP_MI short of one;
//   - US routes, expressways and state highways meet each other, and paved county roads, at grade
//     at traffic signals.
// The same rules as the Roblox world's RoadNet (roblox/src/shared/World/Props/RoadNet.luau).
import { interchangeRamps } from './interchanges.js';

export const GRAVEL_GAP_MI = 0.04;
const HALF = { interstate: 0.051, expressway: 0.039, highway: 0.018, ramp: 0.011 };

function intersect(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return { t, u, sin: Math.abs(den) / (Math.hypot(rx, ry) * Math.hypot(sx, sy)) };
}

// Segments of the highways (and ramps), indexed by 2-mile cells.
function highwayIndex(map) {
  const cells = new Map(), segs = [];
  const add = (a, b, kind, road) => {
    const seg = { a, b, kind, road, half: HALF[kind] ?? 0.018 };
    segs.push(seg);
    for (let x = Math.floor(Math.min(a[0], b[0]) / 2); x <= Math.floor(Math.max(a[0], b[0]) / 2); x++) {
      for (let y = Math.floor(Math.min(a[1], b[1]) / 2); y <= Math.floor(Math.max(a[1], b[1]) / 2); y++) {
        const key = `${x},${y}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(seg);
      }
    }
  };
  for (const road of map.roads) for (let i = 1; i < road.points.length; i++) add(road.points[i - 1], road.points[i], road.kind, road);
  for (const c of map.crossings ?? []) for (const ramp of interchangeRamps(c)) for (let i = 1; i < ramp.length; i++) add(ramp[i - 1], ramp[i], 'ramp', null);
  const near = (a, b) => {
    const found = new Set();
    for (let x = Math.floor(Math.min(a[0], b[0]) / 2) - 1; x <= Math.floor(Math.max(a[0], b[0]) / 2) + 1; x++) {
      for (let y = Math.floor(Math.min(a[1], b[1]) / 2) - 1; y <= Math.floor(Math.max(a[1], b[1]) / 2) + 1; y++) {
        for (const s of cells.get(`${x},${y}`) ?? []) found.add(s);
      }
    }
    return found;
  };
  return { near, segs };
}

// Each mile of section road as drawn: lists of [x0, y0, x1, y1] (miles) by class (1 dirt,
// 2 gravel, 3 paved), cut where the rules stop them.
export function sectionSegments(map, sections) {
  const { size, roads } = sections;
  const index = highwayIndex(map);
  const carried = (x, y) => (map.crossings ?? []).some(c => Math.hypot(c.x - x, c.y - y) < 0.08);
  const out = { 1: [], 2: [], 3: [] };
  for (let J = 0; J < size; J++) for (let I = 0; I < size; I++) {
    const v = roads[J * size + I];
    for (const [cls, a, b] of [[v & 3, [I, J], [I + 1, J]], [(v >> 2) & 3, [I, J], [I, J + 1]]]) {
      if (!cls) continue;
      // Intervals of the mile (as 0 to 1) the rules take out.
      const cuts = [];
      for (const h of index.near(a, b)) {
        if (cls === 3 && h.kind !== 'interstate') continue;   // paved roads meet the other highways at grade
        const hit = intersect(a, b, h.a, h.b);
        if (!hit || hit.sin < 0.2) {
          // Running along a highway: the stretch beside it goes (the highway is the road there).
          continue;
        }
        const gap = h.half / hit.sin + (cls === 3 ? 0.01 : GRAVEL_GAP_MI);
        const hl = Math.hypot(h.b[0] - h.a[0], h.b[1] - h.a[1]) || 1;   // u is a share of the highway segment
        if (hit.u < -gap / hl || hit.u > 1 + gap / hl || hit.t < -gap || hit.t > 1 + gap) continue;
        if (cls === 3 && carried(a[0] + (b[0] - a[0]) * hit.t, a[1] + (b[1] - a[1]) * hit.t)) continue;
        cuts.push([hit.t - gap, hit.t + gap]);
      }
      cuts.sort((p, q) => p[0] - q[0]);
      let from = 0;
      for (const [c0, c1] of cuts) {
        if (c0 > from) out[cls].push([a[0] + (b[0] - a[0]) * from, a[1] + (b[1] - a[1]) * from, a[0] + (b[0] - a[0]) * c0, a[1] + (b[1] - a[1]) * c0]);
        from = Math.max(from, c1);
      }
      if (from < 1) out[cls].push([a[0] + (b[0] - a[0]) * from, a[1] + (b[1] - a[1]) * from, b[0], b[1]]);
    }
  }
  return out;
}

// At-grade junctions with traffic signals: where a US route, expressway or state highway meets
// another of them, or a paved county road ([x, y] miles).
export function signalJunctions(map, sections) {
  const highways = map.roads.filter(r => r.kind !== 'interstate');
  const out = [];
  const add = (x, y) => { if (!out.some(([ox, oy]) => Math.hypot(ox - x, oy - y) < 0.15)) out.push([x, y]); };
  const segs = [];
  highways.forEach((r, ri) => { for (let i = 1; i < r.points.length; i++) segs.push({ a: r.points[i - 1], b: r.points[i], ri }); });
  for (let i = 0; i < segs.length; i++) {
    for (let k = i + 1; k < segs.length; k++) {
      const s = segs[i], o = segs[k];
      if (s.ri === o.ri) continue;
      if (Math.max(s.a[0], s.b[0]) < Math.min(o.a[0], o.b[0]) || Math.min(s.a[0], s.b[0]) > Math.max(o.a[0], o.b[0]) || Math.max(s.a[1], s.b[1]) < Math.min(o.a[1], o.b[1]) || Math.min(s.a[1], s.b[1]) > Math.max(o.a[1], o.b[1])) continue;
      const hit = intersect(s.a, s.b, o.a, o.b);
      if (hit && hit.sin > 0.3 && hit.t >= 0 && hit.t <= 1 && hit.u >= 0 && hit.u <= 1) add(s.a[0] + (s.b[0] - s.a[0]) * hit.t, s.a[1] + (s.b[1] - s.a[1]) * hit.t);
    }
  }
  // Paved section roads crossing the highways.
  const { size, roads } = sections;
  for (const s of segs) {
    for (let I = Math.ceil(Math.min(s.a[0], s.b[0])); I <= Math.floor(Math.max(s.a[0], s.b[0])); I++) {
      if (s.b[0] === s.a[0]) continue;
      const t = (I - s.a[0]) / (s.b[0] - s.a[0]), y = s.a[1] + (s.b[1] - s.a[1]) * t, J = Math.floor(y);
      if (I > 0 && J >= 0 && I < size && J < size && ((roads[J * size + I] >> 2) & 3) === 3 && Math.abs(s.b[1] - s.a[1]) > 0.2 * Math.abs(s.b[0] - s.a[0])) add(I, y);
    }
    for (let J = Math.ceil(Math.min(s.a[1], s.b[1])); J <= Math.floor(Math.max(s.a[1], s.b[1])); J++) {
      if (s.b[1] === s.a[1]) continue;
      const t = (J - s.a[1]) / (s.b[1] - s.a[1]), x = s.a[0] + (s.b[0] - s.a[0]) * t, I = Math.floor(x);
      if (I >= 0 && J > 0 && I < size && J < size && (roads[J * size + I] & 3) === 3 && Math.abs(s.b[0] - s.a[0]) > 0.2 * Math.abs(s.b[1] - s.a[1])) add(x, J);
    }
  }
  return out;
}
