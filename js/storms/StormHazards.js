// What a storm produces from its own state and the air it draws in: its fuel, hail and gusts.
// The storm engine uses these each step; the sounding's hazard outlook (SoundingHazards.js)
// runs the same functions on the air at a point, so the two cannot disagree.
import { clamp } from '../scenarios/math.js';

// Hail. The largest stone an updraught can hold up grows steeply with its speed, so size goes
// as a power of the updraught speed the storm realises (parcel theory less entrainment,
// loading and inhibition, scaled by how mature the storm is). A rotating updraught keeps
// stones in the growth zone longer; steep mid-level lapse rates put more of the buoyancy
// there. Fitted on the redesigned atmosphere so that a typical mature storm is near half an
// inch, about one mature storm-sample in ten reaches 2 in, and the strongest pass 3 in.
export const HAIL = Object.freeze({ scaleInches: 2.3, referenceUpdraftMs: 68, power: 2.6, nonRotating: 0.5, fullRotation: 0.4, lapseRange: [6.5, 8.5], lapseGain: 0.3, largestInches: 5.5 });
// Gusts. The downdraught's speed from the energy available to it (a share of sqrt(2 DCAPE),
// more the more rain is falling), plus a share of the storm's own motion carried to the ground
// (fast storms in strong flow are windier), plus the wind from the middle levels that a rear
// inflow brings down behind an organised line. Nothing is added for what kind of storm it is.
// Set 2026-10-14 from 7,766 storm-samples on 6 worlds: with 0.6 / 0.35 / 0.3, 45% of storms
// reached 58 mph at some time (26% of samples), so the wind contours ran near 90% on half of
// all days, yet only 0.2% of samples reached 85 mph. Real downdraughts lose much of sqrt(2
// DCAPE) to entrainment and drag, and the strongest winds come with organised lines; with
// these, 15% of samples reach 58 mph, 3% 75 mph and 1% 85 mph, most of them in lines.
export const GUST = Object.freeze({ downdraughtShare: 0.5, matureShare: 0.65, motionShare: 0.3, rearInflowShare: 0.9, rearInflowColdPool: [0.15, 0.5], rearInflowHours: 1 });
const MPH_PER_MS = 2.23694;

export function hailSizeInches(storm, environment) {
  const lapseRate = Number(environment.lapseRate700500 ?? environment.midLevelLapseRate ?? 6.5);
  const updraughtMs = storm.updraughtMs ?? storm.updraftStrength * 65;
  const rotation = HAIL.nonRotating + (1 - HAIL.nonRotating) * clamp((storm.mesocycloneStrength ?? 0) / HAIL.fullRotation, 0, 1);
  const lapse = 1 + HAIL.lapseGain * (clamp((lapseRate - HAIL.lapseRange[0]) / (HAIL.lapseRange[1] - HAIL.lapseRange[0]), 0, 1) - 0.35);
  return clamp(HAIL.scaleInches * (updraughtMs / HAIL.referenceUpdraftMs) ** HAIL.power * rotation * lapse, 0, HAIL.largestInches);
}

export function gustMph(storm, environment, motionSpeedKph) {
  const downdraughtMs = Math.sqrt(2 * Math.max(0, Number(environment.dcape) || 0)) * GUST.downdraughtShare * (1 - GUST.matureShare + GUST.matureShare * clamp(storm.precipitation ?? 0, 0, 1));
  const motionMs = motionSpeedKph / 3.6 * GUST.motionShare;
  // Behind a line with a strong cold pool, air from the middle levels is drawn down and
  // forward: the wind up there reaches the ground, and the line bows out ahead of it.
  const aloftMs = Math.hypot(environment.wind500?.eastKt ?? 0, environment.wind500?.northKt ?? 0) * 0.514444;
  const rearInflowMs = GUST.rearInflowShare * clamp(storm.rearInflow ?? 0, 0, 1) * aloftMs;
  return clamp((downdraughtMs + motionMs + rearInflowMs) * MPH_PER_MS, 10, 130);
}

// Rear inflow (0-1) builds behind a line as its cold pool deepens and its rain falls.
export function stepRearInflow(storm, dtHours) {
  const line = clamp(Number(storm.lineOrganization) || 0, 0, 1);
  const target = line * clamp(((storm.coldPoolStrength ?? 0) - GUST.rearInflowColdPool[0]) / (GUST.rearInflowColdPool[1] - GUST.rearInflowColdPool[0]), 0, 1) * clamp(storm.precipitation ?? 0, 0, 1);
  storm.rearInflow = (storm.rearInflow ?? 0) + (target - (storm.rearInflow ?? 0)) * clamp(dtHours / GUST.rearInflowHours, 0, 1);
  return storm.rearInflow;
}

// Fuel: an existing updraft can force surface-based parcels through moderate inhibition
// (~150 J/kg); otherwise it can feed on an elevated parcel that is essentially uncapped.
// Without either the storm has no buoyant inflow and collapses.
export function stormFuel(environment) {
  const surfaceFuel = (Number(environment.cin) || 0) <= 150 ? Number(environment.cape) || 0 : 0;
  const elevatedFuel = (Number(environment.mostUnstableCin) || 0) <= 60 ? 0.85 * (Number(environment.mostUnstableCape) || 0) : 0;
  const fuelCape = Math.max(surfaceFuel, elevatedFuel), elevatedFeed = elevatedFuel > surfaceFuel;
  const feedEnvironment = elevatedFeed ? { ...environment, cape: elevatedFuel, cin: Number(environment.mostUnstableCin) || 0 } : environment;
  return { fuelCape, elevatedFeed, feedEnvironment, starving: fuelCape < 150 };
}
