// Simulated Doppler/dual-pol radar. Radar never creates weather: every echo is derived
// from where each storm's precipitation is (PrecipitationField.js: worked out from its
// updraughts and the wind through its depth), the environmental grid, analysed boundaries
// and the time of day. Output is a deterministic function of world state, site and tilt.
import {
  buildStormPrecipitation, samplePrecipitation, hasPrecipitation, sampleDebris, sampleHeaviness, heavinessGradient,
  RAIN_REFLECTIVITY, HAIL_REFLECTIVITY, DEBRIS_REFLECTIVITY, WIND_PROFILE_STEP_M, WIND_PROFILE_LEVELS, MESOCYCLONE_LEAN_M, FRONT_TO_REAR_BASE_M, frontToRearShare
} from '../storms/PrecipitationField.js';
import {
  RADAR_RADIALS, RADAR_GATES, RADAR_GATE_KM, RADAR_RANGE_KM, RADAR_TILTS_DEG, RADAR_BEAMWIDTH_DEG, RADAR_ANTENNA_HEIGHT_M,
  RADAR_PRODUCT_KEYS, beamHeightKm, groundRangeKm, encodeRadarValue, RANGE_FOLDED
} from './RadarFormat.js';
import { buildSounding } from '../sounding.js';
import { updraughtProfile, STRUCTURE as FRAME } from '../storms/StormStructure.js';
import { coldPoolSpeedMs, coldPoolDepthM } from '../storms/ColdPool.js';

const KT_TO_MS = 0.514444;
const STORM_BIN_KM = 10;
const BOUNDARY_BIN_KM = 20;
const DEG = Math.PI / 180;

// The generic network, for worlds without a map (the server places its radars at the world
// map's airports and air base instead: server/RadarSites.js). Seven radars over the ~805 km
// domain, placed unevenly as real networks are. Two areas are
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
// (offsets k and weights w as plain arrays: the inner loops index them rather than unpack pairs)
const BEAM_OFFSETS = { k: [-1, 0, 1], w: [0.25, 0.5, 0.25] }, BEAM_CENTRE = { k: [0], w: [1] };
// Across the beam a single-site scan gets the same three samples from its own neighbouring
// radials: the outer samples lie this share of the way to the next radial.
const ACROSS_SHARE = 0.35 * RADAR_BEAMWIDTH_DEG / (360 / RADAR_RADIALS);
const NEIGHBOUR_WEIGHT = BEAM_OFFSETS.w[0] * Math.min(1, ACROSS_SHARE), OWN_WEIGHT = 1 - 2 * NEIGHBOUR_WEIGHT;
// Per-gate sums of one scan before blending and noise (reused between scans).
const gateSums = { zh: null, zv: null, cc: null, stormRadial: null, stormRadial2: null, envRadial: null, hail: null, spike: null, spikeRadial: null, clutter: null, fall: null, rise: null, measured: null, guess: null, raw: null, dealiased: null };
// Ground clutter left after the radar's clutter filter: buildings, trees and power lines the
// lowest part of the beam grazes. Echo this strong (dBZ, varying by this much from one target to
// the next) where the beam's lower edge reaches the ground, fading as it rises over this height
// (m); about this share of places has something standing there. Where the air near the ground
// bends the beam down (a strong inversion at night: anomalous propagation) it grazes the ground
// much farther out. Refractivity gradients (N units per km): standard air, and ducting.
const CLUTTER = { residualDbz: 12, varyDb: 8, fadeM: 40, targets: 0.4, standardDnDh: -40, ductingDnDh: -157, earthKm: 6371 };
// Doppler: echoes from beyond this range (km) fold over the gates this much nearer. The lowest
// tilts (split cuts, phase coded) can tell the two apart unless the nearer echo is this much
// (dB) weaker; the others only where the nearer is this much stronger.
// The Doppler range and the fastest motion the radar can tell apart are one choice of pulse rate
// (the Doppler dilemma): Vn x Rmax = c x wavelength / 8, so with the S band's 10.7 cm and a 117 km
// Doppler range Vn is 34.3 m/s (WSR-88D: 25-34 m/s on the low tilts of VCP 12/212). Faster motion
// toward or away folds over into the other sign (aliasing); the radar unfolds it (dealiasing).
// pulses: how many pulses each velocity is estimated from (the WSR-88D's 40-200; the fewest, as on
// the fast low tilts of a convective scan).
const DOPPLER = { unambiguousKm: 117, phaseCodedUpToDeg: 1.8, phaseCodedDb: -10, plainDb: 5, wavelengthM: 0.107, pulses: 40 };
export const NYQUIST_MS = 3e8 * DOPPLER.wavelengthM / (8 * DOPPLER.unambiguousKm * 1000);
// How far a velocity estimate strays (standard deviation, m/s) with a spectrum width sigma (m/s), at
// high signal to noise: var = lambda sigma / (8 sqrt(pi) M Ts) for contiguous pulse pairs and a
// Gaussian spectrum (Zrnic 1977; NCAR TN-331, eq. 3.25), the pulse spacing Ts = lambda / (4 Vn).
// 0.98 m/s at a 4 m/s width, as the WSR-88D's under 1 m/s.
const PULSE_SPACING_S = DOPPLER.wavelengthM / (4 * NYQUIST_MS);
const velocityErrorMs = sigma => Math.sqrt(DOPPLER.wavelengthM * sigma / (8 * Math.sqrt(Math.PI) * DOPPLER.pulses * PULSE_SPACING_S));
// Dealiasing (as the WSR-88D's 2-D velocity dealiasing, VDA, does it in outline): each gate is first
// unfolded to lie nearest the environment's wind along the beam (the VDA's first guess, from the
// radar's own VAD wind), then, this many times over, nearest the median of the gates round it
// (radials either side, gates along the beam), so a patch that differs from the environment by
// more than Vn - a mesocyclone, a tornado's couplet - is unfolded with its neighbours. Where a
// couplet is tighter than the gates round it, it can still be unfolded wrongly, as real ones are.
// (alongKm: how far along the beam the neighbours reach, 2 gates of 500 m)
const DEALIAS = { passes: 2, radials: 1, alongKm: 1, least: 4 };
// Fall speed (m/s) of what reflects Z (mm6/m3) at a height (m above the ground) with the freezing
// level there: rain by Vt = 2.6 Z^0.107 (Joss and Waldvogel 1970), snow and graupel aloft about 1 m/s
// (Locatelli and Hobbs 1974), faster in the thinner air aloft by (rho0 / rho)^0.4 (Foote and du Toit
// 1969; density scale height 8.5 km). Along a beam raised by the tilt it shows as motion toward the
// radar, Vt sin(tilt).
const fallSpeedMs = (z, agl, freezingM) => {
  const frozen = smoothstep(freezingM - 300, freezingM + 700, agl);
  return ((1 - frozen) * 2.6 * z ** 0.107 + frozen) * Math.exp(0.4 * agl / 8500);
};
// Spread of motion within a beam volume besides what the echoes' own winds give (m/s): the
// turbulence of the air in precipitation and in clear air.
const TURBULENCE_MS = { precipitation: 2, clearAir: 1 };
// Three-body scattering: the beam scattered down to the ground by a core of large hail comes back
// up through the hail and in again, later than the echo from the hail itself, so it shows
// farther out, starting as far beyond the core as the hail is above the ground. What returns is
// this much weaker than the hail's own echo (dB), fades over this distance (km), and has the
// hail's motion; a spray off the ground, it has high ZDR (dB) and low ρhv.
const THREE_BODY = { lossDb: 48, fadeKm: 8, reachFades: 3, leastHailDbz: 50, zdrDb: 5, rho: 0.6 };
// (the velocity's own error: velocityErrorMs)
const NOISE = { dbz: 0.8, correlation: 0.008, zdrDb: 0.18 };
// A tornado's wind is as deep as the tornado is strong: a weak one is seen only in the lowest
// kilometre; a violent one reaches several kilometres.
const tornadoDepthM = windMs => clamp(800 + 36 * (windMs - 30), 700, 3500);
// Outflow at the anvil (m/s per unit change of rain heaviness in a km), and the rear-inflow jet
// behind a line at its strongest (m/s). Near the ground the outflow is the cold pool's (coldPoolOf).
const STORM_WINDS = { anvil: 90, rearInflowMs: 24 };
// Flow into a boundary (m/s) that doubles the insects along it, how much (dB) they vary along it,
// and the depth of the denser air pushing under the other (m).
// FINE_LINE_KM: how wide the insects gather along the line (a Gaussian's e-folding half-width).
const FINE_LINE_INFLOW_MS = 0.4, FINE_LINE_PATCHY_DB = 4, DENSITY_CURRENT_DEPTH_M = 1000, FINE_LINE_KM = 1.2;
// Where a storm's gust front is: the pool's lower edge as the frame eases it (StormStructure: from
// 0.15 to 0.45 of the most of its spread footprint), its leading edge at the first.
const POOL_EDGE = [0.15, 0.45];

// layout: { id, name, fx, fy } with fx, fy shares of the domain's width and height. The server
// passes the radars at the world map's airports and air base (server/RadarSites.js); SITE_LAYOUT
// is the generic network used without a map (and by the tests).
export function createRadarSites(world, layout = SITE_LAYOUT) {
  const widthKm = world.width * world.cellSizeKm, heightKm = world.height * world.cellSizeKm;
  return layout.map(({ id, name, fx, fy, operator, airfield }) => {
    const xKm = fx * widthKm, yKm = fy * heightKm;
    const cell = world.getCell(Math.floor(xKm / world.cellSizeKm), Math.floor(yKm / world.cellSizeKm));
    return { id, name, xKm, yKm, elevationM: Number(cell?.terrain?.elevationM) || 0, ...(operator ? { operator } : {}), ...(airfield ? { airfield } : {}) };
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

// One storm's precipitation (PrecipitationField.js). shared: in memory other threads can read;
// the other options (stride, leastResKm, fine) give a coarser field for a quick look.
export function buildStormEcho({ storm, top, freezing, su, sv, inflowVapourGm3, precipitableWaterIn, midLevelRh }, options = {}) {
  return buildStormPrecipitation(storm, { topM: top, freezingM: freezing, su, sv, inflowVapourGm3, precipitableWaterIn, midLevelRh }, options);
}

// reuseEnv: the env of an earlier call on the same cells (it depends on the cells alone).
export function radarSceneInputs(world, { reuseEnv = null } = {}) {
  const w = world.width, h = world.height, cs = world.cellSizeKm, n = w * h;
  const env = reuseEnv ?? sceneEnv(world, w, h, cs, n);

  const storms = [], wind = { u: 0, v: 0 };
  for (const storm of world.storms ?? []) {
    if (storm.active === false || !storm.structure) continue;
    const x = storm.positionKm.x, y = storm.positionKm.y;
    const motion = { u: (storm.velocityKph?.east ?? 0) / 3.6, v: (storm.velocityKph?.north ?? 0) / 3.6 };
    // Echo tops reach the equilibrium level (plus overshoot) in vigorous storms.
    const updraft = clamp(Math.max(Number(storm.updraftStrength) || 0, (Number(storm.intensity) || 0) * 1.3), 0, 1);
    const top = envSample(env, env.top, x, y) * (0.6 + 0.48 * updraft), freezing = envSample(env, env.freezing, x, y), minus20 = envSample(env, env.minus20, x, y);
    // The wind through the storm's depth, relative to the storm: what carries its rain.
    const su = new Float32Array(WIND_PROFILE_LEVELS), sv = new Float32Array(WIND_PROFILE_LEVELS);
    for (let k = 0; k < WIND_PROFILE_LEVELS; k++) { envWindAt(env, x, y, k * WIND_PROFILE_STEP_M, wind); su[k] = wind.u - motion.u; sv[k] = wind.v - motion.v; }
    storms.push({ storm, x, y, motion, top, freezing, minus20, su, sv, ...stormMoisture(world, x, y), ...riseOf(world, storm), poolRadiusKm: Number(storm.coldPoolRadiusKm) || 10, seed: hashString(String(storm.id)), weight: clamp(Number(storm.intensity) || 0, 0, 1) });
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
      boundaries.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, z, widthKm: FINE_LINE_KM * (1 + 0.4 * fbm(seed + 5, along / 30, 0.5, 0)) });
    }
  }

  return { validHourUtc, localHour, domainWidthKm: w * cs, domainHeightKm: h * cs, env, storms, boundaries };
}

// How the storm's updraught varies with height (shares of its fastest, every riseDzM from the
// ground): the entraining parcel the in-world frame draws it with (StormStructure.updraughtProfile).
function riseOf(world, storm) {
  const profile = updraughtProfile(world, storm), peak = Math.max(1e-6, ...profile.w);
  return { rise: Float32Array.from(profile.w, w => Math.max(0, w) / peak), riseDzM: profile.dz };
}

// The storm's cold pool as the in-world frame draws it (StormStructure.buildStormFrame): the rain's
// footprint at the ground (log10(1 + mm/h) / 2), spread by the density current - a Gaussian of
// sigma L / 2, L the distance the pool's speed carries it in coldPoolTauS, at most 0.7 of the
// engine's coldPoolRadiusKm - and left behind by half that time's motion; its edge eased from
// 0.15 to 0.45 of the most. out: 0 outside the pool, 1 well inside; its edge is the gust front.
// edgeKm: how wide the edge is where it is sharpest (1 / the steepest change), so the outflow
// there is the pool's own speed. Null without a cold pool.
const poolSample = {};
// One storm's (input: an entry of radarSceneInputs(world).storms; echo: its field). A thread that
// works out a field works this out with it and keeps it on the field as radarColdPool, so that
// putting the scene together (assembleRadarScene) need not.
export const stormColdPool = (echo, input) => coldPoolOf(echo, input.motion, input.poolRadiusKm);
function coldPoolOf(echo, motion, poolRadiusKm) {
  const strength = clamp(Number(echo.coldPool) || 0, 0, 1);
  if (!(strength > 0) || !echo.grid) return null;
  const tau = FRAME.coldPoolTauS, spreadKm = Math.max(1.5, Math.min(coldPoolSpeedMs(strength) * tau, 0.7 * 1000 * Math.max(2, poolRadiusKm))) / 1000;
  // (cells a quarter of the spread wide at most: the pool is smooth on that scale)
  const res = Math.max(1, echo.grid.res, spreadKm / 2 / 4), sigma = spreadKm / 2 / res, reach = Math.ceil(2.5 * sigma);
  const shiftX = -motion.u * tau / 2 / 1000 / res, shiftY = motion.v * tau / 2 / 1000 / res;   // (cells; y runs south)
  const margin = reach + Math.ceil(Math.abs(shiftX) + Math.abs(shiftY));
  const x0 = echo.minX - margin * res, y0 = echo.minY - margin * res;
  const nx = Math.ceil((echo.maxX - echo.minX) / res) + 1 + 2 * margin, ny = Math.ceil((echo.maxY - echo.minY) / res) + 1 + 2 * margin;
  const mask = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!samplePrecipitation(echo, x0 + i * res, y0 + j * res, 0, poolSample)) continue;
    const mmh = (RAIN_REFLECTIVITY * poolSample.rain / 200) ** (1 / 1.6);
    mask[j * nx + i] = clamp(Math.log10(1 + mmh) / 2, 0, 1);
  }
  // (the Gaussian as three running box sums each way, Wells 1986: the same spread, at a cost that does
  // not grow with it; shifted back along the motion as it goes)
  const blurred = boxBlur3(mask, nx, ny, sigma, Math.round(shiftX), Math.round(shiftY));
  let most = 0;
  for (let k = 0; k < blurred.length; k++) if (blurred[k] > most) most = blurred[k];
  if (!(most > 0)) return null;
  const share = Float32Array.from(blurred, b => b / most), out = Float32Array.from(share, b => smoothstep(POOL_EDGE[0], POOL_EDGE[1], b));
  let steepest = 0;
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i, g = Math.hypot(out[k + 1] - out[k - 1], out[k + nx] - out[k - nx]) / (2 * res);
    if (g > steepest) steepest = g;
  }
  if (!(steepest > 0)) return null;
  // Each cell as the scan reads it, once: the footprint's share, how fast it changes (per km, east
  // and south) and how fast the pool's eased edge does - five values side by side.
  const cells = new Float32Array(5 * nx * ny), slope = (field, k, i, n, step) =>
    (field[i < n - 1 ? k + step : k] - field[i > 0 ? k - step : k]) / ((i > 0 && i < n - 1 ? 2 : 1) * res);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, c = 5 * k;
    cells[c] = share[k]; cells[c + 1] = slope(share, k, i, nx, 1); cells[c + 2] = slope(share, k, j, ny, nx);
    cells[c + 3] = slope(out, k, i, nx, 1); cells[c + 4] = slope(out, k, j, ny, nx);
  }
  return { strength, x0, y0, res, nx, ny, cells, edgeKm: 1 / steepest };
}
// A Gaussian blur of sigma (cells) as three box blurs of width sqrt(4 sigma^2 + 1) each way (three
// boxes of width w have the variance 3 (w^2 - 1) / 12), the field moved by shift cells (x, y).
function boxBlur3(field, nx, ny, sigma, shiftX, shiftY) {
  const r = Math.max(0, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2)), width = 2 * r + 1;
  let a = Float32Array.from(field), b = new Float32Array(field.length);
  const pass = (from, to, n, m, step, line, shift) => {
    for (let l = 0; l < m; l++) {
      const base = l * line;
      let sum = 0;
      for (let q = -r; q <= r; q++) { const i = q - shift; if (i >= 0 && i < n) sum += from[base + i * step]; }
      for (let i = 0; i < n; i++) {
        to[base + i * step] = sum / width;
        const enter = i + r + 1 - shift, leave = i - r - shift;
        if (enter >= 0 && enter < n) sum += from[base + enter * step];
        if (leave >= 0 && leave < n) sum -= from[base + leave * step];
      }
    }
  };
  for (let k = 0; k < 3; k++) { pass(a, b, nx, ny, 1, nx, k === 0 ? shiftX : 0); [a, b] = [b, a]; }
  for (let k = 0; k < 3; k++) { pass(a, b, ny, nx, nx, 1, k === 0 ? shiftY : 0); [a, b] = [b, a]; }
  return a;
}

// The pool at a place (lx, ly km from the storm), bilinear, into POOL_AT: share (the spread
// footprint as a share of its most), shareX / shareY (its change per km east and south) and edgeX /
// edgeY (the eased edge's). False off its grid.
const POOL_AT = { share: 0, shareX: 0, shareY: 0, edgeX: 0, edgeY: 0 };
function poolAt(p, lx, ly) {
  const fx = (lx - p.x0) / p.res, fy = (ly - p.y0) / p.res;
  if (!(fx >= 0 && fy >= 0 && fx <= p.nx - 1 && fy <= p.ny - 1)) return false;
  const i = Math.min(p.nx - 2, fx | 0), j = Math.min(p.ny - 2, fy | 0), tx = fx - i, ty = fy - j, c = p.cells;
  const a = 5 * (j * p.nx + i), b = a + 5, d = a + 5 * p.nx, e = d + 5;
  const wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wd = (1 - tx) * ty, we = tx * ty;
  POOL_AT.share = c[a] * wa + c[b] * wb + c[d] * wd + c[e] * we;
  POOL_AT.shareX = c[a + 1] * wa + c[b + 1] * wb + c[d + 1] * wd + c[e + 1] * we;
  POOL_AT.shareY = c[a + 2] * wa + c[b + 2] * wb + c[d + 2] * wd + c[e + 2] * we;
  POOL_AT.edgeX = c[a + 3] * wa + c[b + 3] * wb + c[d + 3] * wd + c[e + 3] * we;
  POOL_AT.edgeY = c[a + 4] * wa + c[b + 4] * wb + c[d + 4] * wd + c[e + 4] * we;
  return true;
}

// What the scene reads from each cell.
function sceneEnv(world, w, h, cs, n) {
  const env = {
    w, h, cs,
    terrain: new Float32Array(n), freezing: new Float32Array(n), top: new Float32Array(n), blDepth: new Float32Array(n),
    // Height of the -20 °C level above the ground (m), where hail grows fastest.
    minus20: new Float32Array(n),
    // Virtual temperature at the surface (K): how dense the air is, for the boundaries.
    virtualK: new Float32Array(n),
    // How fast the air's refractivity falls with height between the ground and 850 hPa (N units
    // per km): how much the air near the ground bends a radar beam down.
    refractivityGradient: new Float32Array(n),
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
    env.minus20[i] = Math.max(env.freezing[i] + 500, temperatureLevelAgl(levels.map((level, k) => ({ h: env.levelHeight[k][i], t: level.t })), -20, 7000));
    const elAgl = Number(cell.derived?.sounding?.elM) - elev;
    env.top[i] = Number.isFinite(elAgl) && elAgl > 0 ? clamp(elAgl, 3000, 16500) : 11000;
    env.blDepth[i] = clamp(Number(cell.mesoscaleFields?.boundaryLayerDepthM) || 1200, 300, 3000);
    env.virtualK[i] = virtualTemperatureK(levels[0].t, (Number(cell.surface.dewpoint) - 32) * 5 / 9);
    const surfaceN = refractivity(Number(cell.surface.pressure) || 1000, levels[0].t, (Number(cell.surface.dewpoint) - 32) * 5 / 9);
    const aloftN = refractivity(850, Number(cell.levels[850]?.temperature), Number(cell.levels[850]?.dewpoint));
    env.refractivityGradient[i] = Number.isFinite(surfaceN) && Number.isFinite(aloftN) ? (aloftN - surfaceN) / Math.max(0.3, (env.levelHeight[1][i] - env.levelHeight[0][i]) / 1000) : CLUTTER.standardDnDh;
  });
  return env;
}

// echoes: buildStormEcho's result for each of inputs.storms, in order.
export function assembleRadarScene(inputs, echoes) {
  const { validHourUtc, localHour, domainWidthKm, domainHeightKm, env, boundaries } = inputs, storms = [];
  inputs.storms.forEach(({ x, y, motion, top, freezing, seed, weight, rise, riseDzM, poolRadiusKm }, k) => {
    const echo = echoes[k];
    if (!echo) return;
    const pool = echo.radarColdPool !== undefined ? echo.radarColdPool : coldPoolOf(echo, motion, poolRadiusKm);
    storms.push({
      x, y, echo, motion, top, freezing, seed, tornadoDepthM: tornadoDepthM(echo.tornado?.windMs ?? 0), weight, rise, riseDzM, pool,
      gustDepthM: pool ? coldPoolDepthM(pool.strength) : 0, gustSpeedMs: pool ? coldPoolSpeedMs(pool.strength) : 0
    });
  });
  const scene = {
    validHourUtc, localHour, insectZ: 10 ** (biologicalDbz(localHour) / 10), domainWidthKm, domainHeightKm, env, storms, boundaries,
    stormBins: binItems(storms, STORM_BIN_KM, domainWidthKm, domainHeightKm, s => [
      s.x + Math.min(s.echo.minX, s.pool?.x0 ?? Infinity), s.y + Math.min(s.echo.minY, s.pool?.y0 ?? Infinity),
      s.x + Math.max(s.echo.maxX, s.pool ? s.pool.x0 + (s.pool.nx - 1) * s.pool.res : -Infinity), s.y + Math.max(s.echo.maxY, s.pool ? s.pool.y0 + (s.pool.ny - 1) * s.pool.res : -Infinity)]),
    boundaryBins: binItems(boundaries, BOUNDARY_BIN_KM, domainWidthKm, domainHeightKm, b =>
      [Math.min(b.ax, b.bx) - 4, Math.min(b.ay, b.by) - 4, Math.max(b.ax, b.bx) + 4, Math.max(b.ay, b.by) + 4]),
    stormMotion: meanStormMotion(storms, env, domainWidthKm / 2, domainHeightKm / 2, Infinity)
  };
  return scene;
}

// ---------------------------------------------------------------------------
// Scan: one tilt of one site, all products at once.

// gateKm: the length of the gates (GATE_KM, or the finer gates a close look asks for, as the
// WSR-88D's 250 m); the scan reaches RADAR_RANGE_KM either way, so it has RADAR_RANGE_KM / gateKm gates.
export function scanRadarTilt(scene, site, tiltDeg, { gateKm = RADAR_GATE_KM } = {}) {
  const GATE_KM = gateKm, GATES = Math.round(RADAR_RANGE_KM / gateKm);
  const started = globalThis.performance?.now?.() ?? Date.now();
  const total = RADAR_RADIALS * GATES;
  const products = Object.fromEntries(RADAR_PRODUCT_KEYS.map(key => [key, new Uint8Array(total)]));
  const ref = products.reflectivity, vel = products.velocity, srv = products.stormRelativeVelocity;
  const cc = products.correlationCoefficient, zdr = products.differentialReflectivity;
  const sample = { zh: 0, zv: 0, cc: 0, hail: 0, zhOnly: false }, wind = { u: 0, v: 0 }, stormWind = { u: 0, v: 0 }, clearAir = { bl: 0, bioZ: 0 };
  const bioZ = 10 ** (biologicalDbz(scene.localHour) / 10);
  const beamHalfWidth = RADAR_BEAMWIDTH_DEG * DEG * 0.35;
  const cosTilt = Math.cos(tiltDeg * DEG);
  const siteHeightM = site.elevationM + RADAR_ANTENNA_HEIGHT_M;
  const leastHail = 10 ** (THREE_BODY.leastHailDbz / 10), threeBodyShare = 10 ** (-THREE_BODY.lossDb / 10), threeBodyZv = 10 ** (THREE_BODY.zdrDb / 10);
  const sw = products.spectrumWidth, foldGates = Math.round(DOPPLER.unambiguousKm / GATE_KM), phaseCoded = tiltDeg <= DOPPLER.phaseCodedUpToDeg;
  // How far down the air near the ground bends the beam at this radar (effective earth radius, km).
  const dNdh = envSample(scene.env, scene.env.refractivityGradient, site.xKm, site.yKm);
  const lowEarthKm = CLUTTER.earthKm / Math.max(0.02, 1 + CLUTTER.earthKm * Math.max(dNdh, CLUTTER.ductingDnDh) * 1e-6), sinTilt = Math.sin(tiltDeg * DEG);
  const clutterZ = 10 ** (CLUTTER.residualDbz / 10);
  // Storm-relative velocity takes off the motion of the storms this radar can see.
  const stormMotion = meanStormMotion(scene.storms, scene.env, site.xKm, site.yKm, RADAR_RANGE_KM), su = stormMotion.u, sv = stormMotion.v;
  // Noise differs from scan to scan and from product to product.
  const noiseSalt = tiltDeg + (Math.round(scene.validHourUtc * 12) % 4096) * 0.017;
  const gateGeometry = Array.from({ length: GATES }, (_, g) => {
    const range = (g + 0.5) * GATE_KM;
    // (lowEdgeM: the beam's lower edge above the antenna, bent as the air near the ground bends it.)
    const lowEdgeM = (Math.sqrt(range * range + lowEarthKm * lowEarthKm + 2 * range * lowEarthKm * sinTilt) - lowEarthKm) * 1000 - range * 0.5 * RADAR_BEAMWIDTH_DEG * DEG * 1000;
    return { range, ground: groundRangeKm(range, tiltDeg), heightM: beamHeightKm(range, tiltDeg) * 1000, spreadM: range * beamHalfWidth * 1000, minDbz: -32 + 20 * Math.log10(range), lowEdgeM };
  });

  for (const key of Object.keys(gateSums)) { if (gateSums[key]?.length !== total) gateSums[key] = new Float32Array(total); gateSums[key].fill(0); }
  const sumZh = gateSums.zh, sumZv = gateSums.zv, sumCc = gateSums.cc, sumStorm = gateSums.stormRadial, envRadial = gateSums.envRadial;
  const sumHail = gateSums.hail, spike = gateSums.spike, spikeRadial = gateSums.spikeRadial, clutter = gateSums.clutter, sumStorm2 = gateSums.stormRadial2;
  const sumFall = gateSums.fall, sumRise = gateSums.rise, measured = gateSums.measured, guess = gateSums.guess;
  measured.fill(NaN);

  // 1. Each radial on its own: the beam's depth (three samples up through it), and what the
  // echoes in it are doing. Velocity is weighted by how strongly each part reflects.
  for (let r = 0; r < RADAR_RADIALS; r++) {
    const az = (r + 0.5) * (360 / RADAR_RADIALS) * DEG, sinAz = Math.sin(az), cosAz = Math.cos(az);
    for (let g = 0; g < GATES; g++) {
      const geo = gateGeometry[g];
      const x = site.xKm + geo.ground * sinAz, y = site.yKm - geo.ground * cosAz;
      if (x < 0 || y < 0 || x >= scene.domainWidthKm || y >= scene.domainHeightKm) continue;
      const terrain = envSample(scene.env, scene.env.terrain, x, y);
      const centerAgl = siteHeightM + geo.heightM - terrain;
      if (centerAgl < 0) continue; // terrain blockage
      clearAir.bl = envSample(scene.env, scene.env.blDepth, x, y);
      clearAir.bioZ = centerAgl - geo.spreadM < clearAir.bl * 1.3
        ? bioZ * (0.4 + 0.9 * (fbm(911, x / 4, y / 4, scene.validHourUtc) * 0.5 + 0.5)) : 0;
      const index = r * GATES + g;
      // What the lowest part of the beam picks up off the ground (a target or not, fixed in place).
      const edgeAgl = siteHeightM + geo.lowEdgeM - terrain;
      if (edgeAgl < 8 * CLUTTER.fadeM) {
        const spot = gateNoise(Math.floor(x * 2) * 7919 + Math.floor(y * 2), 0.5);
        if (spot < CLUTTER.targets) clutter[index] = clutterZ * 10 ** (CLUTTER.varyDb * (2 * spot / CLUTTER.targets - 1) / 10) * Math.exp(-Math.max(0, edgeAgl) / CLUTTER.fadeM);
      }
      const bin = binAt(scene.stormBins, x, y), inStorm = bin !== null, freezingM = inStorm ? envSample(scene.env, scene.env.freezing, x, y) : 0;
      let zh = 0, zv = 0, ccw = 0, stormRadial = 0, stormRadial2 = 0, hail = 0, fall = 0, rising = 0;
      const boundaryBin = binAt(scene.boundaryBins, x, y);
      for (let o = 0; o < 3; o++) {
        const agl = centerAgl + BEAM_OFFSETS.k[o] * geo.spreadM, wgt = BEAM_OFFSETS.w[o];
        if (agl < 0) continue;
        sampleVolume(scene, bin, boundaryBin, x, y, agl, sample, clearAir);
        zh += sample.zh * wgt; zv += sample.zv * wgt; ccw += sample.cc * wgt; hail += sample.hail * wgt;
        if (inStorm && sample.zh > 0) {
          stormWindAt(bin, x, y, agl, stormWind);
          const along = stormWind.u * sinAz + stormWind.v * cosAz;
          stormRadial += sample.zh * wgt * along; stormRadial2 += sample.zh * wgt * along * along;
          fall += sample.zh * wgt * fallSpeedMs(sample.zh, agl, freezingM);
          rising += sample.zh * wgt * updraughtAt(bin, x, y, agl);
        }
      }
      if (zh <= 0) continue;
      sumZh[index] = zh; sumZv[index] = zv; sumCc[index] = ccw; sumStorm[index] = stormRadial; sumStorm2[index] = stormRadial2; sumFall[index] = fall; sumRise[index] = rising;
      envWindAt(scene.env, x, y, centerAgl, wind);
      envRadial[index] = wind.u * sinAz + wind.v * cosAz;
      if (hail >= leastHail) {
        // Three-body scattering from this gate's hail, spread over the gates beyond it (with the hail's motion).
        const offsetKm = centerAgl / 1000, source = hail * threeBodyShare, motion = envRadial[index] + stormRadial / zh;
        const first = Math.ceil(g + offsetKm / GATE_KM), last = Math.min(GATES - 1, Math.floor(g + (offsetKm + THREE_BODY.reachFades * THREE_BODY.fadeKm) / GATE_KM));
        for (let k = first; k <= last; k++) {
          const z = source * Math.exp(-((k - g) * GATE_KM - offsetKm) / THREE_BODY.fadeKm), at = r * GATES + k;
          spike[at] += z; spikeRadial[at] += z * motion;
        }
      }
    }
  }

  // 2. The beam's width: each gate takes in part of its neighbours on either side, a wider
  // strip of the storm the farther out it is. Then range folding, and the measurement's own noise.
  const power = new Float32Array(GATES);
  for (let r = 0; r < RADAR_RADIALS; r++) {
    const az = (r + 0.5) * (360 / RADAR_RADIALS) * DEG, sinAz = Math.sin(az), cosAz = Math.cos(az);
    const left = ((r + RADAR_RADIALS - 1) % RADAR_RADIALS) * GATES, right = ((r + 1) % RADAR_RADIALS) * GATES;
    // Every gate's echo first: the Doppler products need the one a Doppler range farther out.
    for (let g = 0; g < GATES; g++) {
      const index = r * GATES + g, l = left + g, n = right + g;
      power[g] = OWN_WEIGHT * (sumZh[index] + spike[index] + clutter[index]) + NEIGHBOUR_WEIGHT * (sumZh[l] + sumZh[n] + spike[l] + spike[n] + clutter[l] + clutter[n]);
    }
    for (let g = 0; g < GATES; g++) {
      const index = r * GATES + g, l = left + g, n = right + g;
      const echo = OWN_WEIGHT * sumZh[index] + NEIGHBOUR_WEIGHT * (sumZh[l] + sumZh[n]);
      const scattered = OWN_WEIGHT * spike[index] + NEIGHBOUR_WEIGHT * (spike[l] + spike[n]);
      const ground = OWN_WEIGHT * clutter[index] + NEIGHBOUR_WEIGHT * (clutter[l] + clutter[n]);
      const zh = echo + scattered + ground;
      const dbz = zh > 0 ? 10 * Math.log10(zh) : 0, snr = zh > 0 ? dbz - gateGeometry[g].minDbz : -1;
      // Range folding: an echo a Doppler range farther out, strong enough to be seen there, comes
      // back with this one; the motion here is lost where the two cannot be told apart.
      const far = g + foldGates < GATES ? power[g + foldGates] : 0;
      let folded = false;
      if (far > 0 && 10 * Math.log10(far) >= gateGeometry[g + foldGates].minDbz) {
        const ratio = snr >= 0 ? 10 * Math.log10(zh / far) + 20 * Math.log10(gateGeometry[g + foldGates].range / gateGeometry[g].range) : -Infinity;
        if (phaseCoded ? snr >= 0 && ratio < DOPPLER.phaseCodedDb : ratio < DOPPLER.plainDb) { vel[index] = srv[index] = sw[index] = RANGE_FOLDED; folded = true; }
      }
      if (snr < 0) continue;
      let zv = OWN_WEIGHT * sumZv[index] + NEIGHBOUR_WEIGHT * (sumZv[l] + sumZv[n]), ccw = OWN_WEIGHT * sumCc[index] + NEIGHBOUR_WEIGHT * (sumCc[l] + sumCc[n]);
      let stormRadial = OWN_WEIGHT * sumStorm[index] + NEIGHBOUR_WEIGHT * (sumStorm[l] + sumStorm[n]);
      let stormRadial2 = OWN_WEIGHT * sumStorm2[index] + NEIGHBOUR_WEIGHT * (sumStorm2[l] + sumStorm2[n]);
      // The wind of the air itself varies little across a beam; where this radial saw nothing, its neighbours' is used.
      let air = sumZh[index] > 0 ? envRadial[index] : sumZh[l] > 0 ? envRadial[l] : envRadial[n];
      if (!(echo > 0)) air = 0;
      if (scattered > 0) {
        // The scattered part moves with the hail it came from (stormRadial is relative to the air's wind).
        zv += scattered / threeBodyZv; ccw += scattered * THREE_BODY.rho;
        const moving = OWN_WEIGHT * spikeRadial[index] + NEIGHBOUR_WEIGHT * (spikeRadial[l] + spikeRadial[n]), relative = moving / scattered - air;
        stormRadial += moving - scattered * air; stormRadial2 += scattered * relative * relative;
      }
      if (ground > 0) {
        // Clutter stands still, with no one shape (ZDR anywhere from -4 to 4 dB) and poorly correlated.
        const target = gateNoise(index, 0.9);
        zv += ground / 10 ** ((8 * target - 4) / 10); ccw += ground * (0.35 + 0.5 * gateNoise(index, 0.95));
        stormRadial -= ground * air; stormRadial2 += ground * air * air;
      }
      const lowSnr = Math.exp(-snr / 6);
      const noise = gateNoise(index, noiseSalt) * 2 - 1, velocityNoise = gateNoise(index, noiseSalt + 0.003) * 2 - 1, polarNoise = gateNoise(index, noiseSalt + 0.006) * 2 - 1;
      ref[index] = encodeRadarValue('reflectivity', dbz + noise * (NOISE.dbz + 1.6 * lowSnr));
      // Along a raised beam the targets' vertical motion shows too: the air's rise less their fall.
      const falling = OWN_WEIGHT * sumFall[index] + NEIGHBOUR_WEIGHT * (sumFall[l] + sumFall[n]);
      const rise = OWN_WEIGHT * sumRise[index] + NEIGHBOUR_WEIGHT * (sumRise[l] + sumRise[n]);
      // Spectrum width: how much the motion varies among what the beam holds, and the air's own
      // turbulence; the estimate strays more the wider it is (velocityErrorMs), and where the echo is weak.
      const mean = stormRadial / zh, spread = Math.max(0, stormRadial2 / zh - mean * mean);
      const turbulence = echo > 0 && sumStorm2[index] > 0 ? TURBULENCE_MS.precipitation : TURBULENCE_MS.clearAir;
      const width = Math.sqrt(spread * cosTilt * cosTilt + turbulence * turbulence);
      // (the noise is even over -1..1, a standard deviation of 1 / sqrt 3 of its reach)
      const radial = (air + stormRadial / zh) * cosTilt + (rise - falling) / zh * sinTilt + velocityNoise * (Math.sqrt(3) * velocityErrorMs(width) + 1.2 * lowSnr);
      // (encoded below, folded and dealiased)
      if (!folded) { measured[index] = radial; guess[index] = air * cosTilt; }
      cc[index] = encodeRadarValue('correlationCoefficient', ccw / zh - Math.abs(polarNoise) * (NOISE.correlation + 0.22 * lowSnr));
      zdr[index] = encodeRadarValue('differentialReflectivity', 10 * Math.log10(zh / Math.max(1e-12, zv)) + polarNoise * (NOISE.zdrDb + 0.9 * lowSnr));
      if (folded) continue;
      sw[index] = encodeRadarValue('spectrumWidth', width + Math.abs(velocityNoise) * (0.4 + 2 * lowSnr));
    }
  }

  // 3. Velocity as the radar has it: folded into +-Vn (rawVelocity), then dealiased (velocity and
  // storm-relative velocity).
  dealias(measured, guess, gateSums.raw, gateSums.dealiased, GATES, GATE_KM);
  const rawVel = products.rawVelocity, raw = gateSums.raw, dealiased = gateSums.dealiased;
  for (let r = 0; r < RADAR_RADIALS; r++) {
    const az = (r + 0.5) * (360 / RADAR_RADIALS) * DEG, toward = (su * Math.sin(az) + sv * Math.cos(az)) * cosTilt;
    for (let g = 0, index = r * GATES; g < GATES; g++, index++) {
      if (vel[index] === RANGE_FOLDED) { rawVel[index] = RANGE_FOLDED; continue; }
      if (Number.isNaN(raw[index])) continue;
      rawVel[index] = encodeRadarValue('rawVelocity', raw[index]);
      vel[index] = encodeRadarValue('velocity', dealiased[index]);
      srv[index] = encodeRadarValue('stormRelativeVelocity', dealiased[index] - toward);
    }
  }
  return {
    siteId: site.id, tiltDeg, validHourUtc: scene.validHourUtc, stormMotion, products, gates: GATES, gateKm: GATE_KM,
    buildMs: (globalThis.performance?.now?.() ?? Date.now()) - started
  };
}

// measured: each gate's radial motion (m/s, NaN with none); guess: the environment's there. Fills
// raw (folded into +-Vn) and dealiased (see DEALIAS).
const DEALIAS_MARGIN_MS = 1e-6;
// (room for the neighbours of the finest gates, 125 m)
const NEIGHBOURS = new Float64Array((2 * DEALIAS.radials + 1) * (2 * Math.round(DEALIAS.alongKm / 0.125) + 1));
function dealias(measured, guess, raw, dealiased, GATES = RADAR_GATES, gateKm = RADAR_GATE_KM) {
  const along = Math.max(1, Math.round(DEALIAS.alongKm / gateKm));
  const twoVn = 2 * NYQUIST_MS, total = measured.length;
  for (let i = 0; i < total; i++) {
    const v = measured[i];
    if (Number.isNaN(v)) { raw[i] = NaN; dealiased[i] = NaN; continue; }
    const f = v - twoVn * Math.round(v / twoVn);
    raw[i] = f; dealiased[i] = f + twoVn * Math.round((guess[i] - f) / twoVn);
  }
  for (let pass = 0; pass < DEALIAS.passes; pass++) for (let r = 0; r < RADAR_RADIALS; r++) for (let g = 0; g < GATES; g++) {
    const i = r * GATES + g, f = raw[i];
    if (Number.isNaN(f)) continue;
    // (Where every neighbour lies within Vn of this gate, so does their median, and the gate stays
    // as it is: the median is then not worked out. The margin keeps clear of rounding at Vn itself.)
    const now = dealiased[i], low = now - NYQUIST_MS + DEALIAS_MARGIN_MS, high = now + NYQUIST_MS - DEALIAS_MARGIN_MS;
    let n = 0, near = true;
    for (let dr = -DEALIAS.radials; dr <= DEALIAS.radials; dr++) {
      const row = ((r + dr + RADAR_RADIALS) % RADAR_RADIALS) * GATES;
      for (let dg = -along; dg <= along; dg++) {
        const gg = g + dg;
        if ((dr === 0 && dg === 0) || gg < 0 || gg >= GATES) continue;
        const v = dealiased[row + gg];
        if (Number.isNaN(v)) continue;
        NEIGHBOURS[n++] = v;
        if (v <= low || v >= high) near = false;
      }
    }
    if (n < DEALIAS.least || near) continue;
    // (in order, for the median)
    for (let a = 1; a < n; a++) { const v = NEIGHBOURS[a]; let k = a; while (k > 0 && NEIGHBOURS[k - 1] > v) { NEIGHBOURS[k] = NEIGHBOURS[k - 1]; k--; } NEIGHBOURS[k] = v; }
    const median = n % 2 ? NEIGHBOURS[(n - 1) / 2] : 0.5 * (NEIGHBOURS[n / 2 - 1] + NEIGHBOURS[n / 2]);
    dealiased[i] = f + twoVn * Math.round((median - f) / twoVn);
  }
}

// Network mosaic of reflectivity on a Cartesian grid. Composite: the strongest echo any tilt of
// the nearest radar finds above each place. Base: what the lowest tilt that is not blocked
// finds there (a hybrid scan, as most public radar maps show), which shows the rain near the
// ground and not the anvil above it. Where that radar sees
// nothing (its beams blocked, or too high and too wide by then) the next radar is used. Far
// from every radar the lowest beam is already kilometres up, so a storm there shows only its
// upper parts. One byte per cell, row-major.
export const MOSAIC_RES_KM = 1;
const MOSAIC_CEILING_M = 19000;
export const mosaicSize = scene => ({ width: Math.ceil(scene.domainWidthKm / MOSAIC_RES_KM), height: Math.ceil(scene.domainHeightKm / MOSAIC_RES_KM) });
// rows: [first, end) builds only those rows (bytes then holds just them), so threads can share the work.
// Echo tops, VIL and hail size are worked out from the same tilts: what the nearest radar that
// sees a storm finds at each height above each place.
// (rotationTrack is not built here: the authority lays the radars' own low-level shear on this grid
// and keeps the greatest of the last hour, WeatherAuthorityRuntime.radarRotationTrack.)
export const MOSAIC_KINDS = ['composite', 'base', 'echoTops', 'vil', 'mesh', 'rotationTrack'];
export const MOSAIC_PRODUCT = { composite: 'reflectivity', base: 'reflectivity', echoTops: 'echoTops', vil: 'vil', mesh: 'mesh', rotationTrack: 'azShear' };
const STRUCTURE = { echoTopDbz: 18, leastVil: 0.5, leastMeshIn: 0.25 };
// The mosaics of each kind: buildRadarMosaics for every kind but the base one.
export function buildRadarMosaic(scene, sites, { rows = null, kind = 'composite' } = {}) {
  if (kind !== 'base') { const { bytes, ...rest } = buildRadarMosaics(scene, sites, { rows, kinds: [kind] }); return { ...rest, bytes: bytes[kind] }; }
  const started = globalThis.performance?.now?.() ?? Date.now();
  const { width, height } = mosaicSize(scene), [firstRow, endRow] = rows ?? [0, height];
  const bytes = new Uint8Array(width * (endRow - firstRow));
  // (zhOnly: the mosaics use the reflectivity alone, so ZDR's and CC's sums are not worked out)
  const sample = { zh: 0, zv: 0, cc: 0, hail: 0, zhOnly: true }, clearAir = { bl: 0, bioZ: 0 };
  const bioZ = 10 ** (biologicalDbz(scene.localHour) / 10);
  const tilts = mosaicTilts();
  const noiseSalt = 77 + (Math.round(scene.validHourUtc * 12) % 4096) * 0.017;
  const candidates = [];
  for (let j = firstRow; j < endRow; j++) for (let i = 0; i < width; i++) {
    const x = (i + 0.5) * MOSAIC_RES_KM, y = (j + 0.5) * MOSAIC_RES_KM;
    if (!nearestSites(sites, x, y, tilts, candidates)) continue;
    const terrain = envSample(scene.env, scene.env.terrain, x, y);
    clearAir.bl = envSample(scene.env, scene.env.blDepth, x, y);
    const stormBin = stormCeiling(scene, x, y) > 0;
    for (const { site, ground } of candidates) {
      const tx = -(y - site.yKm) / Math.max(ground, 1e-6), ty = (x - site.xKm) / Math.max(ground, 1e-6);
      let most = 0, mostSnr = 0;
      // The lowest tilt the ground does not block is the base scan, whatever it finds.
      for (let t = 0; t < tilts.length; t++) {
        const range = ground / tilts[t].cos;
        if (range > RADAR_RANGE_KM) break;
        const spread = range * tilts.beamHalfWidth * 1000;
        const agl = site.elevationM + RADAR_ANTENNA_HEIGHT_M + beamHeightKm(range, tilts[t].deg) * 1000 - terrain;
        if (agl < 0) continue;
        clearAir.bioZ = agl - spread < clearAir.bl * 1.3 ? bioZ * (0.4 + 0.9 * (fbm(911, x / 4, y / 4, scene.validHourUtc) * 0.5 + 0.5)) : 0;
        const zh = beamVolumeZh(scene, x, y, tx, ty, agl, spread, stormBin, sample, clearAir);
        const snr = zh > 0 ? 10 * Math.log10(zh) - (-32 + 20 * Math.log10(Math.max(range, 0.5))) : -1;
        if (snr >= 0) { most = zh; mostSnr = snr; }
        break;
      }
      if (most <= 0) continue;
      const noise = gateNoise(j * width + i, noiseSalt) * 2 - 1;
      bytes[(j - firstRow) * width + i] = encodeRadarValue('reflectivity', 10 * Math.log10(most) + noise * (NOISE.dbz + 1.6 * Math.exp(-mostSnr / 6)));
      break;
    }
  }
  return { width, height, rows: [firstRow, endRow], resKm: MOSAIC_RES_KM, kind: 'base', product: MOSAIC_PRODUCT.base, composite: false, validHourUtc: scene.validHourUtc, bytes, buildMs: (globalThis.performance?.now?.() ?? Date.now()) - started };
}

// Composite, echo tops, VIL and hail size (kinds: any of these) in one pass: the tilts of each
// radar above a place are sampled once, and every kind still wanting a value there is worked out
// from them. bytes: { kind: Uint8Array }. Each kind's bytes are those a pass for it alone gives.
export const STACKED_MOSAIC_KINDS = Object.freeze(['composite', 'echoTops', 'vil', 'mesh']);
export function buildRadarMosaics(scene, sites, { rows = null, kinds = STACKED_MOSAIC_KINDS } = {}) {
  if (!kinds.length || kinds.some(kind => !STACKED_MOSAIC_KINDS.includes(kind))) throw new Error(`buildRadarMosaics: kinds ${kinds} (the base mosaic is built alone)`);
  const heights = new Float64Array(RADAR_TILTS_DEG.length + 1), echoes = new Float64Array(RADAR_TILTS_DEG.length + 1), aboveFreezing = new Float64Array(RADAR_TILTS_DEG.length + 1);
  const started = globalThis.performance?.now?.() ?? Date.now();
  const { width, height } = mosaicSize(scene), [firstRow, endRow] = rows ?? [0, height];
  const bytes = Object.fromEntries(kinds.map(kind => [kind, new Uint8Array(width * (endRow - firstRow))]));
  const composite = bytes.composite ?? null, structures = kinds.filter(kind => kind !== 'composite'), found = new Uint8Array(structures.length);
  // (Hail size alone counts echo above the freezing level only: below it the beam need not be sampled.)
  const meshAlone = !composite && structures.length === 1 && structures[0] === 'mesh';
  // (zhOnly: the mosaics use the reflectivity alone, so ZDR's and CC's sums are not worked out)
  const sample = { zh: 0, zv: 0, cc: 0, hail: 0, zhOnly: true }, clearAir = { bl: 0, bioZ: 0 };
  const bioZ = 10 ** (biologicalDbz(scene.localHour) / 10);
  const tilts = mosaicTilts();
  const noiseSalt = 77 + (Math.round(scene.validHourUtc * 12) % 4096) * 0.017;
  const candidates = [];
  for (let j = firstRow; j < endRow; j++) for (let i = 0; i < width; i++) {
    const x = (i + 0.5) * MOSAIC_RES_KM, y = (j + 0.5) * MOSAIC_RES_KM, cell = (j - firstRow) * width + i;
    if (!nearestSites(sites, x, y, tilts, candidates)) continue;
    const terrain = envSample(scene.env, scene.env.terrain, x, y);
    clearAir.bl = envSample(scene.env, scene.env.blDepth, x, y);
    // Only where a storm stands is there anything for the higher tilts to find (or any structure).
    const ceiling = stormCeiling(scene, x, y), stormBin = ceiling > 0;
    let compositeLeft = composite !== null, structuresLeft = stormBin ? structures.length : 0;
    if (!compositeLeft && !structuresLeft) continue;
    found.fill(0);
    let freezing = meshAlone ? envSample(scene.env, scene.env.freezing, x, y) : NaN, minus20 = NaN;
    // The nearest radar that sees something there gives each kind its value; where it sees
    // nothing, the next one.
    for (const { site, ground } of candidates) {
      if (!compositeLeft && !structuresLeft) break;
      const tx = -(y - site.yKm) / Math.max(ground, 1e-6), ty = (x - site.xKm) / Math.max(ground, 1e-6);
      let most = 0, mostSnr = 0, samples = 0;
      for (let t = 0; t < (stormBin ? tilts.length : 1); t++) {
        const range = ground / tilts[t].cos;
        if (range > RADAR_RANGE_KM) break;
        const spread = range * tilts.beamHalfWidth * 1000;
        const agl = site.elevationM + RADAR_ANTENNA_HEIGHT_M + beamHeightKm(range, tilts[t].deg) * 1000 - terrain;
        if (agl < 0) continue;
        // (Nothing is up there: the profile ends with an empty sample.)
        if (agl - spread > Math.min(MOSAIC_CEILING_M, Math.max(ceiling, clearAir.bl * 1.3))) { heights[samples] = agl; echoes[samples++] = 0; break; }
        if (meshAlone && agl <= freezing) { heights[samples] = agl; echoes[samples++] = 0; continue; }
        clearAir.bioZ = t === 0 && agl - spread < clearAir.bl * 1.3 ? bioZ * (0.4 + 0.9 * (fbm(911, x / 4, y / 4, scene.validHourUtc) * 0.5 + 0.5)) : 0;
        const zh = beamVolumeZh(scene, x, y, tx, ty, agl, spread, stormBin, sample, clearAir);
        const floor = -32 + 20 * Math.log10(Math.max(range, 0.5)), dbz = zh > 0 ? 10 * Math.log10(zh) : -Infinity;
        heights[samples] = agl; echoes[samples++] = dbz >= floor ? zh : 0;
        if (zh > most && dbz - floor >= 0) { most = zh; mostSnr = dbz - floor; }
      }
      if (compositeLeft && most > 0) {
        const noise = gateNoise(j * width + i, noiseSalt) * 2 - 1;
        composite[cell] = encodeRadarValue('reflectivity', 10 * Math.log10(most) + noise * (NOISE.dbz + 1.6 * Math.exp(-mostSnr / 6)));
        compositeLeft = false;
      }
      if (!structuresLeft) continue;
      if (Number.isNaN(minus20)) { freezing = envSample(scene.env, scene.env.freezing, x, y); minus20 = envSample(scene.env, scene.env.minus20, x, y); }
      for (let n = 0; n < structures.length; n++) {
        if (found[n]) continue;
        const kind = structures[n];
        // (MESH counts echo above the freezing level only.)
        let column = echoes;
        if (kind === 'mesh') { for (let k = 0; k < samples; k++) aboveFreezing[k] = heights[k] <= freezing ? 0 : echoes[k]; column = aboveFreezing; }
        const value = structureValue(kind, heights, column, samples, terrain, freezing, minus20);
        if (!(value > 0)) continue;
        bytes[kind][cell] = encodeRadarValue(MOSAIC_PRODUCT[kind], value);
        found[n] = 1; structuresLeft--;
      }
    }
  }
  const one = kinds.length === 1 ? kinds[0] : null;
  return { width, height, rows: [firstRow, endRow], resKm: MOSAIC_RES_KM, kinds: [...kinds], kind: one, product: one ? MOSAIC_PRODUCT[one] : null, composite: one === 'composite', validHourUtc: scene.validHourUtc, bytes, buildMs: (globalThis.performance?.now?.() ?? Date.now()) - started };
}

// The tilts a mosaic samples, with the reach and beam width every place uses.
function mosaicTilts() {
  const tilts = RADAR_TILTS_DEG.map(deg => ({ deg, cos: Math.cos(deg * DEG) }));
  tilts.maxGround = groundRangeKm(RADAR_RANGE_KM, tilts[0].deg); tilts.beamHalfWidth = RADAR_BEAMWIDTH_DEG * DEG * 0.35;
  // (a little over maxGround squared: a radar past it is out of reach without the exact distance)
  tilts.outOfReach2 = tilts.maxGround * tilts.maxGround * (1 + 1e-9) + 1e-9;
  return tilts;
}
// Up to three in-range radars, nearest first, into candidates ({ site, ground }); false with none.
function nearestSites(sites, x, y, tilts, candidates) {
  candidates.length = 0;
  for (const site of sites) {
    const dx = x - site.xKm, dy = y - site.yKm;
    if (dx * dx + dy * dy > tilts.outOfReach2) continue;
    const ground = Math.hypot(dx, dy);
    if (ground > tilts.maxGround) continue;
    let k = candidates.length;
    while (k > 0 && candidates[k - 1].ground > ground) k--;
    if (k < 3) { candidates.splice(k, 0, { site, ground }); if (candidates.length > 3) candidates.pop(); }
  }
  return candidates.length > 0;
}
// The highest any storm with precipitation over a place could echo (m above the ground), 0 with none.
function stormCeiling(scene, x, y) {
  const bin = binAt(scene.stormBins, x, y);
  let ceiling = 0;
  if (bin) for (const s of bin) if (hasPrecipitation(s.echo, x - s.x, y - s.y)) ceiling = Math.max(ceiling, s.top * 1.15);
  return ceiling;
}
// Linear Z of one mosaic beam volume: the same volume as the single-site scans, once the beam is
// wider than a cell (across, toward tx, ty) or deeper than a level of the storm (up).
function beamVolumeZh(scene, x, y, tx, ty, agl, spread, stormBin, sample, clearAir) {
  const spreadKm = spread / 1000, across = stormBin && spreadKm > MOSAIC_RES_KM ? BEAM_OFFSETS : BEAM_CENTRE, up = spread > 400 ? BEAM_OFFSETS : BEAM_CENTRE;
  let zh = 0;
  for (let ia = 0; ia < across.k.length; ia++) {
    const sx = x + across.k[ia] * spreadKm * tx, sy = y + across.k[ia] * spreadKm * ty;
    const sampleBin = binAt(scene.stormBins, sx, sy), boundaryBin = binAt(scene.boundaryBins, sx, sy);
    for (let iu = 0; iu < up.k.length; iu++) {
      const z = agl + up.k[iu] * spread;
      if (z < 0) continue;
      sampleVolume(scene, sampleBin, boundaryBin, sx, sy, z, sample, clearAir);
      zh += sample.zh * across.w[ia] * up.w[iu];
    }
  }
  return zh;
}

// What the tilts above a place give (heights m above the ground, lowest first; linear Z):
//   echo tops: the height (kft above sea level) at which the echo falls below 18 dBZ, between
//     the highest tilt that reaches it and the one above (or that tilt, if none is above);
//   VIL (kg/m²): 3.44e-6 Z^(4/7) summed up through the column, Z no more than 56 dBZ (hail);
//   hail size (in): the severe hail index (Witt et al. 1998) - Z above 40 dBZ, more as it is
//     higher above the freezing level, up to the -20 °C level - and MESH = 2.54 SHI^0.5 mm.
function structureValue(kind, heights, echoes, count, terrainM, freezingM, minus20M) {
  const dbz = k => (echoes[k] > 0 ? 10 * Math.log10(echoes[k]) : -99);
  if (kind === 'echoTops') {
    let top = -1;
    for (let k = 0; k < count; k++) if (dbz(k) >= STRUCTURE.echoTopDbz) top = k;
    if (top < 0) return 0;
    let h = heights[top];
    if (top + 1 < count) { const a = dbz(top), b = Math.max(dbz(top + 1), -10); h += (heights[top + 1] - heights[top]) * (a - STRUCTURE.echoTopDbz) / Math.max(1e-6, a - b); }
    return (h + terrainM) / 304.8;
  }
  if (kind === 'vil') {
    let vil = 0;
    const liquid = k => 3.44e-6 * Math.min(echoes[k], 10 ** 5.6) ** (4 / 7);
    for (let k = 0; k + 1 < count; k++) vil += 0.5 * (liquid(k) + liquid(k + 1)) * Math.max(0, heights[k + 1] - heights[k]);
    return vil >= STRUCTURE.leastVil ? vil : 0;
  }
  let shi = 0;
  const growth = k => {
    const h = heights[k], weight = Math.min(1, Math.max(0, (dbz(k) - 40) / 10)), aloft = Math.min(1, Math.max(0, (h - freezingM) / (minus20M - freezingM)));
    return 5e-6 * 10 ** (0.084 * Math.min(dbz(k), 75)) * weight * aloft;
  };
  for (let k = 0; k + 1 < count; k++) if (heights[k + 1] > freezingM) shi += 0.1 * 0.5 * (growth(k) + growth(k + 1)) * Math.max(0, heights[k + 1] - Math.max(heights[k], freezingM));
  const meshIn = 2.54 * Math.sqrt(shi) / 25.4;
  return meshIn >= STRUCTURE.leastMeshIn ? meshIn : 0;
}
// MESH (in) from a column of linear Z at heights (m above the ground), as the mosaic works it out.
export const meshInches = (heights, echoes, count, freezingM, minus20M) => structureValue('mesh', heights, echoes, count, 0, freezingM, minus20M);

// ---------------------------------------------------------------------------
// Volume sampling: linear Zh, Zv (for ZDR) and Zh-weighted ρhv at one point.

const tmp = {};
// stormBin, boundaryBin: binAt(scene.stormBins / scene.boundaryBins, x, y), looked up once by the caller.
function sampleVolume(scene, stormBin, boundaryBin, x, y, agl, out, clearAir) {
  out.zh = 0; out.zv = 0; out.cc = 0; out.hail = 0;
  if (stormBin) for (const s of stormBin) stormHydrometeors(s, x - s.x, y - s.y, agl, out);
  clearAirEchoes(scene, stormBin, boundaryBin, x, y, agl, out, clearAir);
}

function addEcho(out, zh, zdrDb, rho) {
  if (!(zh > 0)) return;
  out.zh += zh;
  if (out.zhOnly) return;
  out.zv += zh / 10 ** (zdrDb / 10); out.cc += zh * rho;
}
// The same with ZDR given as a linear ratio (for the fixed ZDR of clear-air echoes, worked out once).
function addEchoRatio(out, zh, zdrRatio, rho) {
  if (!(zh > 0)) return;
  out.zh += zh;
  if (out.zhOnly) return;
  out.zv += zh / zdrRatio; out.cc += zh * rho;
}
const ZDR_4_5_DB = 10 ** (4.5 / 10), ZDR_5_5_DB = 10 ** (5.5 / 10);

// A storm's precipitation at one place, as a radar sees it: rain below the freezing level, ice
// above (which reflects a fifth as well), a bright band where snow melts, hail, and debris.
function stormHydrometeors(s, lx, ly, z, out) {
  const e = s.echo;
  if (lx < e.minX || ly < e.minY || lx > e.maxX || ly > e.maxY) return;
  precipitationEcho(e, s.freezing, lx, ly, z, out);
  const debris = sampleDebris(e, lx, ly, z);
  if (debris > 0) {
    const cell = Math.floor((lx + 99) * 7) * 977 + Math.floor((ly + 99) * 7);
    addEcho(out, DEBRIS_REFLECTIVITY * debris, (gateNoise(cell, s.seed) - 0.5) * 2, 0.25 + 0.35 * gateNoise(cell, s.seed + 0.5) ** 2);
  }
}
// The rain, snow and hail part of that (no debris), added to out's zh, zv, cc and hail (linear
// Z) at a place lx, ly km from the storm's centre and z m above the ground; fz is the freezing
// level. Returns the share of the precipitation there that is snow (not yet melted).
export function precipitationEcho(e, fz, lx, ly, z, out) {
  let snow = 0;
  if (samplePrecipitation(e, lx, ly, z, tmp)) {
    const frozen = smoothstep(fz - 300, fz + 700, z);
    if (tmp.rain > 0) {
      const zh = RAIN_REFLECTIVITY * tmp.rain;
      // Large wet snowflakes just below the freezing level reflect like giant drops.
      // (only below the ice: nothing reads it where the echo is all frozen)
      const melting = tmp.snow !== 0 && frozen < 1 ? tmp.snow * Math.exp(-(((z - fz + 150) / 350) ** 2)) : 0;
      // Rain carried above the freezing level in a strong updraught: large drops among the ice.
      const column = frozen > 0 ? liquidAloft(e, lx, ly, z - fz) : 0;
      if (frozen < 1) addEcho(out, zh * (1 - frozen) * (1 + 1.5 * melting), clamp(0.8 * tmp.sizeMm - 0.5, 0.15, 4.5) + melting, 0.992 - 0.06 * melting);
      if (frozen > 0) addEcho(out, zh * frozen * 0.2 * (1 + 2 * column), 0.3 + 2.8 * column, 0.985 - 0.02 * column);
      snow = tmp.snow * frozen;
    }
    if (tmp.hail > 0) {
      const wet = 1 - frozen;
      const hailZ = HAIL_REFLECTIVITY * tmp.hail * (0.35 + 0.65 * wet);
      addEcho(out, hailZ, 0.1 + 0.5 * wet, 0.92 - 0.06 * wet);
      out.hail += hailZ;
    }
  }
  return snow;
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

function clearAirEchoes(scene, storms, bin, x, y, z, out, { bl, bioZ }) {
  if (z > bl * 1.3) return;
  const depth = 1 - z / (bl * 1.3);
  // Insects concentrate in boundary convergence zones: fine lines along fronts,
  // drylines and outflow boundaries.
  if (bin) for (const b of bin) {
    const d = segmentDistance(x, y, b.ax, b.ay, b.bx, b.by);
    if (d < 4) addEchoRatio(out, b.z * Math.exp(-((d / b.widthKm) ** 2)) * depth, ZDR_4_5_DB, 0.45);
  }
  addEchoRatio(out, bioZ * depth, ZDR_5_5_DB, 0.38);
  // And along each storm's gust front, where its outflow runs into the air ahead: as along a
  // boundary, the insects go with the flow into it, here the cold pool's own density-current speed,
  // gathered FINE_LINE_KM either side of the front - the pool's leading edge, how far from it told
  // by how fast the spread footprint changes there.
  if (storms) for (const s of storms) {
    const p = s.pool;
    if (!p || z >= s.gustDepthM) continue;
    if (!poolAt(p, x - s.x, y - s.y)) continue;
    const slope = Math.hypot(POOL_AT.shareX, POOL_AT.shareY);
    if (!(slope > 0)) continue;
    const d = (POOL_AT.share - POOL_EDGE[0]) / slope;
    if (Math.abs(d) > 3 * FINE_LINE_KM) continue;
    addEchoRatio(out, scene.insectZ * s.gustSpeedMs / FINE_LINE_INFLOW_MS * Math.exp(-((d / FINE_LINE_KM) ** 2)) * depth * (1 - z / s.gustDepthM), ZDR_4_5_DB, 0.45);
  }
}

// How fast the air rises (m/s) at a place in the storms of a bin: each storm's strongest updraughts
// (PrecipitationField's cores: where, radius R km, peak speed w) with the storm's own profile in
// height, falling off across as exp(-(r/R)^2), as the frame draws it. The fastest there.
function updraughtAt(bin, x, y, z) {
  let w = 0;
  for (const s of bin) {
    const lx = x - s.x, ly = y - s.y, e = s.echo;
    if (!s.rise || !e.cores || lx < e.minX || ly < e.minY || lx > e.maxX || ly > e.maxY) continue;
    const k = Math.round(z / s.riseDzM);
    if (k < 0 || k >= s.rise.length || !(s.rise[k] > 0)) continue;
    for (const c of e.cores) {
      const dx = lx - c.x, dy = ly - c.y, r2 = (dx * dx + dy * dy) / (c.R * c.R);
      if (r2 < 9) { const rising = c.w * s.rise[k] * Math.exp(-r2); if (rising > w) w = rising; }
    }
  }
  return w;
}

// What storms add to the environmental wind: mesocyclone and tornado vortices, outflow away
// from the heavy rain near the ground, the rear-inflow jet and the anvil's outflow near the top.
// The low-level circulation under a mesocyclone: below fullBelowM it is narrower by up to tighten of the
// mesocyclone's radius and its wind faster by up to spinUp, in proportion to the storm's near-ground
// rotation, fading to the mesocyclone's own by depthM.
const LOW_MESO = { fullBelowM: 1000, depthM: 3000, tighten: 0.55, spinUp: 0.4 };
const gradient = {};
// bin: binAt(scene.stormBins, x, y).
function stormWindAt(bin, x, y, z, out) {
  out.u = 0; out.v = 0;
  if (!bin) return;
  // Mesocyclone: strongest at mid levels, present down to the ground in mature supercells.
  let mesoDepth = -1;
  for (const s of bin) {
    const lx = x - s.x, ly = y - s.y, e = s.echo;
    if (s.pool && z < s.gustDepthM) {
      // Rain-cooled air spreads out from under the storm, fastest at the gust front: the pool's
      // speed where its edge is sharpest, less where the edge is gentler, none well inside it.
      if (poolAt(s.pool, lx, ly)) {
        const k = s.gustSpeedMs * s.pool.edgeKm * (1 - z / s.gustDepthM);
        out.u += -k * POOL_AT.edgeX; out.v += k * POOL_AT.edgeY;
      }
    }
    if (lx < e.minX || ly < e.minY || lx > e.maxX || ly > e.maxY) continue;
    if (mesoDepth < 0) mesoDepth = 0.55 + 0.45 * Math.exp(-(((z - 4500) / 2600) ** 2));
    const lean = clamp(z / MESOCYCLONE_LEAN_M, 0, 1), meso = e.mesocyclone;
    // Near the ground a strengthening low-level circulation is tighter and spins faster than the
    // mesocyclone above it (2026-10-21: one radius at all heights, so the couplet at the lowest tilt
    // was the mid-level one, its peaks 4-5 miles apart).
    const tight = (meso.low ?? 0) * clamp((LOW_MESO.depthM - z) / (LOW_MESO.depthM - LOW_MESO.fullBelowM), 0, 1);
    addVortex(out, lx - meso.x - (meso.aloftX - meso.x) * lean, ly - meso.y - (meso.aloftY - meso.y) * lean, meso.radiusKm * (1 - LOW_MESO.tighten * tight), e.spin * e.mesocyclone.vmaxMs * mesoDepth * (1 + LOW_MESO.spinUp * tight) * (z > s.top ? 0.2 : 1), true);
    if (e.tornado && z < s.tornadoDepthM) addVortex(out, lx - e.tornado.x, ly - e.tornado.y, e.tornado.radiusKm, e.spin * e.tornado.vmaxMs * (1 - z / s.tornadoDepthM * 0.6));
    if (z > 0.7 * s.top) {
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
  // (far beyond it: no square root needed to tell)
  const reach = radiusKm * 12 * (1 + 1e-9);
  if (dx * dx + dy * dy > reach * reach) return;
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

// The moisture a storm works with, from the sounding where it stands: the water vapour in its
// lowest kilometre (g/m³, what its updraught draws in), the precipitable water (in) and the mean
// relative humidity 150-350 hPa above the ground (%, the air it mixes in on the way up).
function stormMoisture(world, x, y) {
  const cell = world.getCell(clamp(Math.floor(x / world.cellSizeKm), 0, world.width - 1), clamp(Math.floor(y / world.cellSizeKm), 0, world.height - 1));
  const sounding = cell ? buildSounding(cell) : null, profile = sounding?.profile;
  if (!profile?.length) return {};
  const ground = profile[0].heightM, surfaceP = profile[0].p, low = profile.filter(r => r.heightM - ground <= 1000), mid = profile.filter(r => r.p <= surfaceP - 150 && r.p >= surfaceP - 350);
  const vapour = r => 216.7 * 6.112 * Math.exp(17.67 * r.td / (r.td + 243.5)) / (r.t + 273.15);
  return {
    inflowVapourGm3: low.reduce((sum, r) => sum + vapour(r), 0) / low.length,
    precipitableWaterIn: Number(sounding.params?.precipWater),
    midLevelRh: mid.length ? mid.reduce((sum, r) => sum + r.rh, 0) / mid.length : undefined
  };
}

function levelWind(level) { return { dir: Number(level?.windDirection) || 0, spd: Number(level?.windSpeed) || 0, t: Number(level?.temperature) }; }

// Radio refractivity of air (N units) from pressure (hPa), temperature and dewpoint (°C).
function refractivity(pressureHpa, tempC, dewpointC) {
  if (!Number.isFinite(tempC) || !Number.isFinite(dewpointC)) return NaN;
  const kelvin = tempC + 273.15, vapourHpa = 6.112 * Math.exp(17.67 * dewpointC / (dewpointC + 243.5));
  return 77.6 / kelvin * (pressureHpa + 4810 * vapourHpa / kelvin);
}

function virtualTemperatureK(tempC, dewpointC) {
  if (!Number.isFinite(tempC)) return 288;
  const vapourHpa = Number.isFinite(dewpointC) ? 6.112 * Math.exp(17.67 * dewpointC / (dewpointC + 243.5)) : 0;
  return (tempC + 273.15) * (1 + 0.61 * 0.622 * vapourHpa / 1000);
}

// Height above the ground where the temperature falls through tempC (fallback if it never does).
function temperatureLevelAgl(levels, tempC, fallback) {
  for (let k = 0; k < levels.length - 1; k++) {
    const a = levels[k], b = levels[k + 1];
    if (!Number.isFinite(a.t) || !Number.isFinite(b.t)) continue;
    if (a.t >= tempC && b.t < tempC) return a.h + (b.h - a.h) * (a.t - tempC) / (a.t - b.t);
  }
  return Number.isFinite(levels[0].t) && levels[0].t < tempC ? 0 : fallback;
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
