// The storms' anvils as one field (docs/research/RADAR-AND-SATELLITE.md, S1/S2): what every storm's
// updraught has carried up and spread out, for the satellite to see, merging into one shield where
// storms crowd and outliving the storms that made them.
//
// Each storm tick, each storm puts out a puff: the cloud ice its updraught detrains into the anvil
// in that time (StormStructure.stormCloudTop: the frame's own detrainment), at the height the
// overshooting air settles back to (halfway down from the parcel's top to its equilibrium level).
// A puff is the ring of the anvil that air becomes. An anvil spreads as a gravity current into the
// stable air at its height, as a volcano's umbrella cloud does: its edge at
//   R(t) = (3 lambda N Q t^2 / (2 pi))^(1/3)
// t after the air arrived, Q the volume of air arriving each second, N the stability there
// (Woods & Kienle 1994, J. Volcanol. Geotherm. Res. 62; lambda ~0.2, Costa et al. 2013). So the
// puff put out at age t lies between R(t - dt) and R(t) from where it came up, carried all the
// while by the wind at its height: where the spreading outruns the wind the anvil reaches upwind
// (the back-sheared edge); downwind it opens into a fan. Its ice goes as exp(-t / anvilTauS) (the
// frame's anvil lifetime: falling out and evaporating).
// Where the updraught overshoots the tropopause, most of the air above it falls back into the
// anvil, but some mixes into the stratosphere when the overshoot breaks (stratosphereShare of it,
// as its depth there over the whole overshoot: a tenth or less, Homeyer et al. 2017, JGR 122): it
// spreads there thinly, on the stratosphere's wind and as warm as the air there - the plume of
// cirrus above the anvil (Bedka et al. 2018, MWR 146) and the warm wake downwind of an
// overshooting top. Its ice comes out of the anvil's.
import { stormCloudTop, STRUCTURE } from '../storms/StormStructure.js';

export const ANVIL_FIELD = Object.freeze({
  stepHours: 1 / 12,            // a puff each storm tick
  lambda: 0.2,                  // the umbrella cloud's spreading constant
  spreadShare: 0.5,             // where the overshoot settles: this share of the way up from the EL
  lifeTaus: 4,                  // puffs dropped this many lifetimes old (2% of their ice left)
  tropopauseLapseKPerKm: 2,     // the tropopause: the lowest level above 6 km where the air cools
  tropopauseDepthM: 2000,       // less than this a km over the next 2 km (WMO)
  minN: 0.006,                  // (the stability used at least: a neutral layer would not hold it)
  stratosphereShare: 0.1        // of the overshoot above the tropopause, what stays up there
});

const G = 9.81, THETA = (t, p) => (t + 273.15) * (1000 / p) ** 0.286;

// The stability (N, 1/s) at height z of a sounding, over 1 km either side.
function stability(sd, z) {
  const a = sd.at(z - 1000), b = sd.at(z + 1000), ta = THETA(a.t, a.p), tb = THETA(b.t, b.p);
  return Math.max(ANVIL_FIELD.minN, Math.sqrt(Math.max(0, G / ((ta + tb) / 2) * (tb - ta) / 2000)));
}
// The tropopause (m above the ground) of a sounding at or above a height, or its top.
function tropopause(sd, from = 6000) {
  const top = sd.P[sd.P.length - 1].z, d = ANVIL_FIELD.tropopauseDepthM;
  for (let z = Math.max(6000, from); z + d <= top; z += 100) if ((sd.at(z).t - sd.at(z + d).t) / (d / 1000) < ANVIL_FIELD.tropopauseLapseKPerKm) return z;
  return top;
}
// Where a storm was at an hour (its track, between the points either side).
function placeAt(storm, hourUtc) {
  const t = storm.trackPoints ?? [];
  if (!t.length || hourUtc >= t[t.length - 1].hourUtc) return storm.positionKm;
  if (hourUtc <= t[0].hourUtc) return t[0];
  let k = t.length - 1;
  while (k > 0 && t[k - 1].hourUtc > hourUtc) k--;
  const a = t[k - 1], b = t[k], f = (hourUtc - a.hourUtc) / Math.max(1e-9, b.hourUtc - a.hourUtc);
  return { x: a.x + f * (b.x - a.x), y: a.y + f * (b.y - a.y) };
}

export class AnvilField {
  constructor() {
    this.puffs = [];              // { t0, x, y, u, v (km/h east, south), iceKg, volumeM3S, n, z (m above sea level), tK, coreKm, stepKm, plume }
    this.emittedTo = new Map();   // storm id -> the hour its puffs are put out to
    this.tops = new Map();        // storm id -> its cloud top now (stormCloudTop), for the satellite's domes
    this.hourUtc = null;
  }

  // Bring the field up to the storms' hour: each storm's puffs since it was last seen (from its
  // start, or the field's lifetime ago, the first time: its track says where it was).
  update(world) {
    const F = ANVIL_FIELD, now = Number(world.stormEngine?.validHourUtc ?? world.validHourUtc) || 0, lifeH = F.lifeTaus * STRUCTURE.anvilTauS / 3600;
    if (this.hourUtc != null && now < this.hourUtc - 1e-9) { this.puffs = []; this.emittedTo.clear(); } // (the clock went back: a new world)
    this.hourUtc = now;
    this.tops.clear();
    const cellKm = world.cellSizeKm;
    for (const storm of world.storms ?? []) {
      if (storm.active === false || !storm.positionKm || !storm.geometry) continue;
      const ct = stormCloudTop(world, storm), pos = storm.positionKm;
      this.tops.set(storm.id, { ct, storm });
      const from = Math.max(this.emittedTo.get(storm.id) ?? Number(storm.createdHourUtc ?? now - lifeH), now - lifeH);
      // (puffs a whole number of steps apart up to now: the storms' clock is rounded to 6 decimals)
      const count = Math.round((now - from) / F.stepHours);
      if (!(count > 0)) continue;
      this.emittedTo.set(storm.id, now);
      const cell = world.getCell(Math.min(world.width - 1, Math.max(0, Math.floor(pos.x / cellKm))), Math.min(world.height - 1, Math.max(0, Math.floor(pos.y / cellKm))));
      const ground = cell?.terrain?.elevationM ?? 0, sd = ct.sd;
      // The anvil: where the overshoot settles, as cold as air lifted dry-adiabatically there.
      const zA = ct.el + F.spreadShare * Math.max(0, ct.top - ct.el), tEl = sd.at(ct.el).t;
      // Above the tropopause: what of the overshoot stays in the stratosphere, at the air's own temperature there.
      // (the tropopause looked for from 1 km under the equilibrium level up: an inversion lower down is not it)
      const trop = Math.min(tropopause(sd, ct.el - 1000), ct.top), above = ct.top > trop ? Math.min(1, (ct.top - trop) / Math.max(1, ct.top - ct.el)) : 0;
      const zP = (trop + ct.top) / 2, share = F.stratosphereShare * above;
      const plume = share > 0 ? { z: zP, tK: sd.at(zP).t + 273.15, wind: sd.at(zP), n: stability(sd, zP), ice: ct.iceKgS * share, volume: ct.volumeM3S * share } : null;
      const anvil = { z: zA, tK: Math.min(tEl, sd.at(zA).t, tEl - 9.8e-3 * (zA - ct.el)) + 273.15, wind: sd.at(zA), n: stability(sd, zA), ice: ct.iceKgS * (1 - share), volume: ct.volumeM3S * (1 - share) };
      // (stepKm: how far the storm goes between puffs, the width each ring's ice is spread across so
      // that the rings of a moving storm join up as its anvil does)
      const stepS = F.stepHours * 3600, coreKm = ct.coreM / 1000, stepKm = Math.hypot(storm.velocityKph?.east ?? 0, storm.velocityKph?.north ?? 0) * F.stepHours;
      for (let q = count - 1; q >= 0; q--) {
        const t = now - q * F.stepHours;
        const at = placeAt(storm, t);
        for (const [part, isPlume] of [[anvil, false], [plume, true]]) {
          if (!part) continue;
          this.puffs.push({ t0: t, x: at.x, y: at.y, u: part.wind.u * 3.6, v: -part.wind.v * 3.6, iceKg: part.ice * stepS, volumeM3S: part.volume, n: part.n,
            z: part.z + ground, tK: part.tK, coreKm, stepKm, plume: isPlume });
        }
      }
    }
    this.puffs = this.puffs.filter(p => now - p.t0 <= lifeH);
    for (const id of this.emittedTo.keys()) if (!this.tops.has(id) && now - this.emittedTo.get(id) > lifeH) this.emittedTo.delete(id);
    return this;
  }

  // A puff's ring at an hour: its centre (km), inner and outer radius (km, widened by stepKm) and
  // ice (kg), or null.
  ring(p, hourUtc) {
    const F = ANVIL_FIELD, ageS = (hourUtc - p.t0) * 3600;
    if (ageS < 0) return null;
    const stepS = F.stepHours * 3600, k = 3 * F.lambda * p.n * p.volumeM3S / (2 * Math.PI);
    const outer = p.coreKm + Math.cbrt(k * ageS * ageS) / 1000, inner = ageS > stepS ? p.coreKm + Math.cbrt(k * (ageS - stepS) ** 2) / 1000 : 0;
    const ageH = ageS / 3600, pad = (p.stepKm ?? 0) / 2;
    return { x: p.x + p.u * ageH, y: p.y + p.v * ageH, inner: Math.max(0, inner - pad), outer: outer + pad, iceKg: p.iceKg * Math.exp(-ageS / STRUCTURE.anvilTauS) };
  }
}
