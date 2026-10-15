// The large-scale world map: ground height, regions, land cover and rivers for the whole
// 500 x 500 mile map, made once from a seed. Modelled on the central Great Plains and Midwest
// (roughly NW Kansas to central Missouri, southern Nebraska to northern Oklahoma), fictional in
// detail. Its large-scale slope is the weather engine's own (REGIONAL_DEFAULTS terrain at the
// default geographyOffset), so the ground players see is the ground the weather is made over.
// Roblox adds the fine detail (dunes, field edges, trees, buildings) chunk by chunk from this.
//
// Steps: regions laid out over the map with wandering boundaries; each region's own relief on
// top of the engine's slope; a few rivers entering from beyond the map; stream-power erosion
// (rivers cut their valleys where water collects) with a little hillslope smoothing; a
// reservoir dammed on a river; rivers traced where enough water has gathered; land cover from
// region, slope, rainfall and rivers, with neighbouring regions' land interfingering near their
// borders; then towns, highways and the section-line road grid.
import { REGIONAL_DEFAULTS } from '../atmosphere/RegionalAtmosphere.js';
import { makeNoise, fbm, clamp, smoothstep } from './noise.js';
import { planSettlements } from './settlements.js';
import { planSectionRoads } from './sectionRoads.js';

const METRES_PER_MILE = 1609.344;

export const WORLD_MAP_DEFAULTS = Object.freeze({
  seed: 1,
  miles: 500,
  cellMiles: 0.5,
  boundaryWarp: 0.09,       // how far region boundaries wander, as a share of the map
  // Land cover near a border is drawn from the region at a point up to coverBlendMi away, in
  // patches of about coverBlendScaleMi, so one region's farms and pasture give way to the next.
  coverBlendMi: 25, coverBlendScaleMi: 3,
  reliefBlend: 4,           // each region's relief is weighted by its claim to this power (higher: sharper edges)
  // Low hummocks everywhere (m, miles), so water on the flat plains wanders as it does in life.
  detailM: 6, detailWavelengthMi: 3,
  // The big river (Missouri-like) runs north to south in the east; its valley and the
  // southward tilt of the eastern plains that lead water to it.
  trunkAt: 0.8, trunkValleyM: 60, trunkValleyWidth: 0.03, eastTiltM: 25,
  // Stream-power erosion: dh = -K A^m S per step (A rain-weighted drainage area in cells),
  // solved implicitly; then hillslope diffusion.
  erosionSteps: 24, erosionK: 0.5, erosionM: 0.5, diffusion: 0.04, refillEvery: 4,
  // Rainfall weight from the dry west to the wet east (shares of the eastern rain).
  rainWest: 0.4, rainEast: 1,
  // A creek appears on the map where this much rain-weighted drainage area (mi2) has gathered;
  // its width (m) is riverWidthPerRootMi2 times the root of that area.
  riverAreaMi2: 1000, riverWidthPerRootMi2: 2,
  // Reservoirs: a dam on a river draining lakeDrainMi2, raised until the water behind it covers
  // lakeAreaMi2; built where the dam that takes is nearest lakeDamM (a deep lake in a confined
  // valley, not a shallow spread over a flat) and no lower than its least.
  lakes: 1, lakeAreaMi2: 120, lakeDamM: [10, 22, 40], lakeDrainMi2: [1500, 40000], lakeSpacingMi: 120,
  // Rivers coming in from beyond the map: edge, place along it (0 to 1), rain-weighted area (mi2).
  inflows: [
    { name: 'Platte-like', edge: 'west', at: 0.16, areaMi2: 25000 },
    { name: 'Smoky Hill-like', edge: 'west', at: 0.47, areaMi2: 8000 },
    { name: 'Arkansas-like', edge: 'west', at: 0.78, areaMi2: 20000 },
    { name: 'Missouri-like', edge: 'north', at: null, areaMi2: 120000 }   // at: the trunk river
  ]
});

// reliefM: height of the region's own hills either side of the engine's slope; wavelengthMi:
// their size; terrace: 0 smooth to 1 flat-topped buttes and mesas; ridged: dune-like crests;
// liftM: the region stands this much above the slope (a plateau for erosion to cut into);
// erodibility: how easily its ground is cut (sand soaks rain up, Ozark streams cut deep).
export const REGIONS = Object.freeze([
  { key: 'highPlains', name: 'High Plains', reliefM: 12, wavelengthMi: 20, terrace: 0, ridged: false, liftM: 0, erodibility: 0.7 },
  { key: 'smokyHills', name: 'Smoky Hills', reliefM: 35, wavelengthMi: 8, terrace: 0.5, ridged: false, liftM: 0, erodibility: 1 },
  { key: 'sandhills', name: 'Sandhills', reliefM: 30, wavelengthMi: 3, terrace: 0, ridged: true, liftM: 10, erodibility: 0.25 },
  { key: 'redHills', name: 'Red Hills', reliefM: 45, wavelengthMi: 5, terrace: 0.7, ridged: false, liftM: 10, erodibility: 1.3 },
  { key: 'flintHills', name: 'Flint Hills', reliefM: 45, wavelengthMi: 6, terrace: 0.4, ridged: false, liftM: 30, erodibility: 1 },
  { key: 'midwest', name: 'Midwest farmland', reliefM: 25, wavelengthMi: 6, terrace: 0, ridged: false, liftM: 0, erodibility: 1.2 },
  { key: 'ozarkEdge', name: 'Ozark edge', reliefM: 60, wavelengthMi: 4, terrace: 0, ridged: false, liftM: 120, erodibility: 1.6 }
]);

export const COVER = Object.freeze(['water', 'cropland', 'irrigated', 'grassland', 'sandhillGrass', 'forest', 'riparian', 'breaks', 'redRange', 'tallgrass', 'urban', 'suburban']);
const C = Object.fromEntries(COVER.map((key, i) => [key, i]));

// The engine's ground height (m) at a distance east of the map's west edge (REGIONAL_DEFAULTS
// terrainAt with the default geographyOffset, read continuously between its 10-mile cells).
export function engineTerrainM(mileEast, params = REGIONAL_DEFAULTS) {
  const column = mileEast / (params.cellKm / 1.609344) - 0.5;
  const share = clamp((column + params.geographyOffset) / ((params.geographyColumns ?? params.columns) - 1), 0, 1);
  return params.terrainEastM + (params.terrainWestM - params.terrainEastM) * (1 - share) ** params.terrainShape;
}

// Each region's claim on a point (u east, v south, both 0 to 1); the largest claim wins.
function regionClaims(u, v, out) {
  const band = (x, lo, hi, s) => smoothstep(lo - s, lo + s, x) * (1 - smoothstep(hi - s, hi + s, x));
  const west = 1 - smoothstep(0.27, 0.37, u), east = smoothstep(0.62, 0.7, u);
  const ozark = smoothstep(0.74, 0.82, u) * smoothstep(0.62, 0.72, v);
  out[0] = west;
  out[1] = (1 - west) * (1 - east);
  out[2] = 2 * band(u, 0.14, 0.56, 0.05) * (1 - smoothstep(0.15, 0.25, v));
  out[3] = 2 * band(u, 0.3, 0.6, 0.05) * smoothstep(0.72, 0.8, v);
  out[4] = 2 * band(u, 0.61, 0.68, 0.03) * band(v, 0.25, 0.85, 0.05);
  out[5] = east * (1 - ozark);
  out[6] = 2 * ozark;
}

// Min-heap of cell indices keyed by height, for the depression fill.
class HeightHeap {
  constructor(capacity) { this.keys = new Float64Array(capacity); this.items = new Int32Array(capacity); this.size = 0; }
  push(item, key) {
    let i = this.size++;
    while (i > 0) { const parent = (i - 1) >> 1; if (this.keys[parent] <= key) break; this.keys[i] = this.keys[parent]; this.items[i] = this.items[parent]; i = parent; }
    this.keys[i] = key; this.items[i] = item;
  }
  pop() {
    const top = this.items[0], key = this.keys[--this.size], item = this.items[this.size];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1] < this.keys[child]) child++;
      if (this.keys[child] >= key) break;
      this.keys[i] = this.keys[child]; this.items[i] = this.items[child]; i = child;
    }
    this.keys[i] = key; this.items[i] = item;
    return top;
  }
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];

export function generateWorldMap(options = {}) {
  const p = { ...WORLD_MAP_DEFAULTS, ...options };
  const n = Math.round(p.miles / p.cellMiles), cells = n * n, cellM = p.cellMiles * METRES_PER_MILE, cellMi2 = p.cellMiles ** 2;
  const noise = name => makeNoise(p.seed, name);
  const warpX = noise('warp-x'), warpY = noise('warp-y'), relief = noise('relief'), trunkWobble = noise('trunk'), patch = noise('patch'), patch2 = noise('patch-2'), blend = noise('blend');

  const trunkU = v => p.trunkAt + 0.05 * fbm(trunkWobble, v * 2.5, 0.5, 2) + 0.015 * fbm(trunkWobble, v * 12, 3.5, 2);
  const height = new Float64Array(cells), region = new Uint8Array(cells), coverRegion = new Uint8Array(cells), rain = new Float64Array(cells), erodibility = new Float64Array(cells);
  const claims = new Float64Array(REGIONS.length), coverClaims = new Float64Array(REGIONS.length), weights = new Float64Array(REGIONS.length);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, u = (i + 0.5) / n, v = (j + 0.5) / n, xMi = u * p.miles, yMi = v * p.miles;
      const wu = u + p.boundaryWarp * (fbm(warpX, u * 2, v * 2, 2) + 0.6 * fbm(warpX, u * 7 + 5.3, v * 7, 3)), wv = v + p.boundaryWarp * (fbm(warpY, u * 2, v * 2, 2) + 0.6 * fbm(warpY, u * 7, v * 7 + 5.3, 3));
      regionClaims(wu, wv, claims);
      let best = 0, total = 0;
      for (let r = 0; r < REGIONS.length; r++) { if (claims[r] > claims[best]) best = r; weights[r] = claims[r] ** p.reliefBlend; total += weights[r]; }
      region[k] = best;
      // The region whose land cover this cell takes: the region at a point jittered by up to
      // coverBlendMi, so near a border the two regions' land interfingers for miles.
      const jx = fbm(blend, xMi / p.coverBlendScaleMi, yMi / p.coverBlendScaleMi, 3), jy = fbm(blend, xMi / p.coverBlendScaleMi + 71.3, yMi / p.coverBlendScaleMi - 33.9, 3);
      regionClaims(wu + 2 * jx * p.coverBlendMi / p.miles, wv + 2 * jy * p.coverBlendMi / p.miles, coverClaims);
      coverRegion[k] = 0;
      for (let r = 1; r < REGIONS.length; r++) if (coverClaims[r] > coverClaims[coverRegion[k]]) coverRegion[k] = r;

      let h = engineTerrainM(xMi) + p.detailM * fbm(relief, xMi / p.detailWavelengthMi - 91.3, yMi / p.detailWavelengthMi + 47.1, 3), erode = 0;
      for (let r = 0; r < REGIONS.length; r++) {
        const w = total > 0 ? weights[r] / total : 0;
        if (w < 0.01) continue;
        const def = REGIONS[r];
        let shape = fbm(relief, xMi / def.wavelengthMi + r * 31.7, yMi / def.wavelengthMi - r * 17.3, 5);
        if (def.ridged) shape = 1 - 2 * Math.abs(shape);
        if (def.terrace > 0) { const t = shape * 4, floor = Math.floor(t), stepped = (floor + smoothstep(0.35, 0.65, t - floor)) / 4; shape += (stepped - shape) * def.terrace; }
        h += w * (def.reliefM * shape + def.liftM);
        erode += w * def.erodibility;
      }
      const east = smoothstep(0.55, 0.75, u);
      h -= p.trunkValleyM * Math.exp(-Math.abs(u - trunkU(v)) / p.trunkValleyWidth) * smoothstep(0.5, 0.65, u);   // V-shaped: water gathers at the middle
      h -= p.eastTiltM * v * east;
      height[k] = h;
      erodibility[k] = erode;
      rain[k] = (p.rainWest + (p.rainEast - p.rainWest) * u) * (region[k] === 2 ? 0.5 : 1);
    }
  }

  // Extra drainage area where rivers come in from beyond the map (in rain-weighted cells).
  const inflow = new Float64Array(cells), inflowCells = [];
  for (const source of p.inflows) {
    const at = source.at ?? trunkU(0);
    const k = source.edge === 'west' ? Math.min(n - 1, Math.floor(at * n)) * n : source.edge === 'north' ? Math.min(n - 1, Math.floor(at * n)) : null;
    if (k === null) throw new Error(`unknown inflow edge ${source.edge}`);
    inflow[k] += source.areaMi2 / cellMi2;
    inflowCells.push({ ...source, cell: k });
  }

  // Water leaves the map across its east and south edges only (the high ground is to the west).
  const isOutlet = k => { const i = k % n, j = (k / n) | 0; return i === n - 1 || j === n - 1; };
  const order = new Int32Array(cells), receiver = new Int32Array(cells), receiverDist = new Float64Array(cells), area = new Float64Array(cells);
  const heap = new HeightHeap(cells), seen = new Uint8Array(cells);
  const EPS = 1e-3;

  // Fill pits (priority flood from the outlets) so all water drains, record the drainage order
  // (lowest first) and each cell's receiver (steepest downhill neighbour).
  function route() {
    seen.fill(0); heap.size = 0;
    for (let k = 0; k < cells; k++) if (isOutlet(k)) { heap.push(k, height[k]); seen[k] = 1; }
    let count = 0;
    while (heap.size) {
      const c = heap.pop(), ci = c % n, cj = (c / n) | 0;
      order[count++] = c;
      for (let d = 0; d < 8; d++) {
        const ni = ci + DX[d], nj = cj + DY[d];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const m = nj * n + ni;
        if (seen[m]) continue;
        seen[m] = 1;
        if (height[m] <= height[c] + EPS) height[m] = height[c] + EPS;
        heap.push(m, height[m]);
      }
    }
    for (let k = 0; k < cells; k++) {
      receiver[k] = -1;
      if (isOutlet(k)) continue;
      const ci = k % n, cj = (k / n) | 0;
      let bestDrop = 0;
      for (let d = 0; d < 8; d++) {
        const ni = ci + DX[d], nj = cj + DY[d];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const m = nj * n + ni, dist = (d & 1 ? Math.SQRT2 : 1) * cellM, drop = (height[k] - height[m]) / dist;
        if (drop > bestDrop) { bestDrop = drop; receiver[k] = m; receiverDist[k] = dist; }
      }
    }
  }

  function accumulate() {
    for (let k = 0; k < cells; k++) area[k] = rain[k] + inflow[k];
    for (let o = cells - 1; o >= 0; o--) { const k = order[o], r = receiver[k]; if (r >= 0) area[r] += area[k]; }
  }

  const smoothed = new Float64Array(cells);
  for (let step = 0; step < p.erosionSteps; step++) {
    if (step % p.refillEvery === 0) route();
    accumulate();
    for (let o = 0; o < cells; o++) {
      const k = order[o], r = receiver[k];
      if (r < 0) continue;
      const f = p.erosionK * erodibility[k] * area[k] ** p.erosionM / receiverDist[k];
      const lowered = (height[k] + f * height[r]) / (1 + f);
      if (lowered < height[k]) height[k] = lowered;
    }
    smoothed.set(height);
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      smoothed[k] = height[k] + p.diffusion * (height[k - 1] + height[k + 1] + height[k - n] + height[k + n] - 4 * height[k]);
    }
    height.set(smoothed);
  }
  route();
  accumulate();

  const { lake, lakes } = placeLakes(n, p, height, area, receiver, cellMi2, noise('lake-site'));
  const rivers = splitAtLakes(traceRivers(n, p, cellMi2, area, receiver), lake, n, p.cellMiles);
  const cover = landCover(n, p, height, coverRegion, cellM, rivers, patch, patch2, area, cellMi2);
  for (let k = 0; k < cells; k++) if (lake[k]) cover[k] = C.water;
  const map = {
    params: p, size: n, cellMiles: p.cellMiles, regionKeys: REGIONS.map(r => r.key), coverKeys: COVER,
    elevation: Float32Array.from(height), region, coverRegion, cover, lake, lakes, drainageMi2: Float32Array.from(area, a => a * cellMi2),
    rivers, inflows: inflowCells, trunkU
  };
  const { settlements, roads } = planSettlements(map, p.settlements);
  paintTowns(map, settlements);
  const sections = planSectionRoads({ ...map, settlements }, p.sections);
  return { ...map, settlements, roads, sections };
}

// Reservoirs. For a candidate dam (a river cell of the right size away from the edges), the
// water behind a dam of a given height fills every cell upstream of it, through the drainage
// tree, that lies below the crest; the crest is raised until the lake reaches its area. The site
// whose dam is nearest the usual height is built: a confined valley, as real reservoirs are sited.
function placeLakes(n, p, height, area, receiver, cellMi2, siteNoise) {
  const cells = n * n, lake = new Uint8Array(cells), lakes = [];
  if (!p.lakes) return { lake, lakes };
  // The cells flowing into each cell, as one list with offsets.
  const start = new Int32Array(cells + 1), into = new Int32Array(cells);
  for (let k = 0; k < cells; k++) if (receiver[k] >= 0) start[receiver[k] + 1]++;
  for (let k = 0; k < cells; k++) start[k + 1] += start[k];
  const next = start.slice(0, cells);
  for (let k = 0; k < cells; k++) if (receiver[k] >= 0) into[next[receiver[k]]++] = k;

  const target = p.lakeAreaMi2 / cellMi2, cap = Math.ceil(target * 3), queue = new Int32Array(cells);
  // Cells behind the dam below the crest (counting stops at cap; with mark, they are flooded).
  const flood = (dam, crest, mark = 0, limit = cap) => {
    let count = 1, q = 0;
    queue[0] = dam;
    while (q < count && count < limit) {
      const c = queue[q++];
      for (let s = start[c]; s < start[c + 1] && count < limit; s++) {
        const m = into[s];
        if (height[m] < crest && !lake[m]) { queue[count++] = m; if (mark) lake[m] = mark; }
      }
    }
    return count - 1;
  };
  const margin = Math.round(0.12 * n), spacing = p.lakeSpacingMi / p.cellMiles;
  for (let made = 0; made < p.lakes; made++) {
    let best = null;
    for (let k = 0; k < cells; k += 3) {
      const i = k % n, j = (k / n) | 0, mi2 = area[k] * cellMi2;
      if (i < margin || j < margin || i >= n - margin || j >= n - margin || mi2 < p.lakeDrainMi2[0] || mi2 > p.lakeDrainMi2[1] || lake[k]) continue;
      if (lakes.some(l => Math.hypot(l.cellI - i, l.cellJ - j) < spacing)) continue;
      const [least, usual, most] = p.lakeDamM;
      if (flood(k, height[k] + most) < target || flood(k, height[k] + least) >= target) continue;
      let lo = least, hi = most;
      for (let it = 0; it < 12; it++) { const mid = (lo + hi) / 2; if (flood(k, height[k] + mid) >= target) hi = mid; else lo = mid; }
      const score = Math.abs(hi - usual) + 6 * siteNoise(i / n * 9, j / n * 9);   // a little variety between seeds
      if (!best || score < best.score) best = { k, i, j, damM: hi, score };
    }
    if (!best) break;
    const id = lakes.length + 1, crest = height[best.k] + best.damM, count = flood(best.k, crest, id, cells);
    lakes.push({ id, surfaceM: crest, damHeightM: best.damM, areaMi2: count * cellMi2, cellI: best.i, cellJ: best.j, damX: (best.i + 0.5) * p.cellMiles, damY: (best.j + 0.5) * p.cellMiles, inflowMi2: area[best.k] * cellMi2 });
  }
  return { lake, lakes };
}

// Rivers cut where they enter a lake: the stretch upstream ends at the shore, the stretch
// below starts again at the dam.
function splitAtLakes(rivers, lake, n, cellMiles) {
  const out = [], inLake = (x, y) => lake[Math.floor(y / cellMiles) * n + Math.floor(x / cellMiles)] > 0;
  for (const river of rivers) {
    let points = [], widthsM = [];
    const flush = () => { if (points.length >= 4) out.push({ points, widthsM, mouthDrainageMi2: river.mouthDrainageMi2 }); points = []; widthsM = []; };
    for (let s = 0; s < river.points.length; s += 2) {
      const x = river.points[s], y = river.points[s + 1];
      if (inLake(x, y)) { if (points.length) { points.push(x, y); widthsM.push(river.widthsM[s / 2]); flush(); } continue; }
      points.push(x, y); widthsM.push(river.widthsM[s / 2]);
    }
    flush();
  }
  return out;
}

// Built-up land: the core of each place is urban, the rest of its extent suburban (towns are
// only a few blocks across at this scale; Roblox lays out their streets).
function paintTowns(map, settlements) {
  const { size: n, cellMiles, cover } = map;
  for (const s of settlements) {
    const reach = Math.ceil(s.extentMi / cellMiles);
    const ci = Math.floor(s.x / cellMiles), cj = Math.floor(s.y / cellMiles);
    for (let j = Math.max(0, cj - reach); j <= Math.min(n - 1, cj + reach); j++) for (let i = Math.max(0, ci - reach); i <= Math.min(n - 1, ci + reach); i++) {
      const d = Math.hypot((i + 0.5) * cellMiles - s.x, (j + 0.5) * cellMiles - s.y), k = j * n + i;
      if (cover[k] === C.water) continue;
      if (d <= s.coreMi) cover[k] = C.urban;
      else if (d <= s.extentMi && cover[k] !== C.urban) cover[k] = C.suburban;
    }
  }
}

// Rivers: chains of cells whose drainage reaches riverAreaMi2, each from a head (no river
// flowing into it) down to where it joins a river already traced or leaves the map.
function traceRivers(n, p, cellMi2, area, receiver) {
  const cells = n * n, isRiver = new Uint8Array(cells), fed = new Uint8Array(cells), taken = new Uint8Array(cells);
  const threshold = p.riverAreaMi2 / cellMi2;
  for (let k = 0; k < cells; k++) if (area[k] >= threshold) isRiver[k] = 1;
  for (let k = 0; k < cells; k++) if (isRiver[k] && receiver[k] >= 0) fed[receiver[k]] = 1;
  // Each head is traced down to where it meets a river already traced (that point included,
  // so it joins) or leaves the map. Points are cell centres in miles from the NW corner.
  const rivers = [];
  for (let start = 0; start < cells; start++) {
    if (!isRiver[start] || fed[start]) continue;
    const points = [], widthsM = [];
    let k = start, last = start;
    while (k >= 0) {
      points.push((k % n + 0.5) * p.cellMiles, (((k / n) | 0) + 0.5) * p.cellMiles);
      widthsM.push(p.riverWidthPerRootMi2 * Math.sqrt(area[k] * cellMi2));
      last = k;
      if (taken[k]) break;
      taken[k] = 1;
      k = receiver[k];
    }
    if (points.length >= 4) rivers.push({ points, widthsM, mouthDrainageMi2: area[last] * cellMi2 });
  }
  return rivers;
}

function landCover(n, p, height, region, cellM, rivers, patch, patch2, area, cellMi2) {
  const cells = n * n, cover = new Uint8Array(cells), near = new Float32Array(cells).fill(Infinity), reach = new Int8Array(cells).fill(-1);
  // Distance (cells) to the nearest river bank, out to a few cells, and how far the river's own
  // woods reach: a creek has a line of trees, a large river a wooded bottom a mile or two across.
  const queue = [], bottom = Math.max(1, Math.round(0.5 / p.cellMiles));
  for (const river of rivers) for (let s = 0; s < river.points.length; s += 2) {
    const i = Math.floor(river.points[s] / p.cellMiles), j = Math.floor(river.points[s + 1] / p.cellMiles), k = j * n + i, mi2 = area[k] * cellMi2;
    reach[k] = Math.max(reach[k], mi2 >= 15000 ? 2 * bottom : mi2 >= 3000 ? bottom : 0);
    if (near[k] > 0) { near[k] = 0; queue.push(k); }
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], d = near[k];
    if (d >= 4) continue;
    const i = k % n, j = (k / n) | 0;
    for (let e = 0; e < 4; e++) {
      const ni = i + DX[e * 2], nj = j + DY[e * 2];
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const m = nj * n + ni;
      if (reach[m] < reach[k] - 1) reach[m] = reach[k] - 1;
      if (near[m] > d + 1) { near[m] = d + 1; queue.push(m); }
    }
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, u = (i + 0.5) / n, xMi = (i + 0.5) * p.cellMiles, yMi = (j + 0.5) * p.cellMiles;
    const left = height[j * n + Math.max(0, i - 1)], right = height[j * n + Math.min(n - 1, i + 1)];
    const up = height[Math.max(0, j - 1) * n + i], down = height[Math.min(n - 1, j + 1) * n + i];
    const slope = Math.hypot(right - left, down - up) / (2 * cellM);
    const pick = clamp(0.5 + 0.8 * fbm(patch, xMi / 6, yMi / 6, 4), 0, 1), pick2 = clamp(0.5 + 0.8 * fbm(patch2, xMi / 3, yMi / 3, 3), 0, 1);
    const wet = clamp((u - 0.3) / 0.5, 0, 1);
    const key = REGIONS[region[k]].key;
    let c;
    if (slope > 0.05) c = u < 0.6 && key !== 'ozarkEdge' ? C.breaks : C.forest;
    else if (near[k] <= reach[k] && pick2 < 0.35 + 0.45 * wet) c = C.riparian;
    else if (key === 'highPlains') c = pick < 0.5 ? C.cropland : pick < 0.68 ? C.irrigated : C.grassland;
    else if (key === 'smokyHills') c = pick < 0.55 ? C.cropland : C.grassland;
    else if (key === 'sandhills') c = near[k] <= 3 && pick < 0.15 ? C.irrigated : C.sandhillGrass;
    else if (key === 'redHills') c = pick < 0.25 ? C.cropland : pick2 > 0.8 ? C.forest : C.redRange;
    else if (key === 'flintHills') c = near[k] <= 2 && pick < 0.6 ? C.cropland : C.tallgrass;
    else if (key === 'midwest') c = pick < 0.62 ? C.cropland : pick < 0.82 ? C.grassland : C.forest;
    else c = pick < 0.3 ? C.grassland : C.forest;
    cover[k] = c;
  }
  return cover;
}

// Summary numbers for a generated map: per-region heights and relief, and how far the map's
// 10-mile column averages stray from the engine's ground.
export function describeWorldMap(map) {
  const { size: n, elevation, region, rivers, params: p } = map;
  const byRegion = REGIONS.map(def => ({ key: def.key, name: def.name, values: [] }));
  for (let k = 0; k < n * n; k++) byRegion[region[k]].values.push(elevation[k]);
  const pct = (v, q) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  const regions = byRegion.map(r => {
    const v = r.values.sort((a, b) => a - b);
    return { key: r.key, name: r.name, share: v.length / (n * n), meanM: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, reliefM: v.length ? pct(v, 0.95) - pct(v, 0.05) : null };
  });
  const perColumn = Math.round(10 / p.cellMiles), columns = Math.floor(n / perColumn);
  let worst = 0, sumAbs = 0;
  for (let c = 0; c < columns; c++) {
    let sum = 0;
    for (let j = 0; j < n; j++) for (let i = c * perColumn; i < (c + 1) * perColumn; i++) sum += elevation[j * n + i];
    const diff = sum / (perColumn * n) - engineTerrainM((c + 0.5) * 10);
    worst = Math.max(worst, Math.abs(diff)); sumAbs += Math.abs(diff);
  }
  const riverMiles = rivers.reduce((a, r) => a + polylineMiles(r.points), 0);
  return { regions, engineMatch: { meanAbsM: sumAbs / columns, worstM: worst }, rivers: rivers.length, riverMiles, bigRivers: rivers.filter(r => Math.max(...r.widthsM) >= 150).length };
}

function polylineMiles(points) {
  let total = 0;
  for (let s = 2; s < points.length; s += 2) total += Math.hypot(points[s] - points[s - 2], points[s + 1] - points[s - 1]);
  return total;
}
