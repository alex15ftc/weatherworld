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
  // helicity: the inflow's helicity over which the mesocyclone's turning grows to its full share
  // (2026-10-20: [50, 350] to [50, 200]; effective helicity of 150-250 is a strong supercell's in
  // forecasting practice. On 30 of 80 days supercells had 0-1 km helicity near 226 and made no
  // tornado: their mesocyclones took 0.36 of the turning against 0.59 on tornado days, half as strong.)
  fullUpdraughtMs: 40, shearKt: [20, 55], helicity: [50, 200], shearShare: 0.35, lineLoss: 0.45,
  spinUpHours: 0.4, spinDownHours: 0.7,
  // helicityFloor: the share of near-ground spin a storm has with no helicity in the lowest km
  // (2026-10-19: 0.5 to 0.15; with half of it kept, deep shear alone and a saturated surface's
  // ground-level cloud base put tornadoes down in 0-1 km helicity of 20-70 in the morning. Then
  // 0.3 the same day: 0.15 left afternoon storms, whose inflow helicity is only about 50 against
  // about 140 at night, almost no tornadoes.)
  // (cloudBaseM [2000, 800] to [2000, 1000] on 2026-10-21, the significant tornado parameter's LCL
  // term: afternoon storms under 1,000-1,300 m bases were held back further than night ones.)
  lowHelicity: [50, 250], helicityFloor: 0.3, cloudBaseM: [2000, 1000], outflowBalance: [1.0, 1.8],
  // Inhibition (J/kg) at which a storm fed from the ground takes all, and none, of its inflow from near the ground.
  // (2026-10-21: [50, 200] to [30, 120]; it is read from the surface parcel as well for the rotation
  // near the ground, see surfaceFed.)
  groundCinJkg: [30, 120],
  // Strong helicity near the ground means strong inflow, which holds the outflow back: the
  // outflow a storm can have and still spin up near the ground rises by up to outflowHold
  // (in the balance) between helicityHold[0] and [1]. So a storm in strongly turning low-level
  // wind can cycle, putting down one tornado after another as real cyclic supercells do.
  outflowHold: 0.6, helicityHold: [150, 400],
  // Helicity added near the ground where the inflow crosses the edge of older rain-cooled air
  // (an outflow boundary), from none at boundaryContrastK[0] to all of it at boundaryContrastK[1].
  boundaryHelicity: 150, boundaryContrastK: [1.5, 6],
  // The same near a front, from how fast the air masses' density changes there
  // (frontGradientK100, K of virtual potential temperature per 100 km). Near-ground spin is made in a narrow zone
  // along a front, mostly on its cool side (Markowski et al. 1998): the winds back into it and
  // the contrast turns the air. Only a storm still fed from the ground can use it; one that has
  // gone deep into the cold air feeds above it and makes no near-ground rotation anyway.
  frontGradientK100: [4, 9],
  // A left-moving split rotates the other way: it lives on shear that does not turn with
  // height, and has no rotation near the ground to speak of. Read from 0-3 km helicity, as the
  // split itself is (leftSplitShare); until 2026-10-20 from the inflow's helicity, which by day
  // was the weak 0-1 km value, so a left-mover in an afternoon of 0-3 km helicity 150 kept
  // nearly as much rotation as its parent and often outlived it.
  leftHelicity: [50, 200], leftShare: 0.6,
  // Low-level rotation falls away over most of an hour, and the outflow takes a few times
  // longer to wrap around a tornado than it once did (occlusionHours was 1.5-0.15, spin-down
  // 0.08 h): tornadoes last about 50 minutes on average, not 16, with the rate, wind spread and
  // damage rating in TornadoEngine.js re-set to keep counts and strengths (2026-10-14).
  // The live clock went from 15x to 12x on 2026-10-15 with these left as they were: a tornado
  // lasts the same in simulated time, about 50 minutes, and so a quarter longer in real time.
  lowSpinUpHours: 0.3, lowSpinDownHours: 0.4,
  // Time for the outflow to wrap around a tornado: from balanced outflow to outflow that
  // outruns the shear, and shorter the weaker the rotation is (strong rotation means strong
  // inflow, which holds the outflow back). weakShare is the share of that time left to
  // rotation at holdRotation[0], rising to all of it at holdRotation[1].
  occlusionHours: [4.5, 0.45], occlusionBalance: [0.5, 1.4], weakShare: 0.07, holdRotation: [0.12, 0.6], recoveryHours: 0.15
});

// Median ratio of the cold-pool balance against the measured 0-3 km shear to that against half the 0-6 km shear, over supercells.
const MEASURED_SHARE = 0.72;
const ramp = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);
const toward = (value, target, dtHours, upHours, downHours) => value + (target - value) * clamp(dtHours / (target > value ? upHours : downHours), 0, 1);

export function stepStormRotation(storm, environment, dtHours) {
  const R = ROTATION, linear = lineShare(storm);
  const updraught = clamp((storm.updraughtMs ?? 0) / R.fullUpdraughtMs, 0, 1.2);
  // How much of its inflow the storm takes from near the ground (the inhibition term of the
  // significant tornado parameter: all of it at 50 J/kg or less, none at 200; none for a storm fed
  // from aloft). The rest comes from above the lowest km, and brings only the shear and helicity
  // there: 0-3 km helicity less 0-1 km, 0-6 km shear less 0-1 km (2026-10-17, the effective inflow
  // layer of forecasting practice; given the near-ground values, 61% of supercells formed overnight
  // on air from aloft).
  const fromGround = storm.elevatedFeed ? 0 : clamp((R.groundCinJkg[1] - Math.abs(Number(environment.cin) || 0)) / (R.groundCinJkg[1] - R.groundCinJkg[0]), 0, 1);
  const srhLow = Number(environment.srh) || 0, shearDeep = Number(environment.bulkShear) || 0, shearLow = Number(environment.shear01) || 0;
  const srhAloft = Math.max(0, (Number(environment.srh03) || srhLow) - srhLow), shearAloft = Math.sqrt(Math.max(0, shearDeep * shearDeep - shearLow * shearLow));
  // (Tried 2026-10-20: 0-3 km helicity for a storm fed from the ground. It strengthened night
  // mesocyclones most, where the night jet gives 0-3 km helicity of 230-400, and tornadoes went
  // from 22 to 31 on seed 8181 and 8 to 24 on seed 5150, mostly at night; reverted.)
  const srhIn = fromGround * srhLow + (1 - fromGround) * srhAloft, shearIn = fromGround * shearDeep + (1 - fromGround) * shearAloft;
  // A left-mover's rotation is read from the 0-3 km helicity, as the split is (leftSplitShare).
  const srhLayer = Math.max(srhLow, Number(environment.srh03) || srhLow);
  const turning = storm.leftMover ? R.leftShare * (1 - ramp(srhLayer, R.leftHelicity[0], R.leftHelicity[1])) : ramp(srhIn, R.helicity[0], R.helicity[1]);
  const tilting = R.shearShare * ramp(shearIn, R.shearKt[0], R.shearKt[1]) + (1 - R.shearShare) * turning;
  const clear = 0.4 + 0.6 * clamp(storm.organization ?? 0, 0, 1);
  // Updraughts along a line share their inflow and rotate less than a storm on its own.
  const midTarget = updraught * tilting * clear * (1 - R.lineLoss * linear);
  storm.mesocycloneStrength = toward(storm.mesocycloneStrength ?? 0, midTarget, dtHours, R.spinUpHours, R.spinDownHours);

  const balance = coldPoolBalance(storm, environment);
  const hold = R.weakShare + (1 - R.weakShare) * ramp(storm.lowRotationFree ?? 0, R.holdRotation[0], R.holdRotation[1]);
  storm.occlusion = clamp((storm.occlusion ?? 0) + (storm.tornado?.onGround
    ? (storm.tornado.occlusionShare ?? 1) * dtHours / (hold * (R.occlusionHours[0] + (R.occlusionHours[1] - R.occlusionHours[0]) * ramp(balance, R.occlusionBalance[0], R.occlusionBalance[1])))
    : -dtHours / R.recoveryHours), 0, 1);
  storm.boundaryBoost = Math.max(ramp(environment.outflowContrastK, R.boundaryContrastK[0], R.boundaryContrastK[1]), ramp(environment.densityGradient, R.frontGradientK100[0], R.frontGradientK100[1]));
  const nearGround = R.helicityFloor + (1 - R.helicityFloor) * ramp((Number(environment.srh) || 0) + R.boundaryHelicity * storm.boundaryBoost, R.lowHelicity[0], R.lowHelicity[1]);
  const cloudBase = ramp(R.cloudBaseM[0] - (Number(environment.lcl) || R.cloudBaseM[0]), 0, R.cloudBaseM[0] - R.cloudBaseM[1]);
  const held = R.outflowHold * ramp(environment.srh, R.helicityHold[0], R.helicityHold[1]);
  // The outflow set against the measured 0-3 km shear, the low-level shear the cold pool works
  // against (Rotunno, Klemp and Weisman); the ranges, set on half the 0-6 km shear, are scaled by
  // MEASURED_SHARE, its median ratio over supercells. (2026-10-21: by day the deep shear eases while
  // the low-level shear does not, so half the 0-6 km shear made afternoon storms look outflow
  // dominated: their outflow factor was 0.27-0.30 from 3 to 8 pm against 0.40-0.47 at night.)
  // (Without a measured 0-3 km shear the balance falls back to half the 0-6 km, on the ranges as set.)
  const scale = Number(environment.shear03) > 0 ? MEASURED_SHARE : 1;
  const outflow = 1 - ramp(coldPoolBalance(storm, environment, true), scale * (R.outflowBalance[0] + held), scale * (R.outflowBalance[1] + held));
  // A storm feeding on air from above the ground has nothing near the ground to stretch. One fed
  // from the ground through inhibition draws more of its inflow from above the stable layer the
  // more inhibition there is (the inhibition term of the significant tornado parameter: all of it
  // from the ground at 50 J/kg or less, none at 200; Thompson et al. 2003, Davies 2004). (Without
  // it, from 2026-10-16, storms over the night's cooled ground counted as fed from the ground up to
  // 200 J/kg and made 58-67% of the tornadoes at night.)
  // Rotation near the ground stretches the air at the ground itself, so it also needs the surface
  // parcel to reach the storm: its inhibition rises within hours of sunset, and stays until the
  // morning's mixing has worn the inversion away, while the mixed layer's rises slowly. (2026-10-21:
  // with the mixed layer's alone 42% of tornadoes came from 9 pm to 6 am.)
  const surfaceFed = Math.min(fromGround, clamp((R.groundCinJkg[1] - Math.abs(Number(environment.sbcin ?? environment.cin) || 0)) / (R.groundCinJkg[1] - R.groundCinJkg[0]), 0, 1));
  const freeTarget = storm.elevatedFeed || storm.leftMover ? 0 : storm.mesocycloneStrength * nearGround * cloudBase * outflow * surfaceFed, lowTarget = freeTarget * (1 - storm.occlusion);
  // What the low-level rotation would be were the storm not occluding: its underlying strength.
  storm.lowRotationFree = toward(storm.lowRotationFree ?? 0, freeTarget, dtHours, R.lowSpinUpHours, R.lowSpinDownHours);
  const before = storm.lowRotation ?? 0;
  storm.lowRotation = toward(before, lowTarget, dtHours, R.lowSpinUpHours, R.lowSpinDownHours);
  storm.lowRotationTrend = dtHours > 0 ? (storm.lowRotation - before) / dtHours : 0;
  return { midTarget, lowTarget, balance };
}
