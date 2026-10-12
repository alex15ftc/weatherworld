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
const LOW_LEVEL_SHEAR_SHARE = 0.5;  // 0-3 km share of the 0-6 km bulk shear
const KT_TO_MS = 0.514444;

export const rotatingShare = storm => ramp(storm.mesocycloneStrength ?? 0, ROTATION_RANGE[0], ROTATION_RANGE[1]);
export const lineShare = storm => clamp(Number(storm.lineOrganization) || 0, 0, 1);

// Ratio of cold-pool speed to low-level shear (dimensionless).
export function coldPoolBalance(storm, environment) {
  const coldPoolSpeed = COLD_POOL_SPEED_MS * Math.sqrt(clamp(storm.coldPoolStrength ?? 0, 0, 1));
  const lowLevelShear = Math.max(4, LOW_LEVEL_SHEAR_SHARE * (Number(environment.bulkShear) || 0) * KT_TO_MS);
  return coldPoolSpeed / lowLevelShear;
}

// Where line organization is heading for this storm now.
export function lineOrganizationTarget(storm, environment) {
  // Linear forcing where it formed or sits: shear along a boundary, or dense air undercutting.
  const forced = ramp(environment.linearFraction, 0.3, 0.7);
  // Its own cold pool, shared with close neighbours, overpowering the shear.
  const coldPoolDriven = ramp(coldPoolBalance(storm, environment), COLD_POOL_BALANCE_RANGE[0], COLD_POOL_BALANCE_RANGE[1]) * ramp(environment.stormCoverage, 0.2, 0.6);
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
    if (halfLengthKm >= 110 && (storm.coldPoolStrength ?? 0) >= 0.2 && (storm.ageHours ?? 0) >= 4) return 'MCS';
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
// How much of it goes to the left-mover depends on how the wind turns with height: an even
// split where the shear does not turn (little helicity), almost nothing where it turns
// strongly clockwise, which is the usual tornado day.
const SPLIT = { ageHours: [0.6, 3.2], shearKt: 35, capeJkg: 850, straightHelicity: [80, 250], leastShare: 0.25 };
export function shouldSplitStorm(storm, environment) {
  return !storm.hasSplit && !storm.leftMover && storm.ageHours >= SPLIT.ageHours[0] && storm.ageHours <= SPLIT.ageHours[1] &&
    rotatingShare(storm) >= 0.5 && lineShare(storm) < 0.3 &&
    environment.bulkShear >= SPLIT.shearKt && environment.cape >= SPLIT.capeJkg;
}
// The left-mover's share of the parent (0-1); below leastShare it does not survive the split.
export function leftSplitShare(environment) {
  const share = 1 - ramp(environment.srh, SPLIT.straightHelicity[0], SPLIT.straightHelicity[1]);
  return share >= SPLIT.leastShare ? share : 0;
}
