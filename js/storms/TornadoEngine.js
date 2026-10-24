import { rotatingShare } from './StormModeEngine.js';
import { clamp } from '../scenarios/math.js';

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
const TORNADO = { onsetRotation: [0, 0.5], fullRatePerHour: 0.22, power: 1, sustainRotation: 0.055, outlookHours: 0.5, driftKph: 30 };
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
export const tornadoRatePerHour = imminence => TORNADO.fullRatePerHour * Math.pow(imminence, TORNADO.power);
// Scale (mph above 65) of the wind spread for a tornado under this low-level rotation, and the
// share of tornadoes from that spread whose wind reaches a given speed.
export const tornadoWindScaleMph = (lowRotation, stp = 0) => INTENSITY.baseScaleMph + INTENSITY.rotationScaleMph * clamp(lowRotation, 0, 1.2) + INTENSITY.stpScaleMph * clamp(stp / INTENSITY.stpFull, 0, 1.2) ** INTENSITY.stpPower;
export const tornadoShareReaching = (scaleMph, mph) => Math.exp(-Math.pow(Math.max(0, mph - 65) / scaleMph, 1 / INTENSITY.tail));

export function updateTornadoState(world, storm, environment, dtHours) {
  const tornado = storm.tornado ?? initializeTornadoState(storm);
  const dtMinutes = dtHours * 60;
  const rotating = rotatingShare(storm), low = clamp(storm.lowRotation ?? 0, 0, 1.2);
  const ingredients = tornadoIngredients(environment);
  const imminence = tornadoImminence(storm);
  const ratePerHour = tornadoRatePerHour(imminence);
  // The chance of one in the next half hour, for the pages; imminence is the cue itself.
  const chance = 1 - Math.exp(-ratePerHour * TORNADO.outlookHours);
  tornado.genesisPotential = imminence;
  tornado.probability = chance;
  tornado.rawStp = ingredients;

  const wasDown = tornado.onGround;
  if (!tornado.onGround) {
    const tick = Math.round(((world.stormEngine?.validHourUtc ?? world.validHourUtc ?? 0) + storm.ageHours) * 12);
    const draw = deterministicUnit(`${world.evolution?.config?.seed ?? 1}|${storm.id}|tor|${tick}`);
    if (draw < 1 - Math.exp(-ratePerHour * dtHours)) {
      beginTornado(world, storm, tornado);
      drawTornadoCharacter(world, storm, tornado);
      // It is counted on the ground for the whole of this step, and the storm has already
      // moved through it, so it touched down where the wall cloud was at the step's start.
      tornado.positionKm = { x: tornado.positionKm.x - (storm.velocityKph?.east ?? 0) * dtHours, y: tornado.positionKm.y + (storm.velocityKph?.north ?? 0) * dtHours };
      tornado.trackPoints.push({ ...tornado.positionKm, hourUtc: (world.stormEngine?.validHourUtc ?? world.validHourUtc) - dtHours });
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
  // it from the wall cloud is kept (to capRadii updraught radii), and it is carried by it as
  // well as by the storm's motion, so it is no more "left behind" for it than before.
  const before = (wasDown && tornado.occlusionOffsetKm) || { x: 0, y: 0 };
  const offset = wasDown ? occlusionStep(storm, before, dtHours) : { x: 0, y: 0 };
  const held = tornadoPosition(storm), wall = { x: held.x + offset.x, y: held.y + offset.y };
  tornado.occlusionOffsetKm = offset;
  if (wasDown) {
    const carried = { x: tornado.positionKm.x + (storm.velocityKph?.east ?? 0) * dtHours + offset.x - before.x, y: tornado.positionKm.y - (storm.velocityKph?.north ?? 0) * dtHours + offset.y - before.y };
    const gap = Math.hypot(wall.x - carried.x, wall.y - carried.y), share = gap > 0 ? Math.min(1, TORNADO.driftKph * dtHours / gap) : 0;
    tornado.positionKm = { x: carried.x + (wall.x - carried.x) * share, y: carried.y + (wall.y - carried.y) * share };
  } else tornado.positionKm = wall;
  const reachKm = storm.geometry?.updraught?.radiusKm ?? Infinity;
  const leftBehind = Math.hypot(wall.x - tornado.positionKm.x, wall.y - tornado.positionKm.y) > reachKm;
  tornado.forwardSpeedMph = Math.hypot(storm.velocityKph?.east ?? 0, storm.velocityKph?.north ?? 0) * MPH_PER_KPH;
  tornado.motionDirectionDeg = motionDirection(storm.velocityKph);
  if (!tornado.onGround) return tornado;

  tornado.ageMinutes += dtMinutes;
  tornado.groundTimeMinutes += dtMinutes;
  tornado.pathLengthKm += Math.hypot(tornado.positionKm.x - tornado.previousPositionKm.x, tornado.positionKm.y - tornado.previousPositionKm.y);
  tornado.trackPoints ??= [];
  tornado.trackPoints.push({ x: tornado.positionKm.x, y: tornado.positionKm.y, hourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc });
  if (tornado.trackPoints.length > 96) tornado.trackPoints.shift();

  // Wind: this tornado's draw is its quantile in a spread whose scale the storm's underlying
  // low-level rotation sets; the wind builds over its first minutes and falls as it occludes.
  const quantile = clamp(Number.isFinite(tornado.strengthUniform) ? tornado.strengthUniform : 0.5, 0, 0.999);
  const scaleMph = tornadoWindScaleMph(storm.lowRotationFree ?? low, ingredients);
  const ceilingMph = Math.min(235, 65 + scaleMph * Math.pow(-Math.log(1 - quantile), INTENSITY.tail));
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
  tornado.windSpeedMph += (targetWind - tornado.windSpeedMph) * clamp(dtHours * 6, 0, 1);
  tornado.environmentWindCeilingMph = ceilingMph;
  // Stronger tornadoes are wider: about 50 yd at EF0, 150 at EF1, 250 at EF2, 450 at EF3 and
  // half a mile for the violent ones.
  const targetWidth = clamp(30 + 1.3 * Math.max(0, tornado.windSpeedMph - 65) ** 1.25, 25, 1600);
  tornado.widthYards += (targetWidth - tornado.widthYards) * clamp(dtHours * 8, 0, 1);
  tornado.peakWindSpeedMph = Math.max(tornado.peakWindSpeedMph, tornado.windSpeedMph);
  tornado.peakWidthYards = Math.max(tornado.peakWidthYards, tornado.widthYards);
  // What a damage survey would make of it so far (a rating never goes back down).
  const ratedNow = damageRatingWind(tornado.peakWindSpeedMph, tornado.peakWidthYards, tornado.pathLengthKm, Number.isFinite(tornado.damageDraw) ? tornado.damageDraw : 0.5);
  tornado.ratedWindMph = Math.max(tornado.ratedWindMph ?? 0, ratedNow);
  tornado.estimatedEf = efRating(tornado.ratedWindMph);
  tornado.windEf = efRating(tornado.peakWindSpeedMph);
  storm.hazardExtremes ??= { tornado: { maxWindMph: 0, maxEfRating: null, maxWidthYards: 0, maxPathLengthKm: 0, cycles: 0 }, wind: { maxSustainedMph: 0, maxGustMph: 0 }, hail: { maxSizeInches: 0 } };
  const extreme = storm.hazardExtremes.tornado;
  extreme.maxWindMph = Math.max(extreme.maxWindMph ?? 0, tornado.windSpeedMph);
  extreme.maxWidthYards = Math.max(extreme.maxWidthYards ?? 0, tornado.widthYards);
  extreme.maxPathLengthKm = Math.max(extreme.maxPathLengthKm ?? 0, tornado.pathLengthKm);
  extreme.maxRatedWindMph = Math.max(extreme.maxRatedWindMph ?? 0, tornado.ratedWindMph);
  extreme.maxEfRating = efRating(extreme.maxRatedWindMph);   // the damage rating, as reports and outlook verification use
  extreme.maxWindEf = efRating(extreme.maxWindMph);
  extreme.cycles = Math.max(extreme.cycles ?? 0, tornado.cycleCount ?? 0);

  // It ends when the storm no longer holds the low-level rotation for it, or falls apart. It
  // stays down through the step it formed in, so everything that looks at storms between
  // steps sees it.
  if (tornado.ageMinutes > dtMinutes + 1e-6 && (low < TORNADO.sustainRotation || rotating <= 0 || storm.active === false || leftBehind || (tornado.groundTimeMinutes >= tornado.lifeMinutes - 1e-6))) {
    // Why it ended, for the reports: the storm died or stopped rotating, its rotation moved off
    // (a merger), the outflow cut it off (the storm would still hold the rotation were it not
    // occluding), or the rotation faded.
    const endedBy = storm.active === false ? 'storm ended' : tornado.groundTimeMinutes >= tornado.lifeMinutes - 1e-6 && low >= TORNADO.sustainRotation && !leftBehind && rotating > 0 ? 'vortex spent' : rotating <= 0 ? 'not rotating' : leftBehind ? 'left behind' : (storm.lowRotationFree ?? 0) >= TORNADO.sustainRotation ? 'occluded' : 'rotation faded';
    const cut = endedBy === 'vortex spent' ? cutToLife(tornado) : null;
    endTornado(world, storm, tornado, { endedBy, endOcclusion: storm.occlusion ?? 0, endLowRotationFree: storm.lowRotationFree ?? 0, ...(cut ? { endedHourUtc: cut } : {}) });
    if (endedBy === 'vortex spent') storm.lowRotation = (storm.lowRotation ?? 0) * LIFE.rotationLeft;
  } else tornado.state = 'on-ground';
  return tornado;
}

// What cannot be resolved at this scale, drawn once per tornado: where it falls within the
// spread of winds its storm's rotation allows, and how much there was in its path to damage.
function drawTornadoCharacter(world, storm, tornado) {
  const seed = `${world.evolution?.config?.seed ?? 1}|${storm.id}|cycle${tornado.cycleCount}`;
  tornado.strengthUniform = deterministicUnit(seed + '|strength');
  tornado.damageDraw = deterministicUnit(seed + '|damage');
  tornado.lifeDraw = deterministicUnit(seed + '|life'); tornado.lifeMinutes = null;
  tornado.steadyDraw = deterministicUnit(seed + '|steady'); tornado.steady = false; tornado.occlusionShare = 1;
  tornado.ratedWindMph = 0;
}

function beginTornado(world, storm, tornado) {
  tornado.state = 'on-ground'; tornado.onGround = true; tornado.ageMinutes = 0;
  tornado.groundTimeMinutes = 0; tornado.pathLengthKm = 0; tornado.widthYards = 35;
  tornado.windSpeedMph = 75; tornado.startedHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  tornado.endedHourUtc = null; tornado.cycleCount += 1; tornado.trackPoints = []; tornado.occlusionOffsetKm = null; tornado.positionKm = tornadoPosition(storm);
  tornado.lastGenesisHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
}

// A tornado whose drawn life ran out between storm ticks ended then: its track is cut back to that
// moment (the end point between the last two ticks), and its path, time on the ground and rating are
// those of the cut track. Returns the hour it ended, or null when nothing was cut. (2026-10-24: it
// could end only at a tick after the one it formed in, so every short-lived tornado lasted exactly
// 10 minutes and ran 5-8 miles: 15 of 19 and 15 of 22 tornadoes on two reviewed days.)
function cutToLife(tornado) {
  const points = tornado.trackPoints ?? [], life = tornado.lifeMinutes;
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
      cycle: tornado.cycleCount, startedHourUtc: tornado.startedHourUtc,
      endedHourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc,
      pathLengthKm: tornado.pathLengthKm, groundTimeMinutes: tornado.groundTimeMinutes,
      peakWindSpeedMph: tornado.peakWindSpeedMph, peakWidthYards: tornado.peakWidthYards,
      // estimatedEf is the damage rating; windEf is what its peak wind would be rated on wind alone.
      ratedWindMph: tornado.ratedWindMph ?? tornado.peakWindSpeedMph, estimatedEf: efRating(tornado.ratedWindMph ?? tornado.peakWindSpeedMph), windEf: efRating(tornado.peakWindSpeedMph),
      trackPoints: (tornado.trackPoints ?? []).slice(-96), lifeMinutes: tornado.lifeMinutes ?? null, steady: Boolean(tornado.steady), damageDraw: tornado.damageDraw ?? null, ...end
    });
    if (storm.tornadoHistory.length > 8) storm.tornadoHistory.shift();
  }
  tornado.state = 'ended'; tornado.onGround = false; tornado.endedHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  tornado.windSpeedMph = 0; tornado.widthYards = 0; tornado.startedHourUtc = null; tornado.occlusionShare = 1;
}

// Under the storm's wall cloud (StormGeometry.js); at the storm's centre until its shape is first worked out.
function tornadoPosition(storm) {
  const wall = storm.geometry?.wallCloud;
  return wall ? { x: wall.xKm, y: wall.yKm } : { ...storm.positionKm };
}
const OCCLUSION_TRACK = { turnDeg: 60, slowShare: 0.5, capRadii: 1.8 };
// The occlusion's offset of the tornado from the wall cloud (km, east and south) after a step:
// the difference between the tornado's turned, slowed motion and the storm's, added up.
function occlusionStep(storm, before, dtHours) {
  const occlusion = clamp(storm.occlusion ?? 0, 0, 1), v = storm.velocityKph ?? {}, east = v.east ?? 0, north = v.north ?? 0;
  if (!(occlusion > 0) || !(Math.hypot(east, north) > 0.5)) return before;
  const turn = OCCLUSION_TRACK.turnDeg * occlusion * Math.PI / 180, keep = 1 - OCCLUSION_TRACK.slowShare * occlusion;
  // Turned left (counterclockwise seen from above), in east and north; the offset is east and south.
  const te = keep * (east * Math.cos(turn) - north * Math.sin(turn)), tn = keep * (east * Math.sin(turn) + north * Math.cos(turn));
  const next = { x: before.x + (te - east) * dtHours, y: before.y - (tn - north) * dtHours };
  const cap = OCCLUSION_TRACK.capRadii * (storm.geometry?.updraught?.radiusKm ?? 5), size = Math.hypot(next.x, next.y);
  return size > cap ? { x: next.x * cap / size, y: next.y * cap / size } : next;
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
const INTENSITY = { baseScaleMph: 10, rotationScaleMph: 50, tail: 0.6, stpScaleMph: 70, stpPower: 1.5, stpFull: 6, matureMinutes: 6, occlusionLoss: 0.6 };
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
const DAMAGE_RATING = { densityPerSqMi: [22, 1.9, 0.72, 0.6, 0.08], peakShare: 0.4, decay: 0.6 };
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
