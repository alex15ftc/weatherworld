// A storm's spin budget (docs/research/ENGINE-PHYSICS-PLAN.md, Phase 2 step 1): the vertical spin
// its updraught makes from the horizontal spin of the air it draws in, from the physics rather than
// from tuned ramps. Stage 1: measured beside StormRotation.js (mesocycloneStrength, lowRotation),
// feeding nothing back.
//
//   tilting    In a steady supercell the vortex lines of the inflow follow its streamlines (Beltrami
//              flow, omega = lambda V; Davies-Jones 1984, Lilly 1986), so where the air rises at w
//              its vertical spin is zeta = lambda w, with lambda = SRH / (D Vsr^2) for a layer of
//              depth D, storm-relative helicity SRH and storm-relative wind Vsr. Mid-levels: the
//              0-3 km layer and the storm's updraught. That is for inflow spin all along the wind;
//              only its streamwise share is tilted into spin that rides with the updraught (the rest
//              makes the split's counter-rotating pair): the relative helicity SRH / (Vsr |omega| D),
//              |omega| D the layer's shear, which is what the w-zeta correlation of simulated
//              supercells follows (Davies-Jones 1984; 0.2-0.4 straight to 0.6-0.8 curved hodographs,
//              Weisman and Klemp 1984, Weisman and Rotunno 2000). zeta = streamwise x lambda x w.
//   energy     A mesocyclone is spun up by its updraught and cannot hold more kinetic energy than
//              it: its rotation speed (a Rankine vortex's, zeta R / 2, at the updraught core's radius
//              R = coreShare of 2.5 km + 0.1 km per m/s - StormGeometry's updraught radius without its
//              rotation term) is at most the updraught's w; zeta at most 2 w / R.
//   lift       The mesocyclone's low pressure pulls the near-ground air up: a Rankine vortex's
//              central drop is dp / rho = V^2, worth w^2 = 2 dp / rho of upward speed. Against it: the surface parcel's inhibition
//              (sbcin, J/kg) and the negative buoyancy of rain-cooled outflow it passes through (g dT
//              / T over the outflow's depth, OUTFLOW_DEPTH_M) - a cold rear-flank downdraught or a
//              night's stable layer leaves nothing to lift with (Markowski et al. 2002).
//   stretching The 0-1 km layer's spin tilted by that lift (lambda01 w_low), then stretched by it
//              (dzeta/dt = zeta dw/dz, dw/dz ~ w_low over the lowest km) for the time the inflow takes
//              to cross the low-level mesocyclone (lowRadiusM / Vsr01), at most stretchEFolds e-folds -
//              and by the same energy rule never spinning faster than the lift that stretches it (zeta
//              at most 2 w_low / lowRadiusM). That is the low-level mesocyclone; a tornado is the next
//              contraction, not this one.
// The updraught that tilts and spins up the mesocyclone is its core as a whole at mid-levels, not the
// engine's peak (updraughtMs, near the top of the parcel's climb): given the frame's own updraught
// (StormStructure.updraughtProfile), w is its mean over the mesocyclone's heights (MID_M, where radar
// measures it) and over the Gaussian core's disc out to its radius (1 - 1/e of the centre line), and
// R is that core's radius. Without it, the peak and the radius rule above.
// A left-mover's spin is the other way and its inflow's helicity is not its own: none here.
// Winds are the environment's surface, 850 and 500 mb winds (kt), taken as standing at 0, Z850_M and
// Z500_M; a layer's storm-relative wind is the mean of the wind at its bottom, middle and top (each
// interpolated in height between those), less the storm's motion (kph).
import { clamp } from '../scenarios/math.js';

export const SPIN = Object.freeze({
  // the slowest storm-relative wind used: a right-mover runs about this far off the mean wind
  // (Bunkers et al. 2000's deviation), so a slower one is the engine's motion, not the inflow's
  minVsrMs: 7.5,
  outflowDepthM: 500,
  stretchEFolds: 3,
  // the updraught core's share of the updraught's radius (StormStructure's coreShare), and the
  // low-level mesocyclone's radius (observed 2-4 km across)
  coreShare: 0.5, lowRadiusM: 1500,
  // a mesocyclone: about this much vertical spin (1/s) over a few km (the radar definition)
  mesoZeta: 0.01
});

const KT = 0.514444, G = 9.81, Z850_M = 1500, Z500_M = 5700, MID_M = [3000, 7000], DISC_MEAN = 1 - Math.exp(-1);

// The updraught core's mean speed over the mesocyclone's heights and the core's disc (m/s).
export function coreMeanW(profile) {
  const { w, dz } = profile;
  let sum = 0, n = 0;
  for (let z = MID_M[0]; z <= MID_M[1]; z += dz) { sum += w[Math.round(z / dz)] ?? 0; n++; }
  return DISC_MEAN * sum / n;
}

// The wind (m/s, east and north) at height z, interpolated between the three levels carried.
function windAt(e, z) {
  const lv = [[0, e.surfaceWind], [Z850_M, e.wind850], [Z500_M, e.wind500]];
  const k = z <= Z850_M ? 0 : 1, [za, a] = lv[k], [zb, b] = lv[k + 1], t = clamp((z - za) / (zb - za), 0, 1);
  return [(a.eastKt + (b.eastKt - a.eastKt) * t) * KT, (a.northKt + (b.northKt - a.northKt) * t) * KT];
}
// The mean storm-relative wind speed of the 0-d layer (its bottom, middle and top).
function layerVsr(e, d, cu, cv) {
  let su = 0, sv = 0;
  for (const z of [0, d / 2, d]) { const w = windAt(e, z); su += w[0] / 3; sv += w[1] / 3; }
  return Math.hypot(su - cu, sv - cv);
}

export function spinBudget(storm, environment = storm.environment ?? {}, profile = null) {
  const e = environment, sfc = e.surfaceWind, w85 = e.wind850, w50 = e.wind500;
  if (!sfc || !w85 || !w50 || storm.leftMover) return null;
  const cu = (storm.velocityKph?.east ?? 0) / 3.6, cv = (storm.velocityKph?.north ?? 0) / 3.6;
  const v01 = layerVsr(e, 1000, cu, cv), v03 = layerVsr(e, 3000, cu, cv);
  const V01 = Math.max(SPIN.minVsrMs, v01), V03 = Math.max(SPIN.minVsrMs, v03);
  const srh01 = Math.max(0, Number(e.srh) || 0), srh03 = Math.max(srh01, Number(e.srh03) || 0);
  const lambda01 = srh01 / (1000 * V01 * V01), lambda03 = srh03 / (3000 * V03 * V03);
  const wPeak = Math.max(0, Number(storm.updraughtMs) || 0);
  const w = profile ? coreMeanW(profile) : wPeak;
  const Rm = profile ? profile.coreM : 1000 * SPIN.coreShare * (2.5 + 0.1 * wPeak);
  // the streamwise share of each layer's spin (relative helicity), from its shear (kt)
  const shear03 = Math.max(1, (Number(e.shear03) || 0) * KT), shear01 = Math.max(1, (Number(e.shear01) || 0) * KT);
  const stream03 = clamp(srh03 / (V03 * shear03), 0, 1), stream01 = clamp(srh01 / (V01 * shear01), 0, 1);
  const zetaTilt = stream03 * lambda03 * w, zetaMid = Math.min(zetaTilt, 2 * w / Rm);
  const Vmid = zetaMid * Rm / 2;
  const lift = 2 * Vmid * Vmid;
  const cin = storm.elevatedFeed ? Infinity : Math.abs(Number(e.sbcin ?? e.cin) || 0);
  const coldK = Math.max(0, (Number(storm.coldPoolTemperatureDeficitF) || 0) / 1.8);
  const cold = G * coldK / 300 * SPIN.outflowDepthM;
  const wLow = Math.sqrt(Math.max(0, lift - 2 * (cin + cold)));
  const zetaLow0 = stream01 * lambda01 * wLow;
  const folds = Math.min(SPIN.stretchEFolds, wLow / 1000 * SPIN.lowRadiusM / V01);
  const zetaLow = Math.min(zetaLow0 * Math.exp(folds), 2 * wLow / SPIN.lowRadiusM);
  return { wCore: w, coreM: Rm, v01, v03, stream01, stream03, lambda01, lambda03, zetaTilt, zetaMid, vMidMs: Vmid, liftWMs: Math.sqrt(lift), cinJkg: cin, coldJkg: cold, wLow, zetaLow0, folds, zetaLow };
}
