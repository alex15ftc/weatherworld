// Simulated Doppler/dual-pol radar. Radar never creates weather: every echo is derived
// from authoritative storm structure, the environmental grid, analysed boundaries and the
// time of day. Output is a deterministic function of world state, site and tilt.
import { buildStormEchoModel, sampleEchoInto, sampleEcho, echoGradient } from './StormEchoModel.js';
import {
  RADAR_RADIALS, RADAR_GATES, RADAR_GATE_KM, RADAR_BEAMWIDTH_DEG, RADAR_ANTENNA_HEIGHT_M,
  RADAR_PRODUCT_KEYS, beamHeightKm, groundRangeKm, encodeRadarValue
} from './RadarFormat.js';

const KT_TO_MS = 0.514444;
const STORM_BIN_KM = 20;
const BOUNDARY_BIN_KM = 20;
const DEG = Math.PI / 180;

// A 3×3 network over the ~805 km domain: ~270 km spacing like the real WSR-88D network,
// so storms between sites are sampled high above the ground (realistic coverage gaps).
const SITE_LAYOUT = [
  { id: 'KNWP', name: 'Northwest Plains', fx: 0.17, fy: 0.16 },
  { id: 'KNCP', name: 'North Central Plains', fx: 0.51, fy: 0.17 },
  { id: 'KNEP', name: 'Northeast Plains', fx: 0.84, fy: 0.15 },
  { id: 'KWCP', name: 'West Central Plains', fx: 0.16, fy: 0.5 },
  { id: 'KCPL', name: 'Central Plains', fx: 0.5, fy: 0.49 },
  { id: 'KECP', name: 'East Central Plains', fx: 0.83, fy: 0.52 },
  { id: 'KSWP', name: 'Southwest Plains', fx: 0.17, fy: 0.84 },
  { id: 'KSCP', name: 'South Central Plains', fx: 0.49, fy: 0.83 },
  { id: 'KSEP', name: 'Southeast Plains', fx: 0.85, fy: 0.85 }
];

export function createRadarSites(world) {
  const widthKm = world.width * world.cellSizeKm, heightKm = world.height * world.cellSizeKm;
  return SITE_LAYOUT.map(({ id, name, fx, fy }) => {
    const xKm = fx * widthKm, yKm = fy * heightKm;
    const cell = world.getCell(Math.floor(xKm / world.cellSizeKm), Math.floor(yKm / world.cellSizeKm));
    return { id, name, xKm, yKm, elevationM: Number(cell?.terrain?.elevationM) || 0 };
  });
}

// ---------------------------------------------------------------------------
// Scene: everything a scan samples, extracted once per world revision.

export function buildRadarScene(world) {
  const w = world.width, h = world.height, cs = world.cellSizeKm, n = w * h;
  const env = {
    w, h, cs,
    terrain: new Float32Array(n), freezing: new Float32Array(n), top: new Float32Array(n), blDepth: new Float32Array(n),
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
  });

  const storms = [];
  for (const storm of world.storms ?? []) {
    if (storm.active === false) continue;
    const echo = buildStormEchoModel(storm);
    if (!echo) continue;
    const x = storm.positionKm.x, y = storm.positionKm.y;
    const motion = { u: (storm.velocityKph?.east ?? 0) / 3.6, v: (storm.velocityKph?.north ?? 0) / 3.6 };
    const upperU = envSample(env, env.levelU[4], x, y), upperV = envSample(env, env.levelV[4], x, y);
    // Anvil ice is carried downstream by the storm-relative upper flow (~30 min of travel).
    let anvilX = (upperU - motion.u) * 1.8, anvilY = -(upperV - motion.v) * 1.8;
    const anvilLength = Math.hypot(anvilX, anvilY);
    if (anvilLength > 32) { anvilX *= 32 / anvilLength; anvilY *= 32 / anvilLength; }
    // Echo tops reach the equilibrium level (plus overshoot) in vigorous storms.
    const updraft = clamp(Math.max(Number(storm.updraftStrength) || 0, (Number(storm.intensity) || 0) * 1.3), 0, 1);
    storms.push({
      x, y, echo, motion, anvilX, anvilY,
      halfKm: echo.half * Math.SQRT2,
      top: envSample(env, env.top, x, y) * (0.6 + 0.48 * updraft),
      freezing: envSample(env, env.freezing, x, y),
      seed: hashString(String(storm.id)),
      time: (Number(storm.ageHours) || 0) * 60 / 25,
      weight: clamp(Number(storm.intensity) || 0, 0, 1)
    });
  }

  const boundaries = [];
  for (const boundary of world.mesoscale?.boundaries ?? []) {
    if (boundary.active === false) continue;
    const points = boundary.pointsKm ?? [];
    const dbz = boundaryFineLineDbz(boundary.type) + 4 * clamp(Number(boundary.strength) || 0.5, 0, 1);
    for (let k = 0; k < points.length - 1; k++) boundaries.push({ ax: points[k].x, ay: points[k].y, bx: points[k + 1].x, by: points[k + 1].y, z: 10 ** (dbz / 10) });
  }

  const domainWidthKm = w * cs, domainHeightKm = h * cs;
  const scene = {
    validHourUtc: Number(world.stormEngine?.validHourUtc ?? world.validHourUtc),
    localHour: mod24(Number(world.stormEngine?.validHourUtc ?? world.validHourUtc) - 6),
    domainWidthKm, domainHeightKm, env, storms, boundaries,
    stormBins: binItems(storms, STORM_BIN_KM, domainWidthKm, domainHeightKm, s => {
      const r = s.halfKm + Math.hypot(s.anvilX, s.anvilY);
      return [s.x - r, s.y - r, s.x + r, s.y + r];
    }),
    boundaryBins: binItems(boundaries, BOUNDARY_BIN_KM, domainWidthKm, domainHeightKm, b =>
      [Math.min(b.ax, b.bx) - 4, Math.min(b.ay, b.by) - 4, Math.max(b.ax, b.bx) + 4, Math.max(b.ay, b.by) + 4]),
    stormMotion: meanStormMotion(storms, env, domainWidthKm, domainHeightKm)
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
  const sample = { zh: 0, zv: 0, cc: 0 }, wind = { u: 0, v: 0 }, clearAir = { bl: 0, bioZ: 0 };
  const bioZ = 10 ** (biologicalDbz(scene.localHour) / 10);
  const beamHalfWidth = RADAR_BEAMWIDTH_DEG * DEG * 0.35;
  const cosTilt = Math.cos(tiltDeg * DEG);
  const siteHeightM = site.elevationM + RADAR_ANTENNA_HEIGHT_M;
  const su = scene.stormMotion.u, sv = scene.stormMotion.v;
  const gateGeometry = Array.from({ length: RADAR_GATES }, (_, g) => {
    const range = (g + 0.5) * RADAR_GATE_KM;
    return { range, ground: groundRangeKm(range, tiltDeg), heightM: beamHeightKm(range, tiltDeg) * 1000, spreadM: range * beamHalfWidth * 1000, minDbz: -32 + 20 * Math.log10(range) };
  });

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
      // Three samples across the vertical beam pattern (weights 1:2:1).
      let zh = 0, zv = 0, ccw = 0;
      for (let k = -1; k <= 1; k++) {
        const agl = centerAgl + k * geo.spreadM;
        if (agl < 0) continue;
        sampleVolume(scene, x, y, agl, sample, clearAir);
        const wgt = k === 0 ? 0.5 : 0.25;
        zh += sample.zh * wgt; zv += sample.zv * wgt; ccw += sample.cc * wgt;
      }
      if (zh <= 0) continue;
      const index = r * RADAR_GATES + g;
      const snr = 10 * Math.log10(zh) - geo.minDbz;
      if (snr < 0) continue;
      const noise = gateNoise(index, tiltDeg) * 2 - 1, lowSnr = Math.exp(-snr / 6);
      const dbz = 10 * Math.log10(zh) + noise * 1.6 * lowSnr;
      ref[index] = encodeRadarValue('reflectivity', dbz);
      sampleWind(scene, x, y, centerAgl, wind);
      const radial = (wind.u * sinAz + wind.v * cosAz) * cosTilt + noise * 1.2 * lowSnr;
      vel[index] = encodeRadarValue('velocity', radial);
      srv[index] = encodeRadarValue('stormRelativeVelocity', radial - (su * sinAz + sv * cosAz) * cosTilt);
      const rho = ccw / zh - Math.abs(noise) * 0.22 * lowSnr;
      cc[index] = encodeRadarValue('correlationCoefficient', rho);
      zdr[index] = encodeRadarValue('differentialReflectivity', 10 * Math.log10(zh / Math.max(1e-12, zv)) + noise * 0.9 * lowSnr);
    }
  }
  return {
    siteId: site.id, tiltDeg, validHourUtc: scene.validHourUtc, stormMotion: scene.stormMotion, products,
    buildMs: (globalThis.performance?.now?.() ?? Date.now()) - started
  };
}

// Network mosaic of lowest-tilt reflectivity on a Cartesian grid. Each cell uses the
// nearest radar whose 0.5° beam samples it, falling back to the next radar when that beam
// is blocked or sees nothing, as regional mosaics do. One byte per cell, row-major.
export const MOSAIC_RES_KM = 1;
export const MOSAIC_TILT_DEG = 0.5;
export function buildRadarMosaic(scene, sites) {
  const started = globalThis.performance?.now?.() ?? Date.now();
  const width = Math.ceil(scene.domainWidthKm / MOSAIC_RES_KM), height = Math.ceil(scene.domainHeightKm / MOSAIC_RES_KM);
  const bytes = new Uint8Array(width * height);
  const sample = { zh: 0, zv: 0, cc: 0 }, clearAir = { bl: 0, bioZ: 0 };
  const bioZ = 10 ** (biologicalDbz(scene.localHour) / 10);
  const maxGround = groundRangeKm(RADAR_GATES * RADAR_GATE_KM, MOSAIC_TILT_DEG);
  const cosTilt = Math.cos(MOSAIC_TILT_DEG * DEG), beamHalfWidth = RADAR_BEAMWIDTH_DEG * DEG * 0.35;
  const candidates = [];
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
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
    for (const { site, ground } of candidates) {
      const range = ground / cosTilt, spread = range * beamHalfWidth * 1000;
      const agl = site.elevationM + RADAR_ANTENNA_HEIGHT_M + beamHeightKm(range, MOSAIC_TILT_DEG) * 1000 - terrain;
      if (agl < 0) continue;
      clearAir.bioZ = agl - spread < clearAir.bl * 1.3 ? bioZ * (0.4 + 0.9 * (fbm(911, x / 4, y / 4, scene.validHourUtc) * 0.5 + 0.5)) : 0;
      // Same 1:2:1 vertical beam pattern as the single-site scans.
      let zh = 0;
      for (let k = -1; k <= 1; k++) {
        const z = agl + k * spread;
        if (z < 0) continue;
        sampleVolume(scene, x, y, z, sample, clearAir);
        zh += sample.zh * (k === 0 ? 0.5 : 0.25);
      }
      if (zh <= 0) continue;
      const snr = 10 * Math.log10(zh) - (-32 + 20 * Math.log10(Math.max(range, 0.5)));
      if (snr < 0) continue;
      const noise = gateNoise(j * width + i, 77) * 2 - 1;
      bytes[j * width + i] = encodeRadarValue('reflectivity', 10 * Math.log10(zh) + noise * 1.6 * Math.exp(-snr / 6));
      break;
    }
  }
  return { width, height, resKm: MOSAIC_RES_KM, tiltDeg: MOSAIC_TILT_DEG, validHourUtc: scene.validHourUtc, bytes, buildMs: (globalThis.performance?.now?.() ?? Date.now()) - started };
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

function stormHydrometeors(s, lx, ly, z, out) {
  if (Math.abs(lx) > s.halfKm + Math.abs(s.anvilX) || Math.abs(ly) > s.halfKm + Math.abs(s.anvilY)) return;
  const top = s.top, fz = s.freezing;
  if (z > top * 1.12) return;
  if (!sampleEchoInto(s.echo, lx, ly, tmp)) {
    anvilEcho(s, lx, ly, z, out);
    return;
  }
  const { rain, graupel, hail, updraft, debris } = tmp;
  const localTop = top * (0.35 + 0.65 * clamp(updraft * 1.1 + rain * 0.5 + hail * 0.3, 0, 1));
  const cap = 1 - smoothstep(localTop * 0.82, localTop * 1.02, z);
  const texture = 10 ** (0.42 * fbm(s.seed, lx / 6.5, ly / 6.5, s.time));

  // Precipitation: a bounded weak-echo vault beneath strong updrafts, with suspended
  // precipitation (overhang) above the melting level.
  const vault = z < 0.4 * top ? smoothstep(0.45, 1.1, updraft) * (1 - z / (0.4 * top)) : 0;
  const lofted = z > fz ? updraft * 0.7 * (1 - smoothstep(0.7 * top, top, z)) : 0;
  const precip = Math.max((rain + 0.6 * graupel) * (1 - 0.85 * vault), lofted) * cap;
  if (precip > 0.004) {
    const base = 3.2e5 * precip ** 2.2 * texture;
    // Melting layer: rain below, ice above, blended over ~1 km. Weak-updraft (stratiform)
    // regions get a bright band where wet snow melts.
    const frozen = smoothstep(fz - 300, fz + 700, z);
    const above = Math.max(0, z - fz);
    const zdrColumn = z > fz && above < 2600 * updraft ? smoothstep(0.35, 0.8, updraft) : 0;
    const brightBand = (1 - smoothstep(0.15, 0.4, updraft)) * Math.exp(-(((z - fz + 150) / 350) ** 2));
    const iceFactor = 0.2 * 10 ** (-0.12 * above / 1000) * (1 + 2 * zdrColumn);
    if (frozen < 1) addEcho(out, base * (1 - frozen) * (1 + 2.5 * brightBand), clamp(0.3 + 2.6 * precip ** 0.8, 0.2, 4.2) + brightBand, 0.992 - 0.06 * brightBand);
    if (frozen > 0) addEcho(out, base * frozen * iceFactor, 0.3 + 2.8 * zdrColumn, 0.985 - 0.02 * zdrColumn);
  }
  if (hail > 0.02 && z < localTop * 0.92) {
    const wet = 1 - smoothstep(fz - 300, fz + 700, z);
    addEcho(out, 6.3e6 * (hail * (1 - 0.15 * wet)) ** 2 * Math.sqrt(texture), 0.1 + 0.5 * wet, 0.92 - 0.06 * wet);
  }
  if (debris > 0.03 && z < 3000) {
    const lofting = debris * (1 - z / 3000);
    addEcho(out, 2.5e5 * lofting ** 1.5 * texture, (gateNoise(Math.floor((lx + 99) * 7) * 977 + Math.floor((ly + 99) * 7), s.seed) - 0.5) * 2, 0.3 + 0.3 * fbm(s.seed + 7, lx, ly, s.time) ** 2);
  }
  anvilEcho(s, lx, ly, z, out, texture);
}

function anvilEcho(s, lx, ly, z, out, texture = 1) {
  const top = s.top, fz = s.freezing;
  if (z < Math.max(fz, 0.45 * top) || z > top * 1.05) return;
  const frac = clamp((z - 0.45 * top) / (0.45 * top), 0, 1);
  // Anvil ice spreads downstream and broadens with height.
  const ice = (sampleEcho(s.echo, 'ice', lx - s.anvilX * frac, ly - s.anvilY * frac) + 0.5 * sampleEcho(s.echo, 'updraft', lx - s.anvilX * frac, ly - s.anvilY * frac))
    * (0.6 + 0.6 * frac) * (1 - smoothstep(top * 0.9, top * 1.05, z));
  if (ice > 0.02) addEcho(out, 4e3 * ice * ice * texture, 0.35, 0.988);
}

function clearAirEchoes(scene, x, y, z, out, { bl, bioZ }) {
  if (z > bl * 1.3) return;
  const depth = 1 - z / (bl * 1.3);
  // Insects concentrate in boundary convergence zones: fine lines along fronts,
  // drylines and outflow boundaries.
  const bin = binAt(scene.boundaryBins, x, y);
  if (bin) for (const b of bin) {
    const d = segmentDistance(x, y, b.ax, b.ay, b.bx, b.by);
    if (d < 4) addEcho(out, b.z * Math.exp(-((d / 1.3) ** 2)) * depth, 4.5, 0.45);
  }
  addEcho(out, bioZ * depth, 5.5, 0.38);
}

// Environmental wind plus storm-scale perturbations: mesocyclone and tornado vortices,
// outflow from downdrafts, the rear-inflow jet and divergence near storm top.
const gradient = {};
function sampleWind(scene, x, y, z, out) {
  const env = scene.env;
  envWindAt(env, x, y, z, out);
  const bin = binAt(scene.stormBins, x, y);
  if (!bin) return;
  for (const s of bin) {
    const lx = x - s.x, ly = y - s.y, e = s.echo;
    if (Math.abs(lx) > s.halfKm || Math.abs(ly) > s.halfKm) continue;
    // Mesocyclone: strongest at mid levels, present down to the ground in mature supercells.
    const mesoDepth = 0.55 + 0.45 * Math.exp(-(((z - 4500) / 2600) ** 2));
    addVortex(out, lx - e.mesocyclone.x, ly - e.mesocyclone.y, e.mesocyclone.radiusKm, e.mesocyclone.vmaxMs * mesoDepth * (z > s.top ? 0.2 : 1));
    if (e.tornado && z < 3500) addVortex(out, lx - e.tornado.x, ly - e.tornado.y, e.tornado.radiusKm, e.tornado.vmaxMs * (1 - z / 3500 * 0.6));
    if (z < 1500) {
      // Outflow spreads away from downdraft cores (gust fronts, RFD surges).
      echoGradient(e, 'downdraft', lx, ly, gradient);
      const k = 260 * (1 - z / 1500);
      out.u += -k * gradient.x; out.v += k * gradient.y;
    } else if (z > 0.7 * s.top) {
      echoGradient(e, 'updraft', lx, ly, gradient);
      const k = 220 * clamp((z - 0.7 * s.top) / (0.3 * s.top), 0, 1);
      out.u += -k * gradient.x; out.v += k * gradient.y;
    }
    const rij = sampleEcho(e, 'rearInflow', lx, ly);
    if (rij > 0.01 && z < 6000) {
      // Rear-inflow jet: storm-relative flow toward the leading line, descending to the surface at the bow apex.
      const profile = Math.exp(-(((z - 2500) / 1800) ** 2));
      out.u += 24 * rij * profile * e.mx; out.v += -24 * rij * profile * e.my;
    }
  }
}

// Cyclonic Rankine-like vortex; dx, dy in the screen frame (km).
function addVortex(out, dx, dy, radiusKm, vmax) {
  if (!(vmax > 0)) return;
  const rho = Math.hypot(dx, dy);
  if (rho < 1e-3 || rho > radiusKm * 12) return;
  const vt = vmax * (rho < radiusKm ? rho / radiusKm : (radiusKm / rho) ** 0.8);
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

function meanStormMotion(storms, env, widthKm, heightKm) {
  let u = 0, v = 0, w = 0;
  for (const s of storms) { const k = 0.2 + s.weight; u += s.motion.u * k; v += s.motion.v * k; w += k; }
  if (w > 0) return { u: u / w, v: v / w, source: 'tracked-storms' };
  // No storms: 0-6 km mean wind at the domain centre.
  const cx = widthKm / 2, cy = heightKm / 2, sample = {};
  for (let z = 0; z <= 6000; z += 500) { envWindAt(env, cx, cy, z, sample); u += sample.u; v += sample.v; w++; }
  return { u: u / w, v: v / w, source: 'mean-wind' };
}

function levelWind(level) { return { dir: Number(level?.windDirection) || 0, spd: Number(level?.windSpeed) || 0, t: Number(level?.temperature) }; }

function freezingLevelAgl(levels) {
  for (let k = 0; k < levels.length - 1; k++) {
    const a = levels[k], b = levels[k + 1];
    if (!Number.isFinite(a.t) || !Number.isFinite(b.t)) continue;
    if (a.t >= 0 && b.t < 0) return a.h + (b.h - a.h) * a.t / (a.t - b.t);
  }
  return Number.isFinite(levels[0].t) && levels[0].t < 0 ? 0 : 4200;
}

function boundaryFineLineDbz(type = '') {
  const t = String(type).toLowerCase();
  if (t.includes('outflow')) return 14;
  if (t.includes('cold')) return 10;
  if (t.includes('dry')) return 9;
  if (t.includes('warm') || t.includes('stationary')) return 4;
  return 6;
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
