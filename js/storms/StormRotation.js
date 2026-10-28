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
  // shearShare: how much of the mesocyclone deep shear alone can give (the rest needs the inflow's
  // helicity). 0.35 to 0.55 on 2026-10-23: with 0.35 a storm in 55-85 kt of straight-hodograph
  // shear and little low-level helicity stayed a multicell (mesocyclone about 0.2); real storms
  // there split into supercells, which deep shear alone makes (Weisman and Klemp 1982). Storms in
  // 50+ kt shear went from 26% to 15% of their time as multicells.
  // (2026-10-26: shearKt [20, 55] to [15, 45]: supercells needed 39 kt (their 10th percentile of 0-6 km shear) where real ones
  // have 29-35 (Thompson et al. 2003). lowHelicity [50, 250] to [75, 300] and helicityFloor 0.3 to 0.1: once the low-level
  // jet gave realistic 0-1 km helicity, a storm with none still had 30% of its spin near the ground, so helicity barely told
  // tornadic supercells from others; real tornadic ones have about 1.5 times the helicity, 185 against 123.)
  fullUpdraughtMs: 40, shearKt: [15, 45], helicity: [50, 200], shearShare: 0.55, lineLoss: 0.45,
  spinUpHours: 0.4, spinDownHours: 0.7,
  // helicityFloor: the share of near-ground spin a storm has with no helicity in the lowest km
  // (2026-10-19: 0.5 to 0.15; with half of it kept, deep shear alone and a saturated surface's
  // ground-level cloud base put tornadoes down in 0-1 km helicity of 20-70 in the morning. Then
  // 0.3 the same day: 0.15 left afternoon storms, whose inflow helicity is only about 50 against
  // about 140 at night, almost no tornadoes.)
  // (cloudBaseM [2000, 800] to [2000, 1000] on 2026-10-21, the significant tornado parameter's LCL
  // term: afternoon storms under 1,000-1,300 m bases were held back further than night ones.)
  // (outflowBalance [1.0, 1.8] to [1.4, 2.4] on 2026-10-23: by mid-afternoon the cold pools under
  // DCAPE near 1,000 J/kg had cut the low-level rotation of supercells to a third of the morning's,
  // and the evening's best environments gave weak tornadoes or none; with it the 3-9 pm share of
  // tornadoes went from 35% to 43%.)
  stretchLapse: [5, 9], lowHelicity: [75, 300], helicityFloor: 0.1, cloudBaseM: [2000, 1000], outflowBalance: [1.4, 2.4],
  // Inhibition (J/kg) at which a storm fed from the ground takes all, and none, of its inflow from near the ground.
  // (2026-10-21: [50, 200] to [30, 120]; it is read from the surface parcel as well for the rotation
  // near the ground, see surfaceFed.)
  // (2026-10-26: the mixed layer's inhibition is read on the significant tornado parameter's own range, groundCinJkg [50, 200]
  // (Thompson et al. 2003), and the surface parcel's on surfaceCinJkg [30, 120], which keeps storms over the night's cooled
  // ground from counting as fed from it. With the capping inversion the warm sector's MLCIN has a median of about -45, as real
  // 00Z soundings do, and storms that broke a -70 to -90 cap took only half their inflow from the ground: on reviewed days
  // STP 3-7 gave few tornadoes, all EF0-1.)
  // (surfaceCinJkg [30, 120] to [50, 200] later on 2026-10-26, when the sounding's CIN was corrected to SHARPpy's rule and
  // the 7 pm warm sector's matched 412 real soundings: the narrower range had been set against CIN that read too weak.
  // Night inversions, 200 J/kg and more over cooled ground, still fall outside it.)
  // (Back to [30, 120] the same day, once the low-level jet fix had raised helicity: at [50, 200] about 40% of tornadoes came
  // at night, where 26.6% of Great Plains tornadoes do (Ashley et al. 2008).)
  groundCinJkg: [50, 200], surfaceCinJkg: [30, 120],
  // Strong helicity near the ground means strong inflow, which holds the outflow back: the
  // outflow a storm can have and still spin up near the ground rises by up to outflowHold
  // (in the balance) between helicityHold[0] and [1]. So a storm in strongly turning low-level
  // wind can cycle, putting down one tornado after another as real cyclic supercells do.
  outflowHold: 0.6, helicityHold: [150, 400],
  // A boundary in the inflow: the edge of older rain-cooled air (an outflow boundary, from none at
  // boundaryContrastK[0] of contrast to all at [1]), or an air-mass boundary the inflow is near, mostly on
  // its cool side (airMassContrastK, K of virtual potential temperature; StormEnvironmentCoupling.js).
  // There the winds back into the boundary and its contrast turns the air about a horizontal axis
  // along it, which the updraught tilts and stretches; the cooler, moister air there has lower cloud
  // bases. The grid smooths that 10-30 km zone away, so it is added: up to boundaryHelicity of 0-1 km
  // helicity and boundaryBaseM off the cloud base, built up over boundaryExposureHours[0] in the zone and
  // fading over [1] after leaving it, so a storm riding along a boundary takes all of it and one
  // crossing quickly less. Only a storm still fed from the ground can use it; one gone deep into the
  // cold air feeds above it (fromGround, surfaceFed). (2026-10-25: +150 near sharp gradients alone,
  // 4-9 K per 100 km, seldom reached on the grid, and no cloud-base effect; supercells on days without a
  // tornado had cloud bases near 1,400 m and the boost averaged 0.11. Observed: 0-1 km helicity 80 in the
  // warm air and about 300 on the cool side, bases 160 m lower, Axon et al. 2024;
  // docs/storm-reference/boundaries-qlcs-landspouts-2026-10-25.md.) On the grid a drawn front shows about 2 K
  // within 32 km and the warm sector 0.3-0.4 K (median at supercells' inflows 0.36, 90th percentile 0.9), hence
  // airMassContrastK from just above that to most of a front's.
  boundaryHelicity: 180, boundaryBaseM: 150, boundaryContrastK: [1.5, 6], airMassContrastK: [0.6, 1.8], boundaryExposureHours: [0.35, 1],
  // ...fading where the inflow already has strong low-level spin, from all of it at boundaryAmbientSrh[0] of 0-1 km
  // helicity to none at [1]: boundaries matter where the large-scale flow gives little (F2+ tornadoes on
  // boundaries had 0-1 km helicity of about 200 in model soundings, those in the open warm sector about 280; Garner
  // 2012). (2026-10-25: without it the boost went mostly to outbreak days: High days 10% to 20%, 30+ tornadoes 8% to 13%.)
  boundaryAmbientSrh: [100, 300],
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
  // Rotation near the ground without a mesocyclone (2026-10-25; docs/storm-reference/boundaries-qlcs-
  // landspouts-2026-10-25.md). The real record has about a fifth of tornadoes from squall lines and a
  // tenth from ordinary storms on boundaries, nearly all EF0-EF1; the engine made them only from
  // mesocyclones, and line days and weak-shear boundary days went without.
  //   line: mesovortices along a line's gust front, where the 0-3 km shear across the line (the part
  //   along its motion) is strong enough to stand the cold pool up (shearKt) and the cold pool does
  //   not outrun it (the outflow factor below), stronger where the rear inflow surges (a bow);
  //   Schaumann and Przybylinski 2012, Trapp et al. 2005. Up to peak of low-level rotation.
  //   landspout: a young updraught (ageHours) over a convergence line whose shearing makes small
  //   vortices at the ground, stretched where the low levels are steep (lapseKm, 0-3 km C/km) and
  //   the deep shear weak (weakShearKt; with more the storms are supercells or lines); Wakimoto and
  //   Wilson 1989, Caruso and Davies 2005. Cloud base does not matter for it (the High Plains' are high).
  // Both need the storm fed from the ground, and make weak, brief tornadoes by the same rules as a
  // mesocyclone's (TornadoEngine.js): their rotation is weak.
  // (Ranges set to the grid's spread, 2026-10-25: line-normal shear at lines median 25 kt, 90th 37; young storms'
  // 0-3 km lapse rate median 6.8 C/km in weak shear, convergence median 0.23. With [20, 40] kt, [7.5, 9] C/km and
  // [0.25, 0.6] lines and boundaries made 2% of tornadoes; 30 kt is a soft limit, 46% of mesovortices form below it.)
  // (Peaks 0.35 and 0.3 to 0.5 and 0.4 the same day: lines' tornadoes were 94-97% EF0, against about 46% EF0 and 44%
  // EF1 in the record, and boundaries made 1.6% of tornadoes against about a tenth. Adding the forward speed to the
  // tornado's wind instead did not set them apart: supercells' tornadoes here move as fast. A peak of 0.8 doubled
  // lines' tornadoes, to 26% of all, and left them 88% EF0: more rotation gives more of them, not stronger ones.)
  line: { peak: 0.5, shearKt: [12, 30], surgeShare: 0.4 },
  landspout: { peak: 0.4, ageHours: [0.4, 0.9], convergence: [0.1, 0.45], lapseKm: [6, 8], weakShearKt: [25, 35] },
  occlusionHours: [4.5, 0.45], occlusionBalance: [0.5, 1.4], weakShare: 0.07, holdRotation: [0.12, 0.6], recoveryHours: 0.15
});

// The 0-3 km shear across a line: its part along the storm's motion (a line moves across itself). The
// 0-3 km shear's direction is taken from the mean of the 850 and 500 mb winds less the surface wind.
function lineNormalShearKt(storm, environment) {
  const ve = storm.velocityKph?.east ?? 0, vn = storm.velocityKph?.north ?? 0, speed = Math.hypot(ve, vn);
  const s = environment.surfaceWind, a = environment.wind850, b = environment.wind500;
  if (!s || !a || !b || speed < 1) return 0;
  const de = (a.eastKt + b.eastKt) / 2 - s.eastKt, dn = (a.northKt + b.northKt) / 2 - s.northKt, size = Math.hypot(de, dn);
  if (size < 0.1) return 0;
  return (Number(environment.shear03) || size) * Math.max(0, (de * ve + dn * vn) / (size * speed));
}

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
  const zone = Math.max(ramp(environment.outflowContrastK, R.boundaryContrastK[0], R.boundaryContrastK[1]), ramp(environment.airMassContrastK, R.airMassContrastK[0], R.airMassContrastK[1]));
  storm.boundaryBoost = toward(storm.boundaryBoost ?? 0, zone * (1 - ramp(environment.srh, R.boundaryAmbientSrh[0], R.boundaryAmbientSrh[1])), dtHours, R.boundaryExposureHours[0], R.boundaryExposureHours[1]);
  const nearGround = R.helicityFloor + (1 - R.helicityFloor) * ramp((Number(environment.srh) || 0) + R.boundaryHelicity * storm.boundaryBoost, R.lowHelicity[0], R.lowHelicity[1]);
  const cloudBase = ramp(R.cloudBaseM[0] - ((Number(environment.lcl) || R.cloudBaseM[0]) - R.boundaryBaseM * storm.boundaryBoost), 0, R.cloudBaseM[0] - R.cloudBaseM[1]);
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
  const surfaceFed = Math.min(fromGround, clamp((R.surfaceCinJkg[1] - Math.abs(Number(environment.sbcin ?? environment.cin) || 0)) / (R.surfaceCinJkg[1] - R.surfaceCinJkg[0]), 0, 1));
  const fed = storm.elevatedFeed || storm.leftMover ? 0 : surfaceFed;
  // Stretching near the ground: the lowest kilometre's lapse rate, all of it from stretchLapse[1] C/km, none at [0]. After dark
  // that layer stabilises and tornadoes fade under helicity that is still rising (Davies 2006; Coniglio and Parker 2020).
  // (2026-10-26: 40% of tornadoes came at night, where 27% of Great Plains ones do (Ashley et al. 2008); now 32%, and 48% from 3
  // to 9 pm (was 36%), with the formation rate 0.17 to 0.23 to keep the count. Their 0-1 km lapse
  // rate had a median of 6.8 C/km against 9.0 in the afternoon, which nothing in the tornado's making read.)
  const stretch = ramp(Number(environment.lapseRate01) || R.stretchLapse[1], R.stretchLapse[0], R.stretchLapse[1]);
  const fromMesocyclone = storm.mesocycloneStrength * nearGround * cloudBase * outflow * fed * stretch;
  const fromLine = R.line.peak * linear * ramp(lineNormalShearKt(storm, environment), R.line.shearKt[0], R.line.shearKt[1]) * outflow * (1 - R.line.surgeShare + R.line.surgeShare * clamp(storm.rearInflow ?? 0, 0, 1)) * fed;
  const L = R.landspout;
  const fromBoundary = L.peak * (1 - ramp(storm.ageHours, L.ageHours[0], L.ageHours[1])) * ramp(environment.boundaryInfluence, L.convergence[0], L.convergence[1]) * ramp(environment.lapseRate03, L.lapseKm[0], L.lapseKm[1]) * (1 - ramp(environment.bulkShear, L.weakShearKt[0], L.weakShearKt[1])) * fed;
  const freeTarget = Math.max(fromMesocyclone, fromLine, fromBoundary), lowTarget = freeTarget * (1 - storm.occlusion);
  // What makes most of it, kept on the tornado it puts down (TornadoEngine.js).
  storm.lowRotationSource = freeTarget <= 0 ? null : freeTarget === fromMesocyclone ? 'mesocyclone' : freeTarget === fromLine ? 'line' : 'landspout';
  // What the low-level rotation would be were the storm not occluding: its underlying strength.
  storm.lowRotationFree = toward(storm.lowRotationFree ?? 0, freeTarget, dtHours, R.lowSpinUpHours, R.lowSpinDownHours);
  const before = storm.lowRotation ?? 0;
  storm.lowRotation = toward(before, lowTarget, dtHours, R.lowSpinUpHours, R.lowSpinDownHours);
  storm.lowRotationTrend = dtHours > 0 ? (storm.lowRotation - before) / dtHours : 0;
  return { midTarget, lowTarget, balance };
}
