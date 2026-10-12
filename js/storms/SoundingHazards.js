// What a storm would do in the air at one place: the hazard outlook shown with a sounding.
// Nothing here is a separate rule of thumb. A lone storm is started in that air and run
// through the storm engine's own budgets, rotation, hail, gust and tornado functions for a
// few hours; the outlook is what it produced. Whether a storm can start there at all is the
// initiation engine's own diagnosis. So the outlook says what the simulation would do.
import { clamp } from '../scenarios/math.js';
import { sampleStormEnvironment, diagnoseStormMotion } from './environmentSampling.js';
import { diagnoseInitiation, FULL_INITIATION_RATE_PER_HOUR } from './InitiationEngine.js';
import { diagnoseStormRealizationPhysics } from './StormRealizationPhysics.js';
import { startStormBudgets, stepStormBudgets, stormIsOver } from './StormBudgets.js';
import { hailSizeInches, gustMph, stormFuel } from './StormHazards.js';
import { stepStormRotation } from './StormRotation.js';
import { describeStormMode, rotatingShare, lineShare, lineOrganizationTarget } from './StormModeEngine.js';
import { updateCoupledStormMotion, updateStormColdPool } from './StormEnvironmentCoupling.js';
import { tornadoIngredients, tornadoImminence, tornadoRatePerHour, tornadoWindScaleMph, tornadoShareReaching } from './TornadoEngine.js';

const STEP_HOURS = 1 / 12, RUN_HOURS = 4, KPH_PER_KT = 1.852, MPH_PER_KPH = 0.621371;
// A storm that never reaches this updraught (m/s), or dies sooner than this (h), did not last.
const LASTING = { updraughtMs: 15, hours: 0.75 };

export function diagnoseSoundingHazards(world, x, y) {
  const cell = world.getCell(x, y);
  if (!cell?.derived?.sounding) return null;
  // The air at this spot, as a storm would sample it, with no other storms around it.
  const environment = { ...sampleStormEnvironment(world, (x + 0.5) * world.cellSizeKm, (y + 0.5) * world.cellSizeKm), stormCoverage: 0, processedAir: 0 };
  const start = diagnoseInitiation(cell);
  const run = runLoneStorm(world, environment);
  const motion = character => { const v = diagnoseStormMotion(environment, character); return { u: v.east / KPH_PER_KT, v: v.north / KPH_PER_KT }; };
  const outlook = {
    initiation: start ? {
      canStart: start.canStart, elevated: start.elevated, liftJkg: start.elevated ? start.elevatedLift : start.surfaceLift, capJkg: start.elevated ? start.muCin : start.mlCin,
      // How readily storms start here, as a share of the fastest rate anywhere (0-1).
      readiness: start.ratePerHour / FULL_INITIATION_RATE_PER_HOUR
    } : null,
    storm: run.storm, hail: run.hail, wind: run.wind, tornado: run.tornado,
    // Storm motion as the storm engine computes it (kt, toward): rotating, left-moving, ordinary.
    motion: { right: motion({ rotating: 1 }), left: motion({ rotating: 1, leftMover: true }), ordinary: motion({ rotating: 0 }) }
  };
  outlook.limits = limitingFactors(environment, run);
  outlook.headline = headline(outlook);
  return outlook;
}

// One storm, alone, in unchanging air: the storm engine's own step, in its own order.
export function runLoneStorm(world, environment) {
  const first = diagnoseStormMotion(environment, { rotating: 0, linear: 0 });
  const storm = {
    ageHours: 0, inflowQuality: 1, mesocycloneStrength: 0, lineOrganization: 0, leftMover: false,
    velocityKph: { east: first.east, north: first.north }, coldPoolPropagation: { east: 0, north: 0 }
  };
  startStormBudgets(storm);
  const fuel = stormFuel(environment), ingredients = tornadoIngredients(environment);
  let peak = { updraughtMs: 0, rotating: 0, lowRotation: 0, hail: 0, gust: 0, mode: 'developing convection', separation: 0, undercut: 0 };
  let noTornado = 1, lifetime = null;
  for (let hour = 0; hour < RUN_HOURS - 1e-9; hour += STEP_HOURS) {
    updateCoupledStormMotion(world, storm, environment, STEP_HOURS);
    storm.ageHours += STEP_HOURS;
    storm.elevatedFeed = fuel.elevatedFeed;
    const physics = diagnoseStormRealizationPhysics(fuel.feedEnvironment, storm);
    const budget = stepStormBudgets(storm, environment, physics, STEP_HOURS, { starving: fuel.starving });
    storm.lineOrganization = lineShare(storm) + (lineOrganizationTarget(storm, environment) - lineShare(storm)) * clamp(STEP_HOURS, 0, 1);
    updateStormColdPool(world, storm, environment, STEP_HOURS);
    stepStormRotation(storm, environment, STEP_HOURS);
    const speedKph = Math.hypot(storm.velocityKph.east, storm.velocityKph.north);
    // A tornado comes from the storm's rotation near the ground; none is put down here, so the
    // storm never occludes and this is the chance of its first one.
    noTornado *= Math.exp(-tornadoRatePerHour(tornadoImminence(storm)) * STEP_HOURS);
    peak.lowRotation = Math.max(peak.lowRotation, storm.lowRotationFree ?? 0);
    if (storm.updraughtMs > peak.updraughtMs) peak = { ...peak, updraughtMs: storm.updraughtMs, mode: describeStormMode(storm, environment), separation: budget.separation, undercut: budget.undercut };
    peak.rotating = Math.max(peak.rotating, rotatingShare(storm));
    peak.hail = Math.max(peak.hail, hailSizeInches(storm, environment));
    peak.gust = Math.max(peak.gust, gustMph(storm, environment, speedKph));
    if (stormIsOver(storm)) { lifetime = storm.ageHours; break; }
  }
  const lasting = peak.updraughtMs >= LASTING.updraughtMs && (lifetime === null || lifetime >= LASTING.hours);
  const speedKph = Math.hypot(storm.velocityKph.east, storm.velocityKph.north);
  return {
    environment, ingredients, separation: peak.separation, undercut: peak.undercut, starving: fuel.starving,
    storm: {
      lasting, type: lasting ? peak.mode : 'no lasting storm', elevated: fuel.elevatedFeed, rotating: peak.rotating,
      peakUpdraughtMs: peak.updraughtMs, lifetimeHours: lifetime, runHours: RUN_HOURS,
      speedMph: speedKph * MPH_PER_KPH, towardDeg: (Math.atan2(storm.velocityKph.east, storm.velocityKph.north) * 180 / Math.PI + 360) % 360
    },
    hail: { maxInches: lasting ? peak.hail : 0 },
    wind: { maxGustMph: lasting ? peak.gust : 0 },
    tornado: {
      chance: lasting ? 1 - noTornado : 0, ingredients, lowRotation: peak.lowRotation,
      // Of the tornadoes such a storm produces, the share with EF2+ and with EF4+ winds.
      strongShare: tornadoShareReaching(tornadoWindScaleMph(peak.lowRotation), 111),
      violentShare: tornadoShareReaching(tornadoWindScaleMph(peak.lowRotation), 166)
    }
  };
}

// The same terms the tornado rate and the budgets are built from, weakest first, in plain words.
function limitingFactors(environment, run) {
  const cin = Math.abs(environment.cin ?? 0), found = [];
  const add = (score, text) => { if (score < 1) found.push({ score, text }); };
  const cappedOff = run.starving && cin > 150;
  if (run.starving) add(0, cappedOff ? 'a cap too strong for a storm to draw in air from the ground' : 'too little instability for a storm to feed on');
  add((environment.cape ?? 0) / 1500 / 0.7, 'limited instability');
  add((environment.srh ?? 0) / 150 / 0.7, 'little turning of the wind near the ground');
  add((environment.bulkShear ?? 0) / 40 / 0.75, 'weak wind shear through the storm\'s depth');
  add(clamp((2000 - (environment.lcl ?? 2000)) / 1000, 0, 1.5) / 0.6, 'high cloud bases');
  if (!cappedOff) add(clamp((150 - cin) / 125, 0, 1.2) / 0.5, 'a strong cap');
  add((1 - run.undercut) / 0.6, 'cold outflow undercutting the updraught');
  add(run.separation / 0.4, 'rain falling back into the updraught');
  return found.sort((a, b) => a.score - b.score).slice(0, 3).map(item => item.text);
}

function headline(outlook) {
  const { storm, hail, wind, tornado } = outlook;
  if (!storm.lasting) return 'No lasting storms';
  const hazards = [];
  if (tornado.chance >= 0.3) hazards.push(tornado.strongShare >= 0.3 ? 'tornadoes likely, some strong' : 'tornadoes likely');
  else if (tornado.chance >= 0.12) hazards.push('a tornado possible');
  if (hail.maxInches >= 2.75) hazards.push('giant hail'); else if (hail.maxInches >= 2) hazards.push('very large hail'); else if (hail.maxInches >= 1) hazards.push('large hail');
  if (wind.maxGustMph >= 75) hazards.push('destructive wind'); else if (wind.maxGustMph >= 58) hazards.push('damaging wind');
  const type = storm.type.charAt(0).toUpperCase() + storm.type.slice(1);
  return hazards.length ? `${type}: ${hazards.join(', ')}` : `${type}, below severe limits`;
}
