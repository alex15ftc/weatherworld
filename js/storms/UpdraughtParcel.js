// The updraught's entraining parcel (docs/research/ENGINE-PHYSICS-PLAN.md, Phase 2 step 2): air from
// the storm's inflow lifted through its sounding, mixing in the air round it as it rises. The engine
// takes from it how much of parcel theory's updraught a storm keeps and how high its top goes; the
// frame builder (StormStructure.js) draws the same parcel.
//
//   parcel      the inflow's lowest PARCEL.layerM mixed (a storm fed from aloft: the 500 m layer of
//               the lowest 3 km with the highest equivalent potential temperature, the most unstable
//               one), lifted dry to its LCL and moist above, cloud water carried until it turns to
//               precipitation (over autoQc, autoPerKm of the excess a km)
//   entrainment above cloud base it mixes in the air round it at eps = entrain / R per metre for a
//               core of radius R (Morton, Taylor and Turner 1956; plume theory's 0.2 / R)
//   speed       dw2/dz = 2 B / 1.5 - 2 eps w2: buoyancy less the drag of the air it must push aside
//               (virtual mass, a third of the buoyancy) and of the still air it takes in
//   top         where w reaches zero above the equilibrium level: the overshooting top
//   kept        the entraining parcel's peak over the same parcel's unmixed one, times sqrt(1.5) so
//               it is the share of parcel theory's sqrt(2 CAPE) the updraught keeps (observed about
//               0.5-0.8; Romps and Kuang 2010, Peters et al. 2019)
import { buildSounding } from '../sounding.js';
import { clamp } from '../scenarios/math.js';

export const PARCEL = Object.freeze({
  dz: 100,                    // step (m)
  entrain: 0.2,               // entrainment x core radius
  layerM: 500,                // the inflow layer mixed into the parcel
  feedSearchM: 3000,          // where an elevated storm's feed layer is looked for
  autoQc: 1e-3, autoPerKm: 0.8,
  inflowKm: 24                // the inflow sounding: this far back along the 0-1 km storm-relative wind
});

export const G = 9.81, CP = 1004, LV = 2.5e6, RV = 461.5, RD = 287;
const KT = 0.514444;
export const esat = tc => 6.112 * Math.exp(17.67 * tc / (tc + 243.5));      // hPa
export const qsat = (tc, p) => { const e = esat(tc); return 0.622 * e / Math.max(1, p - e); };
export const dewFromQ = (q, p) => { const e = Math.max(1e-3, q * p / (0.622 + q)), l = Math.log(e / 6.112); return 243.5 * l / (17.67 - l); };
export const lclM = (tc, tdc) => Math.max(0, 125 * (tc - tdc));

// The world cell the storm draws its inflow from: PARCEL.inflowKm back along the 0-1 km
// storm-relative wind at the storm's place.
export function inflowCell(world, storm) {
  const cellKm = world.cellSizeKm;
  const at = (xKm, yKm) => world.getCell(Math.min(world.width - 1, Math.max(0, Math.floor(xKm / cellKm))), Math.min(world.height - 1, Math.max(0, Math.floor(yKm / cellKm))));
  const here = buildSounding(at(storm.positionKm.x, storm.positionKm.y)).profile;
  const base = here[0].heightM;
  const low = here.filter(r => r.heightM - base <= 1000);
  const mu = low.reduce((a, r) => a + r.u, 0) / low.length * KT, mv = low.reduce((a, r) => a + r.v, 0) / low.length * KT;
  const sru = mu - storm.velocityKph.east / 3.6, srv = mv - storm.velocityKph.north / 3.6;
  const sr = Math.hypot(sru, srv) || 1;
  // upstream: against the storm-relative wind (the map's y is south: north = -y)
  const x = storm.positionKm.x - sru / sr * PARCEL.inflowKm, y = storm.positionKm.y + srv / sr * PARCEL.inflowKm;
  return at(x, y);
}

// A sounding with heights above ground, and its values at a height (u, v m/s).
export function soundingProfile(cell) {
  const rows = buildSounding(cell).profile;
  const z0 = rows[0].heightM;
  const P = rows.map(r => ({ z: r.heightM - z0, p: r.p, t: r.t, td: r.td, u: r.u * KT, v: r.v * KT }));
  const at = z => {
    if (z <= P[0].z) return P[0];
    for (let k = 1; k < P.length; k++) if (P[k].z >= z) {
      const a = P[k - 1], b = P[k], f = (z - a.z) / Math.max(1e-6, b.z - a.z);
      return { z, p: a.p + f * (b.p - a.p), t: a.t + f * (b.t - a.t), td: a.td + f * (b.td - a.td), u: a.u + f * (b.u - a.u), v: a.v + f * (b.v - a.v) };
    }
    return P[P.length - 1];
  };
  return { P, at };
}

// The base (m) of the 500 m layer in the lowest feedSearchM with the highest mean equivalent
// potential temperature: an elevated storm's feed.
export function mostUnstableBase(sd) {
  let best = -Infinity, base = 0;
  for (let b = 0; b + PARCEL.layerM <= PARCEL.feedSearchM; b += 250) {
    let s = 0, n = 0;
    for (let z = b; z <= b + PARCEL.layerM; z += 50) { const e = sd.at(z), T = e.t + 273.15; s += T * (1000 / e.p) ** 0.286 * Math.exp(LV * qsat(e.td, e.p) / (CP * T)); n++; }
    if (s / n > best) { best = s / n; base = b; }
  }
  return base;
}

// The parcel. Levels every dz from the ground: w (m/s; 0 below the feed layer), cloud water qc,
// precipitation made (kg/kg a level), the environment's temperature and the buoyancy B. coreM: the
// core's radius (Infinity: unmixed). fromM: the feed layer's base (0: the surface layer). epsIn: a
// mixing rate per metre to use in place of the core's (for one set by the environment).
export function liftParcel(sd, coreM, fromM = 0, epsIn = null) {
  const S = PARCEL, eps = epsIn ?? (Number.isFinite(coreM) ? S.entrain / Math.max(500, coreM) : 0);
  let th = 0, q = 0, n = 0;
  for (let z = fromM; z <= fromM + S.layerM; z += 50) { const e = sd.at(z); th += (e.t + 273.15) * (1000 / e.p) ** 0.286; q += qsat(e.td, e.p); n++; }
  th /= n; q /= n;
  const e0 = sd.at(fromM);
  let T = th * (e0.p / 1000) ** 0.286, qc = 0, lcl = null;
  const out = [];
  const zMax = sd.P[sd.P.length - 1].z, z0 = Math.ceil(fromM / S.dz) * S.dz;
  for (let z = 0; z < z0; z += S.dz) out.push({ z, w: 0, qc: 0, prod: 0, te: sd.at(z).t, B: 0 });
  // Pass 1: the parcel's buoyancy (entrainment is per metre, so it doesn't depend on its speed).
  for (let z = z0; z <= Math.min(zMax, 20000); z += S.dz) {
    const e = sd.at(z), Te = e.t + 273.15, qe = qsat(e.td, e.p);
    let prod = 0;
    if (z > z0) {
      const mix = lcl == null ? 0 : eps * S.dz; // (below cloud the plume is the mixed layer itself)
      T += (Te - T) * mix; q += (qe - q) * mix; qc *= 1 - mix;
      T -= G / CP * S.dz;
      for (let it = 0; it < 4; it++) {
        const qs = qsat(T - 273.15, e.p);
        if (q <= qs) break;
        const d = (q - qs) / (1 + LV * LV * qs / (CP * RV * T * T));
        T += LV / CP * d; q -= d; qc += d;
      }
      if (qc > 1e-5 && lcl == null) lcl = z;
      if (qc > S.autoQc) { prod = (qc - S.autoQc) * Math.min(1, S.autoPerKm * S.dz / 1000); qc -= prod; }
    }
    const Tv = T * (1 + 0.61 * q), Tve = Te * (1 + 0.61 * qe);
    out.push({ z, w: 0, qc, prod, te: e.t, B: z > z0 ? G * ((Tv - Tve) / Tve - qc) : 0 });
  }
  // The free convection: the layer of positive buoyancy with the most energy above the LCL. Below
  // it (a capped sounding) the storm's own lift carries the parcel: the engine has the storm.
  let best = 0, lfc = null, el = null;
  for (let k = 0; k < out.length; k++) {
    if (!(out[k].B > 0) || (lcl != null && out[k].z < lcl)) continue;
    let e = 0, m = k;
    while (m < out.length && out[m].B > 0) { e += out[m].B * S.dz; m++; }
    if (e > best) { best = e; lfc = out[k].z; el = out[Math.min(out.length - 1, m)].z; }
    k = m;
  }
  // Pass 2: its speed, dw2/dz = 2 B / 1.5 (virtual mass) - 2 eps w2.
  let w2 = 1, top = null;
  for (const l of out) {
    if (l.z < z0) continue;
    if (l.z > z0) w2 += S.dz * (2 * l.B / 1.5 - 2 * eps * w2);
    if (lfc == null || l.z < lfc) w2 = Math.max(w2, 1);
    if (w2 <= 0) { top = l.z; l.w = 0; break; }
    l.w = Math.sqrt(w2);
  }
  if (top != null) out.length = out.findIndex(l => l.z === top) + 1;
  top ??= out[out.length - 1].z;
  return { levels: out, lcl: lcl ?? lclM(e0.t, dewFromQ(q, e0.p)), el: el ?? top, top, th, q0: q, t0: e0.t, q0sfc: qsat(e0.td, e0.p), p0: e0.p };
}

// The updraught's width and mixing set by its environment (Peters et al. 2023, JAS 80:2165, "An
// analytic formula for entraining CAPE"): an updraught of radius R = 2 sigma H V / (alpha pi w), with
// H the equilibrium level, V the 0-1 km storm-relative inflow and w = sqrt(2 ECAPE), takes in air at
// eps = 2 k2 L / (Pr R2). ECAPE is found by iterating from the unmixed parcel's CAPE (ENV_ITERS
// times), so the width comes from the inflow and the sounding, never from the storm's own updraught:
// the feedback that collapsed supercells to 26 m/s on 2026-11-06 is gone (a stronger inflow widens,
// a stronger updraught narrows - stabilising). Measured 2026-11-07 (6 seeds x 6 days, no feedback):
// supercell parcels 34 / 44 / 52 m/s (10/50/90 %, observed 36-53), kept 0.56-0.73, R 1.8-3.3 km.
export const PETERS = Object.freeze({ sigma: 1.131, alpha: 0.8, k2: 0.18, mixLenM: 120, prandtl: 1 / 3, iters: 4, minRM: 500, maxRM: 10000 });
const capeOf = p => p.levels.reduce((s, l) => s + (l.z >= p.lcl && l.B > 0 ? l.B * PARCEL.dz : 0), 0);
const peakOf = p => Math.max(0, ...p.levels.map(x => x.w));
export function environmentParcel(world, storm, { elevated = false } = {}) {
  const cell = inflowCell(world, storm), hour = world.validHourUtc;
  const sd = soundingProfile(cell);
  const low = sd.P.filter(x => x.z <= 1000);
  const um = low.reduce((q, x) => q + x.u, 0) / low.length, vm = low.reduce((q, x) => q + x.v, 0) / low.length;
  const vsr = Math.round(Math.hypot(um - storm.velocityKph.east / 3.6, vm - storm.velocityKph.north / 3.6)); // (to 1 m/s, for the cache)
  const c = storm.envParcelCache;
  if (c && c.cell === cell && c.hour === hour && c.elevated === elevated && c.vsr === vsr) return c.result;
  const from = elevated ? mostUnstableBase(sd) : 0, P = PETERS;
  const pure = liftParcel(sd, Infinity, from);
  const H = Math.max(3000, pure.el);
  let ecape = capeOf(pure), mixed = null, R = NaN;
  for (let it = 0; it < P.iters && ecape > 1; it++) {
    R = clamp(2 * P.sigma * H * Math.max(1, vsr) / (P.alpha * Math.PI * Math.sqrt(2 * ecape)), P.minRM, P.maxRM);
    mixed = liftParcel(sd, R, from, 2 * P.k2 * P.mixLenM / (P.prandtl * R * R));
    ecape = capeOf(mixed);
  }
  // dilution: the share of parcel theory's speed the mixing leaves, sqrt(ECAPE / CAPE), both of this
  // parcel - Peters' w = sqrt(2 ECAPE) already holds the pressure drag and the dragged-along air (their
  // constants are fit to simulated updraught peaks), so the drawn parcel's 1/1.5 and drag (peakOf) are
  // not applied again (they cut it to ~0.73 more: supercells 35 m/s, 2026-11-07); and as a ratio it
  // carries over to the engine's own 100 hPa mixed-layer CAPE, where this parcel's 500 m feed holds
  // 4-59 % more
  const wPure = peakOf(pure), capePure = capeOf(pure);
  const result = mixed && capePure > 50
    ? { dilution: clamp(Math.sqrt(Math.max(0, ecape) / capePure), 0, 1), kept: clamp(peakOf(mixed) / (Math.sqrt(1.5) * wPure), 0, 1), peakMs: peakOf(mixed), topM: mixed.top, elM: mixed.el, radiusM: R }
    : null;
  Object.defineProperty(storm, 'envParcelCache', { value: { cell, hour, elevated, vsr, result }, writable: true, configurable: true, enumerable: false });
  return result;
}

// What the engine takes from the parcel for a storm with an updraught core of radius coreM: the
// share of parcel theory's updraught it keeps (see the header), its top and equilibrium level (m
// above ground). Kept per storm until its inflow cell, the atmosphere's hour or its core (to the
// nearest CORE_STEP_M) changes: the sounding only changes then, and a core rounded the same way
// gives the same answer whether kept or not. null where the parcel finds no free convection to measure the mixing against.
const CORE_STEP_M = 250;
export function updraughtParcel(world, storm, coreIn, { elevated = false } = {}) {
  const coreM = Math.max(CORE_STEP_M, Math.round(coreIn / CORE_STEP_M) * CORE_STEP_M);
  const cell = inflowCell(world, storm), hour = world.validHourUtc;
  const c = storm.parcelCache;
  if (c && c.cell === cell && c.hour === hour && c.elevated === elevated && c.coreM === coreM) return c.result;
  const sd = soundingProfile(cell), from = elevated ? mostUnstableBase(sd) : 0;
  const mixed = liftParcel(sd, coreM, from), pure = liftParcel(sd, Infinity, from);
  const peak = l => Math.max(0, ...l.levels.map(x => x.w));
  const wMixed = peak(mixed), wPure = peak(pure);
  const result = wPure * wPure > 1 + 2 * 50 / 1.5   // (some 50 J/kg of free buoyancy to measure against)
    ? { kept: clamp(wMixed / (Math.sqrt(1.5) * wPure), 0, 1), peakMs: wMixed, topM: mixed.top, elM: mixed.el }
    : null;
  Object.defineProperty(storm, 'parcelCache', { value: { cell, hour, elevated, coreM, result }, writable: true, configurable: true, enumerable: false });
  return result;
}
