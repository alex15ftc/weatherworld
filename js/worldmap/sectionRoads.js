// The section-line road grid: county roads on the mile lines north-south and east-west, as the
// land survey laid them out across the Plains. Every mile line is a candidate; whether a road
// runs along a given mile of it, and what kind, comes from the land under it:
//   paved   a concrete county road, one lane each way, on some of the through lines (picked
//           at uneven spacings) and only along parts of them: long paved runs in busy farm
//           districts and near towns, gravel where the paving gives out; it keeps going over
//           rougher ground and bridges big rivers;
//   gravel  many mile lines in flat, farmed country, most of all near towns;
//   dirt    the field and ranch roads further out, and the few through rough or sandy ground.
// How many mile lines carry a road changes across the map: busy farm districts around towns
// and in patches of good land have most of them, emptier country only every second mile line
// or less, with long stretches missing. Lakes stop them all; only paved roads bridge large
// rivers.
//
// No road is left cut off: a piece of the grid that cannot be reached from the highways (a lone
// mile, a few miles of field road meeting nothing, a town's streets off every highway) is joined
// to the rest by the shortest run of missing miles, or, where it is small and nothing is near,
// left out (connectSectionRoads). Dead ends stay; islands do not.
//
// In towns, cities and suburbs every mile line is a paved arterial. The streets between them are
// not on this map: Roblox lays them per chunk inside each settlement's extent, at the
// settlement's streetBlockMi (a dense grid in town and city cores, curving residential streets
// with collectors every half mile in the suburbs), along with the bends roads make where a hill
// or a creek is in the way.
//
// Stored on the corners of the 1-mile grid ((miles + 1) squared bytes, west to east then north
// to south): bits 0-1 the road east from the corner, bits 2-3 the road south, each one of
// SECTION_CLASSES.
import { makeNoise, makeRandom, hashText, fbm, clamp } from './noise.js';
import { AT_1000, STUDS } from './scale.js';

// A river's half-width as built in Roblox (0.18 studs a metre of its width, 12 to 220 studs), in
// map miles (scale.js).
const riverHalfMi = widthM => STUDS(Math.min(220, Math.max(12, widthM * 0.18))) / 2;

export const SECTION_CLASSES = Object.freeze(['none', 'dirt', 'gravel', 'paved']);

export const SECTION_DEFAULTS = Object.freeze({
  // Share of the mile lines with a road, on flat ground, by region.
  density: { highPlains: 0.5, smokyHills: 0.42, sandhills: 0.1, redHills: 0.3, flintHills: 0.3, midwest: 0.62, ozarkEdge: 0.22 },
  // Busier and emptier districts: density times a patchy field of about farmMi across (from
  // farmLow to farmHigh), raised by up to townBoost near towns (falling off over townReachMi).
  farmMi: 35, farmLow: 0.15, farmHigh: 1.4, townBoost: 1, townReachMi: 7,
  // Every second mile line is the more travelled one (the half-section lines get fewer roads).
  evenLine: 1.3, oddLine: 0.6,
  gravelBusy: 0.45,      // where density is below this share, roads are dirt rather than gravel
  // The land under a mile line counts too: fewer roads through range, woods and breaks than through
  // cropland, so the districts' edges follow the fields and the pasture, not a line on the map.
  coverShare: { grassland: 0.55, forest: 0.45, riparian: 0.7, breaks: 0.4 },
  // A through line carries a road all its way only in well-roaded country: elsewhere it comes
  // and goes, in stretches of about throughRunMi, over throughBase + throughGain x density of it.
  throughBase: 0.2, throughGain: 1.6, throughRunMi: 18,
  // Through county roads: mile lines picked at random gaps of pavedGapMi miles (each way). Along
  // one, a mile is paved where a noise of about pavedRunMi along the line falls below
  // pavedShare for the region, raised in busy districts and near towns; the rest of the line is
  // gravel (dirt in rough country).
  pavedGapMi: [3, 11], pavedRunMi: 30,
  pavedShare: { highPlains: 0.55, smokyHills: 0.45, sandhills: 0.15, redHills: 0.3, flintHills: 0.3, midwest: 0.7, ozarkEdge: 0.3 },
  roughSlope: 0.03,      // m/m: the share of mile lines with a road falls off with slope at this scale
  gravelSlope: 0.025,    // m/m: steeper than this, a road is dirt (unless it is paved)
  pavedMaxSlope: 0.08,   // m/m: steeper than this not even a paved road keeps to the mile line
  bridgeMi2: 1500,       // only paved roads cross rivers draining more than this (mi2)
  gapMi: 5,              // size of the stretches of mile line left without a road
  // Cut-off pieces: one of up to linkSmallMi miles is joined by at most one missing mile, a
  // larger one by up to half its own length (at least linkMi, at most linkFarMi; a paved one, a
  // town's, by up to linkPavedMi); pieces of up to dropMi miles that nothing reaches are left
  // out (paved ones only where an interstate, an airfield or an interchange's ramps cut them off).
  // (A pocket the interstates shut in with no bridge goes up to cutOffDropMi.)
  linkSmallMi: 2, linkMi: 3, linkFarMi: 14, linkPavedMi: 14, dropMi: 8, cutOffDropMi: 16,
  // How near a corner a road must pass to be met there: a two-lane highway (its curve's middle),
  // an expressway (paved roads only), and how near an interstate or expressway stops the gravel
  // and dirt roads short of the corner (their gap, from its centre line).
  highwayAtMi: 0.1, expresswayAtMi: 0.16, barrierMi: STUDS(51) + AT_1000(0.04)
});

export function planSectionRoads(map, options = {}) {
  const p = { ...SECTION_DEFAULTS, ...options };
  const { size: n, cellMiles, elevation, coverRegion, cover, coverKeys, drainageMi2, rivers, regionKeys, settlements = [], roads: mapRoads = [] } = map;
  const per = Math.round(1 / cellMiles), miles = Math.floor(n / per), size = miles + 1;
  const cellM = cellMiles * 1609.344, water = coverKeys.indexOf('water'), urban = new Set([coverKeys.indexOf('urban'), coverKeys.indexOf('suburban')]);
  const gap = makeNoise(map.params.seed, 'section-gaps'), farm = makeNoise(map.params.seed, 'section-farms'), random = makeRandom(hashText(`${map.params.seed}|sections`));
  const pave = makeNoise(map.params.seed, 'section-paving');
  const throughLines = () => {
    const lines = new Uint8Array(size);
    for (let at = Math.floor(random() * p.pavedGapMi[1]); at < size; at += p.pavedGapMi[0] + Math.floor(random() * (p.pavedGapMi[1] - p.pavedGapMi[0] + 1))) lines[at] = 1;
    return lines;
  };
  const throughEW = throughLines(), throughNS = throughLines();

  // River cells (the drainage there), and each cell's slope.
  const river = new Float32Array(n * n);
  for (const r of rivers) for (let s = 0; s < r.points.length; s += 2) {
    const k = Math.floor(r.points[s + 1] / cellMiles) * n + Math.floor(r.points[s] / cellMiles);
    river[k] = Math.max(river[k], drainageMi2[k]);
  }
  const slope = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const at = (a, b) => elevation[clamp(b, 0, n - 1) * n + clamp(a, 0, n - 1)];
    slope[j * n + i] = Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (2 * cellM);
  }

  // Miles from each corner to the nearest town (out to a few reaches).
  const townMi = new Float32Array(size * size).fill(Infinity), reach = Math.ceil(4 * p.townReachMi);
  for (const s of settlements) {
    for (let J = Math.max(0, Math.floor(s.y - reach)); J <= Math.min(miles, Math.ceil(s.y + reach)); J++) for (let I = Math.max(0, Math.floor(s.x - reach)); I <= Math.min(miles, Math.ceil(s.x + reach)); I++) {
      const d = Math.max(0, Math.hypot(I - s.x, J - s.y) - s.extentMi), K = J * size + I;
      if (d < townMi[K]) townMi[K] = d;
    }
  }

  // The cells either side of one mile of mile line: east from corner (I, J), or south from it.
  const cellsAlong = (horizontal, I, J) => {
    const list = [];
    for (let t = 0; t < per; t++) for (const side of [-1, 0]) {
      const i = horizontal ? I * per + t : I * per + side, j = horizontal ? J * per + side : J * per + t;
      if (i >= 0 && j >= 0 && i < n && j < n) list.push(j * n + i);
    }
    return list;
  };
  const classify = (horizontal, I, J) => {
    const cellsOn = cellsAlong(horizontal, I, J);
    if (!cellsOn.length) return 0;
    let steep = 0, crossing = 0, town = false;
    for (const k of cellsOn) {
      if (cover[k] === water) return 0;
      steep = Math.max(steep, slope[k]); crossing = Math.max(crossing, river[k]);
      if (urban.has(cover[k])) town = true;
    }
    const key = regionKeys[coverRegion[cellsOn[0]]], line = horizontal ? J : I;
    if (town) return 3;
    // The density of the land along the mile: each cell's region, and what grows there.
    let land = 0;
    for (const k of cellsOn) land += p.density[regionKeys[coverRegion[k]]] * (p.coverShare[coverKeys[cover[k]]] ?? 1);
    const busy = (p.farmLow + (p.farmHigh - p.farmLow) * clamp(0.5 + 1.1 * fbm(farm, I / p.farmMi, J / p.farmMi, 3), 0, 1))
      * (1 + p.townBoost * Math.exp(-townMi[J * size + I] / p.townReachMi)), district = land / cellsOn.length * busy;
    if ((horizontal ? throughEW : throughNS)[line] && steep < p.pavedMaxSlope) {
      const along = (horizontal ? I + 0.5 : J + 0.5) / p.pavedRunMi, across = line * 2.71 + (horizontal ? 0.4 : 900.2);
      if (clamp(0.5 + 1.3 * fbm(pave, along, across, 1), 0, 1) < p.pavedShare[key] * Math.sqrt(busy)) return 3;
      if (crossing > p.bridgeMi2) return 0;
      if (clamp(0.5 + 1.3 * fbm(pave, along * p.pavedRunMi / p.throughRunMi + 311.7, across - 57.3, 1), 0, 1) < p.throughBase + p.throughGain * district) return steep < p.gravelSlope && key !== 'sandhills' ? 2 : 1;
    }
    if (crossing > p.bridgeMi2) return 0;
    const keep = district * (line % 2 === 0 ? p.evenLine : p.oddLine) * Math.exp(-steep / p.roughSlope);
    const along = (horizontal ? I + 0.5 : J + 0.5) / p.gapMi, across = horizontal ? J * 1.37 + 0.31 : I * 1.37 + 500.7;
    if (clamp(0.5 + 0.9 * fbm(gap, along, across, 2), 0, 1) >= keep) return 0;
    return steep < p.gravelSlope && key !== 'sandhills' && district >= p.gravelBusy ? 2 : 1;
  };

  const roads = new Uint8Array(size * size);
  for (let J = 0; J < size; J++) for (let I = 0; I < size; I++) {
    const east = I < miles && J > 0 && J < miles ? classify(true, I, J) : 0;
    const south = J < miles && I > 0 && I < miles ? classify(false, I, J) : 0;
    roads[J * size + I] = east | (south << 2);
  }
  // No junction on a bridge: at a corner in a river only one line goes through, straight across
  // (a highway's, where one passes; else the better road's), and the other arms end at the bank.
  const wetCorner = riverCorners(rivers, size);
  const along = (x, y) => {
    for (const r of mapRoads) for (let i = 1; i < r.points.length; i++) {
      const [ax, ay] = r.points[i - 1], [bx, by] = r.points[i];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
      if (Math.hypot(ax + dx * t - x, ay + dy * t - y) < 0.05) return Math.abs(dy) < 0.05 * Math.abs(dx) ? 0 : Math.abs(dx) < 0.05 * Math.abs(dy) ? 1 : 2;
    }
    return -1;
  };
  for (let J = 0; J < size; J++) for (let I = 0; I < size; I++) {
    if (!wetCorner[J * size + I]) continue;
    const K = J * size + I, W = I > 0 ? K - 1 : -1, N = J > 0 ? K - size : -1;
    const ew = Math.max(roads[K] & 3, W >= 0 ? roads[W] & 3 : 0), ns = Math.max((roads[K] >> 2) & 3, N >= 0 ? (roads[N] >> 2) & 3 : 0);
    if (!ew || !ns) continue;
    const highway = along(I, J);
    const keep = highway >= 0 ? highway : ew >= ns ? 0 : 1;
    if (keep !== 0) { roads[K] &= ~3; if (W >= 0) roads[W] &= ~3; }
    if (keep !== 1) { roads[K] &= ~12; if (N >= 0) roads[N] &= ~12; }
  }
  // Nor where a highway crosses a section road between corners, in a river: that mile goes.
  const riverSegs = new Map();
  for (const r of rivers) for (let k = 2; k < r.points.length; k += 2) {
    const seg = [r.points[k - 2], r.points[k - 1], r.points[k], r.points[k + 1], riverHalfMi(r.widthsM[k / 2]) + AT_1000(0.05)];
    for (let x = Math.floor(Math.min(seg[0], seg[2])) - 1; x <= Math.floor(Math.max(seg[0], seg[2])) + 1; x++) for (let y = Math.floor(Math.min(seg[1], seg[3])) - 1; y <= Math.floor(Math.max(seg[1], seg[3])) + 1; y++) {
      const key = x * 8192 + y; if (!riverSegs.has(key)) riverSegs.set(key, []); riverSegs.get(key).push(seg);
    }
  }
  const wetAt = (x, y) => (riverSegs.get(Math.floor(x) * 8192 + Math.floor(y)) ?? []).some(([ax, ay, bx, by, reach]) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(ax + dx * t - x, ay + dy * t - y) < reach;
  });
  for (const r of mapRoads) {
    if (r.kind === 'interstate') continue;
    for (let i = 1; i < r.points.length; i++) {
      const [ax, ay] = r.points[i - 1], [bx, by] = r.points[i];
      for (let I = Math.ceil(Math.min(ax, bx)); I <= Math.floor(Math.max(ax, bx)); I++) {
        if (bx === ax || I < 0 || I >= size) continue;
        const y = ay + (by - ay) * (I - ax) / (bx - ax), J = Math.floor(y);
        if (J >= 0 && J < size && y - J > 0.05 && y - J < 0.95 && wetAt(I, y)) roads[J * size + I] &= ~12;
      }
      for (let J = Math.ceil(Math.min(ay, by)); J <= Math.floor(Math.max(ay, by)); J++) {
        if (by === ay || J < 0 || J >= size) continue;
        const x = ax + (bx - ax) * (J - ay) / (by - ay), I = Math.floor(x);
        if (I >= 0 && I < size && x - I > 0.05 && x - I < 0.95 && wetAt(x, J)) roads[J * size + I] &= ~3;
      }
    }
  }
  const sections = { size, miles: 1, roads };
  sections.joined = connectSectionRoads(sections, map, p);
  return sections;
}

// Leaves no piece of the grid cut off from the highways (see the top). Works on the grid as
// the road rules will build it (streets.js, roadNetwork.js): gravel and dirt roads meet two-lane
// highways and each other, and stop short of interstates and expressways; paved roads meet the
// expressways too and stop only at an interstate (unless carried over it: crossings, once
// they are planned: then no new mile crosses one, and a small paved piece cut off goes too). No
// mile is put where sections.closed has one (taken by an airfield or a ramp). link: false only
// leaves out.
export function connectSectionRoads(sections, map, options = {}, { link = true, crossings = null } = {}) {
  const p = { ...SECTION_DEFAULTS, ...options };
  const { size, roads } = sections, miles = size - 1;
  const { size: n, cellMiles, cover, coverKeys, rivers, roads: mapRoads = [] } = map;
  const per = Math.round(1 / cellMiles), water = coverKeys.indexOf('water');
  const river = new Uint8Array(n * n);
  for (const r of rivers) for (let k = 0; k < r.points.length; k += 2) river[Math.min(n - 1, Math.floor(r.points[k + 1] / cellMiles)) * n + Math.min(n - 1, Math.floor(r.points[k] / cellMiles))] = 1;
  const wet = riverCorners(rivers, size);
  // The map's roads by mile square.
  const segs = new Map();
  for (const r of mapRoads) for (let i = 1; i < r.points.length; i++) {
    const [ax, ay] = r.points[i - 1], [bx, by] = r.points[i], seg = { ax, ay, bx, by, kind: r.kind };
    for (let X = Math.floor(Math.min(ax, bx)) - 1; X <= Math.floor(Math.max(ax, bx)) + 1; X++) for (let Y = Math.floor(Math.min(ay, by)) - 1; Y <= Math.floor(Math.max(ay, by)) + 1; Y++) {
      const k = X * 8192 + Y; if (!segs.has(k)) segs.set(k, []); segs.get(k).push(seg);
    }
  }
  const near = (x, y, sg) => { const dx = sg.bx - sg.ax, dy = sg.by - sg.ay, l2 = dx * dx + dy * dy, t = l2 ? clamp(((x - sg.ax) * dx + (y - sg.ay) * dy) / l2, 0, 1) : 0; return Math.hypot(sg.ax + dx * t - x, sg.ay + dy * t - y); };
  const crossAt = (x0, y0, x1, y1, sg) => {
    const rx = x1 - x0, ry = y1 - y0, sx = sg.bx - sg.ax, sy = sg.by - sg.ay, den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((sg.ax - x0) * sy - (sg.ay - y0) * sx) / den, u = ((sg.ax - x0) * ry - (sg.ay - y0) * rx) / den;
    return t > 0 && t < 1 && u >= 0 && u <= 1 ? [x0 + rx * t, y0 + ry * t] : null;
  };
  const carried = ([x, y]) => (crossings ?? []).some(c => Math.hypot(c.x - x, c.y - y) < 0.08);
  // One mile of mile line (east or south from corner I, J) as a road of a class: whether the
  // rules cut it between its corners (cut) or short of either corner (a, b), and whether it
  // meets a road of the map's at either corner or between them (metA, metB, met). Where a
  // highway shares an expressway's road, the expressway's rules hold. A new mile (fresh) crosses
  // no interstate, whatever its class: no bridge is planned for it.
  const look = (east, I, J, cls, fresh = false) => {
    const x1 = east ? I + 1 : I, y1 = east ? J : J + 1, out = { cut: false, a: false, b: false, metA: false, metB: false, met: false };
    for (const sg of segs.get(I * 8192 + J) ?? []) {
      const barrier = sg.kind === 'interstate' || (sg.kind === 'expressway' && cls < 3);
      if (barrier) {
        if (cls === 3) { const at = crossAt(I, J, x1, y1, sg); if (at && (fresh || (crossings && !carried(at)))) out.cut = true; continue; }
        if (crossAt(I, J, x1, y1, sg)) out.cut = true;
        if (near(I, J, sg) < p.barrierMi) out.a = true;
        if (near(x1, y1, sg) < p.barrierMi) out.b = true;
      } else {
        const at = sg.kind === 'expressway' ? p.expresswayAtMi : p.highwayAtMi;
        if (crossAt(I, J, x1, y1, sg)) out.met = true;
        if (near(I, J, sg) < at) out.metA = true;
        if (near(x1, y1, sg) < at) out.metB = true;
      }
    }
    if (out.a) out.metA = false;
    if (out.b) out.metB = false;
    if (out.cut) out.met = false;
    return out;
  };
  // Whether a new mile may run there: dry, off the rivers and their corners, inside the map.
  const open = (east, I, J) => {
    if (east ? J < 1 || J >= miles || I < 0 || I >= miles : I < 1 || I >= miles || J < 0 || J >= miles) return false;
    if (wet[J * size + I] || wet[(east ? J : J + 1) * size + (east ? I + 1 : I)] || sections.closed?.has((J * size + I) * 4 + (east ? 0 : 2))) return false;
    for (let t = 0; t < per; t++) for (const side of [-1, 0]) {
      const i = east ? I * per + t : I * per + side, j = east ? J * per + side : J * per + t;
      if (i < 0 || j < 0 || i >= n || j >= n || cover[j * n + i] === water || river[j * n + i]) return false;
    }
    return true;
  };

  const MAIN = size * size, parent = new Int32Array(MAIN + 1).map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { parent[find(a)] = find(b); };
  const classAt = (east, K) => (east ? roads[K] & 3 : (roads[K] >> 2) & 3);
  const clear = (east, K) => { roads[K] &= east ? ~3 : ~12; };
  // Each mile hangs on the corners it reaches: both (joining them), one (a dead end, cut short of
  // the other or between them), or none.
  const hangs = [];   // [east, K, corners it hangs on]
  const stats = { joined: 0, linkMiles: 0, dropped: 0, dropMiles: 0, left: 0 };
  for (let J = 0; J < size; J++) for (let I = 0; I < size; I++) for (const east of [true, false]) {
    const K = J * size + I, cls = classAt(east, K);
    if (!cls) continue;
    const K1 = east ? K + 1 : K + size, at = look(east, I, J, cls);
    const on = at.cut ? [at.a ? -1 : K, at.b ? -1 : K1].filter(c => c >= 0) : at.a && at.b ? [] : at.a ? [K1] : at.b ? [K] : [K, K1];
    if (!on.length) { clear(east, K); stats.dropMiles++; continue; }
    if (!at.cut && on.length === 2) join(K, K1);
    for (const c of on) if (at.met || (c === K ? at.metA : at.metB) || (!at.cut && on.length === 2 && (at.metA || at.metB))) join(c, MAIN);
    hangs.push([east, K, on, at.cut]);
  }
  // The pieces not joined to the highways, largest first.
  const pieces = new Map();
  for (const h of hangs) for (const c of h[2]) {
    const root = find(c);
    if (root === find(MAIN)) continue;
    if (!pieces.has(root)) pieces.set(root, { corners: new Set(), miles: [], paved: false });
    const piece = pieces.get(root);
    piece.corners.add(c); piece.miles.push(h); if (classAt(h[0], h[1]) === 3) piece.paved = true;
  }
  for (const piece of [...pieces.values()].sort((a, b) => b.miles.length - a.miles.length)) {
    piece.miles = [...new Set(piece.miles)];
    if (find([...piece.corners][0]) === find(MAIN)) continue;   // joined through an earlier piece's link
    // (A mile cut short of a corner, or between its corners, counts as half.)
    const size0 = piece.miles.reduce((sum, h) => sum + (h[3] || h[2].length < 2 ? 0.5 : 1), 0);
    const reach = !link ? 0 : piece.paved ? p.linkPavedMi : size0 <= p.linkSmallMi ? 1 : clamp(Math.ceil(size0 / 2), p.linkMi, p.linkFarMi);
    // The shortest run of missing miles to a corner on the network (breadth first).
    const from = new Map([...piece.corners].map(c => [c, null]));
    let front = [...piece.corners], goal = -1;
    for (let depth = 0; depth < reach && goal < 0 && front.length; depth++) {
      const next = [];
      for (const c of front) {
        const I = c % size, J = (c / size) | 0;
        for (const [east, KI, KJ, oI, oJ] of [[true, I, J, I + 1, J], [true, I - 1, J, I - 1, J], [false, I, J, I, J + 1], [false, I, J - 1, I, J - 1]]) {
          if (oI < 0 || oJ < 0 || oI >= size || oJ >= size || goal >= 0) continue;
          const K = KJ * size + KI, o = oJ * size + oI;
          if (from.has(o) || classAt(east, K) || !open(east, KI, KJ)) continue;
          const at = look(east, KI, KJ, piece.paved ? 3 : 2, true);
          if (at.cut || at.a || at.b) continue;
          from.set(o, [c, east, K]);
          if (find(o) === find(MAIN) || at.met || at.metA || at.metB) goal = o; else next.push(o);
        }
      }
      front = next;
    }
    if (goal >= 0) {
      const cls = Math.max(...piece.miles.map(h => classAt(h[0], h[1])));
      for (let c = goal; from.get(c); c = from.get(c)[0]) { const [, east, K] = from.get(c); roads[K] |= east ? cls : cls << 2; stats.linkMiles++; }
      join([...piece.corners][0], MAIN); stats.joined++;
    } else if (crossings || !link ? size0 <= p.cutOffDropMi : !piece.paved && size0 <= p.dropMi) {
      for (const [east, K] of piece.miles) if (classAt(east, K)) { clear(east, K); stats.dropMiles++; }
      stats.dropped++;
    } else stats.left++;
  }
  return stats;
}

// The corners of the 1-mile grid (size by size) that lie in a river, as wide as it is built
// (the Roblox width: 0.18 of the engine width, 12 to 220 studs) with padMi more each side (a
// bridge's reach beyond the water, at character scale).
export function riverCorners(rivers, size, padMi = AT_1000(0.05)) {
  const wet = new Uint8Array(size * size);
  for (const r of rivers) for (let k = 2; k < r.points.length; k += 2) {
    const ax = r.points[k - 2], ay = r.points[k - 1], bx = r.points[k], by = r.points[k + 1];
    const reach = riverHalfMi(r.widthsM[k / 2]) + padMi;
    for (let J = Math.max(0, Math.ceil(Math.min(ay, by) - reach)); J <= Math.min(size - 1, Math.floor(Math.max(ay, by) + reach)); J++) {
      for (let I = Math.max(0, Math.ceil(Math.min(ax, bx) - reach)); I <= Math.min(size - 1, Math.floor(Math.max(ax, bx) + reach)); I++) {
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? clamp(((I - ax) * dx + (J - ay) * dy) / l2, 0, 1) : 0;
        if (Math.hypot(ax + dx * t - I, ay + dy * t - J) < reach) wet[J * size + I] = 1;
      }
    }
  }
  return wet;
}

// Miles of each kind of section road.
export function sectionRoadMiles(sections) {
  const miles = SECTION_CLASSES.map(() => 0);
  for (const v of sections.roads) { miles[v & 3]++; miles[(v >> 2) & 3]++; }
  return Object.fromEntries(SECTION_CLASSES.map((key, i) => [key, miles[i]]).slice(1));
}
