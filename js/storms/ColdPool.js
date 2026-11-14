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

// The outflow's speed as a share of the pool's speed (coldPoolSpeedMs), for everything that shows the
// wind in a pool (the radar's velocity, RadarSimulator.js; the frames' ground wind, StormStructure.js).
// A density current's air runs down the pool's slope, from the rain that makes it out to its gust
// front. The pool's depth here is the rain RATE's footprint spread as the pool is, as a share of its
// deepest (the pool is as deep as the rain that evaporated into it: deep under the heavy core and the
// hook, shallow under the forward flank's light rain). A current runs as the square root of its depth
// (C^2 = 2 g' h), and as fast as that only where the depth falls away within the pool's own spreading
// length (slope x spread of 1 or more): so it is fastest just outside the downdraught, about 0.8 of the
// pool's speed, a fifth of it two spreading lengths out, and near calm at the middle of the pool and
// across a broad, level one. None ahead of the front (present: the pool's eased edge, 0 outside it and
// 1 well inside; where the pool is - its extent and coolness - stays the footprint of the rain's
// logarithm). Until 2026-11-13 the wind was only in the eased edge's strip, as fast under the forward
// flank's drizzle as beside the core. From then to 2026-11-14 it was measured against the steepest
// slope anywhere in the pool, which gave half the pool's speed and more wherever the depth sloped at
// all: over a cluster's pool, 30 m/s across tens of kilometres, swamping the wind the radar should show.
export const outflowShare = (present, depth, slope, spread) => (depth > 0 && slope > 0 ? present * Math.sqrt(depth) * Math.min(1, slope * spread) : 0);

// How far a pool's edge is carried by the air it spreads through: a gravity current's front moves at its own
// speed plus HEAD_WIND of the wind along its way (Simpson and Britter 1980), so it runs out fast downwind and
// hardly at all into a wind as fast as itself. The wind here is the storm-relative wind of the lowest kilometre
// (the inflow's), and the pool is moved by HEAD_WIND x that wind x the time it has been spreading - its oldest
// air sets where its edge is. So a supercell's gust front stays beside its hook and forward flank on the side
// its inflow comes from, and runs out behind. Until 2026-11-14 the pool was only left behind by the storm's
// motion (half the spreading time of it): the fine line of an isolated tornadic supercell with 20 m/s of
// inflow stood 20-25 km out into that inflow (seed 23's S0221), where it would have cut the storm off.
export const HEAD_WIND = 0.62;

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
