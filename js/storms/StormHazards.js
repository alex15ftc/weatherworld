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
// 2026-10-16: power 2.6 to 2, reference 68 to 60 m/s. A stone falls at a speed that grows with
// the square root of its size, so the largest an updraught can hold grows with the square of the
// updraught; with 2.6 the moderate updraughts of pulse storms and elevated storms made almost no
// hail at all (a 47 m/s updraught under an inch even rotating).
// 2026-10-20: lapseRange 6.5-8.5 to 7.2-9.4 when the sounding's 700-500 mb lapse rate was corrected
// (it had read about 10% low; the same air, the same hail). And power 2 to 1.8, with the scale
// keeping an inch of hail at the same updraught (40 m/s): of the storm-samples with an inch or
// more on 4 worlds x 48 hours, 17.6% reached 2 inches (13.7% now) where about 10-12% of US reports
// do, and severe thunderstorm warnings carried a damage threat on a third of them.
// Then (final tuning, the same day) scale 2.12 to 1.9, and 1.8 in the second pass: hail alone made half the Moderate days, with
// an inch of hail on 96% of days; on 80 days Moderate 33% to 30% with the moister Gulf air, largest
// hail median 2.0 in, 2 in hail on 54% of days.
// Melting (2026-10-21): a stone falls through the air above the wet-bulb zero and loses meltInches
// for each meltRefM of it, divided by the square root of its size (small stones fall slower and lose
// more of themselves; after Rasmussen and Heymsfield 1987, about 30% of an inch over a 3 km warm
// layer, 10% of 2 inches, 5% of 3). Until then hail reached the ground at the size it grew.
// With it, power 1.8 to 2 and scale 1.8 to 2.0: melting trims the marginal stones, so the curve can
// again reach giant hail (80 days: 3.5 in hail group on 4% of days, none before; largest hail median 2.3 in).
// 2026-10-23: scale 2.0 to 3.0 and power 2 to 2.5, so an inch of hail grows at about 39 m/s (it took
// 48 m/s), 2 in at 50, 3 in at 60 and 3.7 in at 65 m/s, before melting. (Scale 3.85 first: an
// inch at 35 m/s, but the day's largest stone had a median of 4.1 in on 40 days.) Supercells drawing in
// 1,600-2,000 J/kg with updraughts of 40-44 m/s made 0.5-0.8 in hail (90th 0.7-1.4), and supercell
// days often had no severe hail at all (seed 2112: 35 km of 1 in hail path from about 20
// supercells); updraughts of 35-45 m/s commonly make 1-2 in hail. (The outlooks' hail truth is
// the core size until it is taken from reports: group 4 of docs/FIX-PLAN-2026-10-22.md.)
export const HAIL = Object.freeze({ scaleInches: 3.0, referenceUpdraftMs: 60, power: 2.5, meltInches: 0.3, meltRefM: 3000, nonRotating: 0.8, fullRotation: 0.4, lapseRange: [7.2, 9.4], lapseGain: 0.3, largestInches: 5.5 });
// Gusts. The downdraught's speed from the energy available to it (a share of sqrt(2 DCAPE),
// more the more rain is falling), plus a share of the storm's own motion carried to the ground
// (fast storms in strong flow are windier), plus the wind from the middle levels that a rear
// inflow brings down behind an organised line. Nothing is added for what kind of storm it is.
// Set 2026-10-14 from 7,766 storm-samples on 6 worlds: with 0.6 / 0.35 / 0.3, 45% of storms
// reached 58 mph at some time (26% of samples), so the wind contours ran near 90% on half of
// all days, yet only 0.2% of samples reached 85 mph. Real downdraughts lose much of sqrt(2
// DCAPE) to entrainment and drag, and the strongest winds come with organised lines; with
// these, 15% of samples reach 58 mph, 3% 75 mph and 1% 85 mph, most of them in lines.
// 2026-10-16: downdraught share back to 0.5 and non-rotating hail 0.8: high-CAPE pulse storms
// gave no marginal hail or downburst at all (with the over-strong flow and lines of before
// fixed, the extra wind reports are gone).
// 2026-10-16: 0.6 to 0.5 (wind still made about half the High days; tested on 40 days).
// 2026-10-15: rear inflow share 0.9 to 0.6: real rear-inflow jets bring down about half the
// mid-level wind, and with lines more common the wind reports reached 96 mph over most of
// the map on a fifth of all days (every High day had them); High days 20% to 8%.
// 2026-10-15: downdraught share 0.5 to 0.4. Damaging wind alone still made a third of all High
// days (wind contours at 75-90% on half of all days); at 0.4 High days fell from 45% to 38% on
// 40 days, with tornadoes unchanged.
// (rearInflowShare 0.5 to 0.25 on 2026-10-21: on seed 2112 the severe gusts had a median of 75 mph
// and a 90th of 101, 40% of them 80 mph or more, nearly all behind lines on strong-flow days, where
// half the 500 mb wind added 15-20 m/s; reported severe gusts run at a median near 60-65 mph, and
// 80 mph or more is perhaps one in twenty. 40% of the severe thunderstorm warnings were DESTRUCTIVE.)
// The outflow's surge (2026-10-23): the gust front of a deep, cold outflow runs at the speed a
// density current of its strength spreads at (coldPoolSpeedMs times the square root of its
// strength, as StormModeEngine's), and its gusts with it; with a share of the storm's motion that
// is a storm's gust where it is more than the downdraught's. Organized storms and lines, whose
// outflows are strong, bring damaging wind this way; a pulse storm's weak outflow does not. (Until
// then the outflow did not enter the gust: on days of lines and clusters in 800-900 J/kg of DCAPE
// the gusts' median was 39-46 mph and none reached 58 on two of three such days.)
export const GUST = Object.freeze({ downdraughtShare: 0.5, matureShare: 0.65, motionShare: 0.3, rearInflowShare: 0.25, coldPoolSpeedMs: 38, surgeShare: 0.85, rearInflowColdPool: [0.15, 0.5], rearInflowHours: 1 });
const MPH_PER_MS = 2.23694;

export function hailSizeInches(storm, environment) {
  const lapseRate = Number(environment.lapseRate700500 ?? environment.midLevelLapseRate ?? 6.5);
  const updraughtMs = storm.updraughtMs ?? storm.updraftStrength * 65;
  const rotation = HAIL.nonRotating + (1 - HAIL.nonRotating) * clamp((storm.mesocycloneStrength ?? 0) / HAIL.fullRotation, 0, 1);
  const lapse = 1 + HAIL.lapseGain * (clamp((lapseRate - HAIL.lapseRange[0]) / (HAIL.lapseRange[1] - HAIL.lapseRange[0]), 0, 1) - 0.35);
  const grown = clamp(HAIL.scaleInches * (updraughtMs / HAIL.referenceUpdraftMs) ** HAIL.power * rotation * lapse, 0, HAIL.largestInches);
  const warmM = Math.max(0, Number(environment.wetBulbZeroAglM ?? HAIL.meltRefM));
  return Math.max(0, grown - HAIL.meltInches * (warmM / HAIL.meltRefM) / Math.sqrt(Math.max(grown, 0.25)));
}

export function gustMph(storm, environment, motionSpeedKph) {
  const downdraughtMs = Math.sqrt(2 * Math.max(0, Number(environment.dcape) || 0)) * GUST.downdraughtShare * (1 - GUST.matureShare + GUST.matureShare * clamp(storm.precipitation ?? 0, 0, 1));
  const motionMs = motionSpeedKph / 3.6 * GUST.motionShare;
  // Behind a line with a strong cold pool, air from the middle levels is drawn down and
  // forward: the wind up there reaches the ground, and the line bows out ahead of it.
  const aloftMs = Math.hypot(environment.wind500?.eastKt ?? 0, environment.wind500?.northKt ?? 0) * 0.514444;
  const rearInflowMs = GUST.rearInflowShare * clamp(storm.rearInflow ?? 0, 0, 1) * aloftMs;
  const surgeMs = GUST.surgeShare * GUST.coldPoolSpeedMs * Math.sqrt(clamp(storm.coldPoolStrength ?? 0, 0, 1));
  // (The rear inflow comes down behind the gust front and adds to whichever drives it.)
  return clamp((Math.max(downdraughtMs, surgeMs) + rearInflowMs + motionMs) * MPH_PER_MS, 10, 130);
}

// Rear inflow (0-1) builds behind a line as its cold pool deepens and its rain falls.
export function stepRearInflow(storm, dtHours) {
  const line = clamp(Number(storm.lineOrganization) || 0, 0, 1);
  const target = line * clamp(((storm.coldPoolStrength ?? 0) - GUST.rearInflowColdPool[0]) / (GUST.rearInflowColdPool[1] - GUST.rearInflowColdPool[0]), 0, 1) * clamp(storm.precipitation ?? 0, 0, 1);
  storm.rearInflow = (storm.rearInflow ?? 0) + (target - (storm.rearInflow ?? 0)) * clamp(dtHours / GUST.rearInflowHours, 0, 1);
  return storm.rearInflow;
}

// Fuel: an existing updraft can force surface-based parcels through moderate inhibition
// (~200 J/kg; 150 until 2026-10-15, when the cap became a real elevated mixed layer and storms
// moving off the lines into it went elevated within the hour); otherwise it can feed on an
// elevated parcel that is essentially uncapped.
// Without either the storm has no buoyant inflow and collapses.
// A storm is fed from the ground whenever the air there can be lifted into it, and draws on the
// most unstable air in that inflow too; it feeds from above only when the ground air is capped
// beyond that. (Until 2026-10-16 it went elevated whenever the most unstable parcel had more
// energy than the mixed-layer one, which near the ground it nearly always has: storms spent
// 84% of their time "elevated" over ground air that was rising into them.)
export function stormFuel(environment) {
  const surfaceFuel = (Number(environment.cin) || 0) <= 200 ? Number(environment.cape) || 0 : 0;
  const elevatedFuel = (Number(environment.mostUnstableCin) || 0) <= 60 ? 0.85 * (Number(environment.mostUnstableCape) || 0) : 0;
  const elevatedFeed = surfaceFuel < 150 && elevatedFuel > surfaceFuel, fuelCape = elevatedFeed ? elevatedFuel : Math.max(surfaceFuel, elevatedFuel);
  const feedEnvironment = elevatedFeed ? { ...environment, cape: elevatedFuel, cin: Number(environment.mostUnstableCin) || 0 } : environment;
  return { fuelCape, elevatedFeed, feedEnvironment, starving: fuelCape < 150 };
}
