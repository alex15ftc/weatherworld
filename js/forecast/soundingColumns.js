// What a sounding is made from, kept for every cell of a model run's frame (2026-11-13, the owner's request: the
// live world's soundings are an admin's; the public's come from the model runs). A run keeps finished fields
// (CAPE, shear), not its cells; this keeps the few numbers of each cell that buildSounding (js/sounding.js) reads,
// as Float32, so a sounding at any point and forecast hour can be made when it is asked for: the same code and
// the same numbers as the run's own fields.
// About 0.3 MB a frame of the 50 x 50 map.
import { buildSounding, diagnoseSoundingDisplay } from '../sounding.js';

const LEVELS = [850, 700, 500, 250];
// Each cell's numbers, in order: how to read one from a cell and how to put it back into a stand-in cell.
const COLUMNS = [
  [c => c.surface.pressure, (c, v) => { c.surface.pressure = v; }],
  [c => c.surface.temperature, (c, v) => { c.surface.temperature = v; }],
  [c => c.surface.dewpoint, (c, v) => { c.surface.dewpoint = v; }],
  [c => c.surface.wind.direction, (c, v) => { c.surface.wind.direction = v; }],
  [c => c.surface.wind.speed, (c, v) => { c.surface.wind.speed = v; }],
  ...LEVELS.flatMap(level => [
    [c => c.levels[level].temperature, (c, v) => { c.levels[level].temperature = v; }],
    [c => c.levels[level].windDirection, (c, v) => { c.levels[level].windDirection = v; }],
    [c => c.levels[level].windSpeed, (c, v) => { c.levels[level].windSpeed = v; }],
    // (moisture aloft where the cell carries it; without, the sounding infers it from the ground's)
    [c => c.levels[level].dewpoint, (c, v) => { if (Number.isFinite(v)) c.levels[level].dewpoint = v; }]
  ]),
  [c => c.terrain.elevationM, (c, v) => { c.terrain.elevationM = v; }],
  // The low-level jet's nose, the elevated mixed layer, and what the tornado parameter's large-scale support reads.
  [c => c.jetNose?.heightAglM, (c, v) => { if (Number.isFinite(v)) (c.jetNose ??= {}).heightAglM = v; }],
  [c => c.jetNose?.windSpeed, (c, v) => { if (Number.isFinite(v)) (c.jetNose ??= {}).windSpeed = v; }],
  [c => c.jetNose?.windDirection, (c, v) => { if (Number.isFinite(v)) (c.jetNose ??= {}).windDirection = v; }],
  [c => c.features?.emlInfluence, (c, v) => { if (Number.isFinite(v)) c.features.emlInfluence = v; }],
  [c => c.features?.emlBaseExcessC, (c, v) => { if (Number.isFinite(v)) c.features.emlBaseExcessC = v; }],
  [c => c.features?.synopticAscent, (c, v) => { if (Number.isFinite(v)) c.features.synopticAscent = v; }],
  [c => c.features?.synopticCoherence, (c, v) => { if (Number.isFinite(v)) c.features.synopticCoherence = v; }],
  [c => (c.features?.warmSector ? 1 : 0), (c, v) => { c.features.warmSector = v > 0.5; }],
  [c => c.mesoscaleFields?.ascent, (c, v) => { if (Number.isFinite(v)) c.mesoscaleFields.ascent = v; }],
  [c => c.mesoscaleFields?.moisturePooling, (c, v) => { if (Number.isFinite(v)) c.mesoscaleFields.moisturePooling = v; }],
  [c => c.mesoscaleFields?.capErosion, (c, v) => { if (Number.isFinite(v)) c.mesoscaleFields.capErosion = v; }]
];
export const COLUMN_COUNT = COLUMNS.length;

// Every cell's numbers of a world, row by row.
export function packColumns(world) {
  const values = new Float32Array(world.width * world.height * COLUMN_COUNT);
  world.forEachCell((cell, x, y) => {
    const at = (y * world.width + x) * COLUMN_COUNT;
    for (let k = 0; k < COLUMN_COUNT; k++) { const v = Number(COLUMNS[k][0](cell)); values[at + k] = Number.isFinite(v) ? v : NaN; }
  });
  return { width: world.width, height: world.height, values };
}

// A stand-in for the cell at (row, column), with what a sounding reads; null outside the map.
export function cellOf(packed, row, column) {
  const r = Number(row), c = Number(column);
  if (!packed || !Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= packed.height || c >= packed.width) return null;
  const cell = { surface: { wind: {} }, levels: Object.fromEntries(LEVELS.map(level => [level, {}])), terrain: {}, features: {}, mesoscaleFields: {} };
  const at = (r * packed.width + c) * COLUMN_COUNT;
  for (let k = 0; k < COLUMN_COUNT; k++) COLUMNS[k][1](cell, packed.values[at + k]);
  return cell;
}

// The sounding at a cell as the pages draw it: the profile and its figures, with the table values a forecaster
// reads off it. more: what the caller knows besides (the valid hour, the run, the place).
export function soundingAnswer(cell, more = {}) {
  if (!cell) return null;
  const sounding = buildSounding(cell);
  return { ...sounding, display: diagnoseSoundingDisplay(sounding, cell.terrain.elevationM), context: { surface: { temperatureF: cell.surface.temperature, dewpointF: cell.surface.dewpoint } }, ...more };
}
