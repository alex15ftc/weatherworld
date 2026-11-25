// The footprint of each place: which ground it is built on, in cells of an eighth of a mile on
// the mile grid (0 not built, 1 newer and low density, 2 the original plat and early additions).
// A Plains town was laid out by a railroad or a county, in one of a few forms (Hudson 1982,
// Schmiedeler 2007), and then grew by additions of a few blocks on whichever edge was easiest:
//   - tTown: the commonest railroad form. The plat lies on one side of the line and the business
//     street runs away from it at a right angle; elevator and lumberyard stand across the line.
//   - symmetric: the line is the axis, with a lobe of town on each side (never equal).
//   - orthogonal: Main Street crosses the line; a bar along the line and a longer one across it.
//   - parallel: a long thin plat beside the line.
//   - courthouse: a county seat of the eastern belt: a compact square plat round the square, and
//     a later arm out to the line, which passed some way off.
//   - linear: a Main Street town strung along its road, with or without a cross street.
//   - river: a river landing: the old grid lies along the bank, turned to the river (its axis
//     still follows its road, as a line built later would).
//   - hamlet: an elevator and a few blocks on one side.
//   - regional: a city: the old plat with the yards at its edge, then additions in sectors and
//     fingers along the highways and out to the interstate exits.
// The map has no railways. Each place has instead a founding axis: a straight line along the
// highway corridor the place stands on (the direction of that highway over a few miles, on a
// side every place on that highway shares), and beside it a reserve: a strip one cell wide kept
// clear of streets, lots and land uses for its whole length through the place (where track
// would be laid), with the place's industrial land (elevator, co-op, lumberyard) in a band along
// its far edge. The flat edge of the town along the reserve is what shows.
// Growth is seeded by the place's own stream. The plat goes down first; then additions
// (rectangles of a few cells) are attached to the built edge one at a time, each chosen from a
// few candidates by weight, until the area the place's extent gives is built. The weights are
// continuous: nearer the middle (measured longer along the axis for the long forms), along the
// roads leaving town, towards interstate exits and bypass junctions (big places), on the town's
// side of the axis; less on a floodplain, on slopes, beside creeks. Ground that cannot be built
// (water, a river's bed, an interstate, an airfield, the reserve, another place's ground) is
// stepped over only where there is a way across: near a bridge of a road over the river, near a
// road across the interstate (a little anywhere: streets do pass under), by the form's share for
// the far side of the reserve.
import { makeRandom, hashText } from './noise.js';

export const SHAPE_DEFAULTS = Object.freeze({
  cellMi: 0.125,
  reachShare: 1.4,                // a footprint reaches at most this share of extentMi from the centre
  reserve: { widthMi: 0.125, industryMi: 0.125 },   // the strip kept clear, and the band of industrial land along its far edge
  mainRoadMi: 0.35, corridorMi: 3,   // a place stands on a road this near; failing that its axis follows the nearest road within corridorMi
  // aspect: the plat's length along the axis over its depth; plat: the plat's share of the core
  // area; far: the weight of ground beyond the axis; long: how much longer along the axis than
  // across the place grows; area: the built area as a share of the disc of extentMi.
  forms: {
    tTown: { aspect: [1.1, 1.7], plat: 0.6, far: 0.3, long: [1, 1.5], area: [0.85, 1.1] },
    symmetric: { aspect: [1, 1.4], plat: 0.65, far: 0.7, long: [1, 1.5], area: [0.85, 1.1] },
    orthogonal: { aspect: [1.3, 1.7], plat: 0.6, far: 0.65, long: [0.8, 1.25], area: [0.85, 1.1] },
    parallel: { aspect: [3, 4.5], plat: 0.7, far: 0.22, long: [2.2, 3.4], area: [0.75, 1] },
    courthouse: { aspect: [1, 1], plat: 0.7, far: 0.5, long: [0.85, 1.2], area: [0.85, 1.1] },
    linear: { aspect: [4, 7], plat: 0.6, far: 0.5, long: [2, 3.2], area: [0.75, 1] },
    river: { aspect: [1.5, 2.3], plat: 0.6, far: 0.4, long: [1.3, 2], area: [0.85, 1.1] },
    hamlet: { aspect: [1.4, 2.2], plat: 0.5, far: 0.06, long: [1.1, 1.7], area: [0.5, 0.7] },
    regional: { aspect: [1, 1.4], plat: 0.45, far: 0.8, long: [0.9, 1.3], area: [0.9, 1.1] }
  },
  // How broken a region's towns are (0 strict rectangles, 1 ragged).
  rough: { highPlains: 0.1, sandhills: 0.15, midwest: 0.45, smokyHills: 0.6, flintHills: 0.65, redHills: 0.75, ozarkEdge: 0.9 },
  courthouseRegions: ['midwest', 'ozarkEdge', 'flintHills'],
  riverTownMi: { town: 0.9, smallCity: 1.5 },
  riverMi: 0.1,                   // a river's bed, each side of its line
  interstateMi: 0.07,
  bridgeMi: 0.3, crossMi: 0.35, interstateLeak: 0.1,
  floodMi: 0.35, flood: 0.3,      // weight on the river itself, rising to 1 over floodMi
  slope: 0.03, creekMi: 0.08, creek: 0.55,
  centre: 2.2,                    // how fast weight falls with distance (over extentMi) from the middle
  fingerMi: 0.18, finger: { town: 2.5, smallCity: 4, city: 6, metro: 6 }, fingerReach: 0.5,
  exitMi: 0.6, exit: { town: 0.6, smallCity: 2, city: 2.5, metro: 2.5 }, exitPopulation: 2000,
  candidates: 8,
  hopCells: 5,
  airfieldPadMi: 0.15, townPadMi: 0.25
});

const distSeg = (x, y, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
};
const crossAt = (a, b) => {
  const rx = a[2] - a[0], ry = a[3] - a[1], sx = b[2] - b[0], sy = b[3] - b[1], den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b[0] - a[0]) * sy - (b[1] - a[1]) * sx) / den, u = ((b[0] - a[0]) * ry - (b[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + rx * t, a[1] + ry * t] : null;
};
// Line pieces of at most a mile, kept by the mile square of their middles.
function pieces() {
  const cells = new Map(), all = [];
  return {
    all,
    add(ax, ay, bx, by, tag) {
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let i = 0; i < k; i++) {
        const s = [ax + (bx - ax) * i / k, ay + (by - ay) * i / k, ax + (bx - ax) * (i + 1) / k, ay + (by - ay) * (i + 1) / k, tag];
        const key = Math.floor((s[0] + s[2]) / 2) * 4096 + Math.floor((s[1] + s[3]) / 2);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(s); all.push(s);
      }
    },
    near(x0, y0, x1, y1) {
      const out = [];
      for (let I = Math.floor(x0) - 1; I <= Math.floor(x1) + 1; I++) for (let J = Math.floor(y0) - 1; J <= Math.floor(y1) + 1; J++) { const list = cells.get(I * 4096 + J); if (list) for (const s of list) out.push(s); }
      return out;
    }
  };
}

// Whether a mile of a section line runs through town: at least five sixteenths of the ground
// along it, either side, built or reserve. (Streets, lots and land use all ask this the same way.)
export function townMile(map, I0, J0, I1, J1) {
  let hit = 0;
  for (let k = 0; k < 8; k++) for (const s of [-0.06, 0.06]) { const x = I0 + (I1 - I0) * (k + 0.5) / 8 + (J1 - J0) * s, y = J0 + (J1 - J0) * (k + 0.5) / 8 + (I1 - I0) * s; if (map.built(x, y) || map.reserved(x, y)) hit++; }
  return hit >= 5;
}

// Gives every settlement its shape, form, axis and reserve; returns { built(x, y), reserved(x, y) }.
export function planTownShapes(map, options = {}) {
  const p = { ...SHAPE_DEFAULTS, ...options }, c = p.cellMi, per = Math.round(1 / c);
  const { size: n, cellMiles, cover, coverKeys, coverRegion, regionKeys, elevation, rivers, creeks = [], settlements, roads, airfields = [] } = map;
  const miles = n * cellMiles, seed = map.params.seed, WATER = coverKeys.indexOf('water'), cellM = cellMiles * 1609.344;
  const G = Math.round(miles * per), fine = new Uint8Array(G * G), strip = new Uint8Array(G * G);
  const coarse = (x, y) => Math.min(n - 1, Math.max(0, Math.floor(y / cellMiles))) * n + Math.min(n - 1, Math.max(0, Math.floor(x / cellMiles)));
  const slopeAt = (x, y) => {
    const i = Math.min(n - 2, Math.max(1, Math.floor(x / cellMiles))), j = Math.min(n - 2, Math.max(1, Math.floor(y / cellMiles))), k = j * n + i;
    return Math.hypot(elevation[k + 1] - elevation[k - 1], elevation[k + n] - elevation[k - n]) / (2 * cellM);
  };
  const draw = (rng, [lo, hi]) => lo + (hi - lo) * rng();

  // The lines of the map, and where they cross: bridges (a road over a river), ways across an
  // interstate, and the junctions growth is drawn to (exits, and where a bypass leaves its highway).
  const roadSegs = pieces(), riverSegs = pieces(), creekSegs = pieces();
  roads.forEach((r, ri) => { for (let i = 1; i < r.points.length; i++) roadSegs.add(...r.points[i - 1], ...r.points[i], ri); });
  rivers.forEach((r, ri) => { for (let i = 2; i < r.points.length; i += 2) riverSegs.add(r.points[i - 2], r.points[i - 1], r.points[i], r.points[i + 1], ri); });
  for (const r of creeks) for (let i = 2; i < r.points.length; i += 2) creekSegs.add(r.points[i - 2], r.points[i - 1], r.points[i], r.points[i + 1], 0);
  const bridges = [], ways = [], exits = [];
  for (const s of roadSegs.all) {
    const kind = roads[s[4]].kind, box = [Math.min(s[0], s[2]), Math.min(s[1], s[3]), Math.max(s[0], s[2]), Math.max(s[1], s[3])];
    for (const r of riverSegs.near(...box)) { const q = crossAt(s, r); if (q) bridges.push(q); }
    if (kind === 'highway') continue;
    for (const o of roadSegs.near(...box)) {
      if (o[4] === s[4] || (kind === 'expressway' && roads[o[4]].kind !== 'highway')) continue;
      const q = crossAt(s, o);
      if (q) { if (kind === 'interstate') ways.push(q); exits.push(q); }
    }
  }
  const nearest = (list, x, y) => { let best = Infinity; for (const q of list) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < best) best = d; } return best; };

  // The road each place stands on (a highway before an expressway before an interstate; then the
  // one with the most places along it), and the places on each road.
  const onRoad = settlements.map(s => {
    const seen = new Map();
    let far = null;
    for (const sg of roadSegs.near(s.x - p.corridorMi, s.y - p.corridorMi, s.x + p.corridorMi, s.y + p.corridorMi)) {
      const d = distSeg(s.x, s.y, sg[0], sg[1], sg[2], sg[3]);
      if (d < p.mainRoadMi && d < (seen.get(sg[4]) ?? Infinity)) seen.set(sg[4], d);
      if (d < p.corridorMi && roads[sg[4]].kind !== 'interstate' && (!far || d < far[1])) far = [sg[4], d];
    }
    if (!seen.size && far) seen.set(far[0], far[1]);
    return seen;
  });
  const placesOn = new Map();
  for (const seen of onRoad) for (const ri of seen.keys()) placesOn.set(ri, (placesOn.get(ri) ?? 0) + 1);
  const RANK = { highway: 2, expressway: 1, interstate: 0 };
  // The direction of a road past a point: the chord between the points reach miles along it each way.
  const corridor = (road, x, y, reach) => {
    const pts = road.points;
    let best = Infinity, at = 0, f = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
      if (d < best) { best = d; at = i; f = t; }
    }
    const from = [pts[at - 1][0] + (pts[at][0] - pts[at - 1][0]) * f, pts[at - 1][1] + (pts[at][1] - pts[at - 1][1]) * f];
    const walk = dir => {
      let left = reach, q = from, i = dir > 0 ? at : at - 1;
      for (; i >= 0 && i < pts.length; i += dir) {
        const l = Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]);
        if (l >= left) return [q[0] + (pts[i][0] - q[0]) * left / l, q[1] + (pts[i][1] - q[1]) * left / l];
        left -= l; q = pts[i];
      }
      return q;
    };
    const a = walk(-1), b = walk(1), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return l > 1e-6 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [1, 0];
  };

  // The river beside a place: how far, which way it lies and which way it runs there.
  const riverBy = (s, reach) => {
    let best = null;
    for (const sg of riverSegs.near(s.x - reach, s.y - reach, s.x + reach, s.y + reach)) { const d = distSeg(s.x, s.y, sg[0], sg[1], sg[2], sg[3]); if (d <= reach && (!best || d < best.d)) best = { d, sg }; }
    if (!best) return null;
    const mx = (best.sg[0] + best.sg[2]) / 2, my = (best.sg[1] + best.sg[3]) / 2;
    let sxx = 0, sxy = 0, syy = 0;
    for (const sg of riverSegs.near(mx - 1.5, my - 1.5, mx + 1.5, my + 1.5)) {
      if (sg[4] !== best.sg[4]) continue;
      for (const [x, y] of [[sg[0], sg[1]], [sg[2], sg[3]]]) { if (Math.hypot(x - mx, y - my) > 1.6) continue; sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
    }
    const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { d: best.d, x: mx, y: my, ux: Math.cos(a), uy: Math.sin(a) };
  };

  const regionOf = s => regionKeys[coverRegion[coarse(s.x, s.y)]];
  const formOf = (s, river) => {
    if (s.kind === 'metro' || s.kind === 'city') return 'regional';
    const region = regionOf(s), east = p.courthouseRegions.includes(region) && (region !== 'flintHills' || s.x > miles / 2);
    const byRiver = river ? 1 - 0.6 * river.d / p.riverTownMi[s.kind] : 0, pop = s.population;
    const w = s.kind === 'smallCity'
      ? { regional: 0.5, river: 0.9 * byRiver, courthouse: east ? 0.5 : 0, tTown: 0.15, orthogonal: 0.15 }
      : {
        tTown: 0.44, symmetric: 0.12, orthogonal: 0.14, parallel: 0.09, linear: 0.15, river: 1.1 * byRiver,
        courthouse: east ? 0.55 * Math.max(0, Math.min(1, (pop - 600) / 600)) : 0, hamlet: 3 * Math.max(0, Math.min(1, (300 - pop) / 150))
      };
    let at = hashText(`${seed}|form|${s.name}`) / 4294967296 * Object.values(w).reduce((a, b) => a + b, 0);
    for (const [key, v] of Object.entries(w)) { at -= v; if (at < 0) return key; }
    return 'tTown';
  };

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const grow = (s, si, salt) => {
    const rng = makeRandom(hashText(`${seed}|shape|${s.name}|${salt}`));
    const river = s.kind === 'town' || s.kind === 'smallCity' ? riverBy(s, p.riverTownMi[s.kind]) : null;
    const form = formOf(s, river), F = p.forms[form], region = regionOf(s);
    const rough = Math.min(1, (p.rough[region] ?? 0.5) + Math.min(0.2, 6 * slopeAt(s.x, s.y)));
    const R = s.extentMi, reach = p.reachShare * R, pad = reach + 0.5;
    const X0 = Math.max(0, Math.floor((s.x - pad) * per)), Y0 = Math.max(0, Math.floor((s.y - pad) * per)), X1 = Math.min(G, Math.ceil((s.x + pad) * per)), Y1 = Math.min(G, Math.ceil((s.y + pad) * per));
    const W = X1 - X0, H = Y1 - Y0, bx0 = X0 * c, by0 = Y0 * c, box = [bx0, by0, X1 * c, Y1 * c];

    // The axis: along the main road's corridor (a river town: along its bank), on the road's own side.
    let ux, uy, side, main = null;
    for (const [ri, d] of onRoad[si]) { const score = RANK[roads[ri].kind] * 1000 + (placesOn.get(ri) ?? 0) - d; if (!main || score > main.score) main = { ri, score }; }
    if (main) { [ux, uy] = corridor(roads[main.ri], s.x, s.y, Math.max(1.5, R + 1)); side = hashText(`${seed}|axis-side|${roads[main.ri].name}`) & 1 ? 1 : -1; }
    else { [ux, uy] = hashText(`${seed}|axis|${s.name}`) & 1 ? [1, 0] : [0, 1]; side = hashText(`${seed}|axis-side|${s.name}`) & 1 ? 1 : -1; }
    // (A river town on no road: along its bank, the reserve on the river's side.)
    const bank = form === 'river' ? ((river.x - s.x) * -river.uy + (river.y - s.y) * river.ux >= 0 ? 1 : -1) : 0;
    if (form === 'river' && !main) { ux = river.ux; uy = river.uy; side = bank; }
    // (An axis within a few degrees of the grid runs with it.)
    if (Math.abs(ux) > 0.999) { ux = Math.sign(ux); uy = 0; } else if (Math.abs(uy) > 0.999) { uy = Math.sign(uy); ux = 0; }
    // (nx, ny): across the axis, towards the reserve and away from the town's side.
    const nx = -uy * side, ny = ux * side;
    // The plat's own frame: the axis's, or (strict regions, courthouse squares) the compass's.
    const cardinal = form !== 'river' && (rough < 0.3 || form === 'courthouse');
    // A river town's plat lies along the bank, turned to the river, whatever way its axis runs.
    const [pux, puy] = form === 'river' ? [river.ux, river.uy] : cardinal ? (Math.abs(ux) >= Math.abs(uy) ? [Math.sign(ux) || 1, 0] : [0, Math.sign(uy) || 1]) : [ux, uy];
    const turn = form === 'river' ? bank : -puy * nx + pux * ny >= 0 ? 1 : -1, pnx = turn * -puy, pny = turn * pux;

    // The plat, by form (miles: L along the axis, D deep from it, the centre off miles in).
    const coreMi2 = Math.PI * s.coreMi ** 2, areaShare = draw(rng, F.area), Ap = Math.max(4 * c * c, F.plat * coreMi2 * areaShare), ar = draw(rng, F.aspect);
    const wide = p.reserve.widthMi, two = 2 * c, shift = (rng() - 0.5) * 0.3;
    let L = Math.max(two, Math.sqrt(Ap * ar)), D = Math.max(two, Ap / L), off, inPlat, arm = null;
    if (form === 'symmetric') {
      const D1 = D * draw(rng, [0.58, 0.72]), D2 = D - D1; off = Math.max(c / 2, D1 * draw(rng, [0.3, 0.5]));
      inPlat = (t, v) => Math.abs(t - shift * L) <= L / 2 && v >= -(wide + D2) && v <= D1;
    } else if (form === 'orthogonal') {
      const Wb = Math.max(two, Ap * 0.5 / L), cross = Math.max(two, Math.sqrt(Ap) * draw(rng, [1.2, 1.6])), Wm = Math.max(two, Ap * 0.5 / cross), D1 = cross * draw(rng, [0.55, 0.75]);
      off = Wb * draw(rng, [0.35, 0.65]);
      inPlat = (t, v) => (Math.abs(t) <= L / 2 && v >= 0 && v <= Wb) || (Math.abs(t - shift * L / 2) <= Wm / 2 && v >= -(wide + cross - D1) && v <= D1);
    } else if (form === 'courthouse') {
      const sq = Math.max(3 * c, Math.sqrt(Ap)), jx = (rng() - 0.5) * c * 2, jy = (rng() - 0.5) * c * 2; off = sq / 2 + draw(rng, [0.2, 0.5]) * Math.max(1, R);
      inPlat = (t, v, dx, dy) => Math.abs(dx - jx) <= sq / 2 && Math.abs(dy - jy) <= sq / 2;
      arm = [s.x + nx * off, s.y + ny * off];
    } else if (form === 'linear') {
      const Wl = Math.max(two, Math.min(3 * c, Ap / (1.3 * R * 2))), crossed = rng() < 0.5, L2 = crossed ? draw(rng, [0.45, 0.7]) : 0;
      L = Math.min(2.4 * R, Ap / Wl / (1 + L2)); off = Wl / 2 + draw(rng, [0.15, 0.4]);
      inPlat = (t, v) => (Math.abs(t - shift * L) <= L / 2 && Math.abs(v - off) <= Wl / 2) || (crossed && Math.abs(t - shift * L * 0.6) <= Wl / 2 && Math.abs(v - off) <= L * L2 / 2);
    } else {
      off = form === 'river' && !main ? Math.max(0.07, river.d - p.riverMi - wide - 0.05) : D * (form === 'regional' ? draw(rng, [0.4, 0.6]) : form === 'parallel' ? 0.5 : draw(rng, [0.25, 0.45]));
      if (form === 'river') D = Math.max(D, river.d - p.riverMi + c);
      inPlat = (t, v) => Math.abs(t - shift * L) <= L / 2 && v >= 0 && v <= D;
    }
    // The axis line, on a cell line where it runs with the grid (the reserve is then whole cells).
    off = Math.max(off, 1.5 * c);
    let ax = s.x + nx * off, ay = s.y + ny * off;
    // (the next one out from the middle)
    const out = (v, d) => (d > 0 ? Math.ceil(v * per - 1e-6) : Math.floor(v * per + 1e-6)) / per;
    if (uy === 0) ay = out(ay, ny); else if (ux === 0) ax = out(ax, nx);
    if ((s.x - ax) * nx + (s.y - ay) * ny > -0.02) { ax += nx * c; ay += ny * c; }
    const hd = c / 2 * (Math.abs(nx) + Math.abs(ny)) - 1e-6;
    // Where the plat's depth is measured from: the axis, or a river town's bank.
    const rx = form === 'river' ? s.x + pnx * (river.d - p.riverMi - 0.02) : ax, ry = form === 'river' ? s.y + pny * (river.d - p.riverMi - 0.02) : ay;

    // What stands in each cell, and its weights.
    const stop = new Uint8Array(W * H), jump = new Float32Array(W * H), pull = new Float32Array(W * H), early = new Float32Array(W * H), val = new Uint8Array(W * H);
    const field = () => new Float32Array(W * H).fill(Infinity);
    const stamp = (f, ax0, ay0, bx1, by1, r) => {
      const i0 = Math.max(0, Math.floor((Math.min(ax0, bx1) - r - bx0) * per)), i1 = Math.min(W - 1, Math.floor((Math.max(ax0, bx1) + r - bx0) * per));
      const j0 = Math.max(0, Math.floor((Math.min(ay0, by1) - r - by0) * per)), j1 = Math.min(H - 1, Math.floor((Math.max(ay0, by1) + r - by0) * per));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = distSeg(bx0 + (i + 0.5) * c, by0 + (j + 0.5) * c, ax0, ay0, bx1, by1); if (d < f[j * W + i]) f[j * W + i] = d; }
    };
    const dRiver = field(), dCreek = field(), dRoad = field(), dInter = field(), dExit = field(), dArm = field();
    for (const sg of riverSegs.near(...box)) stamp(dRiver, sg[0], sg[1], sg[2], sg[3], 1.2);
    for (const sg of creekSegs.near(...box)) stamp(dCreek, sg[0], sg[1], sg[2], sg[3], 0.25);
    for (const sg of roadSegs.near(...box)) stamp(roads[sg[4]].kind === 'interstate' ? dInter : dRoad, sg[0], sg[1], sg[2], sg[3], roads[sg[4]].kind === 'interstate' ? 0.2 : 0.8);
    const inBox = q => q[0] > box[0] - 2 && q[0] < box[2] + 2 && q[1] > box[1] - 2 && q[1] < box[3] + 2;
    const myBridges = bridges.filter(inBox), myWays = ways.filter(inBox), exitGain = s.population >= p.exitPopulation ? p.exit[s.kind] : 0;
    if (exitGain) for (const q of exits) if (inBox(q)) stamp(dExit, q[0], q[1], q[0], q[1], 2.5);
    if (arm) stamp(dArm, s.x, s.y, arm[0], arm[1], 0.6);
    const fences = airfields.filter(a => a.fence).map(a => {
      const f = a.fence, turn = Math.sign((f[1][0] - f[0][0]) * (f[2][1] - f[1][1]) - (f[1][1] - f[0][1]) * (f[2][0] - f[1][0])) || 1;
      return f.map(([x, y], i) => { const [x1, y1] = f[(i + 1) % f.length], l = Math.hypot(x1 - x, y1 - y); return [x, y, -(y1 - y) / l * turn, (x1 - x) / l * turn]; });
    }).filter(f => f.some(([x, y]) => x > box[0] - 3 && x < box[2] + 3 && y > box[1] - 3 && y < box[3] + 3));
    const others = settlements.filter(o => o !== s && Math.hypot(o.x - s.x, o.y - s.y) < pad + o.extentMi + 1);
    const el = Math.sqrt(draw(rng, F.long)), fingerGain = p.finger[s.kind], coreR = Math.max(s.coreMi * 1.2, 0.3);
    const ci = Math.floor(s.x * per) - X0, cj = Math.floor(s.y * per) - Y0, centre = cj * W + ci;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, x = bx0 + (i + 0.5) * c, y = by0 + (j + 0.5) * c, dx = x - s.x, dy = y - s.y, r = Math.hypot(dx, dy);
      if (r > reach) { stop[k] = 7; continue; }
      const q = (x - ax) * nx + (y - ay) * ny;
      if (k === centre) { /* the centre is always built */ }
      else if (cover[coarse(x, y)] === WATER) stop[k] = 1;
      else if (fences.some(f => f.every(([fx, fy, ex, ey]) => (x - fx) * ex + (y - fy) * ey > -p.airfieldPadMi))) stop[k] = 4;
      else if (dRiver[k] < p.riverMi) { stop[k] = 2; jump[k] = Math.exp(-Math.max(0, nearest(myBridges, x, y) - p.bridgeMi / 2) / (p.bridgeMi / 2)); }
      else if (dInter[k] < p.interstateMi) { stop[k] = 3; jump[k] = p.interstateLeak + (1 - p.interstateLeak) * Math.exp(-nearest(myWays, x, y) / p.crossMi); }
      else if (others.some(o => Math.hypot(x - o.x, y - o.y) < o.extentMi + p.townPadMi)) stop[k] = 7;
      else if (q > -hd && q < wide + hd) { stop[k] = 5; jump[k] = F.far; }
      if (stop[k]) continue;
      const t = dx * ux + dy * uy, v = -dx * nx - dy * ny, finger = Math.exp(-dRoad[k] / p.fingerMi), dn = Math.hypot(t / el, v * el) / R;
      const sideW = q >= 0 ? F.far * Math.exp(-q / (1.2 * R)) : 1;
      const flood = form === 'river' ? 1 + 0.8 * Math.exp(-dRiver[k] / 0.4) : p.flood + (1 - p.flood) * (1 - Math.exp(-dRiver[k] / p.floodMi));
      const ground = sideW * flood / (1 + (slopeAt(x, y) / p.slope) ** 2) * (1 - p.creek * Math.exp(-((dCreek[k] / p.creekMi) ** 2)));
      early[k] = ground * Math.exp(-p.centre * (dn * R / coreR) ** 2) + 1e-9;
      pull[k] = ground * Math.exp(-p.centre * (dn * (1 - p.fingerReach * finger)) ** 2) * (1 + fingerGain * finger) * (1 + exitGain * Math.exp(-dExit[k] / p.exitMi)) * (1 + (arm ? 1.5 * Math.exp(-dArm[k] / 0.15) : 0)) + 1e-9;
    }

    // Ground left open inside the town (low spots, a block nobody bought): more where towns are broken.
    const N = Math.round(areaShare * Math.PI * R * R * per * per), N2 = Math.round(areaShare * coreMi2 * per * per);
    const most = Math.max(2, Math.min(8, Math.round(0.8 + 1.5 * Math.sqrt(R)) + (rough < 0.3 ? 1 : 0)));
    for (let h = Math.round(N * (0.01 + 0.05 * rough) / 2); h > 0; h--) {
      const r = R * Math.sqrt(rng()), a = 2 * Math.PI * rng(), i = Math.floor((s.x + r * Math.cos(a) - bx0) * per), j = Math.floor((s.y + r * Math.sin(a) - by0) * per), sz = 1 + Math.floor(rng() * rng() * most / 2);
      for (let b = j; b < j + sz; b++) for (let a2 = i; a2 < i + sz; a2++) if (a2 >= 0 && b >= 0 && a2 < W && b < H && !stop[b * W + a2] && Math.abs(a2 - ci) + Math.abs(b - cj) > 1) { stop[b * W + a2] = 6; jump[b * W + a2] = 1; }
    }

    // The plat: from the middle out, a few blocks left empty.
    let count = 0;
    const edge = [];
    const build = k => { val[k] = count < N2 ? 2 : 1; count++; edge.push(k); };
    const platCells = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, x = bx0 + (i + 0.5) * c, y = by0 + (j + 0.5) * c;
      if (k !== centre && (stop[k] === 6 ? stop[k] = 0 : stop[k])) continue;
      if (k === centre || inPlat((x - s.x) * pux + (y - s.y) * puy, -((x - rx) * pnx + (y - ry) * pny), x - s.x, y - s.y)) platCells.push([Math.hypot(x - s.x, y - s.y), k]);
    }
    platCells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [d, k] of platCells) if (count < N && (d < 1.5 * c || rng() >= 0.04 + 0.12 * rough)) build(k);

    // Additions.
    const gamma = 2.4 - 1.2 * rough, strict = rough < 0.3, least = Math.max(1, Math.round(most / 3));
    const shut = k => DIRS.every(([ex, ey]) => { const i = k % W + ex, j = ((k / W) | 0) + ey, g = j * W + i; return i < 0 || j < 0 || i >= W || j >= H || val[g] || (stop[g] && jump[g] <= 0.01); });
    for (let fails = 0; count < N && edge.length && fails < 300;) {
      const w8 = count < N2 ? early : pull, cands = [];
      let total = 0;
      for (let tries = 0; tries < 6 * p.candidates && cands.length < p.candidates && edge.length; tries++) {
        const at = (rng() * edge.length) | 0, f = edge[at], [ex, ey] = DIRS[(rng() * 4) | 0];
        let gi = f % W + ex, gj = ((f / W) | 0) + ey, jmp = 1, hops = 0;
        while (gi >= 0 && gj >= 0 && gi < W && gj < H && stop[gj * W + gi] && hops < p.hopCells) { jmp = Math.min(jmp, jump[gj * W + gi]); gi += ex; gj += ey; hops++; }
        if (gi < 0 || gj < 0 || gi >= W || gj >= H || val[gj * W + gi] || stop[gj * W + gi] || jmp <= 0.01) { if (shut(f)) { edge[at] = edge[edge.length - 1]; edge.pop(); } continue; }
        const a = least + Math.floor(rng() ** 1.3 * (most - least + 1));
        let b = least + Math.floor(rng() ** 1.3 * (most - least + 1)), lat = (ex ? gj : gi) - Math.floor(rng() * b);
        if (strict) { b += b & 1; lat = ((ex ? gj + Y0 : gi + X0) & ~1) - (ex ? Y0 : X0) - 2 * Math.floor(rng() * b / 2); }
        const i0 = ex > 0 ? gi : ex < 0 ? gi - a + 1 : lat, i1 = ex ? i0 + a - 1 : lat + b - 1, j0 = ey > 0 ? gj : ey < 0 ? gj - a + 1 : lat, j1 = ey ? j0 + a - 1 : lat + b - 1;
        const mi = Math.max(0, Math.min(W - 1, (i0 + i1) >> 1)), mj = Math.max(0, Math.min(H - 1, (j0 + j1) >> 1));
        const weight = (jmp * (w8[gj * W + gi] + w8[mj * W + mi]) / 2) ** gamma;
        cands.push([weight, i0, j0, i1, j1]); total += weight;
      }
      if (!cands.length || !(total > 0)) { fails++; continue; }
      let at = rng() * total, pick = cands[cands.length - 1];
      for (const cd of cands) { at -= cd[0]; if (at < 0) { pick = cd; break; } }
      let made = 0;
      for (let j = Math.max(0, pick[2]); j <= Math.min(H - 1, pick[4]) && count < N; j++) for (let i = Math.max(0, pick[1]); i <= Math.min(W - 1, pick[3]) && count < N; i++) { const k = j * W + i; if (!val[k] && !stop[k]) { build(k); made++; } }
      fails = made ? 0 : fails + 1;
    }
    // The edge is tidied: a cell standing out alone on three sides goes back to open ground, and
    // an open cell with town on three sides or more is taken in (left-open ground apart).
    for (let pass = 0; pass < 2; pass++) for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const k = j * W + i, around = (val[k - 1] ? 1 : 0) + (val[k + 1] ? 1 : 0) + (val[k - W] ? 1 : 0) + (val[k + W] ? 1 : 0);
      if (val[k] && around <= 1 && k !== centre) val[k] = 0;
      else if (!val[k] && !stop[k] && around >= 3) val[k] = Math.min(val[k - 1] || 2, val[k + 1] || 2, val[k - W] || 2, val[k + W] || 2);
    }
    val[centre] = 2;

    // Whether track along the reserve could leave town each way (and what stops it).
    const blocked = [];
    let tMin = 0, tMax = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (val[j * W + i]) { const t = (bx0 + (i + 0.5) * c - ax) * ux + (by0 + (j + 0.5) * c - ay) * uy; tMin = Math.min(tMin, t); tMax = Math.max(tMax, t); }
    for (const dir of [1, -1]) {
      let why = null;
      for (let t = 0; t <= reach + 0.4 && !why; t += c / 2) {
        const x = ax + nx * wide / 2 + ux * t * dir, y = ay + ny * wide / 2 + uy * t * dir, i = Math.floor((x - bx0) * per), j = Math.floor((y - by0) * per);
        if (i < 0 || j < 0 || i >= W || j >= H) break;
        const k = j * W + i, was = stop[k];
        if (val[k] || fine[(j + Y0) * G + i + X0]) why = 'footprint';
        else if (was === 1) why = 'water'; else if (was === 4) why = 'airfield';
        else if (was === 2 && nearest(myBridges, x, y) > 0.5) why = 'river';
        else if (was === 3 && nearest(myWays, x, y) > 0.5) why = 'interstate';
      }
      if (why) blocked.push(`${dir > 0 ? 'ahead' : 'back'}: ${why}`);
    }
    return { form, val, stop, X0, Y0, W, H, tMin, tMax, axis: { x: Math.round(ax * 1e4) / 1e4, y: Math.round(ay * 1e4) / 1e4, ux, uy }, reserve: { side, nx, ny, widthMi: wide, industryMi: p.reserve.industryMi, road: main ? roads[main.ri].name : null, blocked }, ax, ay, hd };
  };

  // The largest first (a small place does not build on a larger one's ground twice over). No
  // two places come out the same: a footprint already seen is grown again from the next stream.
  const seen = new Set(), order = settlements.map((s, si) => si).sort((a, b) => settlements[b].population - settlements[a].population || (settlements[a].name < settlements[b].name ? -1 : 1));
  for (const si of order) {
    const s = settlements[si];
    let g, key;
    for (let salt = 0; salt < 8; salt++) {
      g = grow(s, si, salt);
      let i0 = g.W, j0 = g.H, i1 = -1, j1 = -1;
      for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) if (g.val[j * g.W + i]) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
      const w = i1 - i0 + 1, h = j1 - j0 + 1, cells = new Uint8Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) cells[j * w + i] = g.val[(j + j0) * g.W + i + i0];
      g.shape = { cellMi: c, x0: (g.X0 + i0) * c, y0: (g.Y0 + j0) * c, w, h, cells };
      key = `${Math.floor(s.x * per) - g.X0 - i0},${Math.floor(s.y * per) - g.Y0 - j0},${w},${hashText(cells.join(''))},${cells.length}`;
      if (!seen.has(key)) break;
    }
    seen.add(key);
    s.shape = g.shape; s.form = g.form; s.axis = g.axis; s.reserve = g.reserve;
    for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) {
      const k = j * g.W + i, K = (j + g.Y0) * G + i + g.X0;
      if (g.val[k] > fine[K]) fine[K] = g.val[k];
      if (g.stop[k] !== 5) continue;
      const t = (g.X0 * c + (i + 0.5) * c - g.ax) * g.axis.ux + (g.Y0 * c + (j + 0.5) * c - g.ay) * g.axis.uy;
      if (t >= g.tMin - 2 * c && t <= g.tMax + 2 * c) strip[K] = 1;
    }
  }
  for (let K = 0; K < fine.length; K++) if (strip[K]) fine[K] = 0;
  for (const s of settlements) { const sh = s.shape, X = Math.round(sh.x0 * per), Y = Math.round(sh.y0 * per); for (let j = 0; j < sh.h; j++) for (let i = 0; i < sh.w; i++) if (strip[(j + Y) * G + i + X]) sh.cells[j * sh.w + i] = 0; }
  const at = (x, y) => (x < 0 || y < 0 || x >= miles || y >= miles ? -1 : Math.floor(y * per) * G + Math.floor(x * per));
  return { built: (x, y) => { const K = at(x, y); return K < 0 ? 0 : fine[K]; }, reserved: (x, y) => { const K = at(x, y); return K < 0 ? 0 : strip[K]; } };
}
