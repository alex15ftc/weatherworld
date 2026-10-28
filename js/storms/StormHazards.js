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
// (meltRefM 3000 to 3400 on 2026-10-26: the wet-bulb zero rose by about 14% (median 2,820 to 3,205 m under supercells) when
// mid-level humidity came from the large-scale field instead of a painted dry layer; the melting was set against the low one.)
// (scaleInches 3.0 to 3.7 on 2026-10-26, refitted to the SPC record after the sounding and mid-level moisture corrections:
// hail reports 2 in or larger had fallen to 8.4% on seeds 1-8, against 14.1% for May Plains reports; now 13.5%.)
export const HAIL = Object.freeze({ scaleInches: 3.15, referenceUpdraftMs: 60, power: 2.5, meltInches: 0.3, meltRefM: 3400, nonRotating: 0.65, fullRotation: 0.4, lapseRange: [7.2, 9.4], lapseGain: 0.45, coreGain: 1.2, largestInches: 5.5 });
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
// (2026-10-26: the downdraught's rain is enough once the storm makes rainFullShare of a full storm's rain: beyond that DCAPE,
// the evaporative cooling, sets its strength. Until then it scaled with all of the rain, which scaled with the updraught, and
// weak shear's thinner updraughts kept wet downbursts and lines under 58 mph at any DCAPE (1% of storms under 30 kt reached
// it; 97-100% of lines in 1,700-2,600 J/kg and under 35 kt made no wind report). The storm's own speed adds fully only to
// organized outflow: motionLineShare of it for a discrete storm.)
// (downdraughtShare 0.5 to 0.6, 2026-10-26: a 1,000 J/kg DCAPE wet downburst then reaches about 60 mph, where observed
// downbursts in that DCAPE are commonly severe; at 0.5 under 10% of weak-shear storms reached 58 mph at any DCAPE.)
export const GUST = Object.freeze({ stableLoss: 0.7, stableCinJkg: [50, 250], rainFullShare: 0.5, motionLineShare: 0.4, downdraughtShare: 0.6, matureShare: 0.65, motionShare: 0.3, rearInflowShare: 0.25, coldPoolSpeedMs: 38, surgeShare: 0.85, rearInflowColdPool: [0.15, 0.5], rearInflowHours: 1 });
// Bow echoes (2026-10-25): a line segment bows where all of what long-lived bows need is there together (Weisman 1993;
// Evans and Doswell 2001; Cohen et al. 2007, docs/storm-reference/squall-lines-mcs-wind-2026-10-25.md): CAPE (cape), 0-3 km
// shear (shearKt), a fast line (speedMs) with strong low-level inflow relative to it (inflowMs), and a cold pool to drive it
// (coldPool); each from none at [0] to all at [1], the bow (0-1) the least of them (the one lacking most) times the line share, building over buildHours
// and fading over decayHours. At its apex the rear-inflow jet, jetMs[0] to [1] relative to the line as the CAPE rises over
// jetCape, comes down to the ground with the line's own speed, groundShare of the two (35-45 m/s there): a narrow swath of
// damaging wind where the bow runs, a gust of its own. Other lines keep their gusts. (Until then strong wind came from every
// line alike, a quarter of the 500 mb wind added to every line's outflow, so it was either everywhere or never clustered
// enough for an intensity group; same document. That addition is gone: an ordinary line's gust is its downdraught or surge.)
export const BOW = Object.freeze({ cape: [800, 1800], shearKt: [12, 25], speedMs: [8, 16], inflowMs: [6, 14], coldPool: [0.1, 0.3], buildHours: 1.5, decayHours: 1, jetMs: [20, 30], jetCape: [2000, 3500], groundShare: 0.85 });
// An organised line also mixes the cloud layer's wind down to the ground behind its gust front (downward momentum transfer,
// what carries a forward-propagating line's gust front along at about the cloud-layer wind; Corfidi 2003): momentumShare of
// that wind (0.4 x 850 + 0.6 x 500 mb) times the line share, added to its outflow's gust. Ground-relative wind is what tells
// damaging-wind environments apart (Kuchera and Parker 2006). (2026-10-25, set to the real mix of measured severe gusts: in
// May 2015-2023, 11.4% at 75 mph or more in the busiest 500-mile area of each day; the engine had 5.4%, none from lines
// that were not bows; docs/TARGETS-2026-10-25.md.)
export const MOMENTUM = Object.freeze({ share: 0.2 });
const MPH_PER_MS = 2.23694;
const rampTo = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);

export function hailSizeInches(storm, environment) {
  const lapseRate = Number(environment.lapseRate700500 ?? environment.midLevelLapseRate ?? 6.5);
  // The hail grows in the updraught's core, fed by the most unstable of its inflow: the core runs faster than the storm's
  // updraught by the square root of the most unstable parcel's energy over the fuel's, up to HAIL.coreGain (the significant
  // hail parameter uses MUCAPE for this; SPC). (2026-10-26: from the fuel's CAPE alone, storms in SCP 11-31 and 8-8.8 C/km
  // lapse rates made 1.25 in hail at most, or none, on all four reviewed seeds.)
  const core = clamp(Math.sqrt(Math.max(1, (Number(environment.mostUnstableCape) || 0) / Math.max(150, Number(storm.fuelCape) || Number(environment.cape) || 150))), 1, HAIL.coreGain);
  const updraughtMs = (storm.updraughtMs ?? storm.updraftStrength * 65) * core;
  const rotation = HAIL.nonRotating + (1 - HAIL.nonRotating) * clamp((storm.mesocycloneStrength ?? 0) / HAIL.fullRotation, 0, 1);
  const lapse = 1 + HAIL.lapseGain * (clamp((lapseRate - HAIL.lapseRange[0]) / (HAIL.lapseRange[1] - HAIL.lapseRange[0]), 0, 1) - 0.35);
  const grown = clamp(HAIL.scaleInches * (updraughtMs / HAIL.referenceUpdraftMs) ** HAIL.power * rotation * lapse, 0, HAIL.largestInches);
  const warmM = Math.max(0, Number(environment.wetBulbZeroAglM ?? HAIL.meltRefM));
  return Math.max(0, grown - HAIL.meltInches * (warmM / HAIL.meltRefM) / Math.sqrt(Math.max(grown, 0.25)));
}

export function gustMph(storm, environment, motionSpeedKph) {
  const downdraughtMs = Math.sqrt(2 * Math.max(0, Number(environment.dcape) || 0)) * GUST.downdraughtShare * (1 - GUST.matureShare + GUST.matureShare * clamp((storm.precipitation ?? 0) / GUST.rainFullShare, 0, 1));
  const motionMs = motionSpeedKph / 3.6 * GUST.motionShare * (GUST.motionLineShare + (1 - GUST.motionLineShare) * clamp(Number(storm.lineOrganization) || 0, 0, 1));
  const surgeMs = GUST.surgeShare * GUST.coldPoolSpeedMs * Math.sqrt(clamp(storm.coldPoolStrength ?? 0, 0, 1));
  // A storm fed from above a stable layer must push its downdraught through that layer to reach the ground: its downdraught and
  // outflow keep 1 - GUST.stableLoss of their strength at stableCinJkg[1] of the surface parcel's inhibition, all of it at [0]
  // (elevated storms are mostly hail producers; Horgan et al. 2007). (2026-10-27: elevated supercells under an EML made 63
  // wind reports and 7 hail on seed 2112 day 3.)
  const penetration = storm.elevatedFeed ? 1 - GUST.stableLoss * clamp((Math.abs(Number(environment.sbcin) || 0) - GUST.stableCinJkg[0]) / (GUST.stableCinJkg[1] - GUST.stableCinJkg[0]), 0, 1) : 1;
  // (The rear inflow comes down behind the gust front and adds to whichever drives it.)
  const bow = clamp(storm.bow ?? 0, 0, 1), speedMs = motionSpeedKph / 3.6;
  const apexMs = bow > 0 ? bow * BOW.groundShare * (BOW.jetMs[0] + (BOW.jetMs[1] - BOW.jetMs[0]) * rampTo(environment.cape, BOW.jetCape[0], BOW.jetCape[1]) + speedMs) : 0;
  const line = clamp(Number(storm.lineOrganization) || 0, 0, 1), kt = 0.514444;
  const cloudMs = environment.wind850 && environment.wind500 ? Math.hypot(0.4 * environment.wind850.eastKt + 0.6 * environment.wind500.eastKt, 0.4 * environment.wind850.northKt + 0.6 * environment.wind500.northKt) * kt : 0;
  return clamp(Math.max(Math.max(downdraughtMs, surgeMs) * penetration + motionMs + MOMENTUM.share * line * cloudMs, apexMs) * MPH_PER_MS, 10, 130);
}

// Rear inflow (0-1) builds behind a line as its cold pool deepens and its rain falls.
// How far a line has bowed (see BOW).
export function stepBow(storm, environment, dtHours) {
  const line = clamp(Number(storm.lineOrganization) || 0, 0, 1), ve = (storm.velocityKph?.east ?? 0) / 3.6, vn = (storm.velocityKph?.north ?? 0) / 3.6;
  const s = environment.surfaceWind, w = environment.wind850, kt = 0.514444;
  const inflowMs = s && w ? Math.hypot(0.5 * (s.eastKt + w.eastKt) * kt - ve, 0.5 * (s.northKt + w.northKt) * kt - vn) : 0;
  const target = line * Math.min(rampTo(environment.cape, BOW.cape[0], BOW.cape[1]), rampTo(environment.shear03 ?? 0.6 * (Number(environment.bulkShear) || 0), BOW.shearKt[0], BOW.shearKt[1]),
    rampTo(Math.hypot(ve, vn), BOW.speedMs[0], BOW.speedMs[1]), rampTo(inflowMs, BOW.inflowMs[0], BOW.inflowMs[1]), rampTo(storm.coldPoolStrength, BOW.coldPool[0], BOW.coldPool[1]));
  const bow = storm.bow ?? 0;
  storm.bow = bow + (target - bow) * clamp(dtHours / (target > bow ? BOW.buildHours : BOW.decayHours), 0, 1);
  return storm.bow;
}

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
