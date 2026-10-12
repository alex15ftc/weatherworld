import { rotatingShare, lineShare, outflowDominance } from './StormModeEngine.js';
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

// A tornado cannot emerge from fields on a 10-mile grid, so this is a statistical model of
// one, conditioned continuously on the storm and its inflow. There are no gates, vetoes or
// cooldowns: every input moves the odds smoothly.
//   - Whether one forms: a rate that rises with the storm's rotation and with the ingredients
//     of its inflow (instability, low-level helicity, deep shear, cloud base, inhibition,
//     combined as the significant tornado parameter), and falls where the storm is part of a
//     line or its outflow undercuts the updraught. Over CHANCE_WINDOW_HOURS of a mature,
//     fully rotating storm the chance is 65% x (1 - e^(-STP/4)): about 14% at STP 1, 26% at
//     2, 41% at 4.
//   - How long it lasts and how strong it gets: drawn once per tornado (nothing at this scale
//     decides them), from distributions whose scale rises with the same ingredients.
const CHANCE_WINDOW_HOURS = 2.5, FULL_CHANCE = 0.65, STP_SCALE = 4;
// A storm is mature enough to produce one from about half an hour old and moderate strength.
const MATURE_AGE_HOURS = [0.3, 0.9], MATURE_INTENSITY = [0.25, 0.5];
const ramp = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);

export function updateTornadoState(world, storm, environment, dtHours) {
  const tornado = storm.tornado ?? initializeTornadoState(storm);
  const dtMinutes = dtHours * 60;
  const rotating = rotatingShare(storm), inLine = lineShare(storm), undercut = outflowDominance(storm, environment);
  const mesocyclone = clamp(storm.mesocycloneStrength ?? 0, 0, 1.2);
  // The significant tornado parameter of the storm's inflow, from its ingredients.
  const ingredients = clamp(
    (environment.cape ?? 0) / 1500 * ((environment.srh ?? 0) / 150) * ((environment.bulkShear ?? 0) / 40) *
    clamp((2000 - (environment.lcl ?? 2000)) / 1000, 0, 1.5) * clamp((150 - Math.abs(environment.cin ?? 50)) / 125, 0, 1.2),
    0, 18
  );
  const mature = ramp(storm.ageHours, MATURE_AGE_HOURS[0], MATURE_AGE_HOURS[1]) * ramp(storm.intensity, MATURE_INTENSITY[0], MATURE_INTENSITY[1]);
  const chance = FULL_CHANCE * (1 - Math.exp(-ingredients / STP_SCALE)) * rotating * (1 - 0.4 * inLine) * (1 - 0.6 * undercut) * mature;
  const ratePerHour = -Math.log(1 - clamp(chance, 0, 0.95)) / CHANCE_WINDOW_HOURS;
  tornado.genesisPotential = chance;
  tornado.probability = chance;
  tornado.rawStp = ingredients;

  if (!tornado.onGround) {
    const tick = Math.round(((world.stormEngine?.validHourUtc ?? world.validHourUtc ?? 0) + storm.ageHours) * 12);
    const draw = deterministicUnit(`${world.evolution?.config?.seed ?? 1}|${storm.id}|tor|${tick}`);
    if (draw < 1 - Math.exp(-ratePerHour * dtHours)) {
      beginTornado(world, storm, tornado);
      drawTornadoCharacter(world, storm, tornado, ingredients, rotating);
    } else tornado.state = tornado.state === 'ended' ? 'ended' : 'none';
  }

  tornado.previousPositionKm = { ...tornado.positionKm };
  tornado.positionKm = tornadoPosition(storm);
  tornado.forwardSpeedMph = Math.hypot(storm.velocityKph?.east ?? 0, storm.velocityKph?.north ?? 0) * MPH_PER_KPH;
  tornado.motionDirectionDeg = motionDirection(storm.velocityKph);
  if (!tornado.onGround) return tornado;

  tornado.ageMinutes += dtMinutes;
  tornado.groundTimeMinutes += dtMinutes;
  tornado.pathLengthKm += Math.hypot(tornado.positionKm.x - tornado.previousPositionKm.x, tornado.positionKm.y - tornado.previousPositionKm.y);
  tornado.trackPoints ??= [];
  tornado.trackPoints.push({ x: tornado.positionKm.x, y: tornado.positionKm.y, hourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc });
  if (tornado.trackPoints.length > 96) tornado.trackPoints.shift();

  // Peak wind: this tornado's draw is its quantile in a distribution whose scale the
  // ingredients set and the mesocyclone modulates. It needs time on the ground to reach it.
  const quantile = clamp(Number.isFinite(tornado.strengthUniform) ? tornado.strengthUniform : 0.5, 0, 0.999);
  const scaleMph = (INTENSITY.baseScaleMph + INTENSITY.stpScaleMph * (1 - Math.exp(-ingredients / STP_SCALE))) * (0.85 + 0.3 * clamp(mesocyclone / 0.5, 0, 1));
  const ceilingMph = Math.min(235, 65 + scaleMph * Math.pow(-Math.log(1 - quantile), INTENSITY.tail));
  const targetWind = 65 + (ceilingMph - 65) * clamp(tornado.groundTimeMinutes / INTENSITY.matureMinutes, 0.25, 1);
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

  // It ends when its own time is up, or when the storm stops rotating or falls apart. It stays
  // down through the step it formed in, so everything that looks at storms between steps sees
  // it; one shorter than a step is cut back to its own time and path when it ends.
  const lifetime = Number.isFinite(tornado.lifetimeMinutes) ? tornado.lifetimeMinutes : 10;
  if (tornado.ageMinutes > dtMinutes + 1e-6 && (tornado.groundTimeMinutes >= lifetime || rotating <= 0 || storm.active === false)) {
    if (tornado.groundTimeMinutes > lifetime) { tornado.pathLengthKm *= lifetime / tornado.groundTimeMinutes; tornado.groundTimeMinutes = lifetime; }
    endTornado(world, storm, tornado);
  } else tornado.state = 'on-ground';
  return tornado;
}

// Lifetime and strength quantile, drawn once per tornado. Half of all tornadoes last under
// five minutes and one in ten over twenty; a rotating storm among strong ingredients can
// keep one down for an hour.
function drawTornadoCharacter(world, storm, tornado, ingredients, rotating) {
  const seed = `${world.evolution?.config?.seed ?? 1}|${storm.id}|cycle${tornado.cycleCount}`;
  const lifeDraw = deterministicUnit(seed + '|life'), support = 1 - Math.exp(-ingredients / STP_SCALE);
  const lifetime = 1.5 + 7 * Math.pow(lifeDraw, 1.5) + rotating * 60 * Math.pow(lifeDraw, 7) * (0.25 + 0.75 * support);
  tornado.lifetimeMinutes = Math.round(clamp(lifetime, 1.5, 10 + 60 * rotating) * 10) / 10;
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

function endTornado(world, storm, tornado) {
  if (tornado.onGround || tornado.startedHourUtc != null) {
    storm.tornadoHistory ??= [];
    storm.tornadoHistory.push({
      cycle: tornado.cycleCount, startedHourUtc: tornado.startedHourUtc,
      endedHourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc,
      pathLengthKm: tornado.pathLengthKm, groundTimeMinutes: tornado.groundTimeMinutes,
      peakWindSpeedMph: tornado.peakWindSpeedMph, peakWidthYards: tornado.peakWidthYards,
      // estimatedEf is the damage rating; windEf is what its peak wind would be rated on wind alone.
      ratedWindMph: tornado.ratedWindMph ?? tornado.peakWindSpeedMph, estimatedEf: efRating(tornado.ratedWindMph ?? tornado.peakWindSpeedMph), windEf: efRating(tornado.peakWindSpeedMph),
      trackPoints: (tornado.trackPoints ?? []).slice(-96)
    });
    if (storm.tornadoHistory.length > 8) storm.tornadoHistory.shift();
  }
  tornado.state = 'ended'; tornado.onGround = false; tornado.endedHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  tornado.windSpeedMph = 0; tornado.widthYards = 0; tornado.startedHourUtc = null;
}

function tornadoPosition(storm) {
  const angle = (storm.orientationDeg ?? 0) * Math.PI / 180;
  const offset = storm.leftMover ? 5 : -5;
  return { x: storm.positionKm.x + Math.cos(angle) * offset, y: storm.positionKm.y + Math.sin(angle) * offset };
}
function motionDirection(v = {}) { return (Math.atan2(v.east ?? 0, v.north ?? 0) * 180 / Math.PI + 360) % 360; }
// Peak wind above 65 mph follows a stretched exponential whose scale grows with STP: roughly
// one tornado in eight reaches EF2 in a marginal environment, nearly half in an extreme one.
// Peak wind = 65 mph + scale x (-ln(1 - quantile))^tail, the scale rising with the ingredients.
// This is the wind the tornado really has. Its rating is a separate thing (see DAMAGE_RATING):
// with a scale near 31 mph about a quarter of tornadoes have EF2 winds or stronger, while the
// ratings come out as observed (about 64% EF0, 26% EF1, 8% EF2, 2% EF3, under 1% EF4+).
const INTENSITY = { baseScaleMph: 24, stpScaleMph: 19, tail: 1.0, matureMinutes: 6 };
// An EF rating is assigned from the damage a tornado leaves, not from its wind. Most of a
// tornado's path crosses nothing that can show its full strength, so the rating usually falls
// short of the wind, more so for a short track. The rated wind is the wind above 65 mph times
// a share that rises with the length of the path (more things hit) and with this tornado's
// own luck in what it crossed: unexposedShare for a touch-down in open country, up to all of
// it for a long track through something sturdy.
const DAMAGE_RATING = { unexposedShare: 0.5, pathScaleKm: 6, luckFloor: 0.6 };

function efRating(mph) { return mph >= 200 ? 'EF5' : mph >= 166 ? 'EF4' : mph >= 136 ? 'EF3' : mph >= 111 ? 'EF2' : mph >= 86 ? 'EF1' : mph >= 65 ? 'EF0' : null; }
function deterministicUnit(text) {
  let h=2166136261;
  for(let i=0;i<text.length;i++) h=Math.imul(h^text.charCodeAt(i),16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h>>>0)/4294967296;
}
