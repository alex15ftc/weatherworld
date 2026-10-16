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
// 2026-10-15: fullRatePerHour 2.5 to 5 once the environments came down to real values (0-1 km
// helicity median 158 to 114, STP 90th 4.9 to 2.6): tornado days 60% to 88%, about 6.7 a day.
const TORNADO = { onsetRotation: [0, 0.5], fullRatePerHour: 5, power: 2, sustainRotation: 0.055, outlookHours: 0.5, driftKph: 30 };
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
export const tornadoWindScaleMph = lowRotation => INTENSITY.baseScaleMph + INTENSITY.rotationScaleMph * clamp(lowRotation, 0, 1.2);
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
  const wall = tornadoPosition(storm);
  if (wasDown) {
    const carried = { x: tornado.positionKm.x + (storm.velocityKph?.east ?? 0) * dtHours, y: tornado.positionKm.y - (storm.velocityKph?.north ?? 0) * dtHours };
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
  const scaleMph = tornadoWindScaleMph(storm.lowRotationFree ?? low);
  const ceilingMph = Math.min(235, 65 + scaleMph * Math.pow(-Math.log(1 - quantile), INTENSITY.tail));
  const targetWind = 65 + (ceilingMph - 65) * clamp(tornado.groundTimeMinutes / INTENSITY.matureMinutes, 0.25, 1) * (1 - INTENSITY.occlusionLoss * clamp(storm.occlusion ?? 0, 0, 1));
  tornado.windSpeedMph += (targetWind - tornado.windSpeedMph) * clamp(dtHours * 6, 0, 1);
  tornado.environmentWindCeilingMph = ceilingMph;
  // Stronger tornadoes are wider: about 50 yd at EF0, 150 at EF1, 250 at EF2, 450 at EF3 and
  // half a mile for the violent ones.
  const targetWidth = clamp(30 + 1.3 * Math.max(0, tornado.windSpeedMph - 65) ** 1.25, 25, 1600);
  tornado.widthYards += (targetWidth - tornado.widthYards) * clamp(dtHours * 8, 0, 1);
  tornado.peakWindSpeedMph = Math.max(tornado.peakWindSpeedMph, tornado.windSpeedMph);
  tornado.peakWidthYards = Math.max(tornado.peakWidthYards, tornado.widthYards);
  // What a damage survey would make of it so far (a rating never goes back down).
  const exposure = (1 - Math.exp(-tornado.pathLengthKm / DAMAGE_RATING.pathScaleKm)) * (DAMAGE_RATING.luckFloor + (1 - DAMAGE_RATING.luckFloor) * clamp(Number.isFinite(tornado.damageDraw) ? tornado.damageDraw : 0.5, 0, 1));
  const ratedNow = 65 + (tornado.peakWindSpeedMph - 65) * (DAMAGE_RATING.unexposedShare + (1 - DAMAGE_RATING.unexposedShare) * exposure);
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
  if (tornado.ageMinutes > dtMinutes + 1e-6 && (low < TORNADO.sustainRotation || rotating <= 0 || storm.active === false || leftBehind)) {
    // Why it ended, for the reports: the storm died or stopped rotating, its rotation moved off
    // (a merger), the outflow cut it off (the storm would still hold the rotation were it not
    // occluding), or the rotation faded.
    const endedBy = storm.active === false ? 'storm ended' : rotating <= 0 ? 'not rotating' : leftBehind ? 'left behind' : (storm.lowRotationFree ?? 0) >= TORNADO.sustainRotation ? 'occluded' : 'rotation faded';
    endTornado(world, storm, tornado, { endedBy, endOcclusion: storm.occlusion ?? 0, endLowRotationFree: storm.lowRotationFree ?? 0 });
  } else tornado.state = 'on-ground';
  return tornado;
}

// What cannot be resolved at this scale, drawn once per tornado: where it falls within the
// spread of winds its storm's rotation allows, and how much there was in its path to damage.
function drawTornadoCharacter(world, storm, tornado) {
  const seed = `${world.evolution?.config?.seed ?? 1}|${storm.id}|cycle${tornado.cycleCount}`;
  tornado.strengthUniform = deterministicUnit(seed + '|strength');
  tornado.damageDraw = deterministicUnit(seed + '|damage');
  tornado.ratedWindMph = 0;
}

function beginTornado(world, storm, tornado) {
  tornado.state = 'on-ground'; tornado.onGround = true; tornado.ageMinutes = 0;
  tornado.groundTimeMinutes = 0; tornado.pathLengthKm = 0; tornado.widthYards = 35;
  tornado.windSpeedMph = 75; tornado.startedHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  tornado.endedHourUtc = null; tornado.cycleCount += 1; tornado.trackPoints = []; tornado.positionKm = tornadoPosition(storm);
  tornado.lastGenesisHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
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
      trackPoints: (tornado.trackPoints ?? []).slice(-96), ...end
    });
    if (storm.tornadoHistory.length > 8) storm.tornadoHistory.shift();
  }
  tornado.state = 'ended'; tornado.onGround = false; tornado.endedHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  tornado.windSpeedMph = 0; tornado.widthYards = 0; tornado.startedHourUtc = null;
}

// Under the storm's wall cloud (StormGeometry.js); at the storm's centre until its shape is first worked out.
function tornadoPosition(storm) {
  const wall = storm.geometry?.wallCloud;
  return wall ? { x: wall.xKm, y: wall.yKm } : { ...storm.positionKm };
}
function motionDirection(v = {}) { return (Math.atan2(v.east ?? 0, v.north ?? 0) * 180 / Math.PI + 360) % 360; }
// Wind above 65 mph = scale x (-ln(1 - quantile))^tail, the scale rising with the storm's
// low-level rotation (0-1.2). This is the wind the tornado really has; its rating is a
// separate thing (see DAMAGE_RATING).
// rotationScaleMph 52 to 40 on 2026-10-15 with the tornado rate doubled, to keep strong ones about as common.
const INTENSITY = { baseScaleMph: 26, rotationScaleMph: 40, tail: 0.9, matureMinutes: 6, occlusionLoss: 0.6 };
// An EF rating is assigned from the damage a tornado leaves, not from its wind. Most of a
// tornado's path crosses nothing that can show its full strength, so the rating usually falls
// short of the wind, more so for a short track. The rated wind is the wind above 65 mph times
// a share that rises with the length of the path (more things hit) and with this tornado's
// own luck in what it crossed: unexposedShare for a touch-down in open country, up to all of
// it for a long track through something sturdy.
const DAMAGE_RATING = { unexposedShare: 0.5, pathScaleKm: 14, luckFloor: 0.6 };

function efRating(mph) { return mph >= 200 ? 'EF5' : mph >= 166 ? 'EF4' : mph >= 136 ? 'EF3' : mph >= 111 ? 'EF2' : mph >= 86 ? 'EF1' : mph >= 65 ? 'EF0' : null; }
function deterministicUnit(text) {
  let h=2166136261;
  for(let i=0;i<text.length;i++) h=Math.imul(h^text.charCodeAt(i),16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h>>>0)/4294967296;
}
