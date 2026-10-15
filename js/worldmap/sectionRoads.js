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
  gapMi: 5               // size of the stretches of mile line left without a road
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
    const busy = (p.farmLow + (p.farmHigh - p.farmLow) * clamp(0.5 + 1.1 * fbm(farm, I / p.farmMi, J / p.farmMi, 3), 0, 1))
      * (1 + p.townBoost * Math.exp(-townMi[J * size + I] / p.townReachMi)), district = p.density[key] * busy;
    if ((horizontal ? throughEW : throughNS)[line] && steep < p.pavedMaxSlope) {
      const along = (horizontal ? I + 0.5 : J + 0.5) / p.pavedRunMi, across = line * 2.71 + (horizontal ? 0.4 : 900.2);
      if (clamp(0.5 + 1.3 * fbm(pave, along, across, 1), 0, 1) < p.pavedShare[key] * Math.sqrt(busy)) return 3;
      if (crossing > p.bridgeMi2) return 0;
      return steep < p.gravelSlope && key !== 'sandhills' ? 2 : 1;
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
  return { size, miles: 1, roads };
}

// The corners of the 1-mile grid (size by size) that lie in a river, as wide as it is built
// (the Roblox width: 0.18 of the engine width, 12 to 220 studs) with padMi more each side.
export function riverCorners(rivers, size, padMi = 0.05) {
  const wet = new Uint8Array(size * size);
  for (const r of rivers) for (let k = 2; k < r.points.length; k += 2) {
    const ax = r.points[k - 2], ay = r.points[k - 1], bx = r.points[k], by = r.points[k + 1];
    const reach = Math.min(220, Math.max(12, r.widthsM[k / 2] * 0.18)) / 2000 + padMi;
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
