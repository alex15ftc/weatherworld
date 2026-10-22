// Lightning: each storm's flashes over a storm tick, timed and placed from the storm's own state.
// How many comes from the updraught (StormAppearance's flashRatePerMin); where they go comes
// from the storm's geometry, which already says where its updraught, rain, line and anvil are.
// Nothing here reads what a storm is called.
//
//   In the cloud or to the ground. Most flashes stay in the cloud; the share that reaches the
//   ground falls as the updraught strengthens and the cloud base rises (the charge sits higher
//   above the ground, and a stronger updraught makes more of it aloft; IC:CG ratios of about 2
//   in weak storms to 10 and more in strong high-based ones: Boccippio et al. 2001, Williams 2005).
//   Polarity. Ground strikes lower negative charge, but a strong updraught under a high, dry
//   cloud base carries enough liquid water into the mixed-phase zone to charge the storm the
//   other way round, and its strikes are largely positive (Carey and Buffalo 2007, the High
//   Plains). Strikes from the anvil and from the stratiform rain behind a mature line come from
//   the positive charge that spreads out aloft, and are mostly positive.
//   Where. Ground strikes fall about the precipitation core beside the updraught, where the
//   graupel that carries the charge comes down; few hit right under a strong updraught, which
//   lofts the graupel away (the lightning hole over a bounded weak echo region). A line's fall
//   along the line. Cloud flashes spread wider through the charge region and out into the anvil.
//
// Frame: x east and y south in km on the map; bearings degrees clockwise from north.
import { clamp, mulberry32 } from '../scenarios/math.js';
import { rotatingShare, lineShare } from './StormModeEngine.js';
import { flashRatePerMin } from './StormAppearance.js';

export const LIGHTNING = Object.freeze({
  keepMinutes: 30,
  // IC:CG ratio: base, and how much more with updraught (m/s) and with cloud base (m).
  icToCg: { base: 2, updraught: 5, updraughtMs: [15, 50], base2: 3, baseM: [1000, 2200] },
  // Share of the core's ground strikes that are positive: least, and more where the storm is
  // charged the other way round (a strong updraught under a high base).
  positive: { least: 0.07, inverted: 0.55, updraughtMs: [25, 50], baseM: [1500, 2500] },
  // Ground strikes from the anvil: this share, more with a long anvil (km); this many of them positive.
  anvil: { share: 0.05, more: 0.1, lengthKm: [30, 150], positive: 0.75 },
  // From the stratiform rain behind a line, once the line is this many hours old.
  stratiform: { share: 0.12, hours: [1, 3], behindKm: [12, 45], positive: 0.6 },
  // The lightning hole: within this many updraught radii, kept from this updraught (m/s) up.
  hole: { radii: 0.6, updraughtMs: [30, 55] },
  // Cloud flashes reaching into the anvil.
  icAnvil: 0.2
});

export const STRIKE_KIND = Object.freeze({ cloud: 0, negative: 1, positive: 2 });

const ramp = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);
const DEG = Math.PI / 180;
function hashText(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }
const gaussian = rng => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
function poisson(rng, mean) {
  if (mean <= 0) return 0;
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian(rng)));
  let k = 0, p = 1; const limit = Math.exp(-mean);
  while ((p *= rng()) > limit) k++;
  return k;
}
// A point d km along a bearing and s km to its right.
const along = (bearingDeg, d, s = 0) => {
  const b = bearingDeg * DEG, east = Math.sin(b), north = Math.cos(b);
  return { x: d * east + s * north, y: -(d * north - s * east) };
};

// The share of a storm's flashes that reach the ground, and the share of the core's ground
// strikes that are positive.
export function chargeOf(storm) {
  const w = Number(storm.updraughtMs) || 0, base = Number(storm.environment?.lcl) || 1200, C = LIGHTNING;
  const ratio = C.icToCg.base + C.icToCg.updraught * ramp(w, ...C.icToCg.updraughtMs) + C.icToCg.base2 * ramp(base, ...C.icToCg.baseM);
  const inverted = ramp(w, ...C.positive.updraughtMs) * ramp(base, ...C.positive.baseM);
  return { groundShare: 1 / (1 + ratio), positiveShare: C.positive.least + (C.positive.inverted - C.positive.least) * inverted };
}

// The storm's flashes between fromHour and toHour (its state is the one at toHour; earlier
// flashes are put back along its motion): [{ hourUtc, xKm, yKm, kind }].
export function stormFlashes(storm, fromHour, toHour, { seed = 0 } = {}) {
  const g = storm.geometry, hours = toHour - fromHour;
  if (!g || !(hours > 0) || storm.active === false) return [];
  const up = g.updraught, w = Number(up.speedMs ?? storm.updraughtMs) || 0;
  const count = flashRatePerMin(w) * hours * 60;
  if (!(count > 0)) return [];
  const rng = mulberry32(hashText(`${storm.id}|${toHour.toFixed(4)}|${seed}`));
  const n = poisson(rng, count);
  if (!n) return [];
  const C = LIGHTNING, { groundShare, positiveShare } = chargeOf(storm);
  const linear = lineShare(storm), cellular = 1 - linear, v = storm.velocityKph ?? { east: 0, north: 0 };
  const motionDeg = (Math.atan2(v.east, v.north) / DEG + 360) % 360;
  // The core: from the updraught toward where the hail and heavy rain come down beside it.
  const core = { x: (up.xKm + g.hail.xKm) / 2, y: (up.yKm + g.hail.yKm) / 2 };
  const coreSpread = Math.max(2, 0.6 * up.radiusKm + 0.2 * g.rain.acrossKm);
  const hole = ramp(w, ...C.hole.updraughtMs) * rotatingShare(storm) ** 0.5, holeKm = C.hole.radii * up.radiusKm;
  const anvilShare = C.anvil.share + C.anvil.more * ramp(g.anvil.lengthKm, ...C.anvil.lengthKm);
  const stratiformShare = C.stratiform.share * linear * ramp(storm.ageHours, ...C.stratiform.hours);
  const half = g.line.halfLengthKm ?? 0;
  // A point in the storm's convective part: about the core, or along the line.
  const convective = spread => {
    if (half > 0 && rng() < linear) {
      const s = (2 * rng() - 1), keep = 1 - 0.6 * s ** 4;
      const off = along(g.line.axisBearingDeg, s * half, gaussian(rng) * 0.6 * spread * keep);
      return { x: storm.positionKm.x + off.x, y: storm.positionKm.y + off.y };
    }
    for (let tries = 0; ; tries++) {
      const x = core.x + gaussian(rng) * spread, y = core.y + gaussian(rng) * spread;
      if (tries > 4 || Math.hypot(x - up.xKm, y - up.yKm) > holeKm || rng() > hole * cellular) return { x, y };
    }
  };
  const anvilPoint = () => {
    const off = along(g.anvil.bearingDeg, (0.25 + 0.75 * rng()) * g.anvil.lengthKm, gaussian(rng) * g.anvil.widthKm / 4);
    return { x: up.xKm + off.x, y: up.yKm + off.y };
  };
  const out = [];
  for (let k = 0; k < n; k++) {
    const hourUtc = fromHour + rng() * hours, back = hourUtc - toHour;
    let at, kind;
    if (rng() >= groundShare) {
      at = rng() < C.icAnvil * cellular ? anvilPoint() : convective(1.6 * coreSpread);
      kind = STRIKE_KIND.cloud;
    } else {
      const pick = rng();
      if (pick < anvilShare) { at = anvilPoint(); kind = rng() < C.anvil.positive ? STRIKE_KIND.positive : STRIKE_KIND.negative; }
      else if (pick < anvilShare + stratiformShare) {
        const off = along(motionDeg, -(C.stratiform.behindKm[0] + rng() * (C.stratiform.behindKm[1] - C.stratiform.behindKm[0])), (2 * rng() - 1) * half);
        at = { x: storm.positionKm.x + off.x, y: storm.positionKm.y + off.y };
        kind = rng() < C.stratiform.positive ? STRIKE_KIND.positive : STRIKE_KIND.negative;
      } else { at = convective(coreSpread); kind = rng() < positiveShare ? STRIKE_KIND.positive : STRIKE_KIND.negative; }
    }
    // Where the storm was then.
    out.push({ hourUtc, xKm: at.x + v.east * back, yKm: at.y - v.north * back, kind });
  }
  return out;
}

// The world's flashes over the last LIGHTNING.keepMinutes, added to after each storm tick.
export class LightningLog {
  constructor({ seed = 0 } = {}) { this.seed = seed; this.strikes = []; this.hourUtc = null; }

  clear() { this.strikes = []; this.hourUtc = null; }

  // After a storm tick: the flashes since the last one (none on the first, or after a jump).
  record(world) {
    const now = world.stormEngine?.validHourUtc ?? world.validHourUtc, last = this.hourUtc;
    this.hourUtc = now;
    if (last === null || !(now > last) || now - last > 0.5) { if (last !== null && !(now > last)) this.strikes = []; return 0; }
    let added = 0;
    for (const storm of world.storms ?? []) {
      if (storm.active === false) continue;
      for (const flash of stormFlashes(storm, last, now, { seed: this.seed })) { this.strikes.push(flash); added++; }
    }
    const oldest = now - LIGHTNING.keepMinutes / 60;
    if (this.strikes.length && this.strikes[0].hourUtc < oldest) this.strikes = this.strikes.filter(s => s.hourUtc >= oldest);
    return added;
  }
}
