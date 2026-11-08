// One cold pool (E2, docs/research/ENGINE-MODEL-COUPLING.md). A storm's coldPoolStrength (0-1: its
// rain evaporating in the dry air below cloud, StormBudgets.js) is the only cold-pool state. Its
// depth, temperature deficit and gust-front speed all come from it, tied together by the
// density-current speed C = sqrt(2 g h dTheta / Theta) (Benjamin 1968; Rotunno, Klemp and Weisman
// 1988), so the storm modes, the gust surge, the RKW balance, the maintenance lift and the cloud
// model all see the same pool.
//   speed   SPEED_MS x sqrt(strength): the speed the storm-mode ranges were calibrated on
//   depth   DEPTH_M[0] + DEPTH_M[1] x strength, within DEPTH_RANGE_M (0.5-2.4 km)
//   deficit what that speed needs at that depth: C^2 Theta / (2 g h), so about 2 K for a weak
//           pool, 5 K at the storms' median strength and 9 K at full strength (real outflows 2-10 K)
// Before E2 the deficit had its own formula (from intensity and cloud-base height) and was about
// half this (seeds 1-8, 10 days: median 2.3 K), so the deficit-based speed ran 30-40% under SPEED_MS.
import { clamp } from '../scenarios/math.js';

export const COLD_POOL_SHAPE = Object.freeze({ speedMs: 38, depthM: [500, 1900], depthRangeM: [400, 2600], thetaK: 300, minDeficitK: 0.2 });
const G = 9.81;
const share = strength => clamp(Number(strength) || 0, 0, 1);

export const coldPoolSpeedMs = strength => COLD_POOL_SHAPE.speedMs * Math.sqrt(share(strength));
export const coldPoolDepthM = strength => clamp(COLD_POOL_SHAPE.depthM[0] + COLD_POOL_SHAPE.depthM[1] * share(strength), COLD_POOL_SHAPE.depthRangeM[0], COLD_POOL_SHAPE.depthRangeM[1]);
export const coldPoolDeficitK = strength => Math.max(COLD_POOL_SHAPE.minDeficitK, coldPoolSpeedMs(strength) ** 2 * COLD_POOL_SHAPE.thetaK / (2 * G * coldPoolDepthM(strength)));
// The depth of the pool that is this many K cold (the inverse of the two above, by bisection on the
// strength): the atmosphere's rain-cooled air keeps the depth a storm's pool of its coldness has
// (RegionalAtmosphere.js: its spreading speed, the sun's warming of it and its mesohigh).
export function coldPoolDepthForDeficitK(deficitK) {
  if (!(deficitK > 0)) return 0;
  if (deficitK >= coldPoolDeficitK(1)) return coldPoolDepthM(1);
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (coldPoolDeficitK(mid) < deficitK) low = mid; else high = mid; }
  return coldPoolDepthM((low + high) / 2);
}
