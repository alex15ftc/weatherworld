// The column of air a storm's rain falls through: the wind relative to the storm every
// WIND_PROFILE_STEP_M, its top and its freezing level, worked out once each storm tick
// (StormEngine) for StormGeometry to place the storm's rain and hail cores from (StormFallout.js).
// It is the column the radar builds for the same storm (RadarSimulator.js radarSceneInputs and
// sceneEnv): the cells' surface, 850, 700, 500 and 250 hPa winds and temperatures, interpolated
// between the cells round the storm and in height, so the rain the storm's geometry places and the
// rain the radar shows fall through the same wind. (Kept here rather than imported, as the radar
// keeps its scene to itself; if the radar's column changes, change this with it.)
//
// The column is kept beside the storm, never on it: the storm's own state (snapshots, the game feed,
// the fingerprints) is what it was. A storm without one (a forecast run's, which draws no storm
// pictures, or one copied from elsewhere) is placed by StormGeometry's older rule.
import { WIND_PROFILE_STEP_M, WIND_PROFILE_LEVELS } from './PrecipitationField.js';

const DEG = Math.PI / 180, KT_TO_MS = 0.514444;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const columns = new WeakMap();      // storm -> column
const cellLevels = new WeakMap();   // world -> { key, byCell: Map(cell index -> levels) }

export const stormColumnOf = storm => (storm ? columns.get(storm) ?? null : null);

// Works out the storm's column now (and keeps it for stormColumnOf).
export function updateStormColumn(world, storm) {
  if (!world?.getCell || !storm?.positionKm) return null;
  const cs = world.cellSizeKm, w = world.width, h = world.height, x = storm.positionKm.x, y = storm.positionKm.y;
  // (as the radar's envSample: bilinear between cell centres)
  const gx = clamp(x / cs - 0.5, 0, w - 1), gy = clamp(y / cs - 0.5, 0, h - 1);
  const x0 = Math.min(w - 2, Math.floor(gx)), y0 = Math.min(h - 2, Math.floor(gy)), tx = gx - x0, ty = gy - y0;
  const corners = [[x0, y0, (1 - tx) * (1 - ty)], [x0 + 1, y0, tx * (1 - ty)], [x0, y0 + 1, (1 - tx) * ty], [x0 + 1, y0 + 1, tx * ty]].map(([i, j, k]) => [levelsOf(world, i, j), k]);
  const at = pick => corners.reduce((sum, [c, k]) => sum + pick(c) * k, 0);
  const heights = [0, 1, 2, 3, 4].map(k => at(c => c.h[k])), us = [0, 1, 2, 3, 4].map(k => at(c => c.u[k])), vs = [0, 1, 2, 3, 4].map(k => at(c => c.v[k]));
  const mu = (storm.velocityKph?.east ?? 0) / 3.6, mv = (storm.velocityKph?.north ?? 0) / 3.6;
  const su = new Float32Array(WIND_PROFILE_LEVELS), sv = new Float32Array(WIND_PROFILE_LEVELS);
  for (let n = 0; n < WIND_PROFILE_LEVELS; n++) {
    const z = n * WIND_PROFILE_STEP_M;
    let k = 0;
    while (k < 3 && z > heights[k + 1]) k++;
    const t = clamp((z - heights[k]) / Math.max(1, heights[k + 1] - heights[k]), 0, 1);
    su[n] = us[k] + (us[k + 1] - us[k]) * t - mu; sv[n] = vs[k] + (vs[k + 1] - vs[k]) * t - mv;
  }
  // The echo's top as the radar takes it: the equilibrium level, reached in vigorous storms.
  const updraft = clamp(Math.max(Number(storm.updraftStrength) || 0, (Number(storm.intensity) || 0) * 1.3), 0, 1);
  const column = { topM: at(c => c.top) * (0.6 + 0.48 * updraft), freezingM: at(c => c.freezing), su, sv };
  columns.set(storm, column);
  return column;
}

// One cell's levels (heights above its ground, winds east and north in m/s), its freezing level and
// its equilibrium level, kept until the cells change.
function levelsOf(world, i, j) {
  const key = `${world.cellsVersion ?? ''}|${world.validHourUtc}`;
  let kept = cellLevels.get(world);
  if (!kept || kept.key !== key) { kept = { key, byCell: new Map() }; cellLevels.set(world, kept); }
  const index = j * world.width + i;
  let c = kept.byCell.get(index);
  if (c) return c;
  const cell = world.getCell(i, j), elev = Number(cell.terrain?.elevationM) || 0;
  const wind = level => ({ dir: Number(level?.windDirection) || 0, spd: Number(level?.windSpeed) || 0, t: Number(level?.temperature) });
  const levels = [
    { hMsl: elev + 10, dir: cell.surface.wind.direction, spd: cell.surface.wind.speed, t: (cell.surface.temperature - 32) * 5 / 9 },
    { hMsl: 1500, ...wind(cell.levels[850]) },
    { hMsl: 3010, ...wind(cell.levels[700]) },
    { hMsl: (cell.levels[500].heightDm || 570) * 10, ...wind(cell.levels[500]) },
    { hMsl: (cell.levels[250].heightDm || 1040) * 10, ...wind(cell.levels[250]) }
  ];
  c = { h: [], u: [], v: [], freezing: 4200, top: 11000 };
  let previous = 0;
  for (const level of levels) {
    const hAgl = Math.max(previous + 50, level.hMsl - elev); previous = hAgl;
    c.h.push(hAgl); c.u.push(-Math.sin(level.dir * DEG) * level.spd * KT_TO_MS); c.v.push(-Math.cos(level.dir * DEG) * level.spd * KT_TO_MS);
  }
  let found = false;
  for (let k = 0; k < levels.length - 1 && !found; k++) {
    const a = levels[k].t, b = levels[k + 1].t;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a >= 0 && b < 0) { c.freezing = c.h[k] + (c.h[k + 1] - c.h[k]) * a / (a - b); found = true; }
  }
  if (!found && Number.isFinite(levels[0].t) && levels[0].t < 0) c.freezing = 0;
  const elAgl = Number(cell.derived?.sounding?.elM) - elev;
  c.top = Number.isFinite(elAgl) && elAgl > 0 ? clamp(elAgl, 3000, 16500) : 11000;
  kept.byCell.set(index, c);
  return c;
}
