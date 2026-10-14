// Where a storm's precipitation is, worked out rather than drawn. The storm says where its
// updraughts are and how strong (StormGeometry, and the line's cores from its structure); the
// environment gives the wind through its depth. Precipitation of several sizes forms in each
// updraught, is carried up as far as the updraught can hold it, leaves in the outflow near the
// top, and falls through the storm-relative wind and the mesocyclone's rotation: large drops
// and hail land beside the updraught, small ones far downwind, snow drifts for an hour, sticks
// together and melts into the light rain behind a line. Drops evaporate below cloud in dry air.
// The amount of each size in each place, at ten heights, is what the radar scans: the forward
// flank, the hook, the overhang above the updraught, the anvil and the rain shield are where
// the wind puts them. Nothing here reads what the storm is called.
// Frame: x east and y south in km from the storm's centre; heights in metres above the ground.
import { rotatingShare, lineShare } from '../storms/StormModeEngine.js';
import { buildStormGeometry } from '../storms/StormGeometry.js';
import { BUDGET } from '../storms/StormBudgets.js';

export const PRECIP_LEVELS_M = [0, 700, 1500, 2500, 3700, 5200, 7000, 9200, 12000, 15500];
// The storm-relative wind profile the fallout is carried by: one value every 250 m.
export const WIND_PROFILE_STEP_M = 250, WIND_PROFILE_LEVELS = 73;

const LEVELS = PRECIP_LEVELS_M.length, DEG = Math.PI / 180;
const LEVEL_STEP_M = 100, LEVEL_BELOW = new Uint8Array(Math.ceil(PRECIP_LEVELS_M[LEVELS - 1] / LEVEL_STEP_M) + 1);
for (let t = 0, k = 0; t < LEVEL_BELOW.length; t++) { while (k < LEVELS - 2 && PRECIP_LEVELS_M[k + 1] <= t * LEVEL_STEP_M) k++; LEVEL_BELOW[t] = k; }
// Depth of air each level stands for (km): amounts are per volume.
const LEVEL_DEPTH_KM = PRECIP_LEVELS_M.map((z, k) => ((PRECIP_LEVELS_M[Math.min(LEVELS - 1, k + 1)] - PRECIP_LEVELS_M[Math.max(0, k - 1)]) / 2) / 1000);

// Drop sizes carried (melted diameter, mm), the width of the size range each stands for, and
// how many of each are followed from a single updraught and from one cell of a line. The two
// smallest leave the updraught as snow; the rest as graupel.
const DROP_MM = [0.5, 1.0, 1.8, 2.8, 4.0, 5.5], DROP_RANGE_MM = [0.5, 0.65, 0.9, 1.1, 1.35, 1.5], SNOW_SIZES = 2;
const FOLLOWED = { updraught: [1100, 1100, 1000, 900, 750, 600], lineCell: [56, 56, 44, 36, 28, 20], hail: [350, 20], debris: 2600 };
// Hailstones as shares of the storm's largest stone, and the share of the hail's mass in each.
const HAIL_SIZE_SHARE = [0.35, 0.6, 0.9], HAIL_MASS_SHARE = [0.5, 0.35, 0.15];

const PHYSICS = {
  // Precipitation leaves an updraught on its flanks (where it rises at 8% to 70% of its full
  // speed), from a kilometre below the freezing level to this share of the way to the top.
  flank: [0.08, 0.7], formationBelowM: 1000, formationShare: 0.45,
  // It leaves on the side the air through the updraught is going: fully so when that air
  // moves this fast (m/s) relative to the storm, and anywhere round a still updraught.
  throughFlowMs: 4,
  hailAboveM: 1000,            // hail grows this far and more above the freezing level
  inflowM: 1000,               // an updraught carries the wind of the air it draws in: the lowest kilometre
  // Turbulence spreads the fallout as it goes: each followed particle stands for a patch that
  // widens at this speed (m/s, and more per m/s of updraught), half of it as the patch's own drift.
  spreadMs: [1.2, 0.04],
  aggregationS: 1500, aggregateMm: 1.3,   // snow doubles its size in this time, up to this size
  // A mature line drives air from its front to its rear aloft: up to this fast (m/s) with a
  // strong cold pool (this strength or more) once the line is this many hours old.
  frontToRearMs: 22, frontToRearColdPool: 0.6, frontToRearHours: [0.5, 2.5],
  evaporationS: 700,           // life of a 1 mm drop below cloud in the driest air (longer as the square of its size)
  sublimationS: 2500,          // the same for snow falling from the anvil through dry air
  // An updraught's output varies over about this time, by up to this share, separately on
  // each of its sides (a steady, organised storm varies less).
  pulseS: 720, pulse: 0.75, sides: 6,
  longestS: 9000,              // fallout older than this is not followed
  // How much of the water vapour an updraught carries up comes down as precipitation (the rest
  // stays as cloud, or is carried away aloft): this share at most, a third as much in the
  // strongest shear (0-6 km, kt), where more of it is carried off before it can grow.
  efficiency: 0.3, efficiencyShearKt: [20, 60],
  hailMass: [0.04, 0.1],       // share of the precipitation that is hail: least, and more with large stones
  hailRadarMm: 15              // stones larger than this reflect little more (they are no longer small beside the wavelength)
};
export const MESOCYCLONE_LEAN_M = 3500;
// The front-to-rear current's share of its full speed with height: none below 2 km or at the top, most midway.
export const FRONT_TO_REAR_BASE_M = 2000;
export const frontToRearShare = (zM, topM) => Math.sin(Math.PI * clamp((zM - FRONT_TO_REAR_BASE_M) / (topM - FRONT_TO_REAR_BASE_M), 0, 1)) ** 2;
const COLUMNS = 34000, RESOLUTION_KM = [0.5, 2.5], REACH_KM = 260, MAX_STEPS = 220;
// Around a storm's own updraught the grid is finer, so a hook a kilometre or two wide is kept.
// (Its outermost 3.5 km is not used: fallout spread from outside it is missing there.)
const INNER = { halfKm: 18, resKm: 0.4, edgeKm: 3.5, blendKm: 3 };
// A patch wider than a grid cell is added to a coarser copy of the grid (cells 2, 4 and 8 times
// the size), and the copies are merged at the end: old fallout comes out smooth, new fallout sharp.
const COARSER = 3;
const PULSE_STEPS = Math.ceil(PHYSICS.longestS / 150) + 3;
const PULSE_SIDES = PHYSICS.sides;
// Updraught speed with height, as a share of its fastest: it gathers its air in the lowest few
// kilometres, rises at nearly full speed through the middle, and spreads out in the top fifth.
// RISE is the share at each hundredth of the way to the top, and RISE_SLOPE how fast it changes.
const RISE = new Float32Array(102), RISE_SLOPE = new Float32Array(102);
for (let k = 0; k < 102; k++) {
  const h = Math.min(1, k / 100), gather = Math.exp(-h / 0.1);
  RISE[k] = (1 - gather) * (1 - h ** 6); RISE_SLOPE[k] = gather / 0.1 * (1 - h ** 6) - (1 - gather) * 6 * h ** 5;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ramp = (v, a, b) => clamp(((Number(v) || 0) - a) / (b - a), 0, 1);
// Fall speeds (m/s): rain by drop size, snow, graupel, hail.
const rainFallMs = mm => 9.65 - 10.3 * Math.exp(-0.6 * mm);
const iceFallMs = (mm, snow) => (snow ? 1 + 0.3 * mm : 1.2 + 1.4 * mm);
const hailFallMs = mm => 11.45 * Math.sqrt(mm / 10);

// column: { topM, freezingM, su, sv } - the storm's top and freezing level above the ground, and
// the wind relative to the storm (m/s east and north) every WIND_PROFILE_STEP_M. shared: keep the
// result in memory other threads can read without a copy (the radar's threads share one scene).
export function buildStormPrecipitation(storm, column, { shared = false } = {}) {
  const alloc = shared ? sharedAlloc : plainAlloc;
  const structure = storm.structure;
  if (!structure) return null;
  const geometry = storm.geometry ?? buildStormGeometry({ ...storm });
  const theta = (Number(structure.orientationDeg ?? storm.orientationDeg) || 0) * DEG;
  // Motion unit vector m and right-of-motion vector r on the map.
  const mx = Math.sin(theta), my = Math.cos(theta), rx = -my, ry = mx;
  const toMap = (a, b) => ({ x: a * mx + b * rx, y: a * my + b * ry });
  const meso = structure.mesocyclone ?? {}, mesoAt = toMap(Number(meso.offsetXKm) || 0, Number(meso.offsetYKm) || 0);
  const tornado = storm.tornado, tornadoWindMs = (Number(tornado?.windSpeedMph) || 90) * 0.447;
  const model = {
    mx, my, rx, ry, topM: column.topM, freezingM: column.freezingM, su: column.su, sv: column.sv,
    baseM: clamp(Number(geometry.updraught.baseM) || 1200, 300, 4000),
    ageS: Math.min(PHYSICS.longestS, (Number(storm.ageHours) || 0) * 3600),
    seed: hashString(String(storm.id ?? 'storm')),
    // A left-moving storm turns the other way.
    spin: storm.leftMover ? -1 : 1,
    // The rotation is under the wall cloud at the ground and leans to the updraught's centre by LEAN_M up.
    mesocyclone: { x: mesoAt.x, y: mesoAt.y, aloftX: 0, aloftY: 0, radiusKm: clamp(Number(meso.radiusKm) || 4, 1.5, 8), vmaxMs: 6 + 30 * clamp(Number(meso.strength) || 0, 0, 1.25) },
    // The radar sees 85% of the tornado's wind: the rest is in a core narrower than a gate.
    tornado: tornado?.onGround ? { x: mesoAt.x, y: mesoAt.y, radiusKm: clamp((Number(tornado.widthYards) || 300) / 1094, 0.1, 2.5) / 2, vmaxMs: clamp(tornadoWindMs * 0.85, 25, 135), windMs: tornadoWindMs } : null,
    coldPool: clamp(Number(storm.coldPoolStrength) || 0, 0, 1.2), rearInflow: clamp(Number(storm.rearInflow) || 0, 0, 1)
  };
  const environment = storm.environment ?? {};
  // How dry the air the rain falls through is: below cloud (a high cloud base, energetic
  // downdraughts) and aloft beneath the anvil (less so in a line, which moistens its own air).
  const asLine = ramp(lineShare(storm), 0.25, 0.7);
  model.dryBelow = clamp(0.5 * (model.baseM - 400) / 1600 + 0.5 * (Number(environment.dcape) || 600) / 1200, 0.05, 1.2);
  model.dryAloft = clamp((Number(environment.dcape) || 600) / 1200, 0.1, 1.2) * (1 - 0.6 * asLine);
  model.frontToRear = PHYSICS.frontToRearMs * asLine * clamp(model.coldPool / PHYSICS.frontToRearColdPool, 0, 1) * ramp(storm.ageHours, PHYSICS.frontToRearHours[0], PHYSICS.frontToRearHours[1]);
  model.sources = updraughts(storm, structure, geometry, model, asLine, toMap);
  // The strongest few updraughts, for what a radar sees of the updraught itself.
  model.cores = [...model.sources].sort((a, b) => b.w - a.w).slice(0, 6).map(({ x, y, R, w }) => ({ x, y, R, w }));

  // The wind of the air the updraughts draw in.
  const inflowLevels = Math.round(PHYSICS.inflowM / WIND_PROFILE_STEP_M);
  model.inflowU = 0; model.inflowV = 0;
  for (let k = 0; k <= inflowLevels; k++) { model.inflowU += column.su[k] / (inflowLevels + 1); model.inflowV += column.sv[k] / (inflowLevels + 1); }
  model.mesoDepth = Float32Array.from({ length: WIND_PROFILE_LEVELS }, (_, k) => (0.55 + 0.45 * Math.exp(-(((k * WIND_PROFILE_STEP_M - 4500) / 2600) ** 2))) * (k * WIND_PROFILE_STEP_M > column.topM ? 0.2 : 1));

  const reach = follow(model, null, null, 8);
  let grid = null, inner = null;
  if (reach) {
    // Room beyond what was measured: only one particle in eight was followed, and old fallout is spread wide.
    const margin = 4 + 0.1 * Math.max(reach.maxX - reach.minX, reach.maxY - reach.minY) + 0.4 * (PHYSICS.spreadMs[0] + PHYSICS.spreadMs[1] * 40) * model.ageS / 1000;
    const x0 = Math.max(-REACH_KM, reach.minX - margin), y0 = Math.max(-REACH_KM, reach.minY - margin);
    const widthKm = Math.min(REACH_KM, reach.maxX + margin) - x0, heightKm = Math.min(REACH_KM, reach.maxY + margin) - y0;
    const res = clamp(Math.ceil(Math.sqrt(widthKm * heightKm / COLUMNS) * 4) / 4, RESOLUTION_KM[0], RESOLUTION_KM[1]);
    const hail = model.sources.some(source => source.hailMass > 0);
    grid = createGrid(x0, y0, res, Math.ceil(widthKm / res) + 1, Math.ceil(heightKm / res) + 1, hail, alloc);
    if (res > INNER.resKm * 1.5 && model.sources[0]?.kind === 'updraught') inner = createGrid(-INNER.halfKm, -INNER.halfKm, INNER.resKm, Math.round(2 * INNER.halfKm / INNER.resKm) + 1, Math.round(2 * INNER.halfKm / INNER.resKm) + 1, hail, alloc);
    follow(model, grid, inner, 1);
    finish(grid, true, alloc);
    if (inner) finish(inner, false, alloc);
  }
  const debris = model.tornado ? loftDebris(model, alloc) : null;
  // (A tornado's debris is part of the storm's extent even where no rain is.)
  if (debris && grid && !grid.extent) grid.extent = { minX: debris.x - debris.halfKm, minY: debris.y - debris.halfKm, maxX: debris.x + debris.halfKm, maxY: debris.y + debris.halfKm };
  else if (debris && grid) { const e = grid.extent; e.minX = Math.min(e.minX, debris.x - debris.halfKm); e.minY = Math.min(e.minY, debris.y - debris.halfKm); e.maxX = Math.max(e.maxX, debris.x + debris.halfKm); e.maxY = Math.max(e.maxY, debris.y + debris.halfKm); }
  return {
    grid, inner, debris, cores: model.cores, mx, my, rx, ry,
    mesocyclone: model.mesocyclone, tornado: model.tornado, spin: model.spin, coldPool: model.coldPool, rearInflow: model.rearInflow, frontToRear: model.frontToRear,
    // Extent on the map, from the storm's centre (km).
    ...(grid?.extent ?? { minX: -1, minY: -1, maxX: 1, maxY: 1 })
  };
}

// The storm's updraughts: the one at its centre, and the cells along its leading line. Each
// gives rain in proportion to its area, the rain the storm holds and how fast it rises; a
// stronger one makes larger drops.
function updraughts(storm, structure, geometry, model, asLine, toMap) {
  const speed = clamp(Number(storm.updraughtMs) || 6, 3, 70), rain = clamp(Number(storm.precipitation) || 0, 0, 1.3);
  const steady = clamp(Number(storm.organization) || 0, 0, 1), hailMm = (Number(storm.currentHailSizeInches) || 0) * 25.4;
  const hailMass = hailMm > 6 ? PHYSICS.hailMass[0] + PHYSICS.hailMass[1] * clamp(hailMm / 63, 0, 1.2) : 0;
  // Water vapour in the air drawn in (g/m³, from its dewpoint), and how much of it comes down.
  const environment = storm.environment ?? {}, dewpointC = ((Number(environment.dewpoint) || 60) - 32) * 5 / 9;
  const vapour = 216.7 * 6.112 * Math.exp(17.67 * dewpointC / (dewpointC + 243.5)) / (dewpointC + 273.15);
  const efficiency = PHYSICS.efficiency * (1 - 2 / 3 * ramp(environment.bulkShear, PHYSICS.efficiencyShearKt[0], PHYSICS.efficiencyShearKt[1]));
  const sources = [];
  const add = (at, R, w, share, hailShare, kind, index) => {
    const vigour = clamp(0.5 * rain + 0.5 * w / 45, 0, 1.1), slope = 3.6 - 1.9 * vigour;   // drop-size slope (per mm): 3.6 drizzle to 1.5 downpour
    const shares = DROP_MM.map((d, c) => d ** 3 * Math.exp(-slope * d) * DROP_RANGE_MM[c]), total = shares.reduce((a, b) => a + b, 0);
    // Precipitation made each second (g): the share of the vapour the updraught carries up, with
    // the updraught as it was a while ago (rain takes time to form). Amounts in the grid are
    // then grams per cubic metre (a km² is 1e6 m², a km³ 1e9 m³).
    const flux = efficiency * vapour * rain * BUDGET.fullUpdraughtMs * (w / speed) * Math.PI * R * R * 1e-3 * share;
    if (!(flux > 0)) return;
    const counts = FOLLOWED[kind], classes = DROP_MM.map((d, c) => ({ mm: d, snow: c < SNOW_SIZES, hail: false, fallMs: iceFallMs(d, c < SNOW_SIZES), count: counts[c], each: flux * (1 - hailMass * hailShare) * shares[c] / total / counts[c] }));
    if (hailMass * hailShare > 0) HAIL_SIZE_SHARE.forEach((s, c) => {
      const mm = Math.max(6, s * hailMm), count = FOLLOWED.hail[kind === 'updraught' ? 0 : 1];
      classes.push({ mm, snow: false, hail: true, fallMs: hailFallMs(mm), count, each: flux * hailMass * hailShare * HAIL_MASS_SHARE[c] / count });
    });
    sources.push({ kind, x: at.x, y: at.y, R, w, classes, hailMass: hailMass * hailShare, pulse: PHYSICS.pulse * (1 - 0.7 * steady), seed: (model.seed ^ Math.imul(index + 1, 0x9e3779b1)) | 0 });
  };
  if (asLine < 0.95) add({ x: 0, y: 0 }, 0.45 * geometry.updraught.radiusKm, speed, 1 - asLine, 1, 'updraught', 0);
  const line = structure.features?.find(f => f.type === 'convectiveLine');
  if (asLine > 0.05 && line) {
    const cores = structure.features.filter(f => f.type === 'embeddedCore'), half = line.lengthKm / 2;
    const R = clamp(0.3 * line.widthKm, 2.5, 5), spacing = 1.5 * R, count = Math.floor(half / spacing);
    for (let k = -count; k <= count; k++) {
      const b = k * spacing, s = b / half;
      // Stronger where the storm has a core in the line, weaker toward the line's ends.
      const core = cores.reduce((most, f) => Math.max(most, Math.exp(-(((b - f.centerYKm) / Math.max(3, f.radiusYKm)) ** 2))), 0);
      // No two cells of a line are alike, nor evenly spaced.
      const vary = n => hash3(model.seed, k, n) / 4294967296 - 0.5;
      const strength = (0.5 + 0.5 * core) * (1 - 0.6 * s ** 4) * (1 + 0.5 * vary(1));
      add(toMap(line.centerXKm + line.bowKm * (1 - s * s) + 0.8 * R * vary(2), b + 0.7 * spacing * vary(3)), R * (1 + 0.4 * vary(4)), speed * strength, asLine * strength, 0.4 * core, 'lineCell', 1000 + k);
    }
  }
  return sources;
}

// Arrays the finished field keeps: in this thread's own memory, or in memory threads share.
const plainAlloc = (Type, n) => new Type(n);
const sharedAlloc = (Type, n) => new Type(new SharedArrayBuffer(n * Type.BYTES_PER_ELEMENT));
function createGrid(x0, y0, res, nx, ny, hail, alloc = plainAlloc, coarser = COARSER) {
  const n = nx * ny * LEVELS, F = Float32Array;
  const grid = { x0, y0, res, nx, ny, plane: nx * ny, perKm: 1 / res, rain: alloc(F, n), size: alloc(F, n), snow: alloc(F, n), hail: hail ? alloc(F, n) : null, perVolume: LEVEL_DEPTH_KM.map(depth => 1 / (res * res * depth)), used: false };
  if (coarser > 0) {
    // (The coarser copies are merged into the grid and dropped: they are never shared.)
    grid.scales = [grid];
    for (let m = 1; m <= coarser; m++) { const finer = grid.scales[m - 1]; grid.scales.push(createGrid(x0, y0, finer.res * 2, Math.ceil((finer.nx - 1) / 2) + 1, Math.ceil((finer.ny - 1) / 2) + 1, false, plainAlloc, 0)); }
  }
  return grid;
}

// Adds a particle's stay (its mass for a time, and how it reflects) to the grid cell it is in.
function deposit(g, x, y, k, t, amount, mm, isSnow, isHail) {
  const fi = (x - g.x0) * g.perKm + 0.5, fj = (y - g.y0) * g.perKm + 0.5;
  if (fi < 0 || fj < 0 || fi >= g.nx || fj >= g.ny) return;
  const at = k * g.plane + (fj | 0) * g.nx + (fi | 0), lower = amount * (1 - t) * g.perVolume[k], upper = amount * t * g.perVolume[k + 1];
  if (isHail) {
    const reflects = Math.min(mm, PHYSICS.hailRadarMm) ** 2;
    g.hail[at] += lower * reflects; g.hail[at + g.plane] += upper * reflects;
    return;
  }
  const reflects = mm * mm * mm;
  g.used = true;
  g.rain[at] += lower * reflects; g.rain[at + g.plane] += upper * reflects;
  g.size[at] += lower * reflects * mm; g.size[at + g.plane] += upper * reflects * mm;
  if (isSnow) { g.snow[at] += lower * reflects; g.snow[at + g.plane] += upper * reflects; }
}
// The same for a patch wider than a cell, shared between the four cells around it.
function depositWide(g, x, y, k, t, amount, mm, isSnow) {
  const fi = (x - g.x0) * g.perKm, fj = (y - g.y0) * g.perKm;
  if (fi < 0 || fj < 0 || fi >= g.nx - 1 || fj >= g.ny - 1) return;
  const i = fi | 0, j = fj | 0, tx = fi - i, ty = fj - j, at = k * g.plane + j * g.nx + i, reflects = mm * mm * mm;
  const lower = amount * (1 - t) * g.perVolume[k] * reflects, upper = amount * t * g.perVolume[k + 1] * reflects;
  g.used = true;
  for (let corner = 0; corner < 4; corner++) {
    const share = (corner & 1 ? tx : 1 - tx) * (corner & 2 ? ty : 1 - ty), a = at + (corner & 1) + (corner & 2 ? g.nx : 0);
    g.rain[a] += lower * share; g.rain[a + g.plane] += upper * share;
    g.size[a] += lower * share * mm; g.size[a + g.plane] += upper * share * mm;
    if (isSnow) { g.snow[a] += lower * share; g.snow[a + g.plane] += upper * share; }
  }
}
// The grid copy whose cells match a patch this wide (km).
const scaleFor = (widthKm, perKm) => { const cells = widthKm * perKm; return cells < 2.5 ? 0 : cells < 5 ? 1 : cells < 10 ? 2 : 3; };

// Follows the fallout of every updraught. With no grid it only measures how far the fallout
// reaches (following one particle in every `stride`); with one it adds each particle's stay in
// each place to the grid (and to the finer inner grid, where it is inside that).
function follow(model, grid, inner, stride) {
  const { su, sv, topM, freezingM: fz, baseM, ageS, mesocyclone: meso, spin, inflowU, inflowV, mesoDepth } = model;
  // The line's front-to-rear current, east and north (m/s), at its strongest.
  const rearU = -model.mx * model.frontToRear, rearV = model.my * model.frontToRear;
  if (!(ageS > 0)) return null;
  const P = PHYSICS, stepM = (grid ? grid.res : 1) * 800, innerStepM = INNER.resKm * 1000, top = topM * 1.05;
  const mesoR = meso.radiusKm, mesoV = meso.vmaxMs * spin, mesoReach2 = (mesoR * 12) ** 2;
  const evaporation = model.dryBelow / P.evaporationS, sublimation = model.dryAloft / P.sublimationS;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
  const highest = PRECIP_LEVELS_M[LEVELS - 1] - 1, formationTop = fz + P.formationShare * Math.max(0, topM - fz);
  const pulse = new Float32Array(PULSE_STEPS * PULSE_SIDES);
  const rearShare = Float32Array.from({ length: 102 }, (_, k) => frontToRearShare(k / 100 * top, top));

  for (const source of model.sources) {
    const R = source.R, R2 = R * R, wMax = source.w, spread = 0.5 * (P.spreadMs[0] + P.spreadMs[1] * wMax), outflow = wMax / top * R2 * 500;
    // What the updraught was giving at each time before now.
    for (let side = 0; side < PULSE_SIDES; side++) for (let t = 0; t < PULSE_STEPS; t++) pulse[side * PULSE_STEPS + t] = 1 + source.pulse * (2 * noise1(source.seed + side * 7919, (ageS - t * 150) / P.pulseS) - 1);
    const inLine = source.kind === 'lineCell' && model.frontToRear > 0;
    const nearInner = inner && Math.abs(source.x) < INNER.halfKm + 40 && Math.abs(source.y) < INNER.halfKm + 40;
    for (let c = 0; c < source.classes.length; c++) {
      const cls = source.classes[c], isSnow = cls.snow, isHail = cls.hail, sublimates = sublimation / (cls.mm * cls.mm), least = cls.each * stride * 0.03;
      for (let p = 0; p < cls.count; p += stride) {
        const random = mulberry32(hash3(source.seed, c, p));
        let z = Math.max(1200, fz + (isHail ? P.hailAboveM : -P.formationBelowM) + random() ** 1.5 * (formationTop - fz + (isHail ? -P.hailAboveM : P.formationBelowM)));
        // Snow is carried up from anywhere on the flank. Graupel and hail have grown too heavy
        // for the air they are in: they leave where the updraught can no longer hold them.
        const held = cls.fallMs / Math.max(1e-3, wMax * RISE[(100 * z / top) | 0]);
        let share = P.flank[0] + (P.flank[1] - P.flank[0]) * random();
        if (!isSnow) share = Math.min(share, (0.5 + 0.5 * random()) * held);
        // The air through the updraught at that height: its inflow's wind low down, the wind around it higher up.
        const zi0 = Math.min(WIND_PROFILE_LEVELS - 1, (z / WIND_PROFILE_STEP_M) | 0), h0 = Math.min(1, z / top);
        const throughU = inflowU + (su[zi0] - inflowU) * h0, throughV = inflowV + (sv[zi0] - inflowV) * h0;
        const oneSided = Math.min(1, Math.sqrt(throughU * throughU + throughV * throughV) / P.throughFlowMs);
        const startR = R * Math.sqrt(-Math.log(clamp(share, 0.02, 0.95))), startAngle = Math.atan2(-throughV, throughU) + Math.PI * (1 - 0.6 * oneSided) * (random() + random() - 1);
        let x = source.x + startR * Math.cos(startAngle), y = source.y + startR * Math.sin(startAngle);
        const side = ((((startAngle / (2 * Math.PI)) % 1) + 1) % 1 * PULSE_SIDES | 0) * PULSE_STEPS;
        const driftU = (random() + random() + random() - 1.5) * 2 * spread, driftV = (random() + random() + random() - 1.5) * 2 * spread;
        let along = (random() * 4294967296) >>> 0;
        let mass = cls.each * stride, mm = cls.mm, age = 0, iceAge = 0;
        for (let step = 0; step < MAX_STEPS; step++) {
          // The wind relative to the storm at this height.
          const zi = z <= 0 ? 0 : Math.min(WIND_PROFILE_LEVELS - 1, (z / WIND_PROFILE_STEP_M) | 0);
          let u = su[zi], v = sv[zi];
          // The updraught it formed in: rising air that carries its inflow's wind, flowing in below and out above.
          const dx = x - source.x, dy = y - source.y, r2 = dx * dx + dy * dy;
          let rising = 0, inside = 0;
          if (z < top && r2 < 400 * R2) {
            inside = r2 < 9 * R2 ? Math.exp(-r2 / R2) : 0;
            const hi = z <= 0 ? 0 : (100 * z / top) | 0, slope = RISE_SLOPE[hi];
            rising = wMax * RISE[hi] * inside;
            u += (inflowU - u) * inside; v += (inflowV - v) * inside;
            if (r2 > 1e-4) {
              // Air leaving (or entering) the column, from how the updraught changes with height.
              const outward = -outflow * slope * (1 - inside) / r2;
              u += outward * dx; v -= outward * dy;
            }
          }
          // The mesocyclone: strongest at mid levels, present down to the ground.
          const lean = z >= MESOCYCLONE_LEAN_M ? 1 : z <= 0 ? 0 : z / MESOCYCLONE_LEAN_M;
          const mdx = x - meso.x - (meso.aloftX - meso.x) * lean, mdy = y - meso.y - (meso.aloftY - meso.y) * lean, mr2 = mdx * mdx + mdy * mdy;
          if (mr2 > 1e-6 && mr2 < mesoReach2) {
            // Solid rotation inside its core; outside, the wind falls away with distance.
            const mr = Math.sqrt(mr2), ratio = mesoR / mr, around = mesoV * mesoDepth[zi] * (mr < mesoR ? 1 / ratio : ratio) / (mr * (1 + 1 / (27 * ratio * ratio * ratio)));
            u += around * mdy; v += around * mdx;
          }
          if (inLine && z > FRONT_TO_REAR_BASE_M && z < top) { const current = rearShare[(100 * z / top) | 0] * (1 - inside); u += rearU * current; v += rearV * current; }
          u += driftU; v += driftV;
          const frozen = z > fz, vertical = rising - (isHail || frozen ? cls.fallMs : rainFallMs(mm));
          const inInner = nearInner && x > -INNER.halfKm && x < INNER.halfKm && y > -INNER.halfKm && y < INNER.halfKm;
          const speed = Math.sqrt(u * u + v * v), climb = vertical < 0 ? -vertical : vertical;
          // A step is no longer than a grid cell, or half the width of the patch the particle stands for.
          const widthKm = isHail ? 0 : spread * age / 1000, cellM = inInner ? innerStepM : stepM, patchM = 500 * widthKm;
          let dt = Math.min((patchM > cellM ? patchM : cellM) / (speed > 1 ? speed : 1), 450 / (climb > 0.5 ? climb : 0.5));
          dt = dt < 5 ? 5 : dt > 240 ? 240 : dt;
          if (grid) {
            // Its stay over this step goes where it is at some moment of the step, not always at the
            // start: or every particle would leave its mark at the same distances from where it set out.
            along = (Math.imul(along, 1664525) + 1013904223) >>> 0;
            const part = along / 4294967296 * dt, px = x + u * part / 1000, py = y - v * part / 1000, pz = z + vertical * part;
            const zc = pz < 0 ? 0 : pz > highest ? highest : pz, k = LEVEL_BELOW[(zc / LEVEL_STEP_M) | 0];
            const t = (zc - PRECIP_LEVELS_M[k]) / (PRECIP_LEVELS_M[k + 1] - PRECIP_LEVELS_M[k]), amount = mass * dt * pulse[side + ((age / 150) | 0)];
            const scale = scaleFor(widthKm, grid.perKm);
            if (scale) depositWide(grid.scales[scale], px, py, k, t, amount, mm, isSnow); else deposit(grid, px, py, k, t, amount, mm, isSnow, isHail);
            if (inInner) { const fine = scaleFor(widthKm, inner.perKm); if (fine) depositWide(inner.scales[fine], px, py, k, t, amount, mm, isSnow); else deposit(inner, px, py, k, t, amount, mm, isSnow, isHail); }
          } else if (z < topM) {
            any = true;
            if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
          x += u * dt / 1000; y -= v * dt / 1000; z += vertical * dt; age += dt;
          if (!isHail) {
            if (frozen) {
              if (inside < 0.3) {
                // Snow sticks together as it drifts; falling out of the anvil through dry air it wastes away.
                if (isSnow) { iceAge += dt; mm = Math.min(cls.mm * (1 + iceAge / P.aggregationS), P.aggregateMm); }
                if (z < 0.6 * topM) mass *= 1 - Math.min(0.9, dt * sublimates);
              }
            } else if (z < baseM) mass *= 1 - Math.min(0.9, dt * evaporation / (mm * mm));
          }
          if (z <= 0 || age > ageS || mass < least) break;
        }
      }
    }
  }
  return grid ? null : any ? { minX, minY, maxX, maxY } : null;
}

// Merges the coarser copies of the grid into it, notes where it holds anything, and works out
// what the radar's winds need: how heavy the rain is near the ground and aloft (0-1).
function finish(grid, winds, alloc = plainAlloc) {
  // Merge the coarser copies down into the grid itself.
  for (let m = grid.scales.length - 1; m >= 1; m--) {
    const from = grid.scales[m], to = grid.scales[m - 1];
    if (!from.used) continue;
    to.used = true;
    const row = new Float32Array(from.plane);
    for (const name of ['rain', 'size', 'snow']) {
      const a = from[name], b = to[name];
      // Each copy is smoothed over its own cells first, so a wide patch trails off rather than ending at a cell's edge.
      for (let k = 0; k < LEVELS; k++) {
        const level = a.subarray(k * from.plane, (k + 1) * from.plane), { nx, ny } = from;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const at = j * nx + i; row[at] = 0.25 * level[at - (i > 0 ? 1 : 0)] + 0.5 * level[at] + 0.25 * level[at + (i < nx - 1 ? 1 : 0)]; }
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const at = j * nx + i; level[at] = 0.25 * row[at - (j > 0 ? nx : 0)] + 0.5 * row[at] + 0.25 * row[at + (j < ny - 1 ? nx : 0)]; }
      }
      for (let k = 0; k < LEVELS; k++) for (let j = 0; j < to.ny; j++) {
        const j0 = Math.min(from.ny - 1, j >> 1), j1 = Math.min(from.ny - 1, j0 + (j & 1)), rowA = k * from.plane + j0 * from.nx, rowB = k * from.plane + j1 * from.nx, out = k * to.plane + j * to.nx;
        for (let i = 0; i < to.nx; i++) {
          const i0 = Math.min(from.nx - 1, i >> 1), i1 = Math.min(from.nx - 1, i0 + (i & 1));
          b[out + i] += 0.25 * (a[rowA + i0] + a[rowA + i1] + a[rowB + i0] + a[rowB + i1]);
        }
      }
    }
  }
  grid.scales = null;
  // Rain too thin for any radar to see is not kept (the widest patches trail off into it).
  const least = THINNEST_DBZ_UNITS / RAIN_REFLECTIVITY;
  for (let at = 0; at < grid.rain.length; at++) if (grid.rain[at] < least && grid.rain[at] > 0) { grid.rain[at] = 0; grid.size[at] = 0; grid.snow[at] = 0; }
  // Which columns hold anything (or stand beside one that does), so empty air is passed over quickly.
  const { nx, ny } = grid, plane = nx * ny, holds = new Uint8Array(plane), any = grid.any = alloc(Uint8Array, plane);
  for (const field of [grid.rain, grid.hail]) {
    if (!field) continue;
    for (let k = 0; k < LEVELS; k++) for (let at = 0, from = k * plane; at < plane; at++) if (field[from + at] > 0) holds[at] = 1;
  }
  let iMin = nx, iMax = -1, jMin = ny, jMax = -1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!holds[j * nx + i]) continue;
    if (i < iMin) iMin = i; if (i > iMax) iMax = i; if (j < jMin) jMin = j; if (j > jMax) jMax = j;
    for (let b = Math.max(0, j - 1); b <= Math.min(ny - 1, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1); a++) any[b * nx + a] = 1;
  }
  grid.extent = iMax < 0 ? null : { minX: grid.x0 + (iMin - 1) * grid.res, minY: grid.y0 + (jMin - 1) * grid.res, maxX: grid.x0 + (iMax + 1) * grid.res, maxY: grid.y0 + (jMax + 1) * grid.res };
  if (!winds) return;
  const heaviness = (k, at) => clamp(Math.log10(1 + RAIN_REFLECTIVITY * grid.rain[k * plane + at] + (grid.hail ? HAIL_REFLECTIVITY * grid.hail[k * plane + at] : 0)) / 6, 0, 1);
  grid.low = alloc(Float32Array, plane); grid.aloft = alloc(Float32Array, plane); grid.middle = alloc(Float32Array, plane);
  for (let at = 0; at < plane; at++) {
    grid.low[at] = heaviness(0, at);
    grid.middle[at] = heaviness(3, at);
    grid.aloft[at] = Math.max(heaviness(7, at), heaviness(8, at));
  }
}

// What a tornado throws up: debris lifted in the vortex as high as the tornado is strong, thrown
// outward, carried round the mesocyclone and downwind as it falls.
const DEBRIS = { halfKm: 8, resKm: 0.25, levelsM: [0, 300, 700, 1200, 2000, 3200, 5000, 7500] };
function loftDebris(model, alloc = plainAlloc) {
  const { su, sv, tornado, mesocyclone: meso, spin } = model, D = DEBRIS, n = Math.round(2 * D.halfKm / D.resKm) + 1, levels = D.levelsM.length;
  const field = alloc(Float32Array, n * n * levels), wind = tornado.windMs;
  // A weak tornado lofts little, and only to the cloud base; a violent one to several kilometres.
  const topM = clamp(900 + 60 * (wind - 30), 800, 6000), amount = clamp((wind - 29) / 54, 0.15, 1.3) ** 2;
  const depth = D.levelsM.map((z, k) => (D.levelsM[Math.min(levels - 1, k + 1)] - D.levelsM[Math.max(0, k - 1)]) / 2000);
  for (let p = 0; p < FOLLOWED.debris; p++) {
    const random = mulberry32(hash3(model.seed, 77, p));
    const startR = Math.max(0.12, tornado.radiusKm) * Math.sqrt(random()), startAngle = 2 * Math.PI * random();
    let x = tornado.x + startR * Math.cos(startAngle), y = tornado.y + startR * Math.sin(startAngle), z = 0, age = 0;
    // Most debris is light and soon dropped; a little is carried to the top.
    const reachM = topM * random() ** 1.6, liftMs = 12 + 0.3 * wind, fallMs = 5 + 12 * random(), outwardMs = 2 + 6 * random();
    const driftU = (random() + random() - 1) * 4, driftV = (random() + random() - 1) * 4;
    let rising = true;
    for (let step = 0; step < 220; step++) {
      const zi = Math.min(WIND_PROFILE_LEVELS - 1, (z / WIND_PROFILE_STEP_M) | 0);
      let u = su[zi] + driftU, v = sv[zi] + driftV;
      const dx = x - tornado.x, dy = y - tornado.y, r = Math.hypot(dx, dy);
      if (r > 1e-3) {
        const around = tornado.vmaxMs * spin * (r < tornado.radiusKm ? r / tornado.radiusKm : (tornado.radiusKm / r) ** 0.8) * Math.max(0, 1 - z / (topM * 1.2)) * 0.5;
        u += around * dy / r + outwardMs * dx / r; v += around * dx / r - outwardMs * dy / r;
      }
      const mdx = x - meso.x, mdy = y - meso.y, mr = Math.hypot(mdx, mdy);
      if (mr > 1e-3) { const around = meso.vmaxMs * spin * 0.6 * (mr < meso.radiusKm ? mr / meso.radiusKm : (meso.radiusKm / mr) ** 0.8); u += around * mdy / mr; v += around * mdx / mr; }
      const vertical = rising ? liftMs : -fallMs, dt = clamp(Math.min(0.8 * D.resKm * 1000 / Math.max(1, Math.hypot(u, v)), 150 / Math.abs(vertical)), 2, 30);
      const i = ((x - tornado.x + D.halfKm) / D.resKm + 0.5) | 0, j = ((y - tornado.y + D.halfKm) / D.resKm + 0.5) | 0;
      if (i < 0 || j < 0 || i >= n || j >= n) break;
      let k = 0; while (k < levels - 2 && D.levelsM[k + 1] <= z) k++;
      const t = clamp((z - D.levelsM[k]) / (D.levelsM[k + 1] - D.levelsM[k]), 0, 1), at = (k * n + j) * n + i;
      field[at] += dt * (1 - t) / depth[k]; field[at + n * n] += dt * t / depth[k + 1];
      x += u * dt / 1000; y -= v * dt / 1000; z += vertical * dt; age += dt;
      if (rising && z >= reachM) rising = false;
      if (z <= 0 && !rising) break;
    }
  }
  const scale = amount / (FOLLOWED.debris * D.resKm * D.resKm);
  for (let at = 0; at < field.length; at++) field[at] *= scale;
  return { field, n, halfKm: D.halfKm, resKm: D.resKm, levelsM: D.levelsM, x: tornado.x, y: tornado.y, topM };
}

// Reflectivity (mm6/m3) of a unit of the grid's rain, hail and debris amounts; and the least
// reflectivity kept (-5 dBZ).
export const RAIN_REFLECTIVITY = 1600, HAIL_REFLECTIVITY = 1600, DEBRIS_REFLECTIVITY = 1600;
const THINNEST_DBZ_UNITS = 10 ** -0.5;

// The amounts at one place: rain (as reflectivity of the liquid), its reflectivity-weighted
// drop size (mm), the share of it that is snow or was, and hail. False where the storm has none.
export function samplePrecipitation(echo, dx, dy, zM, out) {
  out.rain = 0; out.sizeMm = 0; out.snow = 0; out.hail = 0;
  if (!echo.grid || zM > PRECIP_LEVELS_M[LEVELS - 1] + 1500) return false;
  const zc = zM < 0 ? 0 : Math.min(zM, PRECIP_LEVELS_M[LEVELS - 1] - 1), k = LEVEL_BELOW[(zc / LEVEL_STEP_M) | 0], tz = (zc - PRECIP_LEVELS_M[k]) / (PRECIP_LEVELS_M[k + 1] - PRECIP_LEVELS_M[k]);
  // How far inside the finer inner grid this place is (0 outside it, 1 well inside).
  const within = echo.inner ? clamp((INNER.halfKm - INNER.edgeKm - Math.max(Math.abs(dx), Math.abs(dy))) / INNER.blendKm, 0, 1) : 0;
  if (within > 0) addSample(echo.inner, dx, dy, k, tz, within, out);
  if (within < 1) addSample(echo.grid, dx, dy, k, tz, 1 - within, out);
  if (out.rain > 0) { out.sizeMm /= out.rain; out.snow = Math.min(1, out.snow / out.rain); }
  return out.rain > 0 || out.hail > 0;
}
function addSample(grid, dx, dy, k, tz, weight, out) {
  const fx = (dx - grid.x0) * grid.perKm, fy = (dy - grid.y0) * grid.perKm, nx = grid.nx, ny = grid.ny;
  if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return;
  const i = Math.min(nx - 2, fx | 0), j = Math.min(ny - 2, fy | 0), tx = fx - i, ty = fy - j;
  if (!grid.any[j * nx + i]) return;
  const a = k * grid.plane + j * nx + i, b = a + grid.plane;
  const w00 = (1 - tx) * (1 - ty) * weight, w10 = tx * (1 - ty) * weight, w01 = (1 - tx) * ty * weight, w11 = tx * ty * weight, lower = 1 - tz;
  let f = grid.rain;
  const rain = (f[a] * w00 + f[a + 1] * w10 + f[a + nx] * w01 + f[a + nx + 1] * w11) * lower + (f[b] * w00 + f[b + 1] * w10 + f[b + nx] * w01 + f[b + nx + 1] * w11) * tz;
  if (rain > 0) {
    out.rain += rain;
    f = grid.size; out.sizeMm += (f[a] * w00 + f[a + 1] * w10 + f[a + nx] * w01 + f[a + nx + 1] * w11) * lower + (f[b] * w00 + f[b + 1] * w10 + f[b + nx] * w01 + f[b + nx + 1] * w11) * tz;
    f = grid.snow; out.snow += (f[a] * w00 + f[a + 1] * w10 + f[a + nx] * w01 + f[a + nx + 1] * w11) * lower + (f[b] * w00 + f[b + 1] * w10 + f[b + nx] * w01 + f[b + nx + 1] * w11) * tz;
  }
  f = grid.hail;
  if (f) out.hail += (f[a] * w00 + f[a + 1] * w10 + f[a + nx] * w01 + f[a + nx + 1] * w11) * lower + (f[b] * w00 + f[b + 1] * w10 + f[b + nx] * w01 + f[b + nx + 1] * w11) * tz;
}

// Whether the storm has anything above a place (or right beside it).
export function hasPrecipitation(echo, dx, dy) {
  if (dx < echo.minX || dy < echo.minY || dx > echo.maxX || dy > echo.maxY) return false;
  const grid = echo.grid;
  if (grid) {
    const i = ((dx - grid.x0) * grid.perKm + 0.5) | 0, j = ((dy - grid.y0) * grid.perKm + 0.5) | 0;
    if (i >= 0 && j >= 0 && i < grid.nx && j < grid.ny && grid.any[j * grid.nx + i]) return true;
  }
  const d = echo.debris;
  return Boolean(d) && Math.abs(dx - d.x) < d.halfKm && Math.abs(dy - d.y) < d.halfKm;
}

// Debris amount at one place (0 away from the tornado).
export function sampleDebris(echo, dx, dy, zM) {
  const d = echo.debris;
  if (!d || zM > d.topM * 1.3) return 0;
  const fx = (dx - d.x + d.halfKm) / d.resKm, fy = (dy - d.y + d.halfKm) / d.resKm, n = d.n;
  if (fx < 0 || fy < 0 || fx > n - 1 || fy > n - 1) return 0;
  const i = Math.min(n - 2, fx | 0), j = Math.min(n - 2, fy | 0), tx = fx - i, ty = fy - j, levels = d.levelsM;
  let k = 0; while (k < levels.length - 2 && levels[k + 1] <= zM) k++;
  const tz = clamp((zM - levels[k]) / (levels[k + 1] - levels[k]), 0, 1), a = (k * n + j) * n + i, b = a + n * n, f = d.field;
  return ((f[a] * (1 - tx) + f[a + 1] * tx) * (1 - ty) + (f[a + n] * (1 - tx) + f[a + n + 1] * tx) * ty) * (1 - tz)
    + ((f[b] * (1 - tx) + f[b + 1] * tx) * (1 - ty) + (f[b + n] * (1 - tx) + f[b + n + 1] * tx) * ty) * tz;
}

// How heavy the rain is (0-1) at one place near the ground ('low'), at mid levels ('middle') or
// near the storm's top ('aloft'), and which way it increases (per km): outflow runs away from
// the heavy rain near the ground, and the anvil's air away from the updraught's top.
export function sampleHeaviness(echo, layer, dx, dy) {
  const grid = echo.grid;
  if (!grid) return 0;
  const fx = (dx - grid.x0) / grid.res, fy = (dy - grid.y0) / grid.res, nx = grid.nx, ny = grid.ny;
  if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return 0;
  const i = Math.min(nx - 2, fx | 0), j = Math.min(ny - 2, fy | 0), tx = fx - i, ty = fy - j, f = grid[layer], a = j * nx + i;
  return (f[a] * (1 - tx) + f[a + 1] * tx) * (1 - ty) + (f[a + nx] * (1 - tx) + f[a + nx + 1] * tx) * ty;
}
export function heavinessGradient(echo, layer, dx, dy, out) {
  const h = Math.max(1, echo.grid?.res ?? 1);
  out.x = (sampleHeaviness(echo, layer, dx + h, dy) - sampleHeaviness(echo, layer, dx - h, dy)) / (2 * h);
  out.y = (sampleHeaviness(echo, layer, dx, dy + h) - sampleHeaviness(echo, layer, dx, dy - h)) / (2 * h);
  return out;
}

// Smooth variation in time (0-1), fixed for a given seed.
function noise1(seed, t) {
  const t0 = Math.floor(t), f = t - t0, s = f * f * (3 - 2 * f);
  return hash3(seed, t0, 17, 3) / 4294967296 * (1 - s) + hash3(seed, t0 + 1, 17, 3) / 4294967296 * s;
}
function hash3(seed, a, b, c = 0) {
  let h = (seed ^ Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
function hashString(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h | 0; }
function mulberry32(a) {
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
