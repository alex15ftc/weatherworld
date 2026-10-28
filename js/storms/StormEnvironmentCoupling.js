import { clamp } from '../scenarios/math.js';
import { sampleStormEnvironment, diagnoseStormMotion } from './environmentSampling.js';
import { rotatingShare, lineShare } from './StormModeEngine.js';

// The air a storm ingests: sampled upstream of it along the storm-relative low-level inflow,
// beyond its own rain-cooled outflow (sampling at the storm itself measured its cold pool).
export function sampleEffectiveInflowEnvironment(world, storm) {
  const here = sampleStormEnvironment(world, storm.positionKm.x, storm.positionKm.y);
  const lowLevel = { e: 0.5 * (here.surfaceWind.eastKt + here.wind850.eastKt) * 1.852, n: 0.5 * (here.surfaceWind.northKt + here.wind850.northKt) * 1.852 };
  const relative = { e: lowLevel.e - storm.velocityKph.east, n: lowLevel.n - storm.velocityKph.north };
  const speed = Math.hypot(relative.e, relative.n);
  // Inflow arrives from where the storm-relative wind comes from (screen frame: y south).
  const ux = speed > 0.1 ? -relative.e / speed : 1;
  const uy = speed > 0.1 ? relative.n / speed : 0;
  const offsets = [10, 25, 40], weights = [0.3, 0.4, 0.3];
  const samples = offsets.map(d => sampleStormEnvironment(world, storm.positionKm.x + ux*d, storm.positionKm.y + uy*d));
  const blend = key => samples.reduce((sum, env, i) => sum + (env[key] ?? 0) * weights[i], 0);
  const vectorBlend = key => ({
    eastKt: samples.reduce((sum, env, i) => sum + (env[key]?.eastKt ?? 0) * weights[i], 0),
    northKt: samples.reduce((sum, env, i) => sum + (env[key]?.northKt ?? 0) * weights[i], 0)
  });
  const base = { ...samples[0] };
  for (const key of ['lapseRate01','lapseRate03','cape','cin','srh','stp','rawStp','vtp','synopticTornadoSupport','scp','bulkShear','lcl','readiness','trigger','initiation','forcing','stormCoverage','discreteFraction','linearFraction','warmSector','openWarmSectorSupport','prefrontalSupercellSupport','tornadicEnvironmentSupport','synopticAscent','synopticCoherence','moisturePooling','capErosion','boundaryInfluence','processedAir','outflowConvergence']) base[key] = blend(key);
  // An outflow boundary lying in the inflow, beyond the storm's own rain-cooled air.
  base.outflowContrastK = Math.max(samples[1].outflowContrastK ?? 0, samples[2].outflowContrastK ?? 0);
  // A front in the inflow or under the storm.
  base.densityGradient = Math.max(...samples.map(env => env.densityGradient ?? 0));
  base.moistureGradient = Math.max(...samples.map(env => env.moistureGradient ?? 0));
  base.airMassContrastK = airMassContrast(world, storm.positionKm.x + ux * offsets[0], storm.positionKm.y + uy * offsets[0]);
  base.surfaceWind = vectorBlend('surfaceWind'); base.wind850 = vectorBlend('wind850'); base.wind500 = vectorBlend('wind500');
  base.effectiveInflowSamples = offsets.length; base.effectiveInflowDistanceKm = offsets.at(-1);
  return base;
}

// Which side of an air-mass boundary (a front, or a dryline's denser moist side) the inflow is on, and
// how sharp it is: how much denser (cooler, virtual potential temperature) the inflow's air is than air
// within BOUNDARY_RING_KM[1] of it, or, at BOUNDARY_WARM_SHARE, how much lighter than air within
// BOUNDARY_RING_KM[0]. (2026-10-25: tornadoes form mostly from 10 km on the warm side to 30 km on the
// cool side of a boundary, where the winds back into it and its contrast turns the air; Markowski,
// Rasmussen and Straka 1998, docs/storm-reference/boundaries-qlcs-landspouts-2026-10-25.md.) Storms'
// own rain-cooled air is left out of the field; the edge of another storm's is the outflow contrast.
const BOUNDARY_RING_KM = [16, 32], BOUNDARY_WARM_SHARE = 0.5;
function airMassContrast(world, xKm, yKm) {
  const at = (x, y) => {
    const gx = clamp(x / world.cellSizeKm - 0.5, 0, world.width - 1), gy = clamp(y / world.cellSizeKm - 0.5, 0, world.height - 1);
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(world.width - 1, x0 + 1), y1 = Math.min(world.height - 1, y0 + 1), tx = gx - x0, ty = gy - y0;
    const v = (cx, cy) => Number(world.getCell(cx, cy).features?.airMassDensityK) || 0;
    return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
  };
  const here = at(xKm, yKm);
  if (!here) return 0;
  let cool = 0, warm = 0;
  for (const r of BOUNDARY_RING_KM) for (let a = 0; a < 8; a++) {
    const there = at(xKm + r * Math.cos(a * Math.PI / 4), yKm + r * Math.sin(a * Math.PI / 4));
    if (!there) continue;
    cool = Math.max(cool, there - here);
    if (r === BOUNDARY_RING_KM[0]) warm = Math.max(warm, here - there);
  }
  return Math.max(cool, BOUNDARY_WARM_SHARE * warm);
}

export function updateCoupledStormMotion(world, storm, environment, dtHours) {
  // Storms are not steered by drawn lines: fronts, drylines and cold pools reach them only
  // through the air they draw in and the winds that carry them.
  const target = diagnoseStormMotion({ ...environment, coldPoolPropagation: storm.coldPoolPropagation ?? {east:0,north:0} }, { rotating: rotatingShare(storm), linear: lineShare(storm), leftMover: storm.leftMover, coldPool: storm.coldPoolStrength ?? 0 });
  const responseHours = 0.70 - 0.20 * rotatingShare(storm) - 0.35 * lineShare(storm) * (1 - rotatingShare(storm));
  const blend = clamp(dtHours / responseHours, 0, 1);
  storm.velocityKph.east += (target.east - storm.velocityKph.east) * blend;
  storm.velocityKph.north += (target.north - storm.velocityKph.north) * blend;
}

export function updateStormColdPool(world, storm, environment, dtHours) {
  const linear = lineShare(storm) >= 0.5;
  const dryness = clamp(((environment.lcl ?? 1000)-750)/1700,0,1);
  const targetDeficitF = clamp(1.2 + 8.5*storm.intensity*(0.65 + 0.35*dryness), 0.5, 12);
  storm.coldPoolTemperatureDeficitF ??= 0;
  storm.coldPoolTemperatureDeficitF += (targetDeficitF-storm.coldPoolTemperatureDeficitF)*clamp(dtHours*0.9,0,1);
  const motion = Math.hypot(storm.velocityKph.east, storm.velocityKph.north)||1;
  const propagationSpeed = clamp(5+storm.coldPoolStrength*(linear?28:18),4,34);
  storm.coldPoolPropagation = { east: storm.velocityKph.east/motion*propagationSpeed, north: storm.velocityKph.north/motion*propagationSpeed };
}
