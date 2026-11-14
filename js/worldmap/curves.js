// Curves for the routed highways. Routing lays roads along the mile lines with diagonal steps
// between them, so every bend is a corner. Each corner is rounded into a circular arc of the
// road's design radius (longer, wider curves for faster roads), drawn as chords, before
// anything else is planned against the roads (interchanges, overpasses, airfields, land use,
// lots), so everything downstream sees the curves. The chords are long enough to build as pieces
// of road (minChordMi), as long as no joint then turns more than the road's maxStepDeg; a corner
// already gentler than that is left as it is (a beltway's ring of short straights).
// A corner keeps its point where another road meets it (within keepMi of one of its points, or on
// its line where it runs straight through: a junction stays a junction, and a road joining nearby
// still finds the road where it was; but two routes turning the same corner on one road are both
// rounded, on one curve); where the straight runs either side are too short for the
// full radius, the curve is as wide as they allow. Near an interstate (where another road may
// cross it at an interchange or overpass, planned for straight roads) a curve keeps clearMi from
// it, shrinking or leaving the corner sharp.
// An interstate never turns at a point: every corner of one is curved, whatever is near, on at
// least mustRadiusMi where its runs allow; near where it meets another interstate the curve is
// kept as small as that, so the ramps there (which reach systemReachMi along it) stay on the
// straight or nearly so.
// Each rounded corner is recorded with its curve's middle point (corners: [x, y, middle x,
// middle y]): roads that came to the corner (the section roads) meet the road there instead.
// Scale (scale.js): the room kept for interchanges and overpasses and the chords' length are at
// character scale and keep their size in studs (AT_1000, STUDS); the radii (rounding the routes'
// corners, which come a mile or so apart; scaled, they made more overlaps where curves pass town
// arterials) and which roads come near a corner (keepMi) are the map's own.
import { AT_1000, STUDS } from './scale.js';

export const CURVE_DEFAULTS = Object.freeze({
  // (Highways on the expressways' radius: two routes sharing a road round a corner share its curve,
  // and at 40-stud chords a 45-degree turn then has four joints of about 11 degrees.)
  radiusMi: { interstate: 0.6, expressway: 0.35, highway: 0.35 },
  mustRadiusMi: { interstate: 0.34 }, // these always curve, on at least this radius where their runs allow
  maxShare: 0.45,      // a curve takes at most this share of each straight run beside the corner
  stepDeg: 6,          // the arc is drawn in chords turning at most this much, where they are long enough
  minChordMi: STUDS(40), // and no shorter than this
  // No joint turns more than this: where the radius gives shorter chords than minChordMi at that
  // turn, the curve is drawn on a wider radius, as far as its runs have room.
  maxStepDeg: { interstate: 12, expressway: 12, highway: 12 },
  minDeg: 2,           // corners turning less than this are left as they are
  keepMi: 0.15,        // corners this near a point of another road stay sharp
  onLineMi: 0.05,      // and those this near the line of one running through
  clearMi: AT_1000(0.35), // curves of other roads keep this far from an interstate
  systemReachMi: STUDS(500) // an interstate's own curves are small this near where it meets another (the ramps' reach along it)
});

// The polyline with each corner rounded (points as [x, y]). keep(x, y) holds for corners that
// must stay put; room(x, y) is the longest tangent the corner has room for; corners, if given,
// collects each rounded corner with its curve's middle point.
export function roundCorners(points, radius, keep = () => false, options = {}, room = () => Infinity, corners = null) {
  const p = { ...CURVE_DEFAULTS, ...options };
  const maxStep = (typeof p.maxStepDeg === 'number' ? p.maxStepDeg : 15) * Math.PI / 180, must = typeof p.mustRadiusMi === 'number' ? p.mustRadiusMi : 0;
  if (points.length < 3) return points.map(q => [...q]);
  const out = [[...points[0]]];
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1], [x, y] = points[i], [nx, ny] = points[i + 1];
    const l0 = Math.hypot(x - px, y - py), l1 = Math.hypot(nx - x, ny - y);
    const ux = (x - px) / l0, uy = (y - py) / l0, vx = (nx - x) / l1, vy = (ny - y) / l1;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    if (turn < p.minDeg * Math.PI / 180 || turn <= maxStep || !l0 || !l1 || keep(x, y, [ux, uy], [vx, vy])) { out.push([x, y]); continue; }
    // The tangent length for the radius, shortened to fit the runs either side (each shared with
    // the next corner, hence the share) and the room there is.
    const tanHalf = Math.tan(turn / 2);
    const wide = Math.max(radius, p.minChordMi * Math.ceil(turn / maxStep - 1e-9) / turn);
    const tangent = Math.min(wide * tanHalf, p.maxShare * l0, p.maxShare * l1, Math.max(room(x, y), must * tanHalf));
    if (tangent < 0.01) { out.push([x, y]); continue; }
    const r = tangent / tanHalf;
    const ax = x - ux * tangent, ay = y - uy * tangent;
    // The centre lies to the inside of the turn, r from the arc's start.
    const side = Math.sign(ux * vy - uy * vx), cx = ax - uy * side * r, cy = ay + ux * side * r;
    const a0 = Math.atan2(ay - cy, ax - cx);
    // Chords: as many as stepDeg asks, but none shorter than minChordMi, unless a joint would then
    // turn more than maxStepDeg (the joints at the two ends turn half as much as those between).
    let steps = Math.min(Math.ceil(turn / (p.stepDeg * Math.PI / 180)), Math.max(1, Math.round(r * turn / p.minChordMi)));
    if (turn / (steps === 1 ? 2 : steps) > maxStep + 1e-9) steps = Math.max(2, Math.ceil(turn / maxStep - 1e-9));
    // (The two ends exactly on the runs, so a run along a mile line stays on it to the last digit.)
    const arc = [[ax, ay]];
    for (let k = 1; k < steps; k++) {
      const a = a0 + side * turn * k / steps;
      arc.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    arc.push([x + vx * tangent, y + vy * tangent]);
    out.push(...arc);
    const h = steps >> 1;
    if (corners) corners.push(steps % 2 ? [x, y, (arc[h][0] + arc[h + 1][0]) / 2, (arc[h][1] + arc[h + 1][1]) / 2] : [x, y, arc[h][0], arc[h][1]]);
  }
  out.push([...points.at(-1)]);
  return out;
}

function distToLine(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + dx * t - x, ay + dy * t - y);
}

// Where two polylines cross, or one ends on the other (within slackMi).
function meetings(a, b, slackMi = 0.05) {
  const out = [];
  for (let i = 1; i < a.length; i++) for (let k = 1; k < b.length; k++) {
    const [ax, ay] = a[i - 1], [bx, by] = a[i], [cx, cy] = b[k - 1], [dx, dy] = b[k];
    const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
    const et = slackMi / (Math.hypot(rx, ry) || 1), eu = slackMi / (Math.hypot(sx, sy) || 1);
    if (t >= -et && t <= 1 + et && u >= -eu && u <= 1 + eu) out.push([ax + rx * t, ay + ry * t]);
  }
  return out;
}

// Rounds the corners of every road, keeping those where another road meets it. Returns new road
// objects, each with its rounded corners (corners).
export function curveRoads(roads, options = {}) {
  const p = { ...CURVE_DEFAULTS, ...options };
  const cells = new Map(), key = (X, Y) => X * 8192 + Y;
  roads.forEach((road, i) => road.points.forEach(([x, y], j) => {
    const k = key(Math.floor(x), Math.floor(y));
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push({ x, y, i, j });
  }));
  const boxes = roads.map(r => r.points.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])], [Infinity, Infinity, -Infinity, -Infinity]));
  return roads.map((road, i) => {
    const radius = p.radiusMi[road.kind];
    if (!radius) return road;
    const interstate = road.kind === 'interstate';
    // (u, v: the road's headings into and out of the corner.)
    const keep = (x, y, u, v) => {
      if (interstate) return false;
      // A road turning the same corner the same way (two routes on one road) is no junction:
      // both are rounded, on the same curve.
      const along = new Set();
      for (let X = Math.floor(x - p.keepMi); X <= Math.floor(x + p.keepMi); X++) for (let Y = Math.floor(y - p.keepMi); Y <= Math.floor(y + p.keepMi); Y++) {
        for (const q of cells.get(key(X, Y)) ?? []) {
          if (q.i === i || Math.hypot(q.x - x, q.y - y) >= p.keepMi) continue;
          const pts = roads[q.i].points, a = pts[q.j - 1], b = pts[q.j + 1];
          const heads = (from, to, w) => { const l = Math.hypot(to[0] - from[0], to[1] - from[1]); return l > 0 && ((to[0] - from[0]) * w[0] + (to[1] - from[1]) * w[1]) / l > 0.999; };
          const same = Math.hypot(q.x - x, q.y - y) < 1e-6 && a && b && roads[q.i].kind !== 'interstate'
            && ((heads(a, [x, y], u) && heads([x, y], b, v)) || (heads(b, [x, y], u) && heads([x, y], a, v)));
          if (!same) return true;
          along.add(q.i);
        }
      }
      // Another road running straight through the corner (interstates pass over or under).
      return roads.some((o, k) => k !== i && !along.has(k) && o.kind !== 'interstate' && x > boxes[k][0] - p.onLineMi && x < boxes[k][2] + p.onLineMi && y > boxes[k][1] - p.onLineMi && y < boxes[k][3] + p.onLineMi
        && o.points.some((q, j) => j > 0 && distToLine(x, y, o.points[j - 1], q) < p.onLineMi));
    };
    // Room for the curve: an interstate's, before the ramps where it meets another interstate;
    // another road's, before it comes within clearMi of an interstate.
    const systems = interstate ? roads.flatMap(o => (o.kind === 'interstate' && o !== road ? meetings(road.points, o.points) : [])) : [];
    const room = (x, y) => {
      if (interstate) return Math.min(Infinity, ...systems.map(([sx, sy]) => Math.hypot(sx - x, sy - y))) - p.systemReachMi;
      let best = Infinity;
      for (const o of roads) {
        if (o.kind !== 'interstate') continue;
        for (let k = 1; k < o.points.length; k++) best = Math.min(best, distToLine(x, y, o.points[k - 1], o.points[k]));
      }
      return best - p.clearMi;
    };
    const corners = [];
    const points = roundCorners(road.points, radius, keep, { ...p, maxStepDeg: p.maxStepDeg[road.kind], mustRadiusMi: p.mustRadiusMi[road.kind] ?? 0 }, room, corners);
    return { ...road, points, corners };
  });
}
