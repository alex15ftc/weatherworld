// A storm's rotation, from its own state and the air it draws in.
//   - Mid-level rotation (mesocycloneStrength, 0-1.2): the updraught tilting the environment's
//     shear into the vertical. It needs an updraught, shear through the storm's depth and
//     helicity in the inflow, and an updraught kept clear of its own rain.
//   - Low-level rotation (lowRotation, 0-1.2): the mid-level rotation drawing air up from
//     near the ground. It needs helicity close to the ground, a low cloud base (outflow that
//     is still buoyant), and outflow that does not outrun the updraught.
//   - Occlusion (0-1): while a tornado is down, the storm's outflow wraps around it and in
//     time cuts it off; slowly where the outflow is in balance with the shear, quickly where
//     it is not. When the tornado ends the occlusion clears and rotation can build again.
// Low-level rotation is what a player reads: it builds for some minutes before a tornado can
// form, and it falls away as the storm occludes.
import { clamp } from '../scenarios/math.js';
import { lineShare, coldPoolBalance } from './StormModeEngine.js';

export const ROTATION = Object.freeze({
  fullUpdraughtMs: 40, shearKt: [20, 55], helicity: [50, 350], shearShare: 0.35, lineLoss: 0.45,
  spinUpHours: 0.4, spinDownHours: 0.7,
  lowHelicity: [50, 250], helicityFloor: 0.5, cloudBaseM: [2000, 800], outflowBalance: [1.0, 1.8],
  // Strong helicity near the ground means strong inflow, which holds the outflow back: the
  // outflow a storm can have and still spin up near the ground rises by up to outflowHold
  // (in the balance) between helicityHold[0] and [1]. So a storm in strongly turning low-level
  // wind can cycle, putting down one tornado after another as real cyclic supercells do.
  outflowHold: 0.6, helicityHold: [150, 400],
  // Helicity added near the ground where the inflow crosses the edge of older rain-cooled air
  // (an outflow boundary), from none at boundaryContrastK[0] to all of it at boundaryContrastK[1].
  boundaryHelicity: 150, boundaryContrastK: [1.5, 6],
  // A left-moving split rotates the other way: it lives on shear that does not turn with
  // height, and has no rotation near the ground to speak of.
  leftHelicity: [80, 250], leftShare: 0.6,
  // Low-level rotation falls away over most of an hour, and the outflow takes a few times
  // longer to wrap around a tornado than it once did (occlusionHours was 1.5-0.15, spin-down
  // 0.08 h): tornadoes last about 50 minutes on average, not 16, with the rate, wind spread and
  // damage rating in TornadoEngine.js re-set to keep counts and strengths (2026-10-14).
  lowSpinUpHours: 0.3, lowSpinDownHours: 0.4,
  // Time for the outflow to wrap around a tornado: from balanced outflow to outflow that
  // outruns the shear, and shorter the weaker the rotation is (strong rotation means strong
  // inflow, which holds the outflow back). weakShare is the share of that time left to
  // rotation at holdRotation[0], rising to all of it at holdRotation[1].
  occlusionHours: [4.5, 0.45], occlusionBalance: [0.5, 1.4], weakShare: 0.07, holdRotation: [0.12, 0.6], recoveryHours: 0.15
});

const ramp = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);
const toward = (value, target, dtHours, upHours, downHours) => value + (target - value) * clamp(dtHours / (target > value ? upHours : downHours), 0, 1);

export function stepStormRotation(storm, environment, dtHours) {
  const R = ROTATION, linear = lineShare(storm);
  const updraught = clamp((storm.updraughtMs ?? 0) / R.fullUpdraughtMs, 0, 1.2);
  const turning = storm.leftMover ? R.leftShare * (1 - ramp(environment.srh, R.leftHelicity[0], R.leftHelicity[1])) : ramp(environment.srh, R.helicity[0], R.helicity[1]);
  const tilting = R.shearShare * ramp(environment.bulkShear, R.shearKt[0], R.shearKt[1]) + (1 - R.shearShare) * turning;
  const clear = 0.4 + 0.6 * clamp(storm.organization ?? 0, 0, 1);
  // Updraughts along a line share their inflow and rotate less than a storm on its own.
  const midTarget = updraught * tilting * clear * (1 - R.lineLoss * linear);
  storm.mesocycloneStrength = toward(storm.mesocycloneStrength ?? 0, midTarget, dtHours, R.spinUpHours, R.spinDownHours);

  const balance = coldPoolBalance(storm, environment);
  const hold = R.weakShare + (1 - R.weakShare) * ramp(storm.lowRotationFree ?? 0, R.holdRotation[0], R.holdRotation[1]);
  storm.occlusion = clamp((storm.occlusion ?? 0) + (storm.tornado?.onGround
    ? dtHours / (hold * (R.occlusionHours[0] + (R.occlusionHours[1] - R.occlusionHours[0]) * ramp(balance, R.occlusionBalance[0], R.occlusionBalance[1])))
    : -dtHours / R.recoveryHours), 0, 1);
  storm.boundaryBoost = ramp(environment.outflowContrastK, R.boundaryContrastK[0], R.boundaryContrastK[1]);
  const nearGround = R.helicityFloor + (1 - R.helicityFloor) * ramp((Number(environment.srh) || 0) + R.boundaryHelicity * storm.boundaryBoost, R.lowHelicity[0], R.lowHelicity[1]);
  const cloudBase = ramp(R.cloudBaseM[0] - (Number(environment.lcl) || R.cloudBaseM[0]), 0, R.cloudBaseM[0] - R.cloudBaseM[1]);
  const held = R.outflowHold * ramp(environment.srh, R.helicityHold[0], R.helicityHold[1]);
  const outflow = 1 - ramp(balance, R.outflowBalance[0] + held, R.outflowBalance[1] + held);
  // A storm feeding on air from above the ground has nothing near the ground to stretch.
  const freeTarget = storm.elevatedFeed || storm.leftMover ? 0 : storm.mesocycloneStrength * nearGround * cloudBase * outflow, lowTarget = freeTarget * (1 - storm.occlusion);
  // What the low-level rotation would be were the storm not occluding: its underlying strength.
  storm.lowRotationFree = toward(storm.lowRotationFree ?? 0, freeTarget, dtHours, R.lowSpinUpHours, R.lowSpinDownHours);
  const before = storm.lowRotation ?? 0;
  storm.lowRotation = toward(before, lowTarget, dtHours, R.lowSpinUpHours, R.lowSpinDownHours);
  storm.lowRotationTrend = dtHours > 0 ? (storm.lowRotation - before) / dtHours : 0;
  return { midTarget, lowTarget, balance };
}
