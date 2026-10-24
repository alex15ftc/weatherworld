// The map's counties for the server's products: read once from the built world map
// (data/worldmap/seed-N, made from the seed if missing) and tied to each world's grid
// (js/forecast/counties.js). WEATHER_COUNTIES=off leaves the products without counties (each
// grid cell then stands alone, as in the tests); WORLD_MAP_SEED picks the map (default 1).
import { loadCountyFiles } from '../js/worldmap/countyFiles.node.js';
import { countyLayer } from '../js/forecast/counties.js';

let data, failed = false;
const layers = new Map();

// The towns and counties a world's reports are made from, as the storm log takes them
// (js/reports/stormLog.js): { layer, milesPerKm }.
export function placesFor(world) {
  const layer = countiesFor(world);
  return { layer, milesPerKm: layer ? layer.miles / (world.width * world.cellSizeKm) : 0.621371 };
}

export function countiesFor(world) {
  if (!world || failed || process.env.WEATHER_COUNTIES === 'off') return null;
  try {
    data ??= loadCountyFiles(Number(process.env.WORLD_MAP_SEED ?? 1));
  } catch (error) {
    failed = true;
    console.warn(`counties unavailable (${error?.message ?? error}); watches and warnings will go without them`);
    return null;
  }
  const key = `${world.width}x${world.height}`;
  if (!layers.has(key)) layers.set(key, countyLayer(data, world.width, world.height));
  return layers.get(key);
}
