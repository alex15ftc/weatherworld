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
  // Roads and rivers (clearOfRivers): a road within its half-width and the river's (and
  // riverPadMi) of a river it runs along or meets at a slant (the sine of the angle under
  // riverSkewSin, footprints.js skewSin) is moved: a river is crossed squarely, on a dog-leg
  // reaching legMi either side of it.
  roadHalfMi: { expressway: STUDS(39), highway: STUDS(18) }, riverPadMi: STUDS(8), riverSkewSin: 0.5, legMi: 0.5,
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

// Distance between two segments (0 where they cross).
function segGap(a, b, c, d) {
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = side(a, b, c), d2 = side(a, b, d), d3 = side(c, d, a), d4 = side(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(distToLine(a[0], a[1], c, d), distToLine(b[0], b[1], c, d), distToLine(c[0], c[1], a, b), distToLine(d[0], d[1], a, b));
}

// Takes the highways and expressways off the rivers they run along or cross at a slant (the
// routes are laid corner to corner of the mile grid, and a river's line between cell centres can
// fall right under a diagonal of one). Done once everything sited against the routes as laid is
// in place (the airfields: airfields.js), and before what is planned against the roads as built.
//   beside a river, not crossing it: the road's points there are moved clear of it, a little;
//   on a river, or across it at a slant: the stretch is laid again, from the point before it to
//   the point after, by a straight leg square across one of the river's reaches nearby (the one
//   that turns the road least), with the corners rounded as the route's others are.
// The roads are changed in place; returns what was done.
export function clearOfRivers(roads, rivers, options = {}) {
  const p = { ...CURVE_DEFAULTS, ...options }, done = { moved: 0, relaid: 0, left: 0 };
  const reaches = [], cells = new Map();
  rivers.forEach((river, r) => { for (let k = 2; k < river.points.length; k += 2) {
    const s = { a: [river.points[k - 2], river.points[k - 1]], b: [river.points[k], river.points[k + 1]], half: STUDS(Math.min(220, Math.max(12, river.widthsM[k / 2] * 0.18))) / 2, r };
    reaches.push(s);
    for (let X = Math.floor(Math.min(s.a[0], s.b[0])) - 1; X <= Math.floor(Math.max(s.a[0], s.b[0])) + 1; X++) for (let Y = Math.floor(Math.min(s.a[1], s.b[1])) - 1; Y <= Math.floor(Math.max(s.a[1], s.b[1])) + 1; Y++) { const key = X * 8192 + Y; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(s); }
  } });
  const near = (a, b) => { const found = new Set(); for (let X = Math.floor(Math.min(a[0], b[0])); X <= Math.floor(Math.max(a[0], b[0])); X++) for (let Y = Math.floor(Math.min(a[1], b[1])); Y <= Math.floor(Math.max(a[1], b[1])); Y++) for (const s of cells.get(X * 8192 + Y) ?? []) found.add(s); return found; };
  const sinOf = (a, b, s) => Math.abs((b[0] - a[0]) * (s.b[1] - s.a[1]) - (b[1] - a[1]) * (s.b[0] - s.a[0])) / ((Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1])) || 1);
  // The river reach a piece of road is in trouble with, and how far off it is (0: across it).
  const clash = (a, b, half) => { for (const s of near(a, b)) { const gap = segGap(a, b, s.a, s.b); if (gap < half + s.half + p.riverPadMi && sinOf(a, b, s) < p.riverSkewSin) return { s, gap }; } return null; };
  const length = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (const road of roads) {
    const half = p.roadHalfMi[road.kind];
    if (!half) continue;
    for (let pass = 0; pass < 6; pass++) {
      const pts = road.points;
      let i0 = -1;
      for (let i = 0; i + 1 < pts.length && i0 < 0; i++) if (clash(pts[i], pts[i + 1], half)) i0 = i;
      if (i0 < 0) break;
      let i1 = i0, across = clash(pts[i0], pts[i0 + 1], half).gap === 0;
      while (i1 + 2 < pts.length) { const c = clash(pts[i1 + 1], pts[i1 + 2], half); if (!c) break; i1++; across ||= c.gap === 0; }
      if (!across) {
        // Beside it: each point of the stretch too near the reach moves straight away from it.
        for (let i = i0; i <= i1; i++) {
          const c = clash(pts[i], pts[i + 1], half);
          if (!c) continue;
          for (const v of [pts[i], pts[i + 1]]) {
            const dx = c.s.b[0] - c.s.a[0], dy = c.s.b[1] - c.s.a[1], t = Math.max(0, Math.min(1, ((v[0] - c.s.a[0]) * dx + (v[1] - c.s.a[1]) * dy) / (dx * dx + dy * dy)));
            const qx = c.s.a[0] + dx * t, qy = c.s.a[1] + dy * t, far = Math.hypot(v[0] - qx, v[1] - qy), want = half + c.s.half + 2 * p.riverPadMi;
            if (far > 1e-9 && far < want) { v[0] += (v[0] - qx) / far * (want - far); v[1] += (v[1] - qy) / far * (want - far); }
          }
        }
        done.moved++;
        continue;
      }
      // Across it: from the point before the stretch (back past any short pieces, a curve's) to
      // the point after it.
      let ia = i0, ib = i1 + 1;
      while (ia > 0 && length(pts[ia - 1], pts[ia]) < 0.3) ia--;
      while (ib < pts.length - 1 && length(pts[ib], pts[ib + 1]) < 0.3) ib++;
      const A = pts[ia], B = pts[ib], river = clash(pts[i0], pts[i0 + 1], half).s.r, mid = [(pts[i0][0] + pts[i1 + 1][0]) / 2, (pts[i0][1] + pts[i1 + 1][1]) / 2];
      const turnAt = (a, q, c) => { const u = [q[0] - a[0], q[1] - a[1]], v = [c[0] - q[0], c[1] - q[1]]; return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1)))); };
      let best = null;
      for (const s of reaches) {
        if (s.r !== river || length(s.a, s.b) < 0.3) continue;
        const M = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
        if (length(M, mid) > 2.5) continue;
        const l = length(s.a, s.b);
        let nx = -(s.b[1] - s.a[1]) / l, ny = (s.b[0] - s.a[0]) / l;
        if (nx * (B[0] - A[0]) + ny * (B[1] - A[1]) < 0) { nx = -nx; ny = -ny; }
        const P1 = [M[0] - nx * p.legMi, M[1] - ny * p.legMi], P2 = [M[0] + nx * p.legMi, M[1] + ny * p.legMi], path = [A, P1, P2, B];
        if (length(A, P1) < p.legMi || length(P2, B) < p.legMi) continue;
        // One crossing of the river, and no leg in trouble with it.
        let crossings = 0, bad = false;
        for (let i = 1; i < path.length && !bad; i++) { bad = !!clash(path[i - 1], path[i], half); for (const o of near(path[i - 1], path[i])) if (o.r === river && segGap(path[i - 1], path[i], o.a, o.b) === 0) crossings++; }
        const turns = [turnAt(A, P1, P2), turnAt(P1, P2, B), ...(ib + 1 < pts.length ? [turnAt(P2, B, pts[ib + 1])] : []), ...(ia > 0 ? [turnAt(pts[ia - 1], A, P1)] : [])];
        if (bad || crossings !== 1 || turns.slice(0, 3).some(t => t > 100 * Math.PI / 180)) continue;
        // (A leg nearly along a mile line, but not on it, would run beside the road on that line.)
        const skew = (q, w) => { const t = Math.atan2(Math.abs(w[1] - q[1]), Math.abs(w[0] - q[0])), off = Math.min(t, Math.PI / 2 - t); return off > 0.03 && off < 0.44 ? 3 : 0; };
        const score = turns.reduce((sum, t) => sum + t, 0) + skew(A, P1) + skew(P2, B);
        if (!best || score < best.score) best = { score, P1, P2 };
      }
      if (!best) { done.left++; break; }
      // The corner before the stretch stays as it was where it was a corner (a junction's);
      // the rest are rounded.
      const kept = ia > 0 && ia + 1 < pts.length && turnAt(pts[ia - 1], A, pts[ia + 1]) > p.maxStepDeg[road.kind] * Math.PI / 180 + 1e-6;
      const line = [...(ia > 0 ? [pts[ia - 1]] : []), A, best.P1, best.P2, B, ...(ib + 1 < pts.length ? [pts[ib + 1]] : [])];
      const corners = [], rounded = roundCorners(line, p.radiusMi[road.kind], (x, y) => kept && x === A[0] && y === A[1], { ...p, maxStepDeg: p.maxStepDeg[road.kind], mustRadiusMi: 0 }, () => Infinity, corners);
      road.points = [...pts.slice(0, Math.max(0, ia - 1)), ...rounded, ...pts.slice(ib + 2)];
      // The corners recorded for the roads that came to them: those of the stretch laid again go.
      road.corners = [...(road.corners ?? []).filter(([, , mx, my]) => road.points.some((q, i) => i > 0 && distToLine(mx, my, road.points[i - 1], q) < 1e-6)), ...corners];
      done.relaid++;
    }
  }
  return done;
}
