// Curves for the routed highways. Routing lays roads along the mile lines with diagonal steps
// between them, so every bend is a corner. Each corner is rounded into a circular arc of the
// road's design radius (longer, wider curves for faster roads), drawn as short chords, before
// anything else is planned against the roads (interchanges, overpasses, airfields, land use,
// lots), so everything downstream sees the curves. A corner keeps its point where another road
// comes near it (within keepMi: a junction stays a junction, and a road joining nearby still finds
// the road where it was); where the straight runs either side are too short for the full radius,
// the curve is as wide as they allow. Near an interstate (where another road may cross it at an
// interchange or overpass, planned for straight roads) a curve keeps clearMi from it, shrinking or
// leaving the corner sharp.
// Scale (scale.js): the room kept for interchanges and overpasses is at character scale and keeps
// its size in studs (AT_1000); the radii (rounding the routes' corners, which come a mile or so
// apart; scaled, they made more overlaps where curves pass town arterials) and which roads come
// near a corner (keepMi) are the map's own.
import { AT_1000 } from './scale.js';

export const CURVE_DEFAULTS = Object.freeze({
  radiusMi: { interstate: 0.6, expressway: 0.35, highway: 0.15 },
  maxShare: 0.45,      // a curve takes at most this share of each straight run beside the corner
  stepDeg: 6,          // the arc is drawn in chords turning at most this much
  minDeg: 2,           // corners turning less than this are left as they are
  keepMi: 0.15,        // corners this near a point of another road stay sharp
  clearMi: AT_1000(0.35), // curves of other roads keep this far from an interstate
  systemClearMi: AT_1000(1) // an interstate's curves keep this far from another interstate (its interchange's ramps)
});

// The polyline with each corner rounded (points as [x, y]). keep(x, y) holds for corners that
// must stay put.
export function roundCorners(points, radius, keep = () => false, options = {}, room = () => Infinity) {
  const p = { ...CURVE_DEFAULTS, ...options };
  if (points.length < 3) return points.map(q => [...q]);
  const out = [[...points[0]]];
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1], [x, y] = points[i], [nx, ny] = points[i + 1];
    const l0 = Math.hypot(x - px, y - py), l1 = Math.hypot(nx - x, ny - y);
    const ux = (x - px) / l0, uy = (y - py) / l0, vx = (nx - x) / l1, vy = (ny - y) / l1;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    if (turn < p.minDeg * Math.PI / 180 || keep(x, y) || !l0 || !l1) { out.push([x, y]); continue; }
    // The tangent length for the radius, shortened to fit the runs either side (each shared with
    // the next corner, hence the share).
    let tangent = radius * Math.tan(turn / 2);
    tangent = Math.min(tangent, p.maxShare * l0, p.maxShare * l1, room(x, y));
    if (tangent < 0.01) { out.push([x, y]); continue; }
    const r = tangent / Math.tan(turn / 2);
    const ax = x - ux * tangent, ay = y - uy * tangent;
    // The centre lies to the inside of the turn, r from the arc's start.
    const side = Math.sign(ux * vy - uy * vx), cx = ax - uy * side * r, cy = ay + ux * side * r;
    const a0 = Math.atan2(ay - cy, ax - cx);
    const steps = Math.max(1, Math.ceil(turn / (p.stepDeg * Math.PI / 180)));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + side * turn * k / steps;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  out.push([...points.at(-1)]);
  return out;
}

// Rounds the corners of every road, keeping those near a point (an end or a corner) of another
// road. Returns new road objects.
export function curveRoads(roads, options = {}) {
  const p = { ...CURVE_DEFAULTS, ...options };
  const cells = new Map(), key = (X, Y) => X * 8192 + Y;
  roads.forEach((road, i) => road.points.forEach(([x, y]) => {
    const k = key(Math.floor(x), Math.floor(y));
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push({ x, y, i });
  }));
  return roads.map((road, i) => {
    const radius = p.radiusMi[road.kind];
    if (!radius) return road;
    const keep = (x, y) => {
      for (let X = Math.floor(x - p.keepMi); X <= Math.floor(x + p.keepMi); X++) for (let Y = Math.floor(y - p.keepMi); Y <= Math.floor(y + p.keepMi); Y++) {
        if ((cells.get(key(X, Y)) ?? []).some(q => q.i !== i && Math.hypot(q.x - x, q.y - y) < p.keepMi)) return true;
      }
      return false;
    };
    // Room for the curve before it comes within clearMi of an interstate (systemClearMi of
    // another interstate, for an interstate's own curves).
    const room = (x, y) => {
      let best = Infinity;
      for (const o of roads) {
        if (o.kind !== 'interstate' || o === road) continue;
        for (let k = 1; k < o.points.length; k++) {
          const [ax, ay] = o.points[k - 1], [bx, by] = o.points[k], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
          const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
          best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
        }
      }
      return best - (road.kind === 'interstate' ? p.systemClearMi : p.clearMi);
    };
    return { ...road, points: roundCorners(road.points, radius, keep, p, room) };
  });
}
