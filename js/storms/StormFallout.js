// Where a storm's rain and hail reach the ground, worked out from its fall-out rather than placed by
// rule (docs/research/ENGINE-PHYSICS-PLAN.md, Phase 2 step 3). The particles are the radar's own
// (PrecipitationField.js): precipitation of each size made in the storm's central updraught, carried
// up as far as the updraught can hold it, and falling through the storm-relative wind of its column
// (StormColumn.js) and round its mesocyclone. Here one particle in FALLOUT_STRIDE is followed, with
// the updraught's output held steady (no pulses), and only where each reaches the ground is kept: the
// mass-weighted centre of the rain that leaves the updraught as graupel (the core; the snow's light rain
// far ahead is left out) and of the largest precipitation (hail and drops of 4 mm and more), and the
// rain's spread. StormGeometry places the rain and hail cores there, so the cores, the hail
// swaths reported from them and the radar's picture of the storm agree.
// Measured 2026-11-07 (3 seeds x 2 days, supercells): the radar field's own ground rain centre lies
// 13 km (5-19 km) from the updraught and ahead of it; the older rule, 0.3 h of the 500 mb storm-relative
// wind, put it 7 km away and to the right, missing the radar's by 7 km. The low-level inflow carries
// rain back toward the updraught; the fall-out from 8-12 km, carried by the winds up to 250 hPa, takes
// it out. About 1 ms a supercell, once a storm tick.
import { PHYSICS, WIND_PROFILE_STEP_M, WIND_PROFILE_LEVELS, updraughts, follow, hashString } from './PrecipitationField.js';
import { stormColumnOf } from './StormColumn.js';

const FALLOUT_STRIDE = 15, DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const kept = new WeakMap();   // storm -> { column, ageHours, xKm, yKm, result }

// The storm's fall-out on the ground now (see falloutMoments), kept for the storm tick: null where
// the storm has no column (StormColumn.js).
export function stormFallout(storm, updraught) {
  const column = stormColumnOf(storm);
  if (!column) return null;
  const k = kept.get(storm);
  if (k && k.column === column && k.ageHours === storm.ageHours && k.xKm === updraught.xKm && k.yKm === updraught.yKm) return k.result;
  const result = falloutMoments(storm, updraught, column);
  kept.set(storm, { column, ageHours: storm.ageHours, xKm: updraught.xKm, yKm: updraught.yKm, result });
  return result;
}

// updraught: StormGeometry's (xKm, yKm, radiusKm, baseM); column as for buildStormPrecipitation.
// Returns, in km from the storm's position (x east, y south), the mass-weighted centre of the rain
// (rain) and of the largest precipitation (large: hail and drops of 4 mm or more; null with none), each
// with its spread along its long axis and across it (alongKm, acrossKm: twice the standard deviation)
// and that axis's bearing (degrees clockwise from north); or null while none has reached the ground.
export function falloutMoments(storm, updraught, column) {
  const theta = (Number(storm.orientationDeg) || 0) * DEG;
  const mx = Math.sin(theta), my = Math.cos(theta), rx = -my, ry = mx;
  const toMap = (a, b) => ({ x: a * mx + b * rx, y: a * my + b * ry });
  const updraughtAt = { x: updraught.xKm - storm.positionKm.x, y: updraught.yKm - storm.positionKm.y };
  // (the mesocyclone as StormStructureEngine describes it: at the storm's position, its radius a share of the updraught's)
  const low = clamp(Number(storm.lowRotationFree ?? storm.lowRotation) || 0, 0, 1.2), meso = clamp(Number(storm.mesocycloneStrength ?? storm.rotationStrength) || 0, 0, 1.25);
  const environment = storm.environment ?? {};
  const model = {
    mx, my, rx, ry, topM: column.topM, freezingM: column.freezingM, su: column.su, sv: column.sv,
    baseM: clamp(Number(updraught.baseM) || 1200, 300, 4000),
    ageS: Math.min(PHYSICS.longestS, (Number(storm.ageHours) || 0) * 3600),
    seed: hashString(String(storm.id ?? 'storm')), spin: storm.leftMover ? -1 : 1,
    mesocyclone: { x: 0, y: 0, aloftX: updraughtAt.x, aloftY: updraughtAt.y, radiusKm: clamp(0.4 * updraught.radiusKm, 1.5, 4), vmaxMs: 6 + 30 * Math.max(meso, low), low: clamp(low, 0, 1) },
    tornado: null, coldPool: clamp(Number(storm.coldPoolStrength) || 0, 0, 1.2), rearInflow: 0, updraughtAt, frontToRear: 0
  };
  model.dryBelow = clamp(0.5 * (model.baseM - 400) / 1600 + 0.5 * (Number(environment.dcape) || 600) / 1200, 0.05, 1.2);
  model.dryAloft = clamp((Number(environment.dcape) || 600) / 1200, 0.1, 1.2);
  // (the central updraught alone, whatever share of a line the storm is: StormGeometry blends a line's older placing in)
  model.sources = updraughts(storm, { features: [] }, { updraught }, model, 0, toMap);
  if (!model.sources.length) return null;
  for (const source of model.sources) source.pulse = 0;
  const inflowLevels = Math.round(PHYSICS.inflowM / WIND_PROFILE_STEP_M);
  model.inflowU = 0; model.inflowV = 0;
  for (let k = 0; k <= inflowLevels; k++) { model.inflowU += column.su[k] / (inflowLevels + 1); model.inflowV += column.sv[k] / (inflowLevels + 1); }
  model.mesoDepth = Float32Array.from({ length: WIND_PROFILE_LEVELS }, (_, k) => (0.55 + 0.45 * Math.exp(-(((k * WIND_PROFILE_STEP_M - 4500) / 2600) ** 2))) * (k * WIND_PROFILE_STEP_M > column.topM ? 0.2 : 1));
  const sum = () => ({ n: 0, x: 0, y: 0, xx: 0, yy: 0, xy: 0 });
  const rain = sum(), large = sum(), none = [], onlyRain = [rain], both = [rain, large], onlyLarge = [large];
  // (the rain's core is the graupel's melted rain: the snow that leaves the updraught near its top drifts
  // for an hour and falls as the light rain spread far ahead of the core, which the core's extents cover)
  follow(model, null, null, FALLOUT_STRIDE, { skip: cls => cls.snow, kinds: (isHail, mm) => isHail ? onlyLarge : mm >= 4 ? both : mm > 0 ? onlyRain : none });
  const r = shape(rain);
  return r ? { rain: r, large: shape(large) } : null;
}

function shape(m) {
  if (!(m.n > 0)) return null;
  const x = m.x / m.n, y = m.y / m.n, sxx = Math.max(0, m.xx / m.n - x * x), syy = Math.max(0, m.yy / m.n - y * y), sxy = m.xy / m.n - x * y;
  const half = (sxx + syy) / 2, d = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy)), angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // (the long axis's bearing: x east, y south, so north is -y)
  return { x, y, alongKm: 2 * Math.sqrt(half + d), acrossKm: 2 * Math.sqrt(Math.max(0, half - d)), bearingDeg: (Math.atan2(Math.cos(angle), -Math.sin(angle)) / DEG + 360) % 180 };
}
