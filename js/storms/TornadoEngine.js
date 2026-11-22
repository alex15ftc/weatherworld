import { rotatingShare, coldPoolBalance } from './StormModeEngine.js';
import { stormVortices, mesoLevel } from './StormVortices.js';
import { clamp } from '../scenarios/math.js';
import { wallCloudRadiusKm } from './StormGeometry.js';
import { tornadoStage, tornadoStageShares, TORNADO_STAGES } from './TornadoStages.js';

const MPH_PER_KPH = 0.621371;

export function initializeTornadoState(storm) {
  storm.tornado = {
    state: 'none', onGround: false, probability: 0, genesisPotential: 0,
    ageMinutes: 0, groundTimeMinutes: 0, pathLengthKm: 0, widthYards: 0,
    windSpeedMph: 0, estimatedEf: null, positionKm: { ...storm.positionKm },
    previousPositionKm: { ...storm.positionKm }, motionDirectionDeg: 0,
    forwardSpeedMph: 0, startedHourUtc: null, endedHourUtc: null,
    peakWindSpeedMph: 0, peakWidthYards: 0, cycleCount: 0, trackPoints: [],
    lastGenesisHourUtc: null
  };
  storm.tornadoHistory = [];
  return storm.tornado;
}

// A tornado cannot emerge from fields on a 10-mile grid, so it is modelled on the storm, from
// the storm's own low-level rotation (StormRotation.js). There are no gates, vetoes or
// cooldowns: everything moves smoothly with the storm's state.
//   - Whether one forms: a rate that rises with low-level rotation, slowly at first, from
//     none at onsetRotation[0] to one every fullRatePerHour-th of an hour at onsetRotation[1].
//     Low-level rotation takes time to build, so a tornado is seen coming; chance decides
//     only the minute.
//   - How long it lasts: as long as the storm holds its low-level rotation above
//     sustainRotation. The storm's outflow wraps around a tornado and cuts it off in time
//     (its occlusion), quickly where the outflow outruns the shear.
//   - How strong it is: its wind follows the low-level rotation as it rises and falls. What
//     sets one tornado apart from another under the same rotation cannot be resolved here,
//     so each has its own draw (strengthUniform) within a spread the rotation scales.
// The rate rises as the square of the way from onsetRotation[0] to onsetRotation[1] (power 2):
// a weakly rotating storm seldom puts one down, a strongly rotating one often does, and it is
// the strongly rotating ones whose tornadoes are strong. So the days with many tornadoes are
// the days with strong ones, as in the real record (with power 1 the big days got their
// numbers from weak tornadoes: twice the tornadoes the real outlook categories go with, and
// three 15% tornado areas in four with no strong tornadoes to speak of). The rise starts from
// no rotation at all, so that the weakest storms still put one down now and then: with a
// threshold of 0.04, one day in four had no tornado. Checked on 320 days (docs/STATUS.md).
// 2026-10-16: 5 kept with the outer model's systems slowed and weakened (7 tried: 30+ tornado days on 9%).
// 2026-10-15: fullRatePerHour 2.5 to 5 once the environments came down to real values (0-1 km
// helicity median 158 to 114, STP 90th 4.9 to 2.6): tornado days 60% to 88%, about 6.7 a day.
// 2026-10-16 (later): 5 to 8 once storms over the night's cooled ground stopped counting as fed
// from the ground (StormRotation groundCinJkg): those had made 58% of the tornadoes, and without
// them the mean fell to 3 a day; 8 gives 3.7, a tornado on 70% of days.
// 2026-10-19: back to 5 once nights cool with the wind (RegionalAtmosphere nightCoolingK): the
// warm sector under the night-time jet stays fed from the ground, as it really does. Then (the
// same day): with fronts as sloping cold domes, cyclones on the map and cloud holding the night's
// heat in, 5 gave 11.7 tornadoes a day on 8 seeds x 3 days (2.5 gave 9.5 once nights cooled
// more under cloud); the target is about 7.5. A lower rate alone starved the strongest storms (an
// ideal supercell put down one tornado in eight hours), so the rise was made steeper instead
// (power 2 to 3, rate 4.2): weakly rotating storms lose far more of their tornadoes than strong ones.
// (2026-10-21, with StormRotation's outflow, cloud base and surface inhibition of the same day and
// the later sunset: power 2 to 1.5 and fullRatePerHour 0.6 to 0.75. At power 2 the best storms on
// outbreak days took most of the tornadoes: High on 21% of 80 days, 30+ tornadoes on 8%. Now 7.8 a
// day, tornadoes on 76% of days, High 11%, Moderate 25% (before the day's changes 5.9, 64%, about
// 14% and 25%).)
// (2026-10-23: fullRatePerHour 0.75 to 0.4 after the jet stream and the storm changes of group 3 of
// docs/FIX-PLAN-2026-10-22.md (deep shear's share of the mesocyclone, the outflow balance, the
// strength scales, night lift on the cap) took the climate from 6.3 to 14.9 tornadoes a day.)
// (fullRatePerHour 0.22 to 0.28 on 2026-10-26 with the capping inversion: fewer, more isolated storms; tornadoes a day 5.45 to
// 7.7 on 80 days.)
// (fullRatePerHour 0.28 to 0.2 on 2026-10-26, after the low-level jet and helicity corrections: 22% of supercells made a
// tornado and 11-12 a day came; now 18%, within the record's 15-26% (Trapp et al. 2005; Thompson et al. 2017), and 8 a day.)
// (fullRatePerHour 0.23 to 0.27 on 2026-11-19 with the cloud base's term on genesis, CLOUD_BASE: it took 17.3 tornadoes a
// day to 14.8 over 8 seeds x 10 days; the count back where it was, with fewer under high bases and more under low ones.)
// (fullRatePerHour 0.27 to 0.20 on 2026-11-20 with cyclic tornadogenesis, RENEWAL: a storm's repeat tornadoes come sooner and
// more often, so its first one is drawn less often to keep the count.)
const TORNADO = { onsetRotation: [0, 0.5], fullRatePerHour: 0.20, power: 1, sustainRotation: 0.055, outlookHours: 0.5, driftKph: 30 };
const ramp = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);

// The significant tornado parameter of the storm's inflow, kept for the maps and reports.
export function tornadoIngredients(environment) {
  return clamp(
    (environment.cape ?? 0) / 1500 * ((environment.srh ?? 0) / 150) * ((environment.bulkShear ?? 0) / 40) *
    clamp((2000 - (environment.lcl ?? 2000)) / 1000, 0, 1.5) * clamp((150 - Math.abs(environment.cin ?? 50)) / 125, 0, 1.2),
    0, 18
  );
}
// How close the storm's low-level rotation is to producing a tornado (0-1), and the rate that gives.
export const tornadoImminence = storm => ramp(clamp(storm.lowRotation ?? 0, 0, 1.2), TORNADO.onsetRotation[0], TORNADO.onsetRotation[1]);
// How soon a tornado on the ground ends if things go on as they are (read only; for the game,
// js/game/StormWorkers.js lookOf): the end updateTornadoState will find first of its two clocks -
// the life drawn for it running out ('vortex spent'), or the storm's low-level rotation, falling
// at its present rate (in log space) below TORNADO.sustainRotation ('occluded' while the storm's own rotation
// would still hold it, else 'rotation faded'). { minutes, by }, minutes Infinity when neither is
// in sight; null with no tornado down. (A storm that dies, or a tornado left behind by its
// rotation, ends without notice.)
export function tornadoEndOutlook(storm) {
  const t = storm.tornado;
  if (!t?.onGround) return null;
  const lifeLeft = Number.isFinite(t.lifeMinutes) ? Math.max(0, t.lifeMinutes - (t.groundTimeMinutes ?? 0)) : Infinity;
  const low = clamp(storm.lowRotation ?? 0, 0, 1.2), trend = Number(storm.lowRotationTrend) || 0;
  // (in log space: the rotation falls away roughly exponentially as the outflow wraps round, so its
  // logarithm falls at a near steady rate, trend / low. Straight-line, the countdown ran short: on
  // seed 2's first EF1, 14 min at a tick 28 min before its end, 6.5 at one 8 min before)
  const rotationLeft = low < TORNADO.sustainRotation ? 0 : trend < 0 ? Math.log(TORNADO.sustainRotation / low) / (trend / low) * 60 : Infinity;
  if (lifeLeft <= rotationLeft) return { minutes: lifeLeft, by: lifeLeft < Infinity ? 'vortex spent' : null };
  return { minutes: rotationLeft, by: (storm.lowRotationFree ?? 0) >= TORNADO.sustainRotation ? 'occluded' : 'rotation faded' };
}

// CLOUD_BASE (2026-11-19, the owner's ruling through the tornado lab): under a high cloud base tornadoes are rarer and
// weaker. Significant tornadoes come mostly with LCLs under ~1 km (Rasmussen and Blanchard 1998; Thompson et al. 2003);
// a high base's rear-flank downdraught is colder and less buoyant, and the tornadoes it allows fewer and weaker
// (Markowski et al. 2002). The rate of genesis and the spread of the winds the storm allows both take STP's LCL term
// (Thompson et al. 2003): 1 at or under fullM, falling linearly to 0 at noneM. (Before it the engine already had fewer per
// supercell under a high base, 0.050 under 800 m to 0.010 at 1.5-2 km, 4 seeds x 48 h; now the term on top.) An inflow
// with no LCL leaves it at 1.
export const CLOUD_BASE = Object.freeze({ fullM: 1000, noneM: 2000 });
export const cloudBaseTerm = lclM => Number.isFinite(Number(lclM)) && lclM !== null ? clamp((CLOUD_BASE.noneM - Number(lclM)) / (CLOUD_BASE.noneM - CLOUD_BASE.fullM), 0, 1) : 1;
export const tornadoRatePerHour = (imminence, lclM = null) => TORNADO.fullRatePerHour * Math.pow(imminence, TORNADO.power) * cloudBaseTerm(lclM);
// RENEWAL (2026-11-20): cyclic tornadogenesis. While a tornado is down the rear-flank downdraught wraps round it (the
// storm's occlusion, StormRotation.js) and its gust front makes vorticity near the ground, baroclinically, along the
// outflow's edge (Markowski and Richardson 2014; Dahl et al. 2014). When the old vortex is cut off, a new low-level
// mesocyclone organises from that vorticity at the new occlusion point, under the same mid-level updraught, 5-15 km
// east or south-east of the old one (Lemon and Doswell 1979; Burgess et al. 1982): mesocyclone cycles of ~40-45 min,
// 15-90 min in range; occluding cyclic mesocyclogenesis with 15-60 min periods (Adlerman and Droegemeier 2002, 2005;
// docs/stormlab/RESEARCH-SUPERCELL-LIFECYCLE.md). Modelled as two states on the tornado: its charge, the most the
// occlusion reached while the tornado was down (0-1), which fades over decayHours once it lifts, and the new meso's
// renewal, which organises toward the charge over buildHours. Together they make a pulse that peaks
// buildHours * decayHours / (decayHours - buildHours) * ln(decayHours / buildHours) after the lift (~18 min) at
// (buildHours / decayHours) ^ (buildHours / (decayHours - buildHours)) of the charge (~0.54). The genesis rate is
// multiplied by 1 + gain * renewal, so a renewed meso still needs the storm's low-level rotation and a low cloud base
// to put a tornado down; with a vortex spent the storm's rotation is still rebuilding (LIFE.rotationLeft), which sets
// the earliest repeat at 20-25 min. (Before it, a storm's second tornado came from the same flat hourly rate as its
// first: 0.09 an hour after a lift, 20% of tornadic storms with two or more, 85 min apart (median, start to start), on
// base-2026-11-19c, against real families 15-60 min apart. Calibrated on seeds 1-4 x 4 days with fullRatePerHour
// trimmed to keep the count: gain 6-12 over 0.25/0.75 h gave 22-28% repeats 55-60 min apart; gain 30 over 0.2/0.5 h
// gives 35%, 50 min apart (p10 20, p90 110).)
const RENEWAL = Object.freeze({ gain: 30, buildHours: 0.2, decayHours: 0.5 });
// The storm's genesis rate per hour now: its rotation's rate (tornadoRatePerHour) with the renewed meso's lift.
export const stormTornadoRatePerHour = storm => tornadoRatePerHour(tornadoImminence(storm), storm.environment?.lcl ?? null) * (1 + RENEWAL.gain * clamp(storm.tornado?.renewal ?? 0, 0, 1));
function stepRenewal(storm, tornado, dtHours) {
  if (tornado.onGround) { tornado.renewalCharge = Math.max(tornado.renewalCharge ?? 0, clamp(storm.occlusion ?? 0, 0, 1)); tornado.renewal = 0; return; }
  const charge = tornado.renewalCharge ?? 0;
  if (!(charge > 1e-4) && !((tornado.renewal ?? 0) > 1e-4)) { tornado.renewalCharge = 0; tornado.renewal = 0; return; }
  tornado.renewalCharge = charge * Math.exp(-dtHours / RENEWAL.decayHours);
  tornado.renewal = (tornado.renewal ?? 0) + (tornado.renewalCharge - (tornado.renewal ?? 0)) * (1 - Math.exp(-dtHours / RENEWAL.buildHours));
}
// Scale (mph above 65) of the wind spread for a tornado under this low-level rotation, and the
// share of tornadoes from that spread whose wind reaches a given speed.
export const tornadoWindScaleMph = (lowRotation, stp = 0, lclM = null) => (INTENSITY.baseScaleMph + INTENSITY.rotationScaleMph * clamp(lowRotation, 0, 1.2) + INTENSITY.stpScaleMph * clamp(stp / INTENSITY.stpFull, 0, 1.2) ** INTENSITY.stpPower) * cloudBaseTerm(lclM);
// LEAN (2026-11-17, the owner's request): a tornado's strength leans on its inflow's low-level instability. Its wind is still
// its draw's place in the spread its storm allows (strengthUniform, INTENSITY), but the draw leans toward the top where the
// inflow is more unstable in its lowest 3 km than is usual for tornadoes under that spread, and toward the bottom where it
// is less (Hampshire et al. 2018, NWA JOM: 0-3 km CAPE and lapse rate set EF4-5 environments apart from EF2-3 ones; the
// stretching of low-level vorticity by a stronger low-level updraught, Markowski and Richardson 2010). The lean is a
// Gaussian copula: u' = Phi(sqrt(1 - rho^2) Phi^-1(u) + rho z), with z the inflow's standard score: where its instability
// stands among the engine's own tornadoes with the same spread (quantiles below, measured on seeds 11-18 x 8 days before the
// lean, by spread terciles; ties within a quantile split by a draw of their own). z is then standard normal over the
// engine's tornadoes, so u' stays uniform and the winds, ratings, lives and tracks keep their spread: only which storms get
// the strong ones changes. rho: how far the draw follows z. Re-measure the quantiles when the low levels change (the
// warm-sector moisture, the 0-3 km CAPE or lapse rate); the table is in tornado-lean order, not painted values.
const LEAN = { rho: 0.35, scaleMph: [31.5,49.1,75.5], quantiles: [
  [16,55,84,123,176,220,264,334,418,527,640,780,934,1029,1203,1349,1572,1763,1990,2357,3172],
  [17,103,153,198,265,312,393,452,534,612,709,847,935,1101,1224,1335,1564,1686,1870,2153,3160],
  [36,157,224,276,329,387,464,541,647,729,831,975,1129,1261,1400,1491,1689,1820,2058,2365,4202]
] };
const normCdf = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989422804014327 * Math.exp(-x * x / 2), p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x >= 0 ? 1 - p : p; };
// (Acklam's inverse of the normal distribution)
function normInv(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239], b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572], c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
// The share of a quantile row (instability at P = 0, 1/n, ..., 1) below v (inclusive: at or below), read linearly between.
function rowShare(row, v, inclusive) {
  const n = row.length - 1;
  if (inclusive) { if (v < row[0]) return 0; if (v >= row[n]) return 1; for (let i = n - 1; i >= 0; i--) if (row[i] <= v) return (i + (v - row[i]) / (row[i + 1] - row[i])) / n; return 0; }
  if (v <= row[0]) return 0; if (v > row[n]) return 1; for (let i = 1; i <= n; i++) if (row[i] >= v) return (i - 1 + (v - row[i - 1]) / (row[i] - row[i - 1])) / n; return 1;
}
// A tornado's standard score: where its inflow's instability stands among the engine's tornadoes under the same spread
// (read between the spread terciles' rows), a tie split by tieDraw (0-1; 0.5 for the middle of it).
export function leanScore(scaleMph, instability, tieDraw = 0.5) {
  if (instability === null || !Number.isFinite(instability)) return null;
  const at = row => { const below = rowShare(row, instability, false), atOrBelow = rowShare(row, instability, true); return below + tieDraw * (atOrBelow - below); };
  const c = LEAN.scaleMph, k = scaleMph <= c[0] ? 0 : scaleMph >= c[c.length - 1] ? c.length - 2 : c.findIndex((v, i) => scaleMph >= v && scaleMph < c[i + 1]);
  const f = Math.min(1, Math.max(0, (scaleMph - c[k]) / (c[k + 1] - c[k])));
  const share = at(LEAN.quantiles[k]) * (1 - f) + at(LEAN.quantiles[k + 1]) * f;
  return normInv(Math.min(1 - 1e-4, Math.max(1e-4, share)));
}
// A draw (0-1) leaned by a standard score z.
export const leanedDraw = (u, z) => normCdf(Math.sqrt(1 - LEAN.rho * LEAN.rho) * normInv(Math.min(1 - 1e-6, Math.max(1e-6, u))) + LEAN.rho * z);

// Low-level instability of a storm's inflow (Hampshire et al. 2018): 0-3 km mixed-layer CAPE (J/kg) times the 0-3 km lapse
// rate (C/km), uncapped.
// (null when the inflow carries no 0-3 km CAPE, as a hand-made environment may not: then nothing leans)
export const lowLevelInstability = environment => Number.isFinite(environment?.cape03) ? Math.max(0, environment.cape03) * Math.max(0, environment?.lapseRate03 ?? 6.5) : null;
// SPEED_LIMIT (2026-11-17, the owner's request; was a flat 235 mph cap on the ceiling): how fast a tornado can turn is
// bounded by the pressure its parent updraught can pull down, the thermodynamic speed limit sqrt(2 CAPE), which the
// low-level inflow of a vortex can beat by a factor up to about 1.8 (Fiedler and Rotunno 1986, JAS 43; the end-wall
// vortex). The ceiling the draw gives (65 mph plus its excess) bends to that limit through a soft minimum of the two
// excesses (sharpness: how close to the limit the bend begins); a ceiling well under it is left as it was.
const SPEED_LIMIT = { vortexFactor: 1.8, sharpness: 6, mphPerMs: 2.23694 };
const PATH_WIDTH = { sharpness: 6, ydPerKm: 1093.61, floorYd: 20, ydPerMph: 6.7, windPower: 0.85, refWallCloudKm: 2.1, sizePower: 1.5,
  inflowKt: 30, inflowPower: 0.5, srh: 300, srhPower: 0.5, cape: 1500, capePower: 0.3 };
// The environment's part in a tornado's width (a factor about 1): the low-level storm-relative inflow, which sets the
// updraught's width by mass continuity (Peters et al. 2019, 2020, JAS: R ~ 2 V_sr H / w, r 0.76-0.9 in simulations); the
// 0-1 km SRH, near-surface streamwise vorticity, which sets the low-level mesocyclone's radius (Peters et al. 2023, JAS 80:
// r 0.77; they found the tornado's size unrelated to the updraught's); and the CAPE, the widest tornadoes' environments
// having about twice the median MLCAPE (Garner et al. 2021, WAF 36). Observed, no environmental quantity explains more
// than about 14% of the variance in damage width (Garner: r <= 0.38), so the powers are kept below 1. The references
// are near the medians of real tornadic environments.
export const pathWidthEnvironmentFactor = (environment, velocityKph) => {
  const e = environment ?? {}, kt = 1 / 1.852, ve = (Number(velocityKph?.east) || 0) * kt, vn = (Number(velocityKph?.north) || 0) * kt;
  const lowE = ((Number(e.surfaceWind?.eastKt) || 0) + (Number(e.wind850?.eastKt) || 0)) / 2, lowN = ((Number(e.surfaceWind?.northKt) || 0) + (Number(e.wind850?.northKt) || 0)) / 2;
  const inflow = Math.max(5, Math.hypot(lowE - ve, lowN - vn)), srh = Math.max(50, Number(e.srh) || 0), cape = Math.max(100, Number(e.cape) || 0);
  const P = PATH_WIDTH;
  return (inflow / P.inflowKt) ** P.inflowPower * (srh / P.srh) ** P.srhPower * (cape / P.cape) ** P.capePower;
};
// The smaller of a and b, smoothly (p: how sharp the bend; a value far under the other is left as it was).
const softMinimum = (a, b, p) => a <= 0 ? 0 : Math.pow(Math.pow(a, -p) + Math.pow(b, -p), -1 / p);
export const tornadoSpeedLimitMph = cape => SPEED_LIMIT.vortexFactor * Math.sqrt(2 * Math.max(0, Number(cape) || 0)) * SPEED_LIMIT.mphPerMs;
// A tornado's wind ceiling (mph) from the excess over 65 mph its draw gives and its inflow's CAPE (J/kg; none: no limit).
export function tornadoCeilingMph(excessMph, cape = null) {
  const excess = Math.max(0, excessMph);
  if (cape === null || cape === undefined || !Number.isFinite(Number(cape))) return 65 + excess;
  const room = Math.max(1e-3, tornadoSpeedLimitMph(cape) - 65), p = SPEED_LIMIT.sharpness;
  return 65 + softMinimum(excess, room, p);
}
// The excess a draw must give for the ceiling to reach mph under the inflow's limit (Infinity: out of reach).
function excessNeeded(mph, cape) {
  const e = Math.max(0, mph - 65);
  if (cape === null || cape === undefined || !Number.isFinite(Number(cape)) || e === 0) return e;
  const room = Math.max(1e-3, tornadoSpeedLimitMph(cape) - 65), p = SPEED_LIMIT.sharpness;
  return e >= room ? Infinity : Math.pow(Math.pow(e, -p) - Math.pow(room, -p), -1 / p);
}
// With z (leanScore) the share among tornadoes whose inflow has that score; without, among all (the lean's average).
// With cape, under the inflow's speed limit (SPEED_LIMIT).
export const tornadoShareReaching = (scaleMph, mph, z = null, cape = null) => {
  const share = Math.exp(-Math.pow(excessNeeded(mph, cape) / scaleMph, 1 / INTENSITY.tail));
  if (z === null || !Number.isFinite(z) || share >= 1 || share <= 0) return share;
  return 1 - normCdf((normInv(1 - share) - LEAN.rho * z) / Math.sqrt(1 - LEAN.rho * LEAN.rho));
};

// A tornado's life in stages: the tornado lab's six (TornadoStages.js, 2026-11-19; the lab's earlier request, the
// same day, had three - organizing, mature, decay): over its drawn life (LIFE), so its length is unchanged, it
// touches down as a broad, weak vortex at the EF0 wind and spins up as its core contracts (organizing), holds the
// vortex's wind (mature), eases and thins as the outflow cuts it off (shrinking: the base drifts, DECAY_DRIFT) and
// ropes out, thin and contorted, its wind falling through EF0 by the end (rope). Its rating, width and occlusion
// orbit follow the vortex's intensity (intensityMph). A tornado whose storm is losing the low-level rotation that
// holds it (faded, or cut off by its occlusion) goes into its decay ahead of the loss: rotationLossFall, from the
// minutes the rotation's trend leaves until it falls below sustainRotation, over min(DECAY_DRIFT.windowMinutes,
// windowShare of its life); if the rotation recovers, so does the tornado.
const smooth01 = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
// The core (m) whose wind at the ground falls to the EF0 wind at half the damage width (r^-1 outside it).
// How far ahead of the loss of the rotation holding it a tornado is in its decay (0-1): the rotation's minutes left
// at its trend before it falls below sustainRotation, over min(DECAY_DRIFT.windowMinutes, windowShare of its life).
export function rotationLossFall(storm, tornado) {
  const low = clamp(storm.lowRotation ?? 0, 0, 1.2), trend = Number(storm.lowRotationTrend) || 0, life = Number(tornado?.lifeMinutes) || 0;
  if (!(trend < 0) || !(life > 0)) return 0;
  const left = Math.max(0, low - TORNADO.sustainRotation) / -trend * 60, window = Math.min(DECAY_DRIFT.windowMinutes, DECAY_DRIFT.windowShare * life);
  return smooth01(1 - left / Math.max(1e-3, window));
}
export const matureCoreM = (widthYards, windMph) => Math.max(TORNADO_STAGES.minCoreM, Math.min(widthYards * 0.9144 / 2, widthYards * 0.9144 / 2 * 65 / Math.max(65, Number(windMph) || 65)));

export function updateTornadoState(world, storm, environment, dtHours) {
  const tornado = storm.tornado ?? initializeTornadoState(storm);
  const dtMinutes = dtHours * 60;
  const rotating = rotatingShare(storm), low = clamp(storm.lowRotation ?? 0, 0, 1.2);
  const ingredients = tornadoIngredients(environment);
  const imminence = tornadoImminence(storm);
  stepRenewal(storm, tornado, dtHours);
  const ratePerHour = tornadoRatePerHour(imminence, environment?.lcl ?? null) * (1 + RENEWAL.gain * clamp(tornado.renewal ?? 0, 0, 1));
  // The chance of one in the next half hour, for the pages; imminence is the cue itself.
  const chance = 1 - Math.exp(-ratePerHour * TORNADO.outlookHours);
  tornado.genesisPotential = imminence;
  // (minutes since the last one ended, for its dissipated stage: TornadoStages dissipatedStage)
  { const now = world.stormEngine?.validHourUtc ?? world.validHourUtc ?? 0; tornado.minutesSinceEnd = !tornado.onGround && Number.isFinite(tornado.endedHourUtc) ? Math.max(0, (now - tornado.endedHourUtc) * 60) : null; }
  tornado.probability = chance;
  tornado.rawStp = ingredients;

  const wasDown = tornado.onGround;
  if (!tornado.onGround) {
    const now = world.stormEngine?.validHourUtc ?? world.validHourUtc ?? 0;
    const tick = Math.round((now + storm.ageHours) * 12);
    const draw = deterministicUnit(`${world.evolution?.config?.seed ?? 1}|${storm.id}|tor|${tick}`);
    // (none touches down off the map: a storm stepped offstage is there only to let its tornado finish, StormEngine OFFSTAGE)
    if (!storm.offstage && draw < 1 - Math.exp(-ratePerHour * dtHours)) {
      // (a world saved while the cloud model's hints were in use may carry these: 2026-11-06)
      delete tornado.armed; delete tornado.timing; delete tornado.atModel;
      beginTornado(world, storm, tornado);
      drawTornadoCharacter(world, storm, tornado, environment);
      // It is counted on the ground for the whole of this step, and the storm has already
      // moved through it, so it touched down where the wall cloud was at the step's start: its
      // track (and path) starts there, and it is now under the mesocyclone with the storm.
      // (2026-10-29: its position was left at the step's start, a step's motion - ~4 km -
      // behind its own mesocyclone, until it drifted back.)
      const start = { x: tornado.positionKm.x - (storm.velocityKph?.east ?? 0) * dtHours, y: tornado.positionKm.y + (storm.velocityKph?.north ?? 0) * dtHours };
      tornado.trackPoints.push({ ...start, hourUtc: (world.stormEngine?.validHourUtc ?? world.validHourUtc) - dtHours });
      tornado.pathLengthKm += Math.hypot(tornado.positionKm.x - start.x, tornado.positionKm.y - start.y);
    } else tornado.state = tornado.state === 'ended' ? 'ended' : 'none';
  }

  tornado.previousPositionKm = { ...tornado.positionKm };
  // A tornado on the ground goes where the storm's motion takes it, and drifts toward the wall
  // cloud no faster than driftKph. The storm's centre can move at once when it merges or its
  // line joins another, and the tornado does not go with it: it is left where it was, and if
  // the storm's low-level rotation is no longer over it, it ends (below).
  // Occlusion: as the rear-flank outflow wraps round the tornado it turns it left of the storm's
  // track and slows it, so its track hooks left late in its life (observed turns of 30-55
  // degrees with rear-flank surges, and more as a tornado dissipates; it does not run back over
  // its own path). The tornado moves at the storm's velocity turned left by up to
  // OCCLUSION_TRACK.turnDeg and slowed by up to slowShare as the storm occludes; what that takes
  // it from the wall cloud is kept (to the occlusion's share of the wall cloud's radius), and it is carried by it as
  // well as by the storm's motion, so it is no more "left behind" for it than before.
  const before = (wasDown && tornado.occlusionOffsetKm) || { x: 0, y: 0 };
  const orbitPath = [], offset = wasDown ? occlusionStep(storm, before, dtHours, orbitPath) : { x: 0, y: 0 };
  // ...and a rear-flank surge's push, mid-life (RFD_SURGE)
  const surgeBefore = (wasDown && tornado.surgeOffsetKm) || { x: 0, y: 0 }, surgeOffset = wasDown ? surgeStep(world, storm, tornado, environment, surgeBefore, dtHours) : { x: 0, y: 0 };
  // ...and in its last minutes, cut off from the inflow, it is carried by the low-level air round it (DECAY_DRIFT)
  const driftBefore = (wasDown && tornado.decayDriftBeforeKm) || { x: 0, y: 0 }, drift = wasDown ? decayDrift(storm, tornado, environment, dtHours) : { x: 0, y: 0 };
  const held = tornadoPosition(storm), wall = { x: held.x + offset.x + drift.x + surgeOffset.x, y: held.y + offset.y + drift.y + surgeOffset.y };
  tornado.occlusionOffsetKm = offset; tornado.decayDriftBeforeKm = drift; tornado.surgeOffsetKm = surgeOffset;
  if (wasDown) {
    const carried = { x: tornado.positionKm.x + (storm.velocityKph?.east ?? 0) * dtHours + offset.x - before.x + drift.x - driftBefore.x + surgeOffset.x - surgeBefore.x, y: tornado.positionKm.y - (storm.velocityKph?.north ?? 0) * dtHours + offset.y - before.y + drift.y - driftBefore.y + surgeOffset.y - surgeBefore.y };
    if (tornado.orbitRadPerS && orbitPath.length > 1) {
      // Revolving round the mesocyclone: stepped through the orbit's substeps, so a loop or cusp within the 5-minute
      // step is in its track (and its path's length) - the offset's revolution, the storm's motion, the drift and
      // the surge each a share of the step, and the pull toward where it is held each substep.
      const n = orbitPath.length, ve = (storm.velocityKph?.east ?? 0) * dtHours / n, vn = (storm.velocityKph?.north ?? 0) * dtHours / n, pull = TORNADO.driftKph * dtHours / n;
      const dx = (drift.x - driftBefore.x + surgeOffset.x - surgeBefore.x) / n, dy = (drift.y - driftBefore.y + surgeOffset.y - surgeBefore.y) / n;
      let p = { ...tornado.positionKm }, last = before; tornado.subTrack = [];
      for (let i = 0; i < n; i++) {
        const o = orbitPath[i], f = (i + 1) / n;
        p = { x: p.x + ve + o.x - last.x + dx, y: p.y - vn + o.y - last.y + dy }; last = o;
        const at = { x: held.x - (storm.velocityKph?.east ?? 0) * dtHours * (1 - f) + o.x + driftBefore.x + (drift.x - driftBefore.x) * f + surgeBefore.x + (surgeOffset.x - surgeBefore.x) * f,
          y: held.y + (storm.velocityKph?.north ?? 0) * dtHours * (1 - f) + o.y + driftBefore.y + (drift.y - driftBefore.y) * f + surgeBefore.y + (surgeOffset.y - surgeBefore.y) * f };
        const gap = Math.hypot(at.x - p.x, at.y - p.y), share = gap > 0 ? Math.min(1, pull / gap) : 0;
        p = { x: p.x + (at.x - p.x) * share, y: p.y + (at.y - p.y) * share };
        if (i < n - 1) tornado.subTrack.push({ ...p, f });
      }
      tornado.positionKm = p;
    } else {
      tornado.subTrack = null;
      const gap = Math.hypot(wall.x - carried.x, wall.y - carried.y), share = gap > 0 ? Math.min(1, TORNADO.driftKph * dtHours / gap) : 0;
      tornado.positionKm = { x: carried.x + (wall.x - carried.x) * share, y: carried.y + (wall.y - carried.y) * share };
    }
  } else tornado.positionKm = wall;
  const reachKm = storm.geometry?.updraught?.radiusKm ?? Infinity;
  const leftBehind = Math.hypot(wall.x - tornado.positionKm.x, wall.y - tornado.positionKm.y) > reachKm;
  tornado.forwardSpeedMph = Math.hypot(storm.velocityKph?.east ?? 0, storm.velocityKph?.north ?? 0) * MPH_PER_KPH;
  tornado.motionDirectionDeg = motionDirection(storm.velocityKph);
  if (!tornado.onGround) return tornado;

  tornado.ageMinutes += dtMinutes;
  tornado.groundTimeMinutes += dtMinutes;
  tornado.trackPoints ??= [];
  { const nowH = world.stormEngine?.validHourUtc ?? world.validHourUtc, via = tornado.subTrack ?? [];
    let q = tornado.previousPositionKm;
    for (const p of via) { tornado.pathLengthKm += Math.hypot(p.x - q.x, p.y - q.y); q = p; tornado.trackPoints.push({ x: p.x, y: p.y, hourUtc: nowH - dtHours * (1 - p.f) }); }
    tornado.pathLengthKm += Math.hypot(tornado.positionKm.x - q.x, tornado.positionKm.y - q.y);
    tornado.subTrack = null; }
  tornado.trackPoints.push({ x: tornado.positionKm.x, y: tornado.positionKm.y, hourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc });
  // (TRACK_POINTS: a revolving tornado adds its substeps' points)
  while (tornado.trackPoints.length > TRACK_POINTS) tornado.trackPoints.shift();

  // Wind: this tornado's draw is its quantile in a spread whose scale the storm's underlying
  // low-level rotation sets; the wind builds over its first minutes and falls as it occludes.
  // (its ceiling bends to the inflow's speed limit, SPEED_LIMIT: no draw is too high)
  const quantile = clamp(Number.isFinite(tornado.strengthUniform) ? tornado.strengthUniform : 0.5, 0, 1);
  const scaleMph = tornadoWindScaleMph(storm.lowRotationFree ?? low, ingredients, environment?.lcl ?? null);
  const ceilingMph = tornadoCeilingMph(scaleMph * Math.pow(-Math.log(1 - quantile), INTENSITY.tail), environment.cape);
  // Its life, from the wind it can reach when it first comes down (LIFE).
  if (tornado.lifeMinutes == null) {
    const mean = LIFE.meanMinutes[0] + (LIFE.meanMinutes[1] - LIFE.meanMinutes[0]) * Math.pow(clamp((ceilingMph - 65) / (LIFE.ceilingMph - 65), 0, 1.3), LIFE.power);
    tornado.lifeMinutes = -mean * Math.log(1 - clamp(Number.isFinite(tornado.lifeDraw) ? tornado.lifeDraw : 0.5, 0, 0.999));
    // Now and then an intense tornado's storm does not occlude (STEADY): its rear-flank outflow
    // does not wrap round and undercut it (a warmer, more buoyant downdraught, which this scale
    // cannot resolve, so it is drawn), and the odds rise with how strong it can get and with the
    // low-level helicity feeding it. Such a tornado keeps under its updraught: a long, nearly
    // straight track with the storm, its wind and width held, until the outflow at last wraps
    // round it in its last STEADY.endMinutes and it hooks left and dies.
    const steadyOdds = STEADY.share * ramp(ceilingMph, STEADY.ceilingMph[0], STEADY.ceilingMph[1]) * ramp(environment.srh, STEADY.srh[0], STEADY.srh[1]);
    tornado.steady = (Number.isFinite(tornado.steadyDraw) ? tornado.steadyDraw : 1) < steadyOdds;
    if (tornado.steady) tornado.lifeMinutes *= STEADY.lifeFactor;
  }
  // How fast the storm occludes round it, for StormRotation (1: as usual).
  tornado.occlusionShare = tornado.steady && tornado.groundTimeMinutes < tornado.lifeMinutes - STEADY.endMinutes ? STEADY.occlusionShare : 1;
  // A brief vortex reaches its wind sooner than a long-lived one builds to its own.
  const matureMinutes = Math.min(INTENSITY.matureMinutes, Math.max(1, 0.4 * tornado.lifeMinutes));
  const targetWind = 65 + (ceilingMph - 65) * clamp(tornado.groundTimeMinutes / matureMinutes, 0.25, 1) * (1 - INTENSITY.occlusionLoss * clamp(storm.occlusion ?? 0, 0, 1));
  // (intensityMph: the vortex the storm supports, which its width, rating and orbit follow; the wind it shows is
  // that through its life's stages, TornadoStages.js, below)
  tornado.intensityMph = Number.isFinite(tornado.intensityMph) ? tornado.intensityMph : (tornado.windSpeedMph > 0 ? tornado.windSpeedMph : 75); // (one down in a world saved before 2026-11-19)
  // (its time constant, 1 / INTENSITY.spinUpPerHour, sets how long its organizing stage lasts: TornadoStages organizingMinutes)
  tornado.intensityMph += (targetWind - tornado.intensityMph) * clamp(dtHours * INTENSITY.spinUpPerHour, 0, 1);
  const matureWind = 65 + (ceilingMph - 65) * (1 - INTENSITY.occlusionLoss * clamp(storm.occlusion ?? 0, 0, 1));
  // (and once its rotation is lost, the rope-out it is playing out instead, ROPE_OUT below: begun in the step the rotation
  // crosses sustainRotation, from the fall it had reached - rotationLossFall is 1 by then - at the rope's own pace)
  if (!tornado.ropeOut && low < TORNADO.sustainRotation && tornado.ageMinutes > dtMinutes + 1e-6) {
    const sh = tornadoStageShares(tornado.lifeMinutes), ropeMinutes = sh.rope * tornado.lifeMinutes, ropeSpan = 1 - sh.shrinking / Math.max(1e-3, 1 - sh.matureEnds);
    const prevLow = low - (storm.lowRotationTrend ?? 0) * dtHours, crossed = prevLow > low ? clamp((prevLow - TORNADO.sustainRotation) / (prevLow - low), 0, 1) : 1;
    const fromMinutes = tornado.groundTimeMinutes - dtMinutes * (1 - crossed), fall = clamp(tornado.lifeFall ?? 0, 0, 1);
    tornado.ropeOut = { fromMinutes, fall, endMinutes: fromMinutes + (1 - fall) * ropeMinutes / Math.max(1e-3, ropeSpan), endedBy: (storm.lowRotationFree ?? 0) >= TORNADO.sustainRotation ? 'occluded' : 'rotation faded' };
  }
  const ro = tornado.ropeOut, roFall = ro ? ro.fall + (1 - ro.fall) * clamp((tornado.groundTimeMinutes - ro.fromMinutes) / Math.max(1e-3, ro.endMinutes - ro.fromMinutes), 0, 1) : 0;
  tornado.lossFall = ro ? roFall : tornado.source && tornado.source !== 'mesocyclone' ? 0 : rotationLossFall(storm, tornado);
  // (its stage: the tornado lab's six, TornadoStages.js, 2026-11-19 - organizing, mature, shrinking, rope on the ground)
  // (the stages shape the vortex's own spin, the swirl over the storm's motion; its fall from its peak is part of its decay)
  const motionMph = Math.hypot(storm.velocityKph?.east ?? 0, storm.velocityKph?.north ?? 0) / 1.609344;
  const stage = tornadoStage(tornado.groundTimeMinutes, tornado.lifeMinutes, tornado.intensityMph, matureWind, tornado.lossFall, tornado.ropeFall ?? 0, { motionMph, peakMph: Math.max(tornado.peakWindSpeedMph ?? 0, tornado.intensityMph) });
  if (stage.fall > 0) tornado.ropeFall = Math.max(tornado.ropeFall ?? 0, stage.fall);   // (the decay's ratchet: TornadoStages fallFloor)
  // (in its rope, however it got there, it ropes out at the rope's own pace, committed - ROPE_OUT: one taken into its rope
  // by the forecast loss of its rotation had sat there 35-40 min when the rotation never quite crossed sustainRotation)
  if (stage.name === 'rope' && !tornado.ropeOut) {
    const sh = tornadoStageShares(tornado.lifeMinutes), ropeMinutes = sh.rope * tornado.lifeMinutes, ropeSpan = 1 - sh.shrinking / Math.max(1e-3, 1 - sh.matureEnds);
    tornado.ropeOut = { fromMinutes: tornado.groundTimeMinutes, fall: stage.fall, endMinutes: tornado.groundTimeMinutes + (1 - stage.fall) * ropeMinutes / Math.max(1e-3, ropeSpan),
      endedBy: stage.by === 'time' ? 'vortex spent' : (storm.lowRotationFree ?? 0) >= TORNADO.sustainRotation ? 'occluded' : 'rotation faded' };
  }
  tornado.lifeFall = stage.fall;
  // (in its decay the wind it shows and its core keep to their running minimum: a shrinking vortex does not regrow - the
  // lab, 2026-11-19 - though the vortex the storm supports, intensityMph, the rating's, still can)
  const decaying = stage.fall > 0, wasHeld = tornado.decayHeld;
  tornado.decayHeld = decaying ? { windMph: Math.min(wasHeld?.windMph ?? Infinity, stage.windMph), coreShare: Math.min(wasHeld?.coreShare ?? Infinity, stage.coreShare) } : null;
  tornado.windSpeedMph = decaying ? tornado.decayHeld.windMph : stage.windMph; tornado.lifeStage = stage.name; tornado.lifeShare = stage.share;
  tornado.stageProgress = stage.progress; tornado.contortion = stage.contortion; tornado.driftShare = stage.drift;
  tornado.environmentWindCeilingMph = ceilingMph;
  // Stronger tornadoes are wider: fitted to the record's median widths by rating (SPC database 2008-2022: EF0 50 yd,
  // EF1 125, EF2 300, EF3 600, EF4 900, EF5 1,600). (2026-10-25: 30 + 1.3 x (wind - 65)^1.25 gave about 195 yd at EF2
  // winds, 290 at EF3 and 460 at EF4, half the record's, and the narrow paths showed too little damage: of 18
  // tornadoes with EF3 winds none was rated EF3.)
  // (2026-11-17, the owner's request; was held to 25-1600 yd) The widest damage paths are as wide as the low-level
  // mesocyclone the tornado sits in, not more: the circulation that feeds it bounds it (Wurman and Kosiba 2013, MWR; the
  // El Reno tornado of 31 May 2013, 2.6 mi wide, filled its wall cloud). The width the wind gives bends to the wall cloud's
  // radius through a soft minimum (PATH_WIDTH.sharpness), as the wind ceiling bends to its speed limit.
  // (2026-11-21, the owner's request) The width also scales with the size of that circulation, not only the wind: path
  // widths spread widely within each rating and overlap between them (Brooks 2004, Wea. Forecasting 19), and the widest
  // come from broad low-level mesocyclones. Width = ydPerMph (wind - 65)^windPower (wall cloud / refWallCloudKm)^sizePower,
  // refWallCloudKm the median under the engine's tornadoes. (Was 0.66 (wind - 65)^1.5, wind alone: no path passed
  // ~1,450 yd on base-2026-11-21, 1,579 tornadoes. The exponent is lower because a bigger wall cloud comes with a
  // stronger tornado (r 0.53): fitted on that run to keep the EF0-EF3 medians within 3%, while EF3+ widths spread to
  // ~2,000 yd in the broadest circulations and wide EF0-1 wedges appear.)
  // (2026-11-21, second step) ...and with the environment (pathWidthEnvironmentFactor): against the SPC record 2008-2022
  // the spread of ln width within a rating was 0.36-0.65 against 0.65-0.91; the floor 30 to 20 yd for the narrow EF0s
  // (the record's EF0 p10 is 20 yd). Fitted offline on width-env (1,579 tornadoes) to hold the medians. sizePower 2 to 1.5
  // with it: the wall cloud grows with the tornado's strength, and at 2 the strongest overshot (EF4 median 1,295 yd, 0.63%
  // of all paths over 2,000 yd against the record's 900 yd and 0.21%).
  const wallKm = wallCloudRadiusKm(storm.lowRotationFree ?? low), widthCap = Math.max(1, wallKm * PATH_WIDTH.ydPerKm - PATH_WIDTH.floorYd);
  const envWidth = pathWidthEnvironmentFactor(environment, storm.velocityKph);
  const widthFor = mph => PATH_WIDTH.floorYd + softMinimum(PATH_WIDTH.ydPerMph * Math.max(0, mph - 65) ** PATH_WIDTH.windPower * (wallKm / PATH_WIDTH.refWallCloudKm) ** PATH_WIDTH.sizePower * envWidth, widthCap, PATH_WIDTH.sharpness);
  const targetWidth = widthFor(tornado.intensityMph);
  tornado.widthYards += (targetWidth - tornado.widthYards) * clamp(dtHours * 8, 0, 1);
  // (its peak is the vortex's: every life has a mature stage, between the 5-minute ticks for a brief one, where the
  // wind it shows is the vortex's - so the rating is as before the stages; 2026-11-19, the peak of the ticks' winds
  // lost a brief tornado's second tick to its decay and moved 14% of tornadoes from EF1 to EF0)
  tornado.peakWindSpeedMph = Math.max(tornado.peakWindSpeedMph, tornado.intensityMph);
  // Its core (m): the mature core is the one whose wind falls to the EF0 wind at half the damage width the
  // vortex is heading for; the stage scales it (TornadoStages.js).
  // (the mature core: of the vortex's mature wind and the width it heads for, so it does not grow while the core
  // contracts; held through the decay, which thins it to the rope)
  if (!(stage.fall > 0) || !(tornado.matureCoreM > 0)) { const w = Math.max(tornado.intensityMph, matureWind); tornado.matureCoreM = matureCoreM(widthFor(w), w); }
  tornado.coreRadiusM = Math.max(TORNADO_STAGES.minCoreM, tornado.matureCoreM * (tornado.decayHeld?.coreShare ?? stage.coreShare));
  tornado.peakWidthYards = Math.max(tornado.peakWidthYards, tornado.widthYards);
  // What a damage survey would make of it so far (a rating never goes back down).
  const ratedNow = damageRatingWind(tornado.peakWindSpeedMph, tornado.peakWidthYards, tornado.pathLengthKm, Number.isFinite(tornado.damageDraw) ? tornado.damageDraw : 0.5);
  tornado.ratedWindMph = Math.max(tornado.ratedWindMph ?? 0, ratedNow);
  tornado.estimatedEf = efRating(tornado.ratedWindMph);
  tornado.windEf = efRating(tornado.peakWindSpeedMph);
  storm.hazardExtremes ??= { tornado: { maxWindMph: 0, maxEfRating: null, maxWidthYards: 0, maxPathLengthKm: 0, cycles: 0 }, wind: { maxSustainedMph: 0, maxGustMph: 0 }, hail: { maxSizeInches: 0 } };
  const extreme = storm.hazardExtremes.tornado;
  extreme.maxWindMph = Math.max(extreme.maxWindMph ?? 0, tornado.peakWindSpeedMph);
  extreme.maxWidthYards = Math.max(extreme.maxWidthYards ?? 0, tornado.widthYards);
  extreme.maxPathLengthKm = Math.max(extreme.maxPathLengthKm ?? 0, tornado.pathLengthKm);
  extreme.maxRatedWindMph = Math.max(extreme.maxRatedWindMph ?? 0, tornado.ratedWindMph);
  extreme.maxEfRating = efRating(extreme.maxRatedWindMph);   // the damage rating, as reports and outlook verification use
  extreme.maxWindEf = efRating(extreme.maxWindMph);
  extreme.cycles = Math.max(extreme.cycles ?? 0, tornado.cycleCount ?? 0);

  // A tornado from a line's mesovortex or a boundary (a landspout) has no mesocyclone to lose: the storm's rotation
  // ends only one from a mesocyclone (2026-10-25: every one of them ended at its second tick, after exactly 10 minutes,
  // 13 of 17 on one reviewed day).
  const ownRotation = tornado.source && tornado.source !== 'mesocyclone', spinning = ownRotation || rotating > 0;
  // It ends when the storm no longer holds the low-level rotation for it, or falls apart. It
  // stays down through the step it formed in, so everything that looks at storms between
  // steps sees it.
  // ROPE_OUT (2026-11-19, the tornado lab): losing the rotation that holds it (faded, or cut off by its occlusion) no longer
  // ends it at once - the loss of its parent circulation is what ropes it out, and the rope takes minutes to play out. From
  // the step the rotation falls below sustainRotation its fall runs on to 1 at the rope's own pace (the rope's share of its
  // life over the rope's span of the fall), committed, and it ends at the EF0 wind when it gets there. (Before: it ended in
  // the step it crossed, mid-rope - the lab's tornadoTimeline at 72 mph, contortion 0.72; its EF3 at 91 mph.)
  const lost = low < TORNADO.sustainRotation, spent = tornado.groundTimeMinutes >= tornado.lifeMinutes - 1e-6; // (its rope-out began above)
  const roped = tornado.ropeOut && tornado.groundTimeMinutes >= tornado.ropeOut.endMinutes - 1e-6;
  if (tornado.ageMinutes > dtMinutes + 1e-6 && (!spinning || storm.active === false || leftBehind || spent || roped || (lost && !tornado.ropeOut))) {
    // Why it ended, for the reports: the storm died or stopped rotating, its rotation moved off
    // (a merger), the outflow cut it off (the storm would still hold the rotation were it not
    // occluding), or the rotation faded.
    // (a rope-out ends at its own end, or the life's if that comes first)
    const ropeEnds = roped && !(spent && tornado.ropeOut.endMinutes > tornado.lifeMinutes);
    const endedBy = storm.active === false ? 'storm ended' : !spinning ? 'not rotating' : leftBehind ? 'left behind' : ropeEnds ? tornado.ropeOut.endedBy : spent && (low >= TORNADO.sustainRotation || tornado.ropeOut) ? 'vortex spent' : (storm.lowRotationFree ?? 0) >= TORNADO.sustainRotation ? 'occluded' : 'rotation faded';
    // One whose rotation fell below what holds it (faded, or cut off by the outflow) ended when it crossed sustainRotation
    // within the last step, not at the tick that saw it (2026-10-25: those ended on ticks, 16-39% of them at exactly 10 min).
    const prevLow = low - (storm.lowRotationTrend ?? 0) * dtHours, crossed = low < TORNADO.sustainRotation && prevLow > low ? clamp((prevLow - TORNADO.sustainRotation) / (prevLow - low), 0, 1) : null;
    const fadedLife = crossed !== null && tornado.trackPoints?.length >= 2 ? (tornado.trackPoints.at(-1).hourUtc - dtHours * (1 - crossed) - tornado.trackPoints[0].hourUtc) * 60 : null;
    const cut = endedBy === 'vortex spent' ? cutToLife(tornado) : ropeEnds ? cutToLife(tornado, tornado.ropeOut.endMinutes) : (endedBy === 'rotation faded' || endedBy === 'occluded') && fadedLife !== null ? cutToLife(tornado, fadedLife) : null;
    endTornado(world, storm, tornado, { endedBy, endOcclusion: storm.occlusion ?? 0, endLowRotationFree: storm.lowRotationFree ?? 0, ...(cut ? { endedHourUtc: cut } : {}) });
    if (endedBy === 'vortex spent') storm.lowRotation = (storm.lowRotation ?? 0) * LIFE.rotationLeft;
  } else tornado.state = 'on-ground';
  return tornado;
}

// What cannot be resolved at this scale, drawn once per tornado: where it falls within the
// spread of winds its storm's rotation allows, and how much there was in its path to damage.
function drawTornadoCharacter(world, storm, tornado, environment = storm.environment ?? {}) {
  const seed = `${world.evolution?.config?.seed ?? 1}|${storm.id}|cycle${tornado.cycleCount}`;
  tornado.strengthUniform = deterministicUnit(seed + '|strength');
  tornado.damageDraw = deterministicUnit(seed + '|damage');
  tornado.lifeDraw = deterministicUnit(seed + '|life'); tornado.lifeMinutes = null;
  tornado.steadyDraw = deterministicUnit(seed + '|steady'); tornado.steady = false; tornado.occlusionShare = 1;
  tornado.ratedWindMph = 0;
  // What its strength leans on (LEAN): the spread its storm allows at touchdown and the inflow's low-level instability.
  tornado.lowLevel = { scaleMph: tornadoWindScaleMph(storm.lowRotationFree ?? clamp(storm.lowRotation ?? 0, 0, 1.2), tornadoIngredients(environment), environment?.lcl ?? null), instability: lowLevelInstability(environment) };
  tornado.lowLevel.z = leanScore(tornado.lowLevel.scaleMph, tornado.lowLevel.instability, deterministicUnit(seed + '|lean'));
  tornado.strengthDrawn = tornado.strengthUniform;
  if (tornado.lowLevel.z !== null) tornado.strengthUniform = leanedDraw(tornado.strengthUniform, tornado.lowLevel.z);
}

function beginTornado(world, storm, tornado) {
  tornado.state = 'on-ground'; tornado.onGround = true; tornado.ageMinutes = 0;
  tornado.groundTimeMinutes = 0; tornado.pathLengthKm = 0; tornado.widthYards = 35;
  tornado.windSpeedMph = 65; tornado.intensityMph = 75; tornado.coreRadiusM = null; tornado.matureCoreM = null; tornado.lifeStage = 'organizing'; tornado.lifeShare = 0; tornado.stageProgress = 0; tornado.contortion = 0; tornado.driftShare = 0; tornado.minutesSinceEnd = null; tornado.startedHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  tornado.endedHourUtc = null; tornado.cycleCount += 1; tornado.trackPoints = []; tornado.occlusionOffsetKm = null; tornado.decayDriftBeforeKm = null; tornado.lossFall = 0; tornado.decayHeld = null; tornado.ropeOut = null; tornado.ropeFall = 0; tornado.lifeFall = 0; tornado.surge = null; tornado.surges = 0; tornado.surgeOffsetKm = null; tornado.occlusionPeak = 0; tornado.failedOcclusions = 0; tornado.loopTurnRad = 0; tornado.orbitRadPerS = 0; tornado.positionKm = tornadoPosition(storm);
  tornado.lastGenesisHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  // (its own occlusion charges the next renewal: RENEWAL)
  tornado.renewalCharge = 0; tornado.renewal = 0;
  // What made the rotation it came from: a mesocyclone, a line's mesovortex or a boundary (a landspout).
  tornado.source = storm.lowRotationSource ?? 'mesocyclone';
}

// A tornado whose drawn life ran out between storm ticks ended then: its track is cut back to that
// moment (the end point between the last two ticks), and its path, time on the ground and rating are
// those of the cut track. Returns the hour it ended, or null when nothing was cut. (2026-10-24: it
// could end only at a tick after the one it formed in, so every short-lived tornado lasted exactly
// 10 minutes and ran 5-8 miles: 15 of 19 and 15 of 22 tornadoes on two reviewed days.)
function cutToLife(tornado, lifeMinutes = tornado.lifeMinutes) {
  // (At least a minute: a 0-minute EF1 with no path appeared once the track was cut, 2026-10-24.)
  const points = tornado.trackPoints ?? [], life = Math.max(1, lifeMinutes);
  if (points.length < 2 || !Number.isFinite(life)) return null;
  const endAt = points[0].hourUtc + life / 60;
  if (points.at(-1).hourUtc <= endAt + 1e-9) return null;
  const i = points.findIndex(p => p.hourUtc > endAt), a = points[i - 1], b = points[i], f = (endAt - a.hourUtc) / Math.max(1e-9, b.hourUtc - a.hourUtc);
  tornado.trackPoints = [...points.slice(0, i), { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, hourUtc: endAt }];
  tornado.pathLengthKm = tornado.trackPoints.slice(1).reduce((sum, p, k) => sum + Math.hypot(p.x - tornado.trackPoints[k].x, p.y - tornado.trackPoints[k].y), 0);
  tornado.groundTimeMinutes = life;
  tornado.ratedWindMph = damageRatingWind(tornado.peakWindSpeedMph, tornado.peakWidthYards, tornado.pathLengthKm, Number.isFinite(tornado.damageDraw) ? tornado.damageDraw : 0.5);
  tornado.estimatedEf = efRating(tornado.ratedWindMph);
  return endAt;
}

function endTornado(world, storm, tornado, end = {}) {
  if (tornado.onGround || tornado.startedHourUtc != null) {
    storm.tornadoHistory ??= [];
    storm.tornadoHistory.push({
      cycle: tornado.cycleCount, source: tornado.source ?? 'mesocyclone', startedHourUtc: tornado.startedHourUtc,
      endedHourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc,
      pathLengthKm: tornado.pathLengthKm, groundTimeMinutes: tornado.groundTimeMinutes,
      peakWindSpeedMph: tornado.peakWindSpeedMph, peakWidthYards: tornado.peakWidthYards,
      // estimatedEf is the damage rating; windEf is what its peak wind would be rated on wind alone.
      ratedWindMph: tornado.ratedWindMph ?? tornado.peakWindSpeedMph, estimatedEf: efRating(tornado.ratedWindMph ?? tornado.peakWindSpeedMph), windEf: efRating(tornado.peakWindSpeedMph),
      trackPoints: (tornado.trackPoints ?? []).slice(-TRACK_POINTS), loops: trackLoops(tornado.trackPoints ?? []), lifeMinutes: tornado.lifeMinutes ?? null, steady: Boolean(tornado.steady), damageDraw: tornado.damageDraw ?? null, surges: tornado.surges ?? 0, failedOcclusions: tornado.failedOcclusions ?? 0, occlusionPeak: tornado.occlusionPeak ?? null, ...end
    });
    if (storm.tornadoHistory.length > 8) storm.tornadoHistory.shift();
  }
  tornado.state = 'ended'; tornado.onGround = false; tornado.endedHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  tornado.windSpeedMph = 0; tornado.intensityMph = 0; tornado.coreRadiusM = null; tornado.matureCoreM = null; tornado.lifeStage = null; tornado.stageProgress = null; tornado.contortion = null; tornado.driftShare = null; tornado.minutesSinceEnd = 0; tornado.widthYards = 0; tornado.startedHourUtc = null; tornado.occlusionShare = 1;
}

// Under the storm's wall cloud (StormGeometry.js); at the storm's centre until its shape is first worked out.
function tornadoPosition(storm) {
  const wall = storm.geometry?.wallCloud;
  return wall ? { x: wall.xKm, y: wall.yKm } : { ...storm.positionKm };
}
// How far an occluding tornado drifts from the mesocyclone it formed under, toward the updraught's
// left-rear: the occlusion's share of its low-level circulation's radius (the wall cloud's,
// StormGeometry wallCloudRadiusKm), so it is displaced as the storm occludes, at the occlusion's own
// rate (StormRotation: the cold pool's balance against the shear, and the low-level rotation), however
// fast the storm moves; the storm's next mesocyclone forms back at the origin. Observed: mature
// tornadoes tilt <=10-35 deg in the lowest 1-2 km (Mahre et al. 2018; Griffin et al. 2019), ~0.25-0.6
// km displaced, rising to ~1-1.5 km (55 deg) through dissipation (Griffin et al.).
// (2026-10-29: 1.8 updraught radii, and tornadoes wandered 8-14 km from their storm; then 0.4 updraught
// radii, ~3 km, which the turned and slowed motion of a fast storm reached in one 5-min tick - seed 2's
// first EF1, in a 25 m/s storm, was 2.96 km from its wall cloud 5 min after touchdown and stayed so
// 40 min: separation ~10 m/s, where observed separation is a few m/s. Meteorologist review 2026-11-19.)
const OCCLUSION_TRACK = { turnDeg: 60, slowShare: 0.5 };
// The occlusion orbit (2026-10-29; its rate re-based 2026-11-19): an occluding tornado is wrapped by the rear-flank
// outflow and revolves cyclonically round the mesocyclone it formed under (counterclockwise seen from above; clockwise
// under a left-mover) at the low-level mesocyclone's solid-body rate, V/R, so at its distance r it goes round at the
// mesocyclone's own wind there (Wood 2016, 28th SLS: R 1.5 km, omega 0.01 /s, 15 m/s, a ~10 min period; Agee et al.
// 1976: tornado families on curtate cycloids round the tornado cyclone), times the occlusion. The ground track is the
// storm's motion plus that revolution: a wave when the revolution is slower than the tornado's ground speed, a cusp
// when equal, a LOOP when faster - which comes as an occlusion slows it (Moore 2013, El Reno 2013: loops below ~5 m/s;
// Bennington KS 2013, a slow storm's tornado looping within 2.5 km for half an hour). (Until 2026-11-19: 0.25 x the
// tornado's wind over 65 mph, km/h - the right size for violent tornadoes, but tied to the tornado's wind, not to the
// circulation it revolves in.) substeps resolve a fast revolution within the 5-minute step.
const ORBIT = { substeps: 10 };
// The low-level mesocyclone at the ground ({ V m/s, R km }; StormVortices), or null.
function lowMeso(storm) {
  try { const d = stormVortices(storm); return d ? mesoLevel(d, 0) : null; } catch { return null; }
}
// RFD_SURGE (2026-11-19, owner's request; research: Kurdzo et al. 2015 (Moore 2013: eight rear-flank surges in 39 min;
// an occluding surge turned the tornado N then NW and slowed it under 5 m/s, a surge from the S/SE 1-2 min later
// restored the inflow - a failed occlusion - the tornado looped and lived 12 min more at EF3-4); Lee and Finley 2022
// (Quinter, El Reno, Halstad: mid-life surges turned tornadoes 30-55 deg left and about doubled their speed, which then
// lived >= 21 min more); Marquis et al. 2012, Skinner et al. 2014 (several internal surges per low-level mesocyclone)).
// While a tornado is down, surges of the storm's rear-flank outflow come at up to perMinute (with the cold pool's
// strength), each lasting minutes. A surge wraps round the vortex (the occlusion runs wrapRate x faster, StormRotation)
// or pushes it from the rear: the odds of wrapping rise with the outflow against the low-level shear (the occlusion's
// balance, wrapOdds over balance). A push before the occlusion is under way (below occludedFrom) turns the tornado
// turnDeg left and speeds it speedFactor x, and the mesocyclone with it - an offset that fades over relaxHours after;
// once it is under way, a push restores the inflow and undoes the occlusion toward reloadTo (StormRotation), unless it
// is past irreversible - a failed occlusion: its offset shrinks back under the updraught (the occlusion's cap), its
// wind and rotation recover, and it lives at least extendMinutes more. No numbers for how often occlusions fail were
// found; perMinute and wrapOdds are set so about a fifth of the occlusions under way fail (2026-11-19: 1 / 6.5 and
// 0.4-0.9 failed 2 of 50 - 4% - of those reaching 0.3 over seeds 1, 2, 5 x 48 h; 1 / 5 and 0.25-0.75, 6 of 50; now 9 of 50).
export const RFD_SURGE = Object.freeze({ perMinute: 1 / 5, strength: [0.1, 0.6], minutes: [3, 8], wrapOdds: [0.15, 0.6], balance: [0.36, 1.0],
  occludedFrom: 0.3, turnDeg: [30, 55], speedFactor: [1.5, 2], relaxHours: 0.25, wrapRate: 2.5, reloadTo: 0.2, reloadHours: 0.05, irreversible: 0.85, extendMinutes: [10, 20] });
const rampTo = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);
function surgeStep(world, storm, tornado, environment, before, dtHours) {
  const S = RFD_SURGE, seed = `${world.evolution?.config?.seed ?? 1}|${storm.id}|cycle${tornado.cycleCount}|surge`;
  const ground = tornado.groundTimeMinutes ?? 0, dtMin = dtHours * 60, occ = clamp(storm.occlusion ?? 0, 0, 1);
  // (this step runs from ground to ground + dtMin: the surge ending, or a new one starting in it)
  if (tornado.surge && ground >= tornado.surge.until) tornado.surge = null;
  if (!tornado.surge) {
    const k = Math.round(ground / Math.max(1e-6, dtMin)), rate = S.perMinute * rampTo(storm.coldPoolStrength ?? 0, S.strength[0], S.strength[1]);
    if (rate > 0 && deterministicUnit(`${seed}|${k}`) < 1 - Math.exp(-rate * dtMin)) {
      const odds = S.wrapOdds[0] + (S.wrapOdds[1] - S.wrapOdds[0]) * rampTo(coldPoolBalance(storm, environment, true), S.balance[0], S.balance[1]);
      const lerp = (r, q) => r[0] + (r[1] - r[0]) * deterministicUnit(`${seed}|${k}|${q}`);
      const from = ground + dtMin * deterministicUnit(`${seed}|${k}|at`);
      tornado.surge = { kind: deterministicUnit(`${seed}|${k}|kind`) < odds ? 'wrap' : 'push', from, until: from + lerp(S.minutes, 'min'), turnDeg: lerp(S.turnDeg, 'turn'), speed: lerp(S.speedFactor, 'speed'), occlusion: occ };
      tornado.surges = (tornado.surges ?? 0) + 1;
    }
  }
  tornado.occlusionPeak = Math.max(tornado.occlusionPeak ?? 0, occ);
  const sg = tornado.surge;
  // a failed occlusion: a push once the occlusion is under way, short of irreversible
  if (sg?.kind === 'push' && sg.occlusion >= S.occludedFrom && sg.occlusion < S.irreversible && !sg.counted) {
    sg.counted = true; tornado.failedOcclusions = (tornado.failedOcclusions ?? 0) + 1;
    // (not a rope's: once in its rope, or roping out, the storm's revived rotation goes to its next tornado, under the wall
    // cloud - the occlusion is still undone, StormRotation - not to this one; the lab, 2026-11-19: a rope fattening back
    // into a mature vortex is not seen. A shrinking one can re-strengthen, as observed.)
    const more = tornado.lifeStage === 'rope' || tornado.ropeOut ? 0 : S.extendMinutes[0] + (S.extendMinutes[1] - S.extendMinutes[0]) * deterministicUnit(`${seed}|${Math.round(sg.from * 10)}|more`);
    if (Number.isFinite(tornado.lifeMinutes)) tornado.lifeMinutes = Math.max(tornado.lifeMinutes, ground + more);
  }
  // a push before the occlusion: turned left (right under a left-mover) and sped, for the part of the step it lasts
  let x = before.x * Math.exp(-dtHours / S.relaxHours), y = before.y * Math.exp(-dtHours / S.relaxHours);
  if (sg?.kind === 'push' && sg.occlusion < S.occludedFrom) {
    const share = clamp((Math.min(sg.until, ground + dtMin) - Math.max(sg.from, ground)) / dtMin, 0, 1);
    const v = storm.velocityKph ?? {}, east = v.east ?? 0, north = v.north ?? 0, a = (storm.leftMover ? -1 : 1) * sg.turnDeg * Math.PI / 180;
    const te = sg.speed * (east * Math.cos(a) - north * Math.sin(a)), tn = sg.speed * (east * Math.sin(a) + north * Math.cos(a));
    x += (te - east) * dtHours * share; y -= (tn - north) * dtHours * share;
  }
  return { x, y };
}
const KPH_PER_MPH = 1.609344;
// The occlusion's offset of the tornado from the wall cloud (km, east and south) after a step:
// the difference between the tornado's turned, slowed motion and the storm's, added up, plus its
// revolution round the mesocyclone. Sets tornado.orbitRadPerS (the revolution's rate now, for the
// game) and adds to tornado.loopTurnRad the turning done while revolving faster than the storm
// moves (each 2 pi of it is one loop on the ground).
// DECAY_DRIFT (2026-11-19, owner's go after the occlusion research): a dissipating tornado is cut off from the
// storm's inflow by the rear-flank outflow wrapped round it and is carried more and more by the low-level air
// round it than by its storm - rearward of the updraught, and for the usual veering hodograph to its left: the
// tornado slows and turns left, the terminal hook (radar: storm-relative motion small and in no set direction
// until the last ~10 min, then growing and mostly rearward, left in storms with cyclic tornadoes, the tornado
// 3.5 km from the updraught three volumes before it dies and >6 km at its last; French and Kingfield 2019, JAMC;
// inflow- against outflow-dominated, Dowell and Bluestein 2002). Through its shrinking stage (TornadoStages
// drift: 0 -> 1 over shrinking, 1 through the rope; or ahead of the loss of its rotation, rotationLossFall) its
// motion blends from the storm's toward the 0-500 m wind (lowShare of the way from the surface wind to the 850 mb
// one: 250 m of the ~1.5 km), up to weight. (Until the six stages, 2026-11-19: over the last windowMinutes of its
// life, at most windowShare of a brief one; windowMinutes / windowShare now set only rotationLossFall's window.) The direction is the hodograph's, not set: under storm-relative low-level wind from its right it goes
// left, from its left it goes right. What that moves it from the wall cloud is part of where it is held, as the
// occlusion's offset is, so it is not "left behind" for it; the next tornado forms back under the wall cloud.
export const DECAY_DRIFT = Object.freeze({ windowMinutes: 15, windowShare: 0.4, weight: 0.7, lowShare: 0.17 });
function decayDrift(storm, tornado, environment = storm.environment ?? {}, dtHours) {
  const before = tornado.decayDriftBeforeKm ?? { x: 0, y: 0 }, life = Number(tornado.lifeMinutes);
  if (!(life > 0)) return before;
  const D = DECAY_DRIFT, sfc = environment.surfaceWind, w850 = environment.wind850;
  if (!sfc || !w850) return before;
  const v = storm.velocityKph ?? {}, east = v.east ?? 0, north = v.north ?? 0, KT = 1.852;
  const lowE = (sfc.eastKt + D.lowShare * (w850.eastKt - sfc.eastKt)) * KT, lowN = (sfc.northKt + D.lowShare * (w850.northKt - sfc.northKt)) * KT;
  // (the weight at the middle of the step: its minutes on the ground then)
  const mid = (tornado.groundTimeMinutes ?? 0) + dtHours * 30, w = D.weight * Math.max(tornadoStage(mid, life, tornado.intensityMph ?? 75).drift, clamp(Number(tornado.lossFall) || 0, 0, 1));
  if (!(w > 0)) return before;
  // (east and south, as the offset)
  return { x: before.x + w * (lowE - east) * dtHours, y: before.y - w * (lowN - north) * dtHours };
}
// The loops in a track: the times it crosses itself (a tornado revolving round its mesocyclone faster than it is
// carried on). (Until 2026-11-19 the revolution of its offset, counted where the revolution beat the storm's speed: 5
// "loops" on a track that crossed itself once - the tornado follows the revolving offset no faster than driftKph.)
export function trackLoops(points) {
  let n = 0;
  const cross = (p, q, r, t) => { const d = (q.x - p.x) * (t.y - r.y) - (q.y - p.y) * (t.x - r.x); if (!d) return false;
    const a = ((r.x - p.x) * (t.y - r.y) - (r.y - p.y) * (t.x - r.x)) / d, b = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d; return a > 0 && a < 1 && b > 0 && b < 1; };
  for (let i = 0; i < points.length - 1; i++) for (let j = i + 2; j < points.length - 1; j++) if (cross(points[i], points[i + 1], points[j], points[j + 1])) n++;
  return n;
}
// path (optional): filled with the offset after each substep while it revolves.
const TRACK_POINTS = 480;
function occlusionStep(storm, before, dtHours, path = null) {
  const tornado = storm.tornado;
  if (tornado) tornado.orbitRadPerS = 0;
  const occlusion = clamp(storm.occlusion ?? 0, 0, 1), v = storm.velocityKph ?? {}, east = v.east ?? 0, north = v.north ?? 0;
  const speedKph = Math.hypot(east, north);
  if (!(occlusion > 0) || !(speedKph > 0.5)) return before;
  const turn = OCCLUSION_TRACK.turnDeg * occlusion * Math.PI / 180, keep = 1 - OCCLUSION_TRACK.slowShare * occlusion;
  // Turned left (counterclockwise seen from above), in east and north; the offset is east and south.
  const te = keep * (east * Math.cos(turn) - north * Math.sin(turn)), tn = keep * (east * Math.sin(turn) + north * Math.cos(turn));
  const cap = occlusion * (storm.geometry?.wallCloud?.radiusKm ?? wallCloudRadiusKm(storm.lowRotationFree ?? storm.lowRotation));
  // (the revolution: the low-level mesocyclone's solid-body rate, V/R at the ground, times the occlusion)
  const parent = tornado ? lowMeso(storm) : null, omegaPerH = parent && parent.R > 0 ? parent.V / (parent.R * 1000) * 3600 * occlusion : 0;
  const spin = storm.leftMover ? -1 : 1, h = dtHours / ORBIT.substeps;
  let x = before.x, y = before.y, rate = 0;
  for (let i = 0; i < ORBIT.substeps; i++) {
    x += (te - east) * h; y -= (tn - north) * h;
    const size = Math.hypot(x, y);
    if (size > cap) { x *= cap / size; y *= cap / size; }
    // the revolution: rad/h, at the tornado's distance from the mesocyclone
    rate = spin * omegaPerH;
    const a = rate * h, c = Math.cos(a), s = Math.sin(a);
    // (counterclockwise seen from above, with y south)
    const nx = x * c + y * s, ny = -x * s + y * c;
    x = nx; y = ny;
    // a loop on the ground: the revolution's speed there beats the storm's
    if (tornado && Math.abs(rate) * Math.max(Math.hypot(x, y), 1e-6) > speedKph) tornado.loopTurnRad = (tornado.loopTurnRad ?? 0) + Math.abs(a);
    if (path) path.push({ x, y });
  }
  if (tornado) tornado.orbitRadPerS = rate / 3600;
  return { x, y };
}
function motionDirection(v = {}) { return (Math.atan2(v.east ?? 0, v.north ?? 0) * 180 / Math.PI + 360) % 360; }
// Wind above 65 mph = scale x (-ln(1 - quantile))^tail, the scale rising with the storm's
// low-level rotation (0-1.2). This is the wind the tornado really has; its rating is a
// separate thing (see DAMAGE_RATING).
// rotationScaleMph 52 to 40 on 2026-10-15 with the tornado rate doubled, to keep strong ones about as common.
// 2026-10-17: 26/40 to 80/90 with the damage rating below made harsher: the ratings were three
// quarters EF0 and none EF4 (the US record is about EF0 38%, EF1 37%, EF2 17%, EF3 6%, EF4 1.5%),
// and mobile radar finds tornado winds well above their damage ratings (Wurman et al. 2021: about
// 1-1.5 categories; Kosiba and Wurman 2023: strongest near the ground). On 160 days: ratings EF0
// 42%, EF1 34%, EF2 16%, EF3 7%, EF4 1.5%; peak winds EF0 24%, EF1 27%, EF2 22%, EF3 18%, EF4 7%,
// EF5 2%, about a category above.
// Then 70/70 with the moister warm sectors of the outer model's gentler moisture gradient (they made
// the storms rotate harder): ratings on 160 days EF0 43%, EF1 31%, EF2 15%, EF3 8%, EF4 3%; winds
// EF4 and more 11%.
// 2026-10-20 (final tuning): 70/70 to 40/30. Storms now rotate harder (afternoon helicity, longer-
// lived supercells) and the ratings had drifted to EF2+ 44%, EF3+ 21%; with 40/30, EF0-4 48/34/13/4.5/0.4%
// (EF2+ 18%, the agreed aim about 15%) on 8 seeds x 5 days. Peak winds sit about half a category
// above the ratings (EF4 winds 4%), below what mobile radar suggests.
// 2026-10-20 (second pass): 40/30 to 20/35 plus stpScaleMph 40 (the storm's inflow STP, full at
// stpFull). The low-level rotation saturates in tornadic air (its helicity ramp tops at 250 where
// tornadic storms form in about 345), so rotation alone could not tell a strong tornado's storm
// from a weak one's: nine EF0s came in STP 4-5.5 while an EF4 came in 2.1. Strong tornadoes come
// with high STP in the real record (Thompson et al. 2012). With the damage survey below made
// harsher: ratings EF0-4 52/30/12/4.5/1.4% (EF2+ 18%), peak winds about a category above (EF4 9%),
// median STP at touchdown from 3.7 (EF0) to 9.8 (EF4), on 8 seeds x 5 days.
// (2026-10-21: scales 20/35/40 to 19/33.25/38 and tail 0.9 to 0.85 with the stronger rotation near the
// ground of the same day: EF4+ winds had reached 8.9% of tornadoes and the EF4+ intensity group 18%
// of days.)
// (2026-10-23: base 19, rotation 33.25, tail 0.85, STP 38 to 10, 60, 0.6, 55. With the long tail and
// small scales a tornado's strength was mostly its draw (rank correlation of the draw with peak
// wind 0.81): two EF4s came from draws of 0.92 and 0.98 under STP 2 at midday while STP 6-7 in
// the evening gave EF0-1. Now strength follows the low-level rotation and the environment more,
// and the draw less (0.65).)
// (2026-10-23, later: the environment's part rises faster than the STP itself, stpScaleMph 45 to 70 as
// (STP / stpFull)^stpPower: little in marginal air, much more in an outbreak's. On an outbreak day with
// STP 4-5 most tornadoes peaked at 75-95 mph and only the two in the strongest-rotating storms were
// strong; real days like it have a quarter or more of their tornadoes rated EF2 or stronger.)
// (rotationScaleMph 50 to 80 on 2026-10-25: fitted when the afternoon air was too unstable, the scale gave weaker
// tornadoes once CAPE came down to real values. Supercells' tornadoes form in STP about 1.5 (EF0-1) and 2.5 (EF2+), as
// in the record (Thompson et al. 2012), but only 9.7% reached EF3 winds and 1.2% were rated EF3+. With 80: rated
// 57 / 33 / 8.0 / 1.0 / 0.7%, US 52 / 35 / 9 / 2.4 / 0.45; EF4 winds in 5.9% of supercells' tornadoes, tornadoes per day unchanged.)
// (2026-10-26: baseScaleMph 10 to 20, stpScaleMph 70 to 45, rotationScaleMph 80 to 65, tail 0.6 to 0.8. Ratings had followed
// STP too steeply: supercell tornadoes EF2+ 3% under STP 1, 12% at 1-3, 38% at 3-6 (EF3+ 19%), where the record, scaled from
// Thompson et al. 2012's strongest-per-hour sample (19% EF2+ overall) to all tornadoes (12%), runs about 7-9 / 12-14 / 18-21%,
// and EF0 was 62%. Now 4 / 11 / 33% and 55.9 / 34.7 / 6.3 / 2.3 / 0.6% overall (US 52 / 35 / 9 / 2.4 / 0.45). Rotation, not
// the environment, sets most of a rating (Smith et al. 2015); weak setups' short, narrow paths keep their ratings low.)
// (Later on 2026-10-26, after the low-level jet fix: baseScaleMph 20 to 22, stpScaleMph 45 to 25, tail 0.8 to 0.7. With realistic
// helicity, tornado-time STP reached the record's range (90th percentile 3.6) and STP 3-6 gave 47% EF2+; now 35%, and EF0-4
// 53.6 / 32.8 / 9.6 / 3.1 / 0.6% against the US record's 52 / 35 / 9 / 2.4 / 0.45.)
const INTENSITY = { baseScaleMph: 22, rotationScaleMph: 65, tail: 0.7, stpScaleMph: 25, stpPower: 1.5, stpFull: 6, matureMinutes: 6, occlusionLoss: 0.6, spinUpPerHour: 6 };
// An EF rating is assigned from the damage a tornado leaves, not from its wind. Most of a
// tornado's path crosses nothing that can show its full strength, so the rating usually falls
// short of the wind, more so for a short track. The rated wind is the wind above 65 mph times
// a share that rises with the length of the path (more things hit) and with this tornado's
// own luck in what it crossed: unexposedShare for a touch-down in open country, up to all of
// it for a long track through something sturdy.
// (2026-10-17: 0.5, 14 km, 0.6 to 0.4, 20 km, 0.35 with the wider winds above: a violent rating
// needs a long track and luck in what it crosses.)
// How long a tornado's own vortex lasts. Strong tornadoes live in steady, intense low-level
// mesocyclones and last long; weak ones are brief vortices (US record: path length, and so
// duration, rises steeply with rating; Brooks 2004). Each has a life drawn at touchdown from an
// exponential spread whose mean rises with the wind it could reach (its ceiling then), from
// meanMinutes[0] for a tornado that can barely reach 65 mph to meanMinutes[1] at ceilingMph, as
// (way up)^power. The storm can end it sooner (its rotation or the occlusion, above). (2026-10-20:
// until then only the storm ended a tornado, and once winds were scaled down, EF0s lasted 45-120 min.)
// With it, median durations by rating EF0-4 of 5/15/40/60/45 minutes (8 seeds x 5 days), and the
// tornado rate fullRatePerHour 4.2 to 0.75 (with the mesocyclone helicity of StormRotation.js the same day): a storm whose vortex is spent can put down another.
// A spent vortex goes with the low-level mesocyclone that fed it (the outflow that ends it wraps
// round it): the storm keeps rotationLeft of its low-level rotation and builds it again at its
// usual pace, so the next tornado is a new cycle some 10-30 minutes on. (Without it a strongly
// rotating storm put one down every few minutes: 158 tornadoes on one day.)
const LIFE = { meanMinutes: [3, 60], ceilingMph: 200, power: 1.5, rotationLeft: 0.2 };
// Tornadoes whose storm does not occlude (2026-10-21, the user's request): the odds (share at most,
// from a wind ceiling of 136 mph, full by 200, and 0-1 km helicity of 250, full by 450), the rate
// the storm then occludes at, how much longer it lives, and the minutes at its end in which the
// outflow wraps round after all. (Long-track tornadoes come with much stronger low-level shear and
// winds, Gensini/Kanak et al. 2024; supercells range from steady to occluding cyclic, Droegemeier
// et al.; a long-track violent tornado ends as a rainy downdraught encircles it, Orf et al. 2017.)
const STEADY = { share: 0.35, ceilingMph: [136, 200], srh: [250, 450], occlusionShare: 0.1, lifeFactor: 2.5, endMinutes: 10 };
// The rating a survey would give (2026-10-21, the user's choice of a physical rule; it was a share
// of the wind above 65 mph that rose with path length, which no setting could fit to the record:
// EF1s came out EF0 while EF3+ stayed too common). A tornado is rated EFk where its EFk contour
// covered something able to show EFk damage. The contour's width is the share of its path's
// width where its wind reached the EFk threshold (the wind falling off outside its core as the
// distance to the power decay, as damageSurvey.js draws it: 63% of the width for EF1 down to 15%
// for EF5), along peakShare of its path (where it was near its peak); things able to show each
// rating stand densityPerSqMi apart (poles, trees and outbuildings show EF1; only well-built
// houses EF4-5). The chance its contour held one is 1 - exp(-density x area), read against the
// tornado's own draw. Fitted on 362 tornadoes (seeds 1-6 x 10 days), first to the US record of
// 2008-2022 (EF0 52%, EF1 35%, EF2 9%, EF3 2.4%, EF4 0.45%), then at the user's wish to more
// EF1s and EF4s (aim 45 / 38 / 11 / 4 / 1.5 / 0.15): fitted 46 / 38 / 11 / 3.9 / 1.1 / 0.3.
// (EF1 indicators 9.6 to 22 per sq mi on 2026-10-21, with the weaker tornadoes the rate's power 1.5
// adds: 80 days rated 63/26/8.1/2.4/0.2/0.2, now 53/37/8.1/2.4/0.2/0.2, US 2008-22 52/35/9/2.4/0.45/0.05.
// Trees, poles and outbuildings show EF1 damage almost everywhere in farm country.)
// (EF4 indicators 0.13 to 0.6 per sq mi on 2026-10-24, about one well-built, well-anchored house per
// 1.7 sq mi: none of 442 tornadoes on 40 days was rated EF4, though 21 had EF4+ winds; refitted on
// them offline, the top ratings came out EF3 2.5%, EF4 0.7%, EF5 0, the US record 2.4 / 0.45 / 0.05.)
// (EF3 and EF4 indicators 0.72 and 0.6 to 0.4 and 0.13 per sq mi on 2026-10-25, once tornadoes are as wide as the record's
// (width above): with the two nearly equal a path that showed EF3 almost always showed EF4 too, EF3 2.3% and EF4 1.9%
// expected over 286 tornadoes; now 58.4 / 29.8 / 9.0 / 2.25 / 0.50 / 0.06, US 52 / 35 / 9 / 2.4 / 0.45 / 0.05.)
const DAMAGE_RATING = { densityPerSqMi: [22, 1.9, 0.4, 0.13, 0.08], peakShare: 0.4, decay: 0.6 };
const EF_FLOOR_MPH = [65, 86, 111, 136, 166, 201, 260];
// The rated wind: the peak wind where the damage could show it all, otherwise the middle of the
// highest category it showed.
export function damageRatingWind(peakMph, widthYards, pathKm, draw) {
  const windEf = EF_FLOOR_MPH.findLastIndex(m => peakMph >= m);
  if (windEf < 0) return peakMph;
  const along = Math.max(0, pathKm) * 0.621371 * DAMAGE_RATING.peakShare, width = Math.max(0, widthYards) / 1760;
  let shown = 0;
  for (let k = 1; k <= windEf; k++) {
    const area = along * width * Math.pow(65 / EF_FLOOR_MPH[k], 1 / DAMAGE_RATING.decay);
    if (draw < 1 - Math.exp(-DAMAGE_RATING.densityPerSqMi[k - 1] * area)) shown = k; else break;
  }
  return shown === windEf ? peakMph : (EF_FLOOR_MPH[shown] + EF_FLOOR_MPH[shown + 1]) / 2;
}

function efRating(mph) { return mph >= 200 ? 'EF5' : mph >= 166 ? 'EF4' : mph >= 136 ? 'EF3' : mph >= 111 ? 'EF2' : mph >= 86 ? 'EF1' : mph >= 65 ? 'EF0' : null; }
function deterministicUnit(text) {
  let h=2166136261;
  for(let i=0;i<text.length;i++) h=Math.imul(h^text.charCodeAt(i),16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h>>>0)/4294967296;
}
