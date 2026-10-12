// A storm is three linked budgets, each fed by the air it draws in:
//   - Updraught (m/s): heads for what its inflow can support.
//   - Rain (0-1): made by the updraught, falling out a while later.
//   - Cold pool (0-1): made by the rain evaporating into dry air below cloud.
// They act on each other. Rain weighs on the updraught where the shear does not carry it
// clear; the cold pool cuts the inflow off where it outruns the updraught. In weak shear a
// storm rains into itself and is undercut within an hour or two. In strong shear the rain and
// the outflow stay clear of the updraught and it lasts for hours; rotation helps it hold its
// inflow against its own outflow. Along a line the gust front
// lifts the next updraught, so a line stands a stronger cold pool than a lone storm does.
// Nothing here knows what kind of storm it is.
import { clamp } from '../scenarios/math.js';
import { lineShare, rotatingShare, outflowDominance, coldPoolBalance } from './StormModeEngine.js';

export const BUDGET = Object.freeze({
  initialUpdraughtMs: 6, fullUpdraughtMs: 50,
  // Below deadUpdraughtMs a storm past its first youngHours is over.
  deadUpdraughtMs: 4, youngHours: 0.4,
  growthHours: 0.35, decayHours: 0.3, falloutHours: 0.4,
  // 0-6 km shear (kt) from which the rain starts to fall clear of the updraught, to fully clear.
  separationShearKt: [15, 45],
  loadingShare: 0.45, undercutShare: 0.9,
  lineOrganization: 0.7, lineUndercutBalance: [1.8, 3],
  // Share of the undercutting a fully rotating updraught resists: its rotation draws air up
  // into it from below, so it holds its inflow against outflow that would cut off another storm.
  rotationLift: 0.6
});
// Cold pool strength as a share of the rain falling: every storm has some; more with the
// energy available to its downdraughts and where storms share one along a line.
export const COLD_POOL = Object.freeze({ base: 0.25, dryness: 0.45, strongDcape: 1200, line: 0.2, responsePerHour: 1 });

const ramp = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);

// Strength (0-1) and the older updraught scale are what the radar, the hazards and the maps read.
export function setUpdraught(storm, ms) {
  storm.updraughtMs = Math.max(0, Number(ms) || 0);
  storm.intensity = clamp(storm.updraughtMs / BUDGET.fullUpdraughtMs, 0, 1);
  storm.updraftStrength = clamp(storm.updraughtMs / 65, 0, 1);
}

export function startStormBudgets(storm) {
  setUpdraught(storm, BUDGET.initialUpdraughtMs);
  storm.precipitation = 0; storm.loading = 0; storm.updraughtTrend = 1;
  storm.organization = 0.1;
  storm.coldPoolStrength = 0;
}

// One step of the budgets. `physics` is the parcel diagnosis of the storm's inflow
// (StormRealizationPhysics); `starving` means the inflow has no usable instability left.
export function stepStormBudgets(storm, environment, physics, dtHours, { starving = false } = {}) {
  const linear = lineShare(storm);
  // Rain: the updraught makes it, and it falls out a while later.
  storm.precipitation += (storm.updraughtMs / BUDGET.fullUpdraughtMs - storm.precipitation) * clamp(dtHours / BUDGET.falloutHours, 0, 1);
  // Shear through the storm's depth carries the rain downwind of the updraught. Without it
  // the rain falls back through the updraught and weighs it down.
  const separation = ramp(environment.bulkShear, BUDGET.separationShearKt[0], BUDGET.separationShearKt[1]);
  storm.loading = storm.precipitation * (1 - separation);
  // Cold outflow that outruns the updraught cuts off its inflow; a rotating updraught resists
  // it. A line stands a stronger cold pool, but not one that far outruns the shear: then the
  // gust front leaves it behind too.
  const undercut = outflowDominance(storm, environment) * (1 - BUDGET.rotationLift * rotatingShare(storm)) * (1 - linear) + ramp(coldPoolBalance(storm, environment), BUDGET.lineUndercutBalance[0], BUDGET.lineUndercutBalance[1]) * linear;
  // What the inflow can support (parcel theory less entrainment and inhibition), less the
  // weight of the rain, the undercutting, and inflow spoiled by other storms.
  const potentialMs = starving ? 0 : physics.theoreticalUpdraftMs * physics.entrainmentEfficiency * physics.inhibitionEfficiency;
  const targetMs = potentialMs * (1 - BUDGET.loadingShare * storm.loading) * (1 - BUDGET.undercutShare * undercut) * clamp(storm.inflowQuality ?? 1, 0, 1);
  storm.updraughtTrend = (targetMs - storm.updraughtMs) / Math.max(BUDGET.deadUpdraughtMs, storm.updraughtMs);
  setUpdraught(storm, storm.updraughtMs + (targetMs - storm.updraughtMs) * clamp(dtHours / (targetMs > storm.updraughtMs ? BUDGET.growthHours : BUDGET.decayHours), 0, 1));
  // Organization: how well the updraught is kept clear of its own rain and outflow (or, in a
  // line, how firmly the storms share one gust front).
  const shearSupport = clamp(((Number(environment.bulkShear) || 0) - 16) / 44, 0, 1);
  const targetOrganization = clamp(Math.max(separation * (1 - undercut), BUDGET.lineOrganization * linear) * (0.4 + 0.6 * storm.intensity), 0, 1);
  storm.organization += (targetOrganization - storm.organization) * clamp((0.34 + 0.5 * shearSupport) * dtHours, 0, 1);
  // Cold pool: the rain that has fallen, evaporating into dry air below cloud.
  const downdraught = clamp((Number(environment.dcape) || 0) / COLD_POOL.strongDcape, 0, 1.2);
  const coldPoolTarget = clamp(storm.precipitation * (COLD_POOL.base + COLD_POOL.dryness * downdraught + COLD_POOL.line * linear), 0, 1);
  storm.coldPoolStrength += (coldPoolTarget - storm.coldPoolStrength) * clamp(COLD_POOL.responsePerHour * dtHours, 0, 1);
  return { separation, undercut, potentialMs, targetMs };
}

export const stormIsOver = storm => storm.ageHours > BUDGET.youngHours && storm.updraughtMs < BUDGET.deadUpdraughtMs;
