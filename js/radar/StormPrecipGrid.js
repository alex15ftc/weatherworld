// Each storm's rain and hail near the ground, as a small grid the game draws its rain and hail
// shafts from and sets the rain and hail at the player by (server/GameFeed.js puts it in each
// storm's appearance as `precip`). Nothing here is drawn or decided from a storm's kind: the
// grid is the radar's own field (PrecipitationField.js, read the way RadarSimulator.js reads it),
// worked out a little coarser so it can be done for every storm each storm tick.
//
//   precip = {
//     cellKm, cols, rows       fixed, so the game can blend one frame's grid into the next
//     xKm, yKm                 the grid's centre on the map (km east, south), the middle of the
//                              storm's low-level echo kept within reach of its centre
//     dbz   [rows * cols]      reflectivity (dBZ, whole numbers) PRECIP_GRID.lowM above the ground,
//                              0 below PRECIP_GRID.leastDbz; row-major, the first row northernmost
//                              (smallest y), each row west to east
//     hailIn [rows * cols]     expected hail size (MESH, inches to a tenth): the most of the columns
//                              over the cell, as RadarSimulator.js works MESH out
//     snow  [rows * cols]      share of the precipitation that is snow (tenths), only when any is
//     maxDbz                   the strongest echo in the columns over the grid's echoing cells
//     freezingLevelM           height of the freezing level above the ground where the storm is
//   }
// A storm with no echo of leastDbz near the ground has precip = null.
import { radarSceneInputs, buildStormEcho, precipitationEcho, meshInches } from './RadarSimulator.js';
import { PRECIP_LEVELS_M } from './PrecipitationField.js';

export const PRECIP_GRID = Object.freeze({
  cols: 20, rows: 20, cellKm: 2,
  lowM: 250, leastDbz: 15,
  // Columns are looked up through only where the echo near the ground is this strong (hail and
  // the strongest echo aloft stand over a core).
  columnDbz: 30,
  // Points averaged across each cell, each way.
  perCell: 2,
  // The storm's centre stays at least this far inside the grid's edge (km), so the updraught,
  // hook, rear flank and wall cloud are always on it however far the forward flank pulls the
  // middle of the echo away.
  edgeKm: 10,
  // The coarser field: one particle in 8 followed, cells no finer than 1.5 km, no inner grid and
  // no debris (PrecipitationField.js): about a seventh of the radar's work, 5-10 ms for a mature
  // storm. Its peaks are a little lower (MESH 0.1-0.3 in less than the full field's on seed 8181).
  echo: Object.freeze({ stride: 8, leastResKm: 1.5, fine: false, debris: false })
});

const r1 = v => Math.round(v * 10) / 10;
const dbzOf = z => (z > 0 ? 10 * Math.log10(z) : -99);

// Map of storm id -> precip block (or null) for every active storm with a structure.
export function buildStormPrecipGrids(world, settings = PRECIP_GRID) {
  const out = new Map();
  if (!(world.storms ?? []).some(storm => storm.active !== false && storm.structure)) return out;
  for (const input of radarSceneInputs(world).storms) out.set(input.storm.id, stormPrecipGrid(input, settings));
  return out;
}

// One storm (an entry of radarSceneInputs(world).storms).
export function stormPrecipGrid(input, settings = PRECIP_GRID) {
  const echo = buildStormEcho(input, settings.echo);
  if (!echo?.grid) return null;
  const { cols, rows, cellKm, lowM, leastDbz, columnDbz, perCell, edgeKm } = settings, fz = input.freezing;
  const sample = { zh: 0, zv: 0, cc: 0, hail: 0 };
  const lowZ = (dx, dy) => { sample.zh = 0; const snow = precipitationEcho(echo, fz, dx, dy, lowM, sample); return { z: sample.zh, snow }; };
  // The middle of the low-level echo (weighted by Z, so the cores count most), on a lattice a cell apart.
  const least = 10 ** (leastDbz / 10);
  let sx = 0, sy = 0, sw = 0;
  for (let dy = Math.ceil(echo.minY / cellKm) * cellKm; dy <= echo.maxY; dy += cellKm) for (let dx = Math.ceil(echo.minX / cellKm) * cellKm; dx <= echo.maxX; dx += cellKm) {
    const { z } = lowZ(dx, dy);
    if (z >= least) { sx += z * dx; sy += z * dy; sw += z; }
  }
  if (!(sw > 0)) return null;
  const halfX = cols * cellKm / 2, halfY = rows * cellKm / 2;
  const cx = Math.max(-(halfX - edgeKm), Math.min(halfX - edgeKm, sx / sw)), cy = Math.max(-(halfY - edgeKm), Math.min(halfY - edgeKm, sy / sw));
  const n = cols * rows, dbz = new Array(n).fill(0), hailIn = new Array(n).fill(0), snow = new Array(n).fill(0);
  const levels = PRECIP_LEVELS_M.length, heights = Float64Array.from(PRECIP_LEVELS_M), column = new Float64Array(levels);
  let maxDbz = -99, anySnow = false, anyEcho = false;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x0 = cx - halfX + i * cellKm, y0 = cy - halfY + j * cellKm, at = j * cols + i;
    let z = 0, snowZ = 0;
    for (let b = 0; b < perCell; b++) for (let a = 0; a < perCell; a++) {
      const s = lowZ(x0 + (a + 0.5) * cellKm / perCell, y0 + (b + 0.5) * cellKm / perCell);
      z += s.z; snowZ += s.z * s.snow;
    }
    const low = dbzOf(z / (perCell * perCell));
    if (low < leastDbz) continue;
    anyEcho = true;
    dbz[at] = Math.round(low);
    const share = snowZ / z;
    if (share >= 0.05) { snow[at] = r1(share); anySnow = true; }
    maxDbz = Math.max(maxDbz, low);
    if (low < columnDbz) continue;
    // The columns over the cell: the strongest echo, and the largest hail they imply.
    let mesh = 0;
    for (let b = 0; b < perCell; b++) for (let a = 0; a < perCell; a++) {
      const mx = x0 + (a + 0.5) * cellKm / perCell, my = y0 + (b + 0.5) * cellKm / perCell;
      for (let k = 0; k < levels; k++) { sample.zh = 0; precipitationEcho(echo, fz, mx, my, heights[k], sample); column[k] = sample.zh; if (sample.zh > 0) maxDbz = Math.max(maxDbz, dbzOf(sample.zh)); }
      mesh = Math.max(mesh, meshInches(heights, column, levels, fz, input.minus20));
    }
    hailIn[at] = r1(mesh);
  }
  if (!anyEcho) return null;
  const precip = { cellKm, cols, rows, xKm: Math.round((input.x + cx) * 100) / 100, yKm: Math.round((input.y + cy) * 100) / 100, dbz, hailIn };
  if (anySnow) precip.snow = snow;
  precip.maxDbz = Math.round(maxDbz);
  precip.freezingLevelM = Math.round(fz);
  return precip;
}
