// Simulated Doppler/dual-pol radar. Radar never creates weather: every echo is derived
// from where each storm's precipitation is (PrecipitationField.js: worked out from its
// updraughts and the wind through its depth), the environmental grid, analysed boundaries
// and the time of day. Output is a deterministic function of world state, site and tilt.
import {
  buildStormPrecipitation, samplePrecipitation, hasPrecipitation, sampleDebris, sampleHeaviness, heavinessGradient,
  RAIN_REFLECTIVITY, HAIL_REFLECTIVITY, DEBRIS_REFLECTIVITY, WIND_PROFILE_STEP_M, WIND_PROFILE_LEVELS, MESOCYCLONE_LEAN_M, FRONT_TO_REAR_BASE_M, frontToRearShare
} from './PrecipitationField.js';
import {
  RADAR_RADIALS, RADAR_GATES, RADAR_GATE_KM, RADAR_RANGE_KM, RADAR_TILTS_DEG, RADAR_BEAMWIDTH_DEG, RADAR_ANTENNA_HEIGHT_M,
  RADAR_PRODUCT_KEYS, beamHeightKm, groundRangeKm, encodeRadarValue
} from './RadarFormat.js';

const KT_TO_MS = 0.514444;
const STORM_BIN_KM = 10;
const BOUNDARY_BIN_KM = 20;
const DEG = Math.PI / 180;

// Seven radars over the ~805 km domain, placed unevenly as real networks are. Two areas are
// poorly covered: the far west-centre, where the nearest radars are 230 km and more away (a
// strip along the edge has no radar at all), and the south-centre, which three radars reach
// only with beams 3 km and more above the ground. About a fifth of the map has no view of
// the lowest 3 km; storms there show their upper parts only.
const SITE_LAYOUT = [
  { id: 'KNWP', name: 'Northwest Plains', fx: 0.14, fy: 0.20 },
  { id: 'KNCP', name: 'North Central Plains', fx: 0.52, fy: 0.14 },
  { id: 'KNEP', name: 'Northeast Plains', fx: 0.86, fy: 0.22 },
  { id: 'KCPL', name: 'Central Plains', fx: 0.44, fy: 0.50 },
  { id: 'KECP', name: 'East Central Plains', fx: 0.80, fy: 0.58 },
  { id: 'KSWP', name: 'Southwest Plains', fx: 0.20, fy: 0.82 },
  { id: 'KSEP', name: 'Southeast Plains', fx: 0.72, fy: 0.88 }
];

// What a radar cannot do. Its beam is about a degree wide, so what one gate reports is an
// average over a volume that grows with range: BEAM_OFFSETS are where that volume is sampled
// (in units of 0.35 beamwidths, across and up) and with what weight. Every estimate also
// carries measurement noise, more where the echo is weak.
const BEAM_OFFSETS = [[-1, 0.25], [0, 0.5], [1, 0.25]], BEAM_CENTRE = [[0, 1]];
// Across the beam a single-site scan gets the same three samples from its own neighbouring
// radials: the outer samples lie this share of the way to the next radial.
const ACROSS_SHARE = 0.35 * RADAR_BEAMWIDTH_DEG / (360 / RADAR_RADIALS);
const NEIGHBOUR_WEIGHT = BEAM_OFFSETS[0][1] * Math.min(1, ACROSS_SHARE), OWN_WEIGHT = 1 - 2 * NEIGHBOUR_WEIGHT;
// Per-gate sums of one scan before blending and noise (reused between scans).
const gateSums = { zh: null, zv: null, cc: null, stormRadial: null, envRadial: null };
const NOISE = { dbz: 0.8, velocityMs: 0.9, correlation: 0.008, zdrDb: 0.18 };
// A tornado's wind is as deep as the tornado is strong: a weak one is seen only in the lowest
// kilometre; a violent one reaches several kilometres.
const tornadoDepthM = windMs => clamp(800 + 36 * (windMs - 30), 700, 3500);
// Outflow near the ground and at the anvil (m/s per unit change of rain heaviness in a km), and
// the rear-inflow jet behind a line at its strongest (m/s).
const STORM_WINDS = { outflow: 110, anvil: 90, rearInflowMs: 24 };
// Flow into a boundary (m/s) that doubles the insects along it, how much (dB) they vary along it,
// and the depth of the denser air pushing under the other (m).
const FINE_LINE_INFLOW_MS = 0.4, FINE_LINE_PATCHY_DB = 4, DENSITY_CURRENT_DEPTH_M = 1000;

export function createRadarSites(world) {
  const widthKm = world.width * world.cellSizeKm, heightKm = world.height * world.cellSizeKm;
  return SITE_LAYOUT.map(({ id, name, fx, fy }) => {
    const xKm = fx * widthKm, yKm = fy * heightKm;
    const cell = world.getCell(Math.floor(xKm / world.cellSizeKm), Math.floor(yKm / world.cellSizeKm));
    return { id, name, xKm, yKm, elevationM: Number(cell?.terrain?.elevationM) || 0 };
  });
}

// ---------------------------------------------------------------------------
// Scene: everything a scan samples, extracted once per world revision. It is made in three
// steps so the storms can be worked out on several threads: what the scene is made from (plain
// data), each storm's precipitation, and the scene put together from them.

export function buildRadarScene(world) {
  const inputs = radarSceneInputs(world);
  return assembleRadarScene(inputs, inputs.storms.map(input => buildStormEcho(input)));
}

// One storm's precipitation (PrecipitationField.js). shared: in memory other threads can read.
export function buildStormEcho({ storm, top, freezing, su, sv }, { shared = false } = {}) {
  return buildStormPrecipitation(storm, { topM: top, freezingM: freezing, su, sv }, { shared });
}

export function radarSceneInputs(world) {
  const w = world.width, h = world.height, cs = world.cellSizeKm, n = w * h;
  const env = {
    w, h, cs,
    terrain: new Float32Array(n), freezing: new Float32Array(n), top: new Float32Array(n), blDepth: new Float32Array(n),
    // Virtual temperature at the surface (K): how dense the air is, for the boundaries.
    virtualK: new Float32Array(n),
    // Wind profile per cell at surface, 850, 700, 500, 250 hPa: heights AGL (m) and u/v (m/s, east/north).
    levelHeight: Array.from({ length: 5 }, () => new Float32Array(n)),
    levelU: Array.from({ length: 5 }, () => new Float32Array(n)),
    levelV: Array.from({ length: 5 }, () => new Float32Array(n))
  };
  world.forEachCell((cell, x, y) => {
    const i = y * w + x, elev = Number(cell.terrain?.elevationM) || 0;
    env.terrain[i] = elev;
    const levels = [
      { hMsl: elev + 10, dir: cell.surface.wind.direction, spd: cell.surface.wind.speed, t: (cell.surface.temperature - 32) * 5 / 9 },
      { hMsl: 1500, ...levelWind(cell.levels[850]) },
      { hMsl: 3010, ...levelWind(cell.levels[700]) },
      { hMsl: (cell.levels[500].heightDm || 570) * 10, ...levelWind(cell.levels[500]) },
      { hMsl: (cell.levels[250].heightDm || 1040) * 10, ...levelWind(cell.levels[250]) }
    ];
    let previousH = 0;
    levels.forEach((level, k) => {
      const hAgl = Math.max(previousH + 50, level.hMsl - elev);
      previousH = hAgl;
      env.levelHeight[k][i] = hAgl;
      env.levelU[k][i] = -Math.sin(level.dir * DEG) * level.spd * KT_TO_MS;
      env.levelV[k][i] = -Math.cos(level.dir * DEG) * level.spd * KT_TO_MS;
    });
    env.freezing[i] = freezingLevelAgl(levels.map((level, k) => ({ h: env.levelHeight[k][i], t: level.t })));
    const elAgl = Number(cell.derived?.sounding?.elM) - elev;
    env.top[i] = Number.isFinite(elAgl) && elAgl > 0 ? clamp(elAgl, 3000, 16500) : 11000;
    env.blDepth[i] = clamp(Number(cell.mesoscaleFields?.boundaryLayerDepthM) || 1200, 300, 3000);
    env.virtualK[i] = virtualTemperatureK(levels[0].t, (Number(cell.surface.dewpoint) - 32) * 5 / 9);
  });

  const storms = [], wind = { u: 0, v: 0 };
  for (const storm of world.storms ?? []) {
    if (storm.active === false || !storm.structure) continue;
    const x = storm.positionKm.x, y = storm.positionKm.y;
    const motion = { u: (storm.velocityKph?.east ?? 0) / 3.6, v: (storm.velocityKph?.north ?? 0) / 3.6 };
    // Echo tops reach the equilibrium level (plus overshoot) in vigorous storms.
    const updraft = clamp(Math.max(Number(storm.updraftStrength) || 0, (Number(storm.intensity) || 0) * 1.3), 0, 1);
    const top = envSample(env, env.top, x, y) * (0.6 + 0.48 * updraft), freezing = envSample(env, env.freezing, x, y);
    // The wind through the storm's depth, relative to the storm: what carries its rain.
    const su = new Float32Array(WIND_PROFILE_LEVELS), sv = new Float32Array(WIND_PROFILE_LEVELS);
    for (let k = 0; k < WIND_PROFILE_LEVELS; k++) { envWindAt(env, x, y, k * WIND_PROFILE_STEP_M, wind); su[k] = wind.u - motion.u; sv[k] = wind.v - motion.v; }
    storms.push({ storm, x, y, motion, top, freezing, su, sv, seed: hashString(String(storm.id)), weight: clamp(Number(storm.intensity) || 0, 0, 1) });
  }

  const validHourUtc = Number(world.stormEngine?.validHourUtc ?? world.validHourUtc), localHour = mod24(validHourUtc - 6);
  // Fine lines: insects hold their height in rising air, so they pile up where the air flows
  // together along a boundary. How many more there are than around them goes with how fast air
  // flows into it: the change in the wind across it, or, where the grid is too coarse to show
  // that, the speed the denser air on one side pushes under the other (a density current). How
  // many there are to begin with goes with the time of day, as for the insects everywhere else.
  const boundaries = [], insectZ = 10 ** (biologicalDbz(localHour) / 10), across = { u: 0, v: 0 }, behind = { u: 0, v: 0 };
  for (const boundary of world.mesoscale?.boundaries ?? []) {
    if (boundary.active === false) continue;
    // The analysed line is a few straight pieces; the insects along it follow a smooth curve,
    // thicker in some stretches than others.
    const points = roundCorners(roundCorners(boundary.pointsKm ?? [])), seed = hashString(String(boundary.id ?? boundary.type));
    let along = 0;
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k], b = points[k + 1], length = Math.hypot(b.x - a.x, b.y - a.y), patchy = fbm(seed, along / 18, 0.5, 0);
      along += length;
      if (length < 1e-6) continue;
      // Across the piece, a grid cell out each way: the wind toward it (m/s), and the difference in density.
      const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = cs;
      envWindAt(env, mx + nx * d, my + ny * d, 0, across); envWindAt(env, mx - nx * d, my - ny * d, 0, behind);
      const windShift = -((across.u - behind.u) * nx - (across.v - behind.v) * ny);
      const warmer = envSample(env, env.virtualK, mx + nx * d, my + ny * d), colder = envSample(env, env.virtualK, mx - nx * d, my - ny * d);
      const densityCurrent = Math.sqrt(9.81 * DENSITY_CURRENT_DEPTH_M * Math.abs(warmer - colder) / (0.5 * (warmer + colder)));
      const inflow = Math.max(windShift, densityCurrent);
      if (!(inflow > 0)) continue;
      const z = insectZ * inflow / FINE_LINE_INFLOW_MS * 10 ** (FINE_LINE_PATCHY_DB * patchy / 10);
      boundaries.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, z, widthKm: 1.2 * (1 + 0.4 * fbm(seed + 5, along / 30, 0.5, 0)) });
    }
  }

  return { validHourUtc, localHour, domainWidthKm: w * cs, domainHeightKm: h * cs, env, storms, boundaries };
}

// echoes: buildStormEcho's result for each of inputs.storms, in order.
export function assembleRadarScene(inputs, echoes) {
  const { validHourUtc, localHour, domainWidthKm, domainHeightKm, env, boundaries } = inputs, storms = [];
  inputs.storms.forEach(({ x, y, motion, top, freezing, seed, weight }, k) => {
    const echo = echoes[k];
    if (echo) storms.push({ x, y, echo, motion, top, freezing, seed, tornadoDepthM: tornadoDepthM(echo.tornado?.windMs ?? 0), weight });
  });
  const scene = {
    validHourUtc, localHour, domainWidthKm, domainHeightKm, env, storms, boundaries,
    stormBins: binItems(storms, STORM_BIN_KM, domainWidthKm, domainHeightKm, s => [s.x + s.echo.minX, s.y + s.echo.minY, s.x + s.echo.maxX, s.y + s.echo.maxY]),
    boundaryBins: binItems(boundaries, BOUNDARY_BIN_KM, domainWidthKm, domainHeightKm, b =>
      [Math.min(b.ax, b.bx) - 4, Math.min(b.ay, b.by) - 4, Math.max(b.ax, b.bx) + 4, Math.max(b.ay, b.by) + 4]),
    stormMotion: meanStormMotion(storms, env, domainWidthKm / 2, domainHeightKm / 2, Infinity)
  };
  return scene;
}

// ---------------------------------------------------------------------------
// Scan: one tilt of one site, all products at once.

export function scanRadarTilt(scene, site, tiltDeg) {
  const started = globalThis.performance?.now?.() ?? Date.now();
  const total = RADAR_RADIALS * RADAR_GATES;
  const products = Object.fromEntries(RADAR_PRODUCT_KEYS.map(key => [key, new Uint8Array(total)]));
  const ref = products.reflectivity, vel = products.velocity, srv = products.stormRelativeVelocity;
  const cc = products.correlationCoefficient, zdr = products.differentialReflectivity;
  const sample = { zh: 0, zv: 0, cc: 0 }, wind = { u: 0, v: 0 }, stormWind = { u: 0, v: 0 }, clearAir = { bl: 0, bioZ: 0 };
  const bioZ = 10 ** (biologicalDbz(scene.localHour) / 10);
  const beamHalfWidth = RADAR_BEAMWIDTH_DEG * DEG * 0.35;
  const cosTilt = Math.cos(tiltDeg * DEG);
  const siteHeightM = site.elevationM + RADAR_ANTENNA_HEIGHT_M;
  // Storm-relative velocity takes off the motion of the storms this radar can see.
  const stormMotion = meanStormMotion(scene.storms, scene.env, site.xKm, site.yKm, RADAR_RANGE_KM), su = stormMotion.u, sv = stormMotion.v;
  // Noise differs from scan to scan and from product to product.
  const noiseSalt = tiltDeg + (Math.round(scene.validHourUtc * 12) % 4096) * 0.017;
  const gateGeometry = Array.from({ length: RADAR_GATES }, (_, g) => {
    const range = (g + 0.5) * RADAR_GATE_KM;
    return { range, ground: groundRangeKm(range, tiltDeg), heightM: beamHeightKm(range, tiltDeg) * 1000, spreadM: range * beamHalfWidth * 1000, minDbz: -32 + 20 * Math.log10(range) };
  });

  for (const key of Object.keys(gateSums)) (gateSums[key] ??= new Float32Array(total)).fill(0);
  const sumZh = gateSums.zh, sumZv = gateSums.zv, sumCc = gateSums.cc, sumStorm = gateSums.stormRadial, envRadial = gateSums.envRadial;

  // 1. Each radial on its own: the beam's depth (three samples up through it), and what the
  // echoes in it are doing. Velocity is weighted by how strongly each part reflects.
  for (let r = 0; r < RADAR_RADIALS; r++) {
    const az = (r + 0.5) * (360 / RADAR_RADIALS) * DEG, sinAz = Math.sin(az), cosAz = Math.cos(az);
    for (let g = 0; g < RADAR_GATES; g++) {
      const geo = gateGeometry[g];
      const x = site.xKm + geo.ground * sinAz, y = site.yKm - geo.ground * cosAz;
      if (x < 0 || y < 0 || x >= scene.domainWidthKm || y >= scene.domainHeightKm) continue;
      const terrain = envSample(scene.env, scene.env.terrain, x, y);
      const centerAgl = siteHeightM + geo.heightM - terrain;
      if (centerAgl < 0) continue; // terrain blockage
      clearAir.bl = envSample(scene.env, scene.env.blDepth, x, y);
      clearAir.bioZ = centerAgl - geo.spreadM < clearAir.bl * 1.3
        ? bioZ * (0.4 + 0.9 * (fbm(911, x / 4, y / 4, scene.validHourUtc) * 0.5 + 0.5)) : 0;
      const inStorm = binAt(scene.stormBins, x, y) !== null;
      let zh = 0, zv = 0, ccw = 0, stormRadial = 0;
      for (const [k, wgt] of BEAM_OFFSETS) {
        const agl = centerAgl + k * geo.spreadM;
        if (agl < 0) continue;
        sampleVolume(scene, x, y, agl, sample, clearAir);
        zh += sample.zh * wgt; zv += sample.zv * wgt; ccw += sample.cc * wgt;
        if (inStorm && sample.zh > 0) { stormWindAt(scene, x, y, agl, stormWind); stormRadial += sample.zh * wgt * (stormWind.u * sinAz + stormWind.v * cosAz); }
      }
      if (zh <= 0) continue;
      const index = r * RADAR_GATES + g;
      sumZh[index] = zh; sumZv[index] = zv; sumCc[index] = ccw; sumStorm[index] = stormRadial;
      envWindAt(scene.env, x, y, centerAgl, wind);
      envRadial[index] = wind.u * sinAz + wind.v * cosAz;
    }
  }

  // 2. The beam's width: each gate takes in part of its neighbours on either side, a wider
  // strip of the storm the farther out it is. Then the measurement's own noise.
  for (let r = 0; r < RADAR_RADIALS; r++) {
    const az = (r + 0.5) * (360 / RADAR_RADIALS) * DEG, sinAz = Math.sin(az), cosAz = Math.cos(az);
    const left = ((r + RADAR_RADIALS - 1) % RADAR_RADIALS) * RADAR_GATES, right = ((r + 1) % RADAR_RADIALS) * RADAR_GATES;
    for (let g = 0; g < RADAR_GATES; g++) {
      const index = r * RADAR_GATES + g, l = left + g, n = right + g;
      const zh = OWN_WEIGHT * sumZh[index] + NEIGHBOUR_WEIGHT * (sumZh[l] + sumZh[n]);
      if (zh <= 0) continue;
      const snr = 10 * Math.log10(zh) - gateGeometry[g].minDbz;
      if (snr < 0) continue;
      const zv = OWN_WEIGHT * sumZv[index] + NEIGHBOUR_WEIGHT * (sumZv[l] + sumZv[n]), ccw = OWN_WEIGHT * sumCc[index] + NEIGHBOUR_WEIGHT * (sumCc[l] + sumCc[n]);
      const stormRadial = OWN_WEIGHT * sumStorm[index] + NEIGHBOUR_WEIGHT * (sumStorm[l] + sumStorm[n]);
      // The wind of the air itself varies little across a beam; where this radial saw nothing, its neighbours' is used.
      const air = sumZh[index] > 0 ? envRadial[index] : sumZh[l] > 0 ? envRadial[l] : envRadial[n];
      const lowSnr = Math.exp(-snr / 6);
      const noise = gateNoise(index, noiseSalt) * 2 - 1, velocityNoise = gateNoise(index, noiseSalt + 0.003) * 2 - 1, polarNoise = gateNoise(index, noiseSalt + 0.006) * 2 - 1;
      ref[index] = encodeRadarValue('reflectivity', 10 * Math.log10(zh) + noise * (NOISE.dbz + 1.6 * lowSnr));
      const radial = (air + stormRadial / zh) * cosTilt + velocityNoise * (NOISE.velocityMs + 1.2 * lowSnr);
      vel[index] = encodeRadarValue('velocity', radial);
      srv[index] = encodeRadarValue('stormRelativeVelocity', radial - (su * sinAz + sv * cosAz) * cosTilt);
      cc[index] = encodeRadarValue('correlationCoefficient', ccw / zh - Math.abs(polarNoise) * (NOISE.correlation + 0.22 * lowSnr));
      zdr[index] = encodeRadarValue('differentialReflectivity', 10 * Math.log10(zh / Math.max(1e-12, zv)) + polarNoise * (NOISE.zdrDb + 0.9 * lowSnr));
    }
  }
  return {
    siteId: site.id, tiltDeg, validHourUtc: scene.validHourUtc, stormMotion, products,
    buildMs: (globalThis.performance?.now?.() ?? Date.now()) - started
  };
}

// Network mosaic of composite reflectivity on a Cartesian grid: the strongest echo any tilt of
// the nearest radar finds above each place, as national mosaics show. Where that radar sees
// nothing (its beams blocked, or too high and too wide by then) the next radar is used. Far
// from every radar the lowest beam is already kilometres up, so a storm there shows only its
// upper parts. One byte per cell, row-major.
export const MOSAIC_RES_KM = 1;
const MOSAIC_CEILING_M = 19000;
export const mosaicSize = scene => ({ width: Math.ceil(scene.domainWidthKm / MOSAIC_RES_KM), height: Math.ceil(scene.domainHeightKm / MOSAIC_RES_KM) });
// rows: [first, end) builds only those rows (bytes then holds just them), so threads can share the work.
export function buildRadarMosaic(scene, sites, { rows = null } = {}) {
  const started = globalThis.performance?.now?.() ?? Date.now();
  const { width, height } = mosaicSize(scene), [firstRow, endRow] = rows ?? [0, height];
  const bytes = new Uint8Array(width * (endRow - firstRow));
  const sample = { zh: 0, zv: 0, cc: 0 }, clearAir = { bl: 0, bioZ: 0 };
  const bioZ = 10 ** (biologicalDbz(scene.localHour) / 10);
  const tilts = RADAR_TILTS_DEG.map(deg => ({ deg, cos: Math.cos(deg * DEG) }));
  const maxGround = groundRangeKm(RADAR_RANGE_KM, tilts[0].deg), beamHalfWidth = RADAR_BEAMWIDTH_DEG * DEG * 0.35;
  const noiseSalt = 77 + (Math.round(scene.validHourUtc * 12) % 4096) * 0.017;
  const candidates = [];
  for (let j = firstRow; j < endRow; j++) for (let i = 0; i < width; i++) {
    const x = (i + 0.5) * MOSAIC_RES_KM, y = (j + 0.5) * MOSAIC_RES_KM;
    // Up to three in-range radars, nearest first (insertion into a short list).
    candidates.length = 0;
    for (const site of sites) {
      const ground = Math.hypot(x - site.xKm, y - site.yKm);
      if (ground > maxGround) continue;
      let k = candidates.length;
      while (k > 0 && candidates[k - 1].ground > ground) k--;
      if (k < 3) { candidates.splice(k, 0, { site, ground }); if (candidates.length > 3) candidates.pop(); }
    }
    if (!candidates.length) continue;
    const terrain = envSample(scene.env, scene.env.terrain, x, y);
    clearAir.bl = envSample(scene.env, scene.env.blDepth, x, y);
    // Only where a storm stands is there anything for the higher tilts to find.
    const bin = binAt(scene.stormBins, x, y);
    let ceiling = 0;
    if (bin) for (const s of bin) if (hasPrecipitation(s.echo, x - s.x, y - s.y)) ceiling = Math.max(ceiling, s.top * 1.15);
    const stormBin = ceiling > 0;
    for (const { site, ground } of candidates) {
      const tx = -(y - site.yKm) / Math.max(ground, 1e-6), ty = (x - site.xKm) / Math.max(ground, 1e-6);
      let most = 0, mostSnr = 0;
      for (let t = 0; t < (stormBin ? tilts.length : 1); t++) {
        const range = ground / tilts[t].cos;
        if (range > RADAR_RANGE_KM) break;
        const spread = range * beamHalfWidth * 1000, spreadKm = spread / 1000;
        const agl = site.elevationM + RADAR_ANTENNA_HEIGHT_M + beamHeightKm(range, tilts[t].deg) * 1000 - terrain;
        if (agl < 0) continue;
        if (agl - spread > Math.min(MOSAIC_CEILING_M, Math.max(ceiling, clearAir.bl * 1.3))) break;
        clearAir.bioZ = t === 0 && agl - spread < clearAir.bl * 1.3 ? bioZ * (0.4 + 0.9 * (fbm(911, x / 4, y / 4, scene.validHourUtc) * 0.5 + 0.5)) : 0;
        // The same beam volume as the single-site scans, once the beam is wider than a cell or deeper than a level of the storm.
        const across = stormBin && spreadKm > MOSAIC_RES_KM ? BEAM_OFFSETS : BEAM_CENTRE, up = spread > 400 ? BEAM_OFFSETS : BEAM_CENTRE;
        let zh = 0;
        for (const [a, acrossWeight] of across) for (const [k, upWeight] of up) {
          const z = agl + k * spread;
          if (z < 0) continue;
          sampleVolume(scene, x + a * spreadKm * tx, y + a * spreadKm * ty, z, sample, clearAir);
          zh += sample.zh * acrossWeight * upWeight;
        }
        if (zh <= most) continue;
        const snr = 10 * Math.log10(zh) - (-32 + 20 * Math.log10(Math.max(range, 0.5)));
        if (snr < 0) continue;
        most = zh; mostSnr = snr;
      }
      if (most <= 0) continue;
      const noise = gateNoise(j * width + i, noiseSalt) * 2 - 1;
      bytes[(j - firstRow) * width + i] = encodeRadarValue('reflectivity', 10 * Math.log10(most) + noise * (NOISE.dbz + 1.6 * Math.exp(-mostSnr / 6)));
      break;
    }
  }
  return { width, height, rows: [firstRow, endRow], resKm: MOSAIC_RES_KM, composite: true, validHourUtc: scene.validHourUtc, bytes, buildMs: (globalThis.performance?.now?.() ?? Date.now()) - started };
}

// ---------------------------------------------------------------------------
// Volume sampling: linear Zh, Zv (for ZDR) and Zh-weighted ρhv at one point.

const tmp = {};
function sampleVolume(scene, x, y, agl, out, clearAir) {
  out.zh = 0; out.zv = 0; out.cc = 0;
  const stormBin = binAt(scene.stormBins, x, y);
  if (stormBin) for (const s of stormBin) stormHydrometeors(s, x - s.x, y - s.y, agl, out);
  clearAirEchoes(scene, x, y, agl, out, clearAir);
}

function addEcho(out, zh, zdrDb, rho) {
  if (!(zh > 0)) return;
  out.zh += zh; out.zv += zh / 10 ** (zdrDb / 10); out.cc += zh * rho;
}

// A storm's precipitation at one place, as a radar sees it: rain below the freezing level, ice
// above (which reflects a fifth as well), a bright band where snow melts, hail, and debris.
function stormHydrometeors(s, lx, ly, z, out) {
  const e = s.echo, fz = s.freezing;
  if (lx < e.minX || ly < e.minY || lx > e.maxX || ly > e.maxY) return;
  if (samplePrecipitation(e, lx, ly, z, tmp)) {
    const frozen = smoothstep(fz - 300, fz + 700, z);
    if (tmp.rain > 0) {
      const zh = RAIN_REFLECTIVITY * tmp.rain;
      // Large wet snowflakes just below the freezing level reflect like giant drops.
      const melting = tmp.snow * Math.exp(-(((z - fz + 150) / 350) ** 2));
      // Rain carried above the freezing level in a strong updraught: large drops among the ice.
      const column = frozen > 0 ? liquidAloft(e, lx, ly, z - fz) : 0;
      if (frozen < 1) addEcho(out, zh * (1 - frozen) * (1 + 1.5 * melting), clamp(0.8 * tmp.sizeMm - 0.5, 0.15, 4.5) + melting, 0.992 - 0.06 * melting);
      if (frozen > 0) addEcho(out, zh * frozen * 0.2 * (1 + 2 * column), 0.3 + 2.8 * column, 0.985 - 0.02 * column);
    }
    if (tmp.hail > 0) {
      const wet = 1 - frozen;
      addEcho(out, HAIL_REFLECTIVITY * tmp.hail * (0.35 + 0.65 * wet), 0.1 + 0.5 * wet, 0.92 - 0.06 * wet);
    }
  }
  const debris = sampleDebris(e, lx, ly, z);
  if (debris > 0) {
    const cell = Math.floor((lx + 99) * 7) * 977 + Math.floor((ly + 99) * 7);
    addEcho(out, DEBRIS_REFLECTIVITY * debris, (gateNoise(cell, s.seed) - 0.5) * 2, 0.25 + 0.35 * gateNoise(cell, s.seed + 0.5) ** 2);
  }
}

// How far a place above the freezing level is inside a strong updraught's column of lofted rain (0-1).
function liquidAloft(e, lx, ly, aboveM) {
  let most = 0;
  for (const core of e.cores) {
    if (aboveM > 2600 * core.w / 45) continue;
    const dx = lx - core.x, dy = ly - core.y, r2 = (dx * dx + dy * dy) / (core.R * core.R);
    if (r2 < 6) most = Math.max(most, smoothstep(0.35, 0.8, core.w / 45 * Math.exp(-r2)));
  }
  return most;
}

function clearAirEchoes(scene, x, y, z, out, { bl, bioZ }) {
  if (z > bl * 1.3) return;
  const depth = 1 - z / (bl * 1.3);
  // Insects concentrate in boundary convergence zones: fine lines along fronts,
  // drylines and outflow boundaries.
  const bin = binAt(scene.boundaryBins, x, y);
  if (bin) for (const b of bin) {
    const d = segmentDistance(x, y, b.ax, b.ay, b.bx, b.by);
    if (d < 4) addEcho(out, b.z * Math.exp(-((d / b.widthKm) ** 2)) * depth, 4.5, 0.45);
  }
  addEcho(out, bioZ * depth, 5.5, 0.38);
}

// What storms add to the environmental wind: mesocyclone and tornado vortices, outflow away
// from the heavy rain near the ground, the rear-inflow jet and the anvil's outflow near the top.
const gradient = {};
function stormWindAt(scene, x, y, z, out) {
  out.u = 0; out.v = 0;
  const bin = binAt(scene.stormBins, x, y);
  if (!bin) return;
  for (const s of bin) {
    const lx = x - s.x, ly = y - s.y, e = s.echo;
    if (lx < e.minX || ly < e.minY || lx > e.maxX || ly > e.maxY) continue;
    // Mesocyclone: strongest at mid levels, present down to the ground in mature supercells.
    const mesoDepth = 0.55 + 0.45 * Math.exp(-(((z - 4500) / 2600) ** 2));
    const lean = clamp(z / MESOCYCLONE_LEAN_M, 0, 1), meso = e.mesocyclone;
    addVortex(out, lx - meso.x - (meso.aloftX - meso.x) * lean, ly - meso.y - (meso.aloftY - meso.y) * lean, meso.radiusKm, e.spin * e.mesocyclone.vmaxMs * mesoDepth * (z > s.top ? 0.2 : 1), true);
    if (e.tornado && z < s.tornadoDepthM) addVortex(out, lx - e.tornado.x, ly - e.tornado.y, e.tornado.radiusKm, e.spin * e.tornado.vmaxMs * (1 - z / s.tornadoDepthM * 0.6));
    if (z < 1500) {
      // Rain-cooled air spreads away from the heavy rain: gust fronts, and the surge behind a hook.
      heavinessGradient(e, 'low', lx, ly, gradient);
      const k = STORM_WINDS.outflow * e.coldPool * (1 - z / 1500);
      out.u += -k * gradient.x; out.v += k * gradient.y;
    } else if (z > 0.7 * s.top) {
      heavinessGradient(e, 'aloft', lx, ly, gradient);
      const k = STORM_WINDS.anvil * clamp((z - 0.7 * s.top) / (0.3 * s.top), 0, 1);
      out.u += -k * gradient.x; out.v += k * gradient.y;
    }
    if (e.frontToRear > 0 && z > FRONT_TO_REAR_BASE_M && z < s.top) {
      // A mature line's front-to-rear current, through the rain it carries rearward.
      const current = e.frontToRear * frontToRearShare(z, s.top) * sampleHeaviness(e, 'middle', lx, ly);
      out.u += -current * e.mx; out.v += current * e.my;
    }
    if (e.rearInflow > 0.01 && z < 6000) {
      // Rear-inflow jet: air driven toward the leading line through the rain behind it, strongest about 2.5 km up.
      const jet = e.rearInflow * sampleHeaviness(e, 'middle', lx, ly) * Math.exp(-(((z - 2500) / 1800) ** 2));
      out.u += STORM_WINDS.rearInflowMs * jet * e.mx; out.v += -STORM_WINDS.rearInflowMs * jet * e.my;
    }
  }
}

// Rankine-like vortex, cyclonic for a positive speed; dx, dy in the screen frame (km). A
// mesocyclone's wind fades beyond about three of its radii (it is one storm's rotation, not the air's).
function addVortex(out, dx, dy, radiusKm, vmax, fades = false) {
  if (!vmax) return;
  const rho = Math.hypot(dx, dy);
  if (rho < 1e-3 || rho > radiusKm * 12) return;
  const vt = vmax * (rho < radiusKm ? rho / radiusKm : (radiusKm / rho) ** 0.8) / (fades ? 1 + (rho / (3 * radiusKm)) ** 3 : 1);
  // Counter-clockwise on a north-up map: east component dy/ρ, north component dx/ρ.
  out.u += vt * dy / rho;
  out.v += vt * dx / rho;
}

// ---------------------------------------------------------------------------
// Helpers

function envSample(env, array, x, y) {
  const gx = clamp(x / env.cs - 0.5, 0, env.w - 1), gy = clamp(y / env.cs - 0.5, 0, env.h - 1);
  const x0 = Math.min(env.w - 2, Math.floor(gx)), y0 = Math.min(env.h - 2, Math.floor(gy)), tx = gx - x0, ty = gy - y0;
  const i = y0 * env.w + x0;
  return (array[i] * (1 - tx) + array[i + 1] * tx) * (1 - ty) + (array[i + env.w] * (1 - tx) + array[i + env.w + 1] * tx) * ty;
}

function envWindAt(env, x, y, z, out) {
  let k = 0;
  while (k < 3 && z > envSample(env, env.levelHeight[k + 1], x, y)) k++;
  const h0 = envSample(env, env.levelHeight[k], x, y), h1 = envSample(env, env.levelHeight[k + 1], x, y);
  const t = clamp((z - h0) / Math.max(1, h1 - h0), 0, 1);
  out.u = lerp(envSample(env, env.levelU[k], x, y), envSample(env, env.levelU[k + 1], x, y), t);
  out.v = lerp(envSample(env, env.levelV[k], x, y), envSample(env, env.levelV[k + 1], x, y), t);
}

// The motion of the storms within reach of a place, the stronger counting for more.
function meanStormMotion(storms, env, x, y, reachKm) {
  let u = 0, v = 0, w = 0;
  for (const s of storms) {
    if (Math.hypot(s.x - x, s.y - y) > reachKm) continue;
    const k = 0.2 + s.weight; u += s.motion.u * k; v += s.motion.v * k; w += k;
  }
  if (w > 0) return { u: u / w, v: v / w, source: 'tracked-storms' };
  // No storms: the 0-6 km mean wind there.
  const sample = {};
  for (let z = 0; z <= 6000; z += 500) { envWindAt(env, x, y, z, sample); u += sample.u; v += sample.v; w++; }
  return { u: u / w, v: v / w, source: 'mean-wind' };
}

function levelWind(level) { return { dir: Number(level?.windDirection) || 0, spd: Number(level?.windSpeed) || 0, t: Number(level?.temperature) }; }

function virtualTemperatureK(tempC, dewpointC) {
  if (!Number.isFinite(tempC)) return 288;
  const vapourHpa = Number.isFinite(dewpointC) ? 6.112 * Math.exp(17.67 * dewpointC / (dewpointC + 243.5)) : 0;
  return (tempC + 273.15) * (1 + 0.61 * 0.622 * vapourHpa / 1000);
}

function freezingLevelAgl(levels) {
  for (let k = 0; k < levels.length - 1; k++) {
    const a = levels[k], b = levels[k + 1];
    if (!Number.isFinite(a.t) || !Number.isFinite(b.t)) continue;
    if (a.t >= 0 && b.t < 0) return a.h + (b.h - a.h) * a.t / (a.t - b.t);
  }
  return Number.isFinite(levels[0].t) && levels[0].t < 0 ? 0 : 4200;
}

// Insects and birds: modest daytime boundary-layer returns, a dusk bloom, quiet pre-dawn.
function biologicalDbz(localHour) {
  const dusk = Math.exp(-(((localHour - 22) / 2.2) ** 2)) + Math.exp(-(((localHour + 2) / 2.2) ** 2));
  const day = localHour > 9 && localHour < 19 ? Math.sin((localHour - 9) / 10 * Math.PI) : 0;
  return -6 + 9 * day + 18 * dusk;
}

function binItems(items, size, widthKm, heightKm, extent) {
  const cols = Math.ceil(widthKm / size), rows = Math.ceil(heightKm / size);
  const bins = { size, cols, rows, cells: new Array(cols * rows).fill(null) };
  for (const item of items) {
    const [x0, y0, x1, y1] = extent(item);
    for (let by = Math.max(0, Math.floor(y0 / size)); by <= Math.min(rows - 1, Math.floor(y1 / size)); by++)
      for (let bx = Math.max(0, Math.floor(x0 / size)); bx <= Math.min(cols - 1, Math.floor(x1 / size)); bx++)
        (bins.cells[by * cols + bx] ??= []).push(item);
  }
  return bins;
}
function binAt(bins, x, y) {
  const bx = Math.floor(x / bins.size), by = Math.floor(y / bins.size);
  if (bx < 0 || by < 0 || bx >= bins.cols || by >= bins.rows) return null;
  return bins.cells[by * bins.cols + bx];
}

// Cuts the corners off a line of points (each piece replaced by its quarter points).
function roundCorners(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k], b = points[k + 1];
    out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y }, { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
  }
  out.push(points.at(-1));
  return out;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Deterministic value noise: fbm in [-1, 1], gate noise in [0, 1].
function hash3(seed, x, y, z) {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(seed, x, y, z) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = fade(x - x0), fy = fade(y - y0), fz = fade(z - z0);
  const c = (dx, dy, dz) => hash3(seed, x0 + dx, y0 + dy, z0 + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
function fbm(seed, x, y, z) { return (0.62 * valueNoise(seed, x, y, z) + 0.38 * valueNoise(seed + 101, x * 2.3 + 17.1, y * 2.3 + 31.7, z * 1.7)) * 2 - 1; }
function gateNoise(index, salt) { return hash3(Math.round(salt * 1000), index, index >>> 7, 3); }
function hashString(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h | 0; }
function fade(t) { return t * t * (3 - 2 * t); }
function smoothstep(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function mod24(h) { return ((h % 24) + 24) % 24; }
