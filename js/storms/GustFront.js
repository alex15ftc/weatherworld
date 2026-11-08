// How far a storm's gust front leads it (2026-11-07). Until then the lead was a set share of the
// pool's radius, 0.3-1 of it by how much the outflow dominated (StormGeometry.js).
// The gust front is the edge of the storm's cold pool (ColdPool.js: its deficit and depth from the
// storm's coldPoolStrength), a density current that advances at Fr sqrt(g' h), g' = g dT / T (Fr 0.9,
// of 0.7-1.1 observed and simulated: Benjamin 1968, Simpson and Britter 1979, Bryan and Rotunno 2008),
// through the low-level air ahead of it, while the storm moves on. The pool's depth and deficit are
// those at the downdraught, which feeds it from about the updraught's edge (r0); spreading outward
// from a steady source the current thins, h c r constant, so its front slows as (r0 / L)^(1/3)
// (the axisymmetric constant-flux gravity current, R ~ t^(3/4): Huppert 1982). Along the storm's
// motion, relative to the storm:
//   dL/dt = Fr sqrt(g' h) (r0 / L)^(1/3) + (u_low - storm motion) . along
// u_low the mean of the surface and 850 mb winds. A fast storm outruns its front, which stays close
// to its downdraught (observed supercell forward- and rear-flank gust fronts a few to 20 km from
// the updraught); a slow line's front runs ahead of it. The front is the pool's edge, so it leads by
// no more than the pool's radius (coldPoolRadiusKm), and it is never inside the downdraught, whose
// fresh outflow reaches at least the updraught's edge (smooth minimum and maximum of each).
import { clamp } from '../scenarios/math.js';
import { coldPoolDeficitK, coldPoolDepthM, COLD_POOL_SHAPE } from './ColdPool.js';

const KT = 0.514444, TICK_HOURS = 1 / 12, FROUDE = 0.9, G = 9.81;
const softMax = (a, b, w) => (a + b + Math.sqrt((a - b) ** 2 + w * w)) / 2;
const softMin = (a, b, w) => (a + b - Math.sqrt((a - b) ** 2 + w * w)) / 2;

export function stepGustFront(storm, environment, dtHours) {
  if (!(dtHours > 0)) return;
  const s = clamp(Number(storm.coldPoolStrength) || 0, 0, 1);
  const front = s > 0 ? FROUDE * Math.sqrt(G * coldPoolDeficitK(s) / COLD_POOL_SHAPE.thetaK * coldPoolDepthM(s)) : 0;
  const vE = (storm.velocityKph?.east ?? 0) / 3.6, vN = (storm.velocityKph?.north ?? 0) / 3.6, speed = Math.hypot(vE, vN);
  const sw = environment?.surfaceWind ?? {}, w8 = environment?.wind850 ?? {};
  const uE = 0.5 * ((sw.eastKt ?? 0) + (w8.eastKt ?? 0)) * KT, uN = 0.5 * ((sw.northKt ?? 0) + (w8.northKt ?? 0)) * KT;
  const drift = speed > 0.1 ? ((uE - vE) * vE + (uN - vN) * vN) / speed : 0;
  const inner = Math.max(1, Number(storm.geometry?.updraught?.radiusKm) || 4), outer = Math.max(inner, Number(storm.coldPoolRadiusKm) || inner);
  const steps = Math.max(1, Math.ceil(dtHours / TICK_HOURS - 1e-6)), dtKm = dtHours * 3.6 / steps;
  let lead = Number(storm.gustFrontLeadKm);
  if (!Number.isFinite(lead)) lead = inner;
  for (let i = 0; i < steps; i++) lead = softMax(softMin(lead + (front * Math.cbrt(inner / Math.max(inner, lead)) + drift) * dtKm, outer, 0.5 * inner), inner, 0.5 * inner);
  storm.gustFrontLeadKm = lead;
}
