// A storm's character is carried by continuous properties that evolve from its environment
// and its neighbours:
//   - rotation (mesocycloneStrength): from the shear and the updraft;
//   - cold pool (coldPoolStrength): from its rain falling through dry air;
//   - line organization (lineOrganization): from the cold pool overpowering the shear across a
//     group of close storms, or from linear forcing where the storm forms.
// The type name ("isolated supercell", "QLCS", ...) is only a description of those properties
// for the pages, the radar depiction and statistics. Nothing in the physics reads it.
import { clamp } from '../scenarios/math.js';

const ramp = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);

// Mesocyclone strength (0-1.2 in this model) from a non-rotating to a clearly rotating storm.
const ROTATION_RANGE = [0.15, 0.35];
// Cold pool propagation against the low-level shear (RKW balance): below about 0.7 the shear
// holds the updraft over its inflow (discrete cells); above about 1.3 the cold pool runs ahead
// and organizes the convection along its leading edge.
const COLD_POOL_BALANCE_RANGE = [0.7, 1.3];
const COLD_POOL_SPEED_MS = 38;      // gust-front speed of the strongest cold pool, m/s
// 0-3 km share of the 0-6 km bulk shear in the balance the storm's outflow, rotation and occlusion
// are set against (their ranges were calibrated on it).
const LOW_LEVEL_SHEAR_SHARE = 0.5;
// Share of the cold pool's pull into a line that a fully rotating storm resists.
const ROTATION_HOLDS_DISCRETE = 0.4;
const KT_TO_MS = 0.514444;

export const rotatingShare = storm => ramp(storm.mesocycloneStrength ?? 0, ROTATION_RANGE[0], ROTATION_RANGE[1]);
export const lineShare = storm => clamp(Number(storm.lineOrganization) || 0, 0, 1);

// Ratio of cold-pool speed to low-level shear (dimensionless). measured: against the air's own
// 0-3 km shear (where known) rather than the share of the 0-6 km.
export function coldPoolBalance(storm, environment, measured = false) {
  const coldPoolSpeed = COLD_POOL_SPEED_MS * Math.sqrt(clamp(storm.coldPoolStrength ?? 0, 0, 1));
  const shear03 = (measured && Number(environment.shear03)) || LOW_LEVEL_SHEAR_SHARE * (Number(environment.bulkShear) || 0);
  const lowLevelShear = Math.max(4, shear03 * KT_TO_MS);
  return coldPoolSpeed / lowLevelShear;
}

// Where line organization is heading for this storm now.
export function lineOrganizationTarget(storm, environment) {
  // Linear forcing where it formed or sits: shear along a boundary, or dense air undercutting.
  const forced = ramp(environment.linearFraction, 0.3, 0.7);
  // Its own cold pool, shared with close neighbours, overpowering the shear: the RKW balance against
  // the measured 0-3 km shear. (Until 2026-10-20 against half the 0-6 km shear, where the soundings
  // give 0.75-1.0 of it in moist air on supercell days: the balance ran about 1.6 times too high
  // and supercells in 55-60 kt of shear turned into lines within the hour. Using it for the
  // outflow, rotation and occlusion as well took seed 8181 from 21 to 49 tornadoes, their ranges
  // having been calibrated on the share; left for the final tuning.)
  // A rotating updraught resists it: its rotation lifts it (the dynamic pressure of the mesocyclone)
  // whatever the gust front does, so a supercell keeps its own inflow among neighbours
  // (ROTATION_HOLDS_DISCRETE). (2026-10-21: on 8 seeds x 10 days the median discrete-supercell spell
  // lasted 1.4 h, 29% of them 2 h or more, and 46% ended by lining out; real discrete supercells last
  // 2-4 h. With 0.4: about 2 h, 50% and 28%, tornadoes 5.5 to 6.4 a day; 0.6 left 8% lining out.)
  const coldPoolDriven = ramp(coldPoolBalance(storm, environment, true), COLD_POOL_BALANCE_RANGE[0], COLD_POOL_BALANCE_RANGE[1]) * ramp(environment.stormCoverage, 0.2, 0.6) * (1 - ROTATION_HOLDS_DISCRETE * rotatingShare(storm));
  return clamp(Math.max(forced, coldPoolDriven), 0, 1);
}

// How far the outflow undercuts the updraft (0 none, 1 fully outflow dominated).
export const outflowDominance = (storm, environment) => ramp(coldPoolBalance(storm, environment), 1.1, 1.8);

// The name that describes the storm's present properties.
export function describeStormMode(storm, environment = storm.environment ?? {}) {
  const rotating = rotatingShare(storm), linear = lineShare(storm);
  const coverage = clamp(Number(environment.stormCoverage) || 0, 0, 1);
  const halfLengthKm = Number(storm.lineHalfLengthKm) || 0;
  if (storm.elevatedFeed && rotating < 0.5 && linear < 0.5) return 'elevated convection';
  if (linear >= 0.5) {
    // An MCS by the usual definition: a line at least 220 km long that has kept going for hours
    // (the system's age, through the cells it took in).
    if (halfLengthKm >= 110 && (storm.coldPoolStrength ?? 0) >= 0.2 && (storm.systemAgeHours ?? storm.ageHours ?? 0) >= 4) return 'MCS';
    if (halfLengthKm >= 60) return rotating >= 0.5 ? 'QLCS with embedded supercells' : 'QLCS';
    return linear >= 0.75 ? 'linear segment' : 'broken line';
  }
  if (rotating >= 0.5) {
    if (storm.leftMover) return 'left-moving supercell';
    if (linear >= 0.3) return 'mixed supercell cluster';
    if (coverage < 0.15) return 'isolated supercell';
    if (coverage < 0.4) return 'discrete supercell';
    return coverage < 0.7 ? 'semi-discrete supercell' : 'discrete supercell cluster';
  }
  return (Number(environment.bulkShear) || 0) < 22 ? 'pulse storm' : 'multicell';
}

// A rotating storm on its own in strong shear splits once into right- and left-moving members.
// How much of it goes to the left-mover depends on how the wind turns with height through the
// lower half of the storm (0-3 km helicity, the curvature of the hodograph that sets the split's
// pressure forcing; Rotunno and Klemp 1982, Bunkers 2002): an even split where the shear does not
// turn, almost nothing where it turns strongly clockwise, which is the usual tornado day.
// (Until 2026-10-20 this read 0-1 km helicity, about 50 by day where the 0-3 km is 140-200: day
// splits came out even, and left-movers held 34-40% of all supercell time.)
// (straightHelicity [50, 200] to [25, 150] on 2026-10-24: left-movers held 20% of supercell time, 9% of
// all storm time, more than discrete right-movers; a strong left-mover needs a nearly straight low-level
// hodograph. Now 10% of supercell time; tornado days unchanged, 78% on 40 days.)
const SPLIT = { ageHours: [0.6, 3.2], shearKt: 35, capeJkg: 850, straightHelicity: [25, 150], leastShare: 0.25 };
export function shouldSplitStorm(storm, environment) {
  return !storm.hasSplit && !storm.leftMover && storm.ageHours >= SPLIT.ageHours[0] && storm.ageHours <= SPLIT.ageHours[1] &&
    rotatingShare(storm) >= 0.5 && lineShare(storm) < 0.3 &&
    environment.bulkShear >= SPLIT.shearKt && environment.cape >= SPLIT.capeJkg;
}
// The left-mover's share of the parent (0-1); below leastShare it does not survive the split.
export function leftSplitShare(environment) {
  const share = 1 - ramp(environment.srh03 ?? environment.srh, SPLIT.straightHelicity[0], SPLIT.straightHelicity[1]);
  return share >= SPLIT.leastShare ? share : 0;
}
