// The ground the weather is made over, from the world map players see (2026-11-18). The regional layer's own
// ground is a smooth east-west slope (terrainAt); the map carries that slope and its regions' relief, its river
// valleys and the divide (WorldMapGenerator divideM). Here the map's ground is averaged over each of the regional
// layer's cells and given as each cell's departure from the slope (m), rows from the north as the layer's are, so
// the layer stands its cells on the map's ground and its upslope lift, heating and lid source follow the hills.
//
// The Roblox world is always the map of WORLD_MAP_SEED, whatever the weather's seed. Making the map's ground takes
// about 6 s, so for the default grid it is read from engineGroundData.js (scripts/build-engine-ground.mjs writes it;
// tests/engine-ground.mjs checks it against the generator); any other map is made here, once a process.
import { REGIONAL_DEFAULTS } from '../atmosphere/RegionalAtmosphere.js';
import { generateWorldMap, engineTerrainM, WORLD_MAP_DEFAULTS } from './WorldMapGenerator.js';
import { ENGINE_GROUND } from './engineGroundData.js';

export const WORLD_MAP_SEED = 1;
// The world map's options the engine's ground is made with, over its defaults (none: the map's own ground. 2026-11-18
// to 19 the divide was here alone, a trial on the engine before the map was rebuilt with it).
export const ENGINE_MAP_OPTIONS = Object.freeze({});
const cache = new Map();

// Whether the regional layer's grid lies on the map: the same width, cells and place along the geography.
function onMap(rp, mp) {
  const cellMiles = rp.cellKm / 1.609344;
  return Math.abs(rp.columns * cellMiles - mp.miles) < 1e-6 && Math.abs(rp.rows * cellMiles - mp.miles) < 1e-6 && rp.geographyOffset === REGIONAL_DEFAULTS.geographyOffset;
}

// The map's ground over the layer's cells, made from the generator (mapOptions: over the world map's defaults).
export function computeEngineGroundReliefM(regionalParams = REGIONAL_DEFAULTS, mapOptions = {}) {
  const rp = { ...REGIONAL_DEFAULTS, ...regionalParams }, mp = { ...WORLD_MAP_DEFAULTS, seed: WORLD_MAP_SEED, ...ENGINE_MAP_OPTIONS, ...mapOptions };
  if (!onMap(rp, mp)) return null;
  const cellMiles = rp.cellKm / 1.609344, cols = rp.columns, rows = rp.rows;
  const map = generateWorldMap({ ...mp, groundOnly: true }), n = map.size, per = n / cols;
  const relief = new Float64Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let sum = 0, count = 0;
    for (let j = Math.round(y * per); j < Math.round((y + 1) * per); j++) for (let i = Math.round(x * per); i < Math.round((x + 1) * per); i++) { sum += map.elevation[j * n + i]; count++; }
    relief[y * cols + x] = sum / count - engineTerrainM((x + 0.5) * cellMiles, rp);
  }
  return relief;
}

// The same, read from engineGroundData.js where the grid and map are the defaults. Null where the layer's grid is
// not the map's (another size or cell, or moved along the geography).
export function engineGroundReliefM(regionalParams = REGIONAL_DEFAULTS, mapOptions = {}) {
  const rp = { ...REGIONAL_DEFAULTS, ...regionalParams };
  const stored = !Object.keys(mapOptions).length && rp.columns === ENGINE_GROUND.columns && rp.rows === ENGINE_GROUND.rows && rp.cellKm === ENGINE_GROUND.cellKm && rp.geographyOffset === REGIONAL_DEFAULTS.geographyOffset;
  if (stored) return (cache.get('stored') ?? cache.set('stored', Float64Array.from(ENGINE_GROUND.reliefM)).get('stored'));
  const key = JSON.stringify([rp.columns, rp.rows, rp.cellKm, rp.geographyOffset, mapOptions]);
  if (!cache.has(key)) cache.set(key, computeEngineGroundReliefM(rp, mapOptions));
  return cache.get(key);
}
