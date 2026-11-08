// One storm's 3-D structure from the engine's own state and physics (docs/research/ENGINE-PHYSICS-PLAN.md,
// Phase 0). DISPLAY ONLY: nothing here is written back to the storm. It builds the same full frame
// the cloud model's workers send (js/cloudmodel/FrameCodec.js, VERSION 1), so clientFrame() cuts
// its near and far copies and the Roblox views draw it unchanged.
//
// Everything comes from the engine's storm and its inflow sounding:
//   parcel      an entraining parcel from the inflow's lowest 500 m (entrainment 0.2 / core radius,
//               Morton-Taylor): cloud base (its LCL), updraught speed with height (scaled to the
//               engine's updraughtMs, which stays the authority on strength), equilibrium level,
//               overshoot top, and where it makes precipitation
//   updraught   that profile across a Gaussian core on the engine's updraught, leaning from the
//               mesocyclone (the storm's position) at the ground to the updraught's place by 5 km
//   spin        the inflow's streamwise vorticity (SRH over depth x storm-relative wind), tilted and
//               stretched as far as the engine's mesocyclone and low-level rotation say: a Rankine
//               low-level mesocyclone on the storm's position and a mid-level one on the updraught
//   rain, hail  the storm's rain field (StormRainFields.js, PrecipitationField.js): the one the radar
//               scans, so the rain on the ground is the rain on the radar. Its reflectivity at the
//               ground as a rate (Z = 200 R^1.6, what a radar reading of it gives; hail as melted
//               water by the same)
//   anvil       ice spread at the equilibrium level by the storm-relative wind there and the top's
//               outflow, thinning as it falls out and sublimates, no longer than the storm's age
//   cold pool   the ground rain's footprint spread by the density current (ColdPool.js speed),
//               left behind by the storm's motion; its edge facing the inflow lifts a shelf cloud
//   one base    every low cloud's base is ONE surface: the lifting condensation level of the air
//               rising there (inflow mixed with the cool, moist outflow it ingests: the wall cloud
//               where the updraught meets the outflow) lowered by the pressure drop of the
//               mesocyclone and the tornado, drop / (rho g), air expanding into the low condensing
//               lower. The tornado's funnel is that same surface where its own drop takes it toward
//               the ground, so it widens smoothly into the wall cloud above it.
//   tornado     the engine's tornado (wind, width, place): a Rankine core (as FrameView draws),
//               upright near the ground and curving into the mesocyclone at the wall cloud
//
// buildStormFrame(world, storm, { seq, rainField }) -> { bytes (Uint8Array, full frame), info (numbers for checks) }.
// rainField: the storm's field if already in hand (null: none; left out: StormRainFields.js's).
import { inflowCell, soundingProfile, liftParcel as liftParcelAt, qsat, dewFromQ, lclM, G, CP, LV, RV, RD } from './UpdraughtParcel.js';
import { coldPoolSpeedMs, coldPoolDepthM, coldPoolDeficitK } from './ColdPool.js';
import { clamp, smoothstep } from '../scenarios/math.js';
import { coreMeanW, spinBudget } from './SpinBudget.js';
import { VERSION, BOX_FIELDS, NEST_FIELDS, HEADER, TORNADO, UPDRAUGHT } from '../cloudmodel/FrameCodec.js';
import { samplePrecipitation, hailFallSpeedMs, RAIN_REFLECTIVITY, HAIL_REFLECTIVITY } from './PrecipitationField.js';
import { rainFieldOf } from './StormRainFields.js';

const KT = 0.514444;
export const STRUCTURE = Object.freeze({
  nx: 64, ny: 64, dx: 1000,            // the box, as the model's
  boxLean: 0.25,                       // the storm sits up to this share of the box upwind of its centre (see buildStormFrame)
  nest: { n: 48, dx: 250 },            // the near nest, round the mesocyclone
  dz: 100,                             // parcel step (m)
  entrain: 0.2,                        // entrainment x core radius
  coreShare: 0.5,                      // the updraught core's radius / the engine's updraught radius
  wEdge: 1,                            // cloud where the rising air is at least this (m/s)
  leanTopM: 5000,                      // the updraught reaches its place downshear by this height
  autoQc: 1e-3, autoPerKm: 0.8,        // condensate over 1 g/kg turns to precipitation, 80% a km
  meltC: 0,
  stretch: 2,                          // low-level spin: the inflow's 0-1 km streamwise vorticity stretched this much at full low rotation
  zetaMax: 0.05,
  anvilTauS: 5400, anvilSpread: 0.3,   // anvil ice lifetime, lateral spread per km downwind
  coldPoolTauS: 900,                   // how long the outflow spreads before it is the storm's
  mixOutflow: [0.3, 0.5],              // outflow share of the air rising: everywhere it lies, plus in the updraught
  levels: [0.04, 0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 1], // (tornado levels, shares of the wall cloud's base, with the funnel's tip at the ground)
  funnelCapM: 500, ef0Mph: 65
});

const wetBulb = (tc, q, p) => { let tw = tc; for (let n = 0; n < 20; n++) { const qs = qsat(tw, p); tw -= (tw - tc + LV / CP * (qs - q)) / (1 + LV / CP * qs * 17.67 * 243.5 / (tw + 243.5) ** 2); } return Math.min(tc, tw); };
// Rankine vortex: the pressure drop at r (Pa; rho V^2 at the centre, cyclostrophic) and the swirl.
const rankineDrop = (r, R, V, rho) => R <= 0 || V <= 0 ? 0 : r < R ? rho * V * V * (1 - 0.5 * (r / R) ** 2) : 0.5 * rho * V * V * (R / r) ** 2;
const rankineV = (r, R, V) => R <= 0 ? 0 : r < R ? V * r / R : V * R / r;

// The inflow sounding: AGL heights, and helpers at a height.
const profileOf = (world, storm) => soundingProfile(inflowCell(world, storm));
// The entraining parcel (UpdraughtParcel.js), with the frame's step and mixing.
const liftParcel = (sd, coreM) => liftParcelAt(sd, coreM, 0);

// The updraught the frame draws, for measuring (js/storms/SpinBudget.js): its core radius (m) and its
// centre-line speed every dz from the ground (m/s, scaled to the engine's updraughtMs as below).
export function updraughtProfile(world, storm) {
  const upd = storm.geometry?.updraught ?? {};
  const coreM = STRUCTURE.coreShare * 1000 * clamp(upd.radiusKm ?? 4, 1.5, 10);
  const pr = liftParcel(profileOf(world, storm), coreM);
  const wPeak = Math.max(1, ...pr.levels.map(l => l.w));
  const wScale = clamp((storm.updraughtMs ?? wPeak) / wPeak, 0.2, 2);
  return { coreM, dz: STRUCTURE.dz, w: pr.levels.map(l => (l.z > pr.top ? 0 : l.w * wScale)), parcelPeakMs: wPeak, topM: pr.top, elM: pr.el, lclM: pr.lcl };
}

// The anvil (storm-relative wind at the equilibrium level, the top's outflow spreading it): at a
// place (x east, y north, metres from the storm's centre) its base, top (m above the ground) and
// ice (iwp, kg/m2), or null where there is none. sd: the inflow sounding; pr: the lifted parcel;
// U: the updraught's place; freezeZ: the freezing level. (The satellite's anvils, js/satellite/
// AnvilField.js, are fed by the same detrainment.)
function anvilOf({ storm, sd, pr, U, coreM, wPeak, wScale, um, vm, freezeZ }) {
  const S = STRUCTURE, g = storm.geometry ?? {}, top = pr.top, el = Math.min(pr.el, top);
  const e0 = sd.at(el), ua = [e0.u - um, e0.v - vm], uaS = Math.hypot(ua[0], ua[1]), dir = uaS > 1 ? [ua[0] / uaS, ua[1] / uaS] : [1, 0];
  const spreadMs = 0.3 * wPeak * wScale;
  const ageS = Math.max(600, (storm.ageHours ?? 1) * 3600);
  const maxDown = Math.min((uaS + spreadMs) * ageS, 1000 * (g.anvil?.lengthKm ?? 300)), maxUp = Math.max(0, spreadMs - uaS) * Math.min(ageS, S.anvilTauS);
  const detrainFlux = detrainment(pr, wScale, coreM).iceKgS;
  return (x, y) => {
    const ex = x - U[0], ey = y - U[1], s = ex * dir[0] + ey * dir[1], n = -ex * dir[1] + ey * dir[0];
    if (s > maxDown || s < -maxUp) return null;
    const half = coreM + S.anvilSpread * Math.abs(s) + 0.5 * spreadMs * Math.min(ageS, Math.abs(s) / Math.max(1, uaS + spreadMs));
    if (Math.abs(n) > half) return null;
    const fade = Math.exp(-Math.max(0, s) / Math.max(1000, (uaS + spreadMs) * S.anvilTauS)) * Math.exp(-Math.max(0, -s) / Math.max(500, maxUp || 500));
    const edge = 1 - (n / half) ** 2;
    const thick = (top - el + 2500) * Math.sqrt(fade * edge);
    if (thick < 300) return null;
    const iwp = detrainFlux * fade / (Math.max(5, uaS + spreadMs) * 2 * half);
    return { base: Math.max(el - 0.7 * thick, freezeZ + 1000), top: Math.max(el, top - 1500 * (1 - fade)) * (0.92 + 0.08 * edge), iwp };
  };
}

// What the updraught carries into its anvil: the air rising through the core a km below the
// equilibrium level (volumeM3S, m3/s) and the cloud ice it holds there (iceKgS, kg/s; air ~0.35
// kg/m3 at that height).
function detrainment(pr, wScale, coreM) {
  const S = STRUCTURE, top = pr.top, el = Math.min(pr.el, top), z = el - 1000;
  const w = Math.max(1, z > top ? 0 : pr.levels[clamp(Math.round(z / S.dz), 0, pr.levels.length - 1)].w * wScale);
  const volumeM3S = w * Math.PI * coreM * coreM;
  return { volumeM3S, iceKgS: 0.35 * volumeM3S * Math.max(5e-4, pr.levels[Math.min(pr.levels.length - 1, Math.round(el / S.dz))].qc) };
}

// A storm's cloud as seen from above (js/satellite): the updraught's top (top: where the lifted
// parcel stops; el: its equilibrium level, m above the ground), its core radius and place (U,
// metres from the storm's centre, y north), what it detrains into its anvil (detrainment), and the
// inflow sounding (sd.at(z)) and lifted parcel (pr).
export function stormCloudTop(world, storm) {
  const S = STRUCTURE, g = storm.geometry ?? {}, pos = storm.positionKm, upd = g.updraught ?? {};
  const U = Number.isFinite(upd.xKm) ? [(upd.xKm - pos.x) * 1000, -(upd.yKm - pos.y) * 1000] : [0, 0];
  const sd = profileOf(world, storm), coreM = S.coreShare * 1000 * clamp(upd.radiusKm ?? 4, 1.5, 10);
  const pr = liftParcel(sd, coreM), wPeak = Math.max(1, ...pr.levels.map(l => l.w));
  const wScale = clamp((storm.updraughtMs ?? wPeak) / wPeak, 0.2, 2);
  return { top: pr.top, el: Math.min(pr.el, pr.top), coreM, U, sd, pr, wScale, ...detrainment(pr, wScale, coreM) };
}

export function buildStormFrame(world, storm, { seq = 1, rainField } = {}) {
  const t0 = performance.now();
  const S = STRUCTURE, nx = S.nx, ny = S.ny, dx = S.dx;
  let anchorX = 0, anchorY = 0; // (where the storm is in the box: set from its winds below)
  const g = storm.geometry ?? {}, pos = storm.positionKm;
  const rel = part => part && Number.isFinite(part.xKm) ? [(part.xKm - pos.x) * 1000, -(part.yKm - pos.y) * 1000] : [0, 0];
  const um = (storm.velocityKph?.east ?? 0) / 3.6, vm = (storm.velocityKph?.north ?? 0) / 3.6;
  const sd = profileOf(world, storm);
  const upd = g.updraught ?? {}, U = rel(upd);
  const coreM = S.coreShare * 1000 * clamp(upd.radiusKm ?? 4, 1.5, 10);
  const pr = liftParcel(sd, coreM);
  const wPeak = Math.max(1, ...pr.levels.map(l => l.w));
  const wScale = clamp((storm.updraughtMs ?? wPeak) / wPeak, 0.2, 2);
  const top = pr.top, el = Math.min(pr.el, top), lclIn = pr.lcl;
  const wAtZ = z => { const k = clamp(Math.round(z / S.dz), 0, pr.levels.length - 1); return z > top ? 0 : pr.levels[k].w * wScale; };
  const centreAt = z => { const f = clamp(z / S.leanTopM, 0, 1); return [U[0] * f, U[1] * f]; };
  const wAt = (x, y, z) => { const c = centreAt(z); return wAtZ(z) * Math.exp(-(((x - c[0]) ** 2 + (y - c[1]) ** 2) / (coreM * coreM))); };
  const rho0 = pr.p0 * 100 / (RD * (pr.t0 + 273.15)), rhoG = rho0 * G;

  // Storm-relative winds (m/s): the mean over a layer, and the streamwise vorticity there.
  const srAt = z => { const e = sd.at(z); return [e.u - um, e.v - vm]; };
  const layerMean = (a, b) => { let su = 0, sv = 0, n = 0; for (let z = a; z <= b; z += 100) { const w = srAt(z); su += w[0]; sv += w[1]; n++; } return [su / n, sv / n]; };
  const sr01 = layerMean(0, 1000), sr03 = layerMean(0, 3000);
  // The box round the storm: its anvil and forward-flank rain go downwind along the storm-relative
  // wind at the equilibrium level, so the storm sits upwind in the box - by boxLean of the box at a
  // 10 m/s wind or more, less in lighter winds (centred in none) - leaving most of the box where its
  // cloud goes. (A long anvil still runs past it: the views fade the box's edge.)
  { const e = srAt(el), es = Math.hypot(e[0], e[1]), lean = S.boxLean * Math.min(1, es / 10);
    anchorX = (Math.floor((0.5 - lean * (es > 0 ? e[0] / es : 0)) * nx) - 0.5) * dx;
    anchorY = (Math.floor((0.5 - lean * (es > 0 ? e[1] / es : 0)) * ny) - 0.5) * dx; }
  const env = storm.environment ?? {};
  const omega01 = Math.abs(env.srh ?? 0) / (Math.max(3, Math.hypot(...sr01)) * 1000);
  const omega03 = Math.abs(env.srh03 ?? env.srh ?? 0) / (Math.max(3, Math.hypot(...sr03)) * 3000);
  const spinSign = storm.leftMover ? -1 : 1;
  // (the low-level rotation the storm has under it, occluding or not: an occluding mesocyclone still
  // spins, it is only being cut off from its inflow)
  const zetaLow = Math.min(S.zetaMax, clamp(Math.max(storm.lowRotation ?? 0, storm.lowRotationFree ?? 0), 0, 1.2) * S.stretch * omega01);
  // The mid-level mesocyclone's swirl at the core's radius: SpinBudget's (the inflow's streamwise spin
  // tilted by the core's mean rise over the mesocyclone's heights - Beltrami flow - and never holding
  // more energy than that rise), as organised as the engine says the mesocyclone is. Until 2026-11-07
  // it was the inflow's spin x min(2, peak w / Vsr): 69 m/s on seed 2's 21Z tornadic storm against
  // radar Vrot medians of 18-38 m/s for EF0-4+ (docs/storm-reference/mesocyclone-rotation-2026-11-06.md),
  // which swept its falling rain ~20 km round to the storm's rear.
  const wProfile = { w: pr.levels.map(l => (l.z > top ? 0 : l.w * wScale)), dz: S.dz, coreM };
  const organised = clamp(storm.mesocycloneStrength ?? 0, 0, 1);
  const sb = spinBudget(storm, env, wProfile);
  const Vmid = sb ? organised * sb.vMidMs
    : 0.5 * Math.min(S.zetaMax, organised * omega03 * Math.min(2, coreMeanW(wProfile) / Math.max(3, Math.hypot(...sr03)))) * coreM;
  const zetaMid = 2 * Vmid / coreM;
  const Rm = clamp(500 * (g.wallCloud?.radiusKm ?? 2), 500, 2500), Vm = zetaLow * Rm / 2;
  // the low-level mesocyclone fades into the mid-level one between 1 and 3 km
  const lowShare = z => 1 - smoothstep(1000, 3000, z);

  // The tornado (engine's, while down).
  const tor = storm.tornado?.onGround ? storm.tornado : null;
  let T = null;
  if (tor) {
    const V = (tor.windSpeedMph ?? 0) * 0.44704, W = (tor.widthYards ?? 0) * 0.9144;
    const swirl = Math.max(0, V - Math.hypot(um, vm));
    const R = V > 0 && W > 0 ? Math.max(10, Math.min(W / 2, (W / 2) * S.ef0Mph * 0.44704 / V)) : 0;
    const p = tor.positionKm ? [(tor.positionKm.x - pos.x) * 1000, -(tor.positionKm.y - pos.y) * 1000] : [0, 0];
    T = { x: p[0], y: p[1], R, V: swirl, Vg: V, drop: rho0 * swirl * swirl };
  }
  const torDrop = (x, y) => T ? rankineDrop(Math.hypot(x - T.x, y - T.y), T.R, T.V, rho0) : 0;
  // The low-level mesocyclone's centre: the storm's position, or the tornado while one is down - a
  // tornado forms inside its parent circulation, so the circulation (and the wall cloud its drop
  // lowers) is drawn round it. (Until 2026-11-07 it stayed on the storm's position: a tornado the
  // engine had moved 3 km off it - occlusion - leant 3 km sideways over its 700 m to the base.)
  const MC = T ? [T.x, T.y] : [0, 0];
  const mesoR = (x, y) => Math.hypot(x - MC[0], y - MC[1]);
  const mesoDrop = (x, y) => rankineDrop(mesoR(x, y), Rm, Vm, rho0);

  // Outflow air: cooled toward its wet bulb by the evaporation that made the cold pool, so moister.
  const cpS = clamp(storm.coldPoolStrength ?? 0, 0, 1), deficit = cpS > 0 ? coldPoolDeficitK(cpS) : 0;
  const tw = wetBulb(pr.t0, pr.q0sfc, pr.p0), cool = Math.min(deficit, pr.t0 - tw);
  const tOut = pr.t0 - cool, qOut = pr.q0sfc + CP * cool / LV;
  const spreadIn = pr.t0 - dewFromQ(pr.q0sfc, pr.p0);
  // The LCL of air with share f of outflow (its spread from the parcel's own LCL), unlowered.
  const lclMix = f => { const t = pr.t0 + f * (tOut - pr.t0), q = pr.q0sfc + f * (qOut - pr.q0sfc); return Math.max(0, lclIn - 125 * (spreadIn - (t - dewFromQ(q, pr.p0)))); };

  // Box coordinates of cell (i, j), storm-relative metres (x east, y north).
  const cx = i => (i - 0.5) * dx - anchorX, cy = j => (j - 0.5) * dx - anchorY;
  const N = nx * ny, col = (i, j) => (j - 1) * nx + (i - 1);
  const freezeZ = (() => { for (const l of sd.P) if (l.t <= S.meltC) return l.z; return 4000; })();

  // The anvil (anvilOf).
  const anvilAt = anvilOf({ storm, sd, pr, U, coreM, wPeak, wScale, um, vm, freezeZ });
  const ageS = Math.max(600, (storm.ageHours ?? 1) * 3600);

  // The wind round the two mesocyclones (the low one fading into the mid-level one with height).
  const swirlAt = (x, y, z) => {
    let u = 0, v = 0;
    const ls = lowShare(z);
    if (ls > 0 && Vm > 0) { const ex = x - MC[0], ey = y - MC[1], r = Math.hypot(ex, ey) || 1, s = spinSign * ls * rankineV(r, Rm, Vm) / r; u -= s * ey; v += s * ex; }
    if (Vmid > 0) { const c = centreAt(z), ex = x - c[0], ey = y - c[1], r = Math.hypot(ex, ey) || 1, s = spinSign * (1 - ls) * rankineV(r, coreM, Vmid) / r; u -= s * ey; v += s * ex; }
    return [u, v];
  };

  // Ground rain and hail (mm/h): the storm's rain field at the ground (in its frame: km from the
  // storm's centre, y south), each cell the mean reflectivity of 2 x 2 points across it. Rain is
  // the rate its reflectivity gives (Z = 200 R^1.6). Hail, as melted water, is the mass falling that
  // carries the hail's kinetic energy flux, 5e-6 x 10^(0.084 dBZ) W/m2 (Waldvogel; Witt et al. 1998,
  // as the radar's severe hail index takes it: from 40 dBZ, fully by 50, no more past 75), at the
  // storm's hail fall speed: mass flux = 2 E / v^2.
  const field = rainField === undefined ? rainFieldOf(world, storm) : rainField;
  const rainZ = new Float64Array(N), hailZ = new Float64Array(N), got = {}, hailVms = hailFallSpeedMs(storm);
  if (field) for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
    let zr = 0, zh = 0;
    for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) {
      const x = cx(i) + (a - 0.5) * dx / 2, y = cy(j) + (c - 0.5) * dx / 2;
      if (samplePrecipitation(field, x / 1000, -y / 1000, 0, got)) { zr += RAIN_REFLECTIVITY * got.rain; zh += HAIL_REFLECTIVITY * got.hail; }
    }
    rainZ[col(i, j)] = zr / 4; hailZ[col(i, j)] = zh / 4;
  }
  const rain = Array.from(rainZ, z => (z > 0 ? (z / 200) ** (1 / 1.6) : 0));
  const hail = Array.from(hailZ, z => {
    if (!(z > 0)) return 0;
    const dbz = Math.min(75, 10 * Math.log10(z)), energy = 5e-6 * 10 ** (0.084 * dbz) * clamp((dbz - 40) / 10, 0, 1);
    return 2 * energy / (hailVms * hailVms) * 3600; // kg/m2/s of water = mm/s
  });

  // The cold pool: the rain's footprint spread by the density current, left behind by the motion.
  const cpSpeed = cpS > 0 ? coldPoolSpeedMs(cpS) : 0, cpDepth = cpS > 0 ? coldPoolDepthM(cpS) : 0;
  const L = Math.max(1500, Math.min(cpSpeed * S.coldPoolTauS, 0.7 * 1000 * Math.max(2, storm.coldPoolRadiusKm ?? 10)));
  const mask = new Float64Array(N);
  for (let k = 0; k < N; k++) mask[k] = clamp(Math.log10(1 + rain[k]) / 2, 0, 1);
  // Gaussian blur, sigma L/2, separable; shifted back along the storm's motion by half the spread time
  const sigma = L / 2 / dx, rad = Math.ceil(2.5 * sigma), ker = [];
  for (let q = -rad; q <= rad; q++) ker.push(Math.exp(-0.5 * (q / sigma) ** 2));
  const ks = ker.reduce((a, b) => a + b, 0);
  const shI = Math.round(-um * S.coldPoolTauS / 2 / dx), shJ = Math.round(-vm * S.coldPoolTauS / 2 / dx);
  const tmp = new Float64Array(N), blurred = new Float64Array(N);
  for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { let s = 0; for (let q = -rad; q <= rad; q++) { const ii = i + q - shI; if (ii >= 1 && ii <= nx) s += mask[col(ii, j)] * ker[q + rad]; } tmp[col(i, j)] = s / ks; }
  for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { let s = 0; for (let q = -rad; q <= rad; q++) { const jj = j + q - shJ; if (jj >= 1 && jj <= ny) s += tmp[col(i, jj)] * ker[q + rad]; } blurred[col(i, j)] = s / ks; }
  let bMax = 0; for (let k = 0; k < N; k++) bMax = Math.max(bMax, blurred[k]);
  const out = new Float64Array(N);
  for (let k = 0; k < N; k++) out[k] = cpS > 0 && bMax > 0 ? smoothstep(0.15, 0.45, blurred[k] / bMax) : 0;
  const outAt = (x, y) => { const i = clamp(Math.round((x + anchorX) / dx + 0.5), 1, nx), j = clamp(Math.round((y + anchorY) / dx + 0.5), 1, ny); return out[col(i, j)]; };
  const gradOut = (i, j) => [(out[col(Math.min(nx, i + 1), j)] - out[col(Math.max(1, i - 1), j)]) / (2 * dx), (out[col(i, Math.min(ny, j + 1))] - out[col(i, Math.max(1, j - 1))]) / (2 * dx)];

  // THE base: the LCL of the air rising there, lowered by the pressure drop (see the header).
  const updLow = (x, y) => wAt(x, y, lclIn) / Math.max(1, wAtZ(lclIn));
  const mixAt = (x, y) => { const o = outAt(x, y); return o * (S.mixOutflow[0] + S.mixOutflow[1] * updLow(x, y)); };
  const baseUnlowered = (x, y) => lclMix(mixAt(x, y));
  const dropAt = (x, y) => mesoDrop(x, y) + torDrop(x, y);
  const baseAt = (x, y) => Math.max(0, baseUnlowered(x, y) - dropAt(x, y) / rhoG);


  // Columns: the cloud runs, ground fields.
  const bytes = { base1: new Uint8Array(N), top1: new Uint8Array(N), base2: new Uint8Array(N), top2: new Uint8Array(N) };
  const lowCloud = new Uint8Array(N);
  const box = new Uint8Array(N * BOX_FIELDS);
  const u8 = x => Math.min(255, Math.max(0, Math.floor(x + 0.5))), i8 = x => Math.min(127, Math.max(-127, Math.floor(x + 0.5)));
  const logRate = mmh => u8(40 * Math.log10(1 + Math.max(0, mmh)));
  const sfc = sd.at(0), z1 = 1000;
  let towerCols = 0, shelfCols = 0, anvilCols = 0, deckCols = 0, lowestBase = Infinity;
  const colRuns = new Array(N);
  for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
    const x = cx(i), y = cy(j), k = col(i, j), runs = [];
    const b = baseAt(x, y);
    // the updraught's cloud: where the rising air is at least wEdge, from the base up
    let zt = -1;
    for (let z = Math.max(b, 100); z <= top; z += 250) if (wAt(x, y, z) >= S.wEdge) zt = z;
    if (zt > b && wAt(x, y, Math.max(b, 100)) >= S.wEdge * 0.5) { runs.push([b, zt + 250]); towerCols++; }
    // (precipitation aloft is not cloud: outside the updraught it falls through descending, unsaturated
    // air, and the views draw it as rain falling from the cloud over it - RainView. Until 2026-11-07 it
    // was a cloud run from the base to its highest particle, which joined the anvil into one solid
    // slab from ~1 to 13 km over the whole forward flank.)
    // the shelf: the cold pool's edge facing the inflow lifts the inflow air past its LCL
    if (cpS > 0 && cpDepth > 0.6 * lclIn) {
      const gr = gradOut(i, j), gm = Math.hypot(gr[0], gr[1]);
      if (gm > 0) {
        const n = [-gr[0] / gm, -gr[1] / gm], sr = srAt(250), into = -(sr[0] * n[0] + sr[1] * n[1]);
        const o = out[k], lift = 4 * o * (1 - o) * clamp(into / 5, 0, 1);
        if (lift > 0.5) { runs.push([b, Math.max(b + 300, 1.4 * cpDepth)]); shelfCols++; }
      }
    }
    // the anvil
    const an = anvilAt(x, y);
    if (an) { runs.push([an.base, an.top]); anvilCols++; }
    colRuns[k] = runs; // (written once the stratiform deck is in: below)
    const o = k * BOX_FIELDS;
    box[o + 4] = logRate(rain[k]); box[o + 5] = logRate(hail[k]);
    box[o + 6] = i8(-deficit * out[k] * 10);
    // ground wind: the environment's, the outflow pushing out of the pool, the low-level mesocyclone
    const gr = gradOut(i, j), gm = Math.hypot(gr[0], gr[1]) || 1, push = cpSpeed * (0.5 * out[k] + 2 * out[k] * (1 - out[k]));
    const sw = swirlAt(x, y, 0);
    box[o + 7] = i8((sfc.u - gr[0] / gm * push * (gm > 1e-9 ? 1 : 0) + 0.5 * sw[0]) * 2);
    box[o + 8] = i8((sfc.v - gr[1] / gm * push * (gm > 1e-9 ? 1 : 0) + 0.5 * sw[1]) * 2);
    box[o + 9] = i8(wAt(x, y, 5000) * 2);
    const r1 = mesoR(x, y), zeta1 = spinSign * (r1 < Rm ? 2 * Vm / Rm : 0) * lowShare(z1) + (Math.hypot(x - centreAt(z1)[0], y - centreAt(z1)[1]) < coreM ? spinSign * 2 * Vmid / coreM * (1 - lowShare(z1)) : 0);
    box[o + 10] = i8(zeta1 * 1000);
    box[o + 11] = an ? u8(an.iwp / 0.05) : 0;
  }

  // Where the ground rain fell from. A drop reaching the ground at a column left its cloud upwind of
  // it: it drifted with the storm-relative wind all the way down, so from height h it moved
  // W(h) / v, W(h) the wind summed over the fall from h (m2/s) and v its fall speed (the median
  // drop for its rate: Marshall-Palmer D0 = 0.9 R^0.21 mm, Atlas's law). The views draw the shafts
  // slanting that way (the drift block, below; RainView). Rain whose way up meets none of the
  // storm's cloud above fell from a stratiform deck: ice grown in the slow mesoscale ascent above
  // the melting level, melting as it falls through 0 C and raining through the drier, sinking air
  // under it - the trailing (or forward) stratiform region of a line or a mature supercell. So
  // there the deck is drawn, at the point the rain left it: from the freezing level to the
  // equilibrium level. (Until 2026-11-07 nothing was drawn there: on seed 2 at 21Z most of the big
  // storms' radar rain - 52-82% - fell from clear sky.)
  const DRIFT_STEP = 250, DRIFT_TOP = Math.min(top, 13000);
  const drift = []; // [h, Wx, Wy]
  { let wx = 0, wy = 0; for (let h = 0; h <= DRIFT_TOP; h += DRIFT_STEP) { drift.push([h, wx, wy]); const w = srAt(h + DRIFT_STEP / 2); wx += w[0] * DRIFT_STEP; wy += w[1] * DRIFT_STEP; } }
  const fallOf = mmh => 9.65 - 10.3 * Math.exp(-0.6 * 0.9 * Math.max(0.1, mmh) ** 0.21); // (Atlas et al. 1973 for the median drop)
  const colAt = (x, y) => { const i = Math.floor((x + anchorX) / dx) + 1, j = Math.floor((y + anchorY) / dx) + 1; return i < 1 || j < 1 || i > nx || j > ny ? -1 : col(i, j); };
  const deckRun = [freezeZ, Math.max(freezeZ + 500, el)];
  const deckAt = new Uint8Array(N);
  for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
    const k = col(i, j);
    if (rain[k] + hail[k] < 0.5) continue;
    const v = fallOf(rain[k]), x = cx(i), y = cy(j);
    let found = false, src = -1;
    for (const [h, wx, wy] of drift) {
      const c = colAt(x - wx / v, y - wy / v);
      if (c < 0) break; // (fell from outside the box)
      if (colRuns[c].some(r => r !== deckRun && r[0] <= h && h <= r[1])) { found = true; break; } // (in a cloud there: a drop over a low cloud's top only passes through it)
      if (h <= freezeZ) src = c; // (the column the rain left the deck's base from)
    }
    // (every such column marks its own source: the deck is where all that rain came from, not just
    // enough of it to be crossed on the way down)
    if (!found && src >= 0 && !deckAt[src]) { deckAt[src] = 1; colRuns[src].push(deckRun); deckCols++; }
  }
  // The columns' cloud: the two lowest runs, overlapping ones joined.
  for (let k = 0; k < N; k++) {
    const runs = colRuns[k].sort((a, c) => a[0] - c[0]), merged = [];
    for (const r of runs) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1] + 300) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
    const o = k * BOX_FIELDS;
    if (merged[0]) { box[o] = Math.max(1, u8(merged[0][0] / 100)); box[o + 1] = u8(merged[0][1] / 100); if (merged[0][0] < 3000) { lowCloud[k] = 1; lowestBase = Math.min(lowestBase, merged[0][0]); } }
    if (merged[1]) { box[o + 2] = Math.max(1, u8(merged[1][0] / 100)); box[o + 3] = u8(merged[1][1] / 100); }
  }
  // The drift block (FrameCodec DRIFT): u8 levels, f32 hail fall speed (m/s), then per level u16
  // height (m) and f32 Wx, Wy (m2/s, x east, y north: the storm-relative wind summed from the ground
  // to that height). A shaft's point at height z is its ground point less W(z) / v.
  const driftBytes = new Uint8Array(5 + 10 * drift.length), dv = new DataView(driftBytes.buffer);
  dv.setUint8(0, drift.length); dv.setFloat32(1, hailVms, true);
  drift.forEach(([h, wx, wy], q) => { dv.setUint16(5 + 10 * q, h, true); dv.setFloat32(7 + 10 * q, wx, true); dv.setFloat32(11 + 10 * q, wy, true); });

  // The nest: 250 m round the mesocyclone. Its base is unlowered; its drop lowers it (FrameView
  // draws the cloud down by drop / (rho g)), so the two together are the base above.
  const NN = S.nest.n, ndx = S.nest.dx, X0 = anchorX - NN * ndx / 2, Y0 = anchorY - NN * ndx / 2;
  const nest = new Uint8Array(16 + NN * NN * NEST_FIELDS), nv = new DataView(nest.buffer);
  nv.setUint16(0, NN, true); nv.setUint16(2, NN, true); nv.setFloat32(4, ndx, true); nv.setFloat32(8, X0, true); nv.setFloat32(12, Y0, true);
  let no = 16, nestCloud = 0, deepest = 0;
  const torCirc = T ? 2 * Math.PI * T.R * T.V : 0;
  for (let j = 1; j <= NN; j++) for (let i = 1; i <= NN; i++) {
    const bx = X0 + (i - 0.5) * ndx, by = Y0 + (j - 0.5) * ndx, x = bx - anchorX, y = by - anchorY;
    const bi = clamp(Math.floor(bx / dx) + 1, 1, nx), bj = clamp(Math.floor(by / dx) + 1, 1, ny);
    const zb = baseUnlowered(x, y);
    // the drop over the cell (its mean: the tornado's core is smaller than a cell)
    let d = 0;
    for (let a = 0; a < 4; a++) for (let c = 0; c < 4; c++) d += dropAt(x + (a - 1.5) * ndx / 4, y + (c - 1.5) * ndx / 4);
    d /= 16;
    const lowered = Math.max(0, zb - d / rhoG);
    // (the tornado's own core is rising air too: where it is in the cell, its air reaches the lowered
    // condensation level and is cloud, whatever the box column round it says - so the wall cloud and
    // funnel exist over a tornado that sits off the 1 km updraught)
    const inCore = T && Math.abs(x - T.x) <= ndx / 2 + T.R && Math.abs(y - T.y) <= ndx / 2 + T.R;
    const cloudy = lowCloud[col(bi, bj)] === 1 || wAt(x, y, Math.max(100, lowered)) >= S.wEdge || Boolean(inCore);
    if (cloudy && lowered < 3000) { nestCloud++; deepest = Math.max(deepest, d / rhoG); }
    const sw = swirlAt(x, y, 0);
    let tu = 0, tv = 0, tz = 0;
    if (T) {
      const ex = x - T.x, ey = y - T.y, r = Math.hypot(ex, ey) || 1, s = spinSign * rankineV(r, T.R, T.V) / r;
      tu = -s * ey; tv = s * ex;
      if (Math.abs(ex) <= ndx / 2 && Math.abs(ey) <= ndx / 2) tz = spinSign * torCirc / (ndx * ndx);
    }
    const zl = spinSign * (mesoR(x, y) < Rm ? 2 * Vm / Rm : 0) + tz;
    nest[no] = cloudy && zb < 3000 ? Math.max(1, u8(zb / 25)) : 0;
    nv.setInt8(no + 1, i8((sfc.u + sw[0] + tu) * 2));
    nv.setInt8(no + 2, i8((sfc.v + sw[1] + tv) * 2));
    nv.setInt8(no + 3, i8(zl / 0.002));
    nest[no + 4] = cloudy ? u8(d / 10) : 0;
    no += NEST_FIELDS;
  }

  // The tornado block (FrameCodec TORNADO): its funnel is the base surface where its drop takes it
  // down - the wall cloud's base over it (Bt) is the same surface with only the mesocyclone's drop.
  let torBytes = null, torInfo = null;
  if (T) {
    const lm = baseUnlowered(T.x, T.y), dm = mesoDrop(T.x, T.y), Bt = Math.max(0, lm - dm / rhoG);
    const tip = Math.max(0, Bt - T.drop / rhoG);
    const funnel = z => {
      if (T.R <= 0) return 0;
      if (z >= Bt) return S.funnelCapM;
      const need = rhoG * (Bt - z), P = T.drop;
      if (need >= P) return 0;
      const r = need >= P / 2 ? T.R * Math.sqrt(2 * (1 - need / P)) : T.R * Math.sqrt(P / (2 * need));
      return Math.min(S.funnelCapM, r);
    };
    // upright at the ground, curving into the mesocyclone (the storm's position) at the base
    // (half the levels below the funnel's tip, for the lean; half in the condensed funnel, for its shape)
    const zs = tip > 20 ? [0.15, 0.45, 0.8, 1].map(q => q * tip).concat([0.3, 0.6, 0.85, 1].map(q => tip + q * (Bt - tip))) : S.levels.map(q => q * Bt);
    const levels = zs.map(z0 => { const z = Math.max(10, z0), q = Bt > 0 ? Math.min(1, z / Bt) : 1, s = q * q * (3 - 2 * q); return { z, dx: (MC[0] - T.x) * s, dy: (MC[1] - T.y) * s, funnel: funnel(z < Bt ? z : Bt - 0.05 * Math.max(10, Bt - tip)) }; });
    // (the top level, at the base itself, takes the funnel's width just under it: at the base the
    // funnel IS the base, drawn by the cloud and the nest, so it widens into it rather than ending in a lid)
    const efM = String(storm.tornado.estimatedEf ?? storm.tornado.ef ?? '').replace(/[^0-9]/g, ''), ef = efM === '' ? null : Number(efM);
    const u16 = x => Math.min(65535, Math.max(0, Math.floor(x + 0.5))), i16 = x => Math.min(32767, Math.max(-32767, Math.floor(x + 0.5)));
    torBytes = new Uint8Array(TORNADO + 8 * levels.length);
    const b = new DataView(torBytes.buffer);
    b.setUint8(0, 1 | (Bt > 0 ? 2 : 0)); b.setUint8(1, ef == null ? 255 : u8(ef));
    b.setUint16(2, u16(T.Vg / 0.44704), true); b.setUint16(4, u16(storm.tornado.widthYards ?? 0), true);
    b.setFloat32(6, T.x + anchorX, true); b.setFloat32(10, T.y + anchorY, true);
    b.setUint16(14, u16(T.R), true); b.setUint16(16, u16(T.drop), true); b.setUint16(18, u16(Bt), true); b.setUint16(20, u16(tip), true);
    b.setUint8(22, u8(T.Vg)); b.setUint8(23, u8(zetaLow / 0.005)); b.setInt8(24, 0); b.setUint16(25, u16(dm), true);
    b.setUint8(27, levels.length);
    levels.forEach((l, q) => { const o = TORNADO + 8 * q; b.setUint16(o, u16(l.z), true); b.setInt16(o + 2, i16(l.dx), true); b.setInt16(o + 4, i16(l.dy), true); b.setUint16(o + 6, Math.min(32767, u16(l.funnel)) | 32768, true); });
    torInfo = { R: Math.round(T.R), dropHpa: +(T.drop / 100).toFixed(1), wallBaseM: Math.round(Bt), tipM: Math.round(tip), mesoDropHpa: +(dm / 100).toFixed(1), at: [Math.round(T.x), Math.round(T.y)] };
  }

  // The updraught block (FrameCodec UPDRAUGHT, flags bit 4): what the views need of the rising air to
  // draw it - the updraught over the tornado (or the low-level mesocyclone without one) at the wall
  // cloud's base, for the vortex's swirl ratio (VisualAtmosphere.luau), the centre-line speed at the
  // cloud base, where the core is at 1 km and at leanTopM, and its radius. Display only, as the rest.
  const upBytes = new Uint8Array(UPDRAUGHT), uv = new DataView(upBytes.buffer);
  { const c1 = centreAt(1000), c5 = centreAt(S.leanTopM);
    // (the rise the vortex's corner flow feeds: the strongest in the 3 km over the wall cloud's base
    // there - at the base itself the parcel is still accelerating from rest)
    const px = T ? T.x : 0, py = T ? T.y : 0, b0 = Math.max(100, T ? baseUnlowered(px, py) - mesoDrop(px, py) / rhoG : lclIn);
    let wT = 0; for (let z = b0; z <= b0 + 3000; z += 250) wT = Math.max(wT, wAt(px, py, z));
    uv.setUint8(0, UPDRAUGHT);
    [wT, wAtZ(lclIn), c1[0] + anchorX, c1[1] + anchorY, c5[0] + anchorX, c5[1] + anchorY, coreM].forEach((v, q) => uv.setFloat32(1 + 4 * q, v, true)); }

  // The full frame.
  const outBytes = new Uint8Array(HEADER + box.length + nest.length + (torBytes?.length ?? 0) + driftBytes.length + upBytes.length);
  const h = new DataView(outBytes.buffer);
  h.setUint8(0, VERSION); h.setUint8(1, 1 | (torBytes ? 4 : 0) | 8 | 16); h.setUint32(2, seq, true);
  h.setFloat32(6, ageS, true); h.setFloat64(10, Number(world.stormEngine?.validHourUtc ?? world.validHourUtc) || 0, true);
  h.setUint16(18, nx, true); h.setUint16(20, ny, true); h.setFloat32(22, dx, true);
  h.setFloat32(26, anchorX, true); h.setFloat32(30, anchorY, true); h.setFloat32(34, um, true); h.setFloat32(38, vm, true);
  outBytes.set(box, HEADER); outBytes.set(nest, HEADER + box.length); if (torBytes) outBytes.set(torBytes, HEADER + box.length + nest.length);
  outBytes.set(driftBytes, HEADER + box.length + nest.length + (torBytes?.length ?? 0));
  outBytes.set(upBytes, HEADER + box.length + nest.length + (torBytes?.length ?? 0) + driftBytes.length);
  let rainMax = 0, hailMax = 0; for (let k = 0; k < N; k++) { rainMax = Math.max(rainMax, rain[k]); hailMax = Math.max(hailMax, hail[k]); }
  return {
    bytes: outBytes,
    info: {
      ms: +(performance.now() - t0).toFixed(1), rainField: Boolean(field), lclM: Math.round(lclIn), elM: Math.round(el), topM: Math.round(top), wPeakParcel: +wPeak.toFixed(1), wScale: +wScale.toFixed(2),
      zetaLow: +zetaLow.toFixed(4), zetaMid: +zetaMid.toFixed(4), mesoR: Math.round(Rm), mesoV: +Vm.toFixed(1), midV: +Vmid.toFixed(1), mesoDropHpa: +(rho0 * Vm * Vm / 100).toFixed(1),
      wallLclM: Math.round(lclMix(S.mixOutflow[0] + S.mixOutflow[1])), lowestBaseM: Math.round(lowestBase), deepestLoweringM: Math.round(deepest),
      rainMax: Math.round(rainMax), hailMax: Math.round(hailMax), coldPoolK: +deficit.toFixed(1), towerCols, shelfCols, anvilCols, deckCols, nestCloud,
      tornado: torInfo
    }
  };
}
