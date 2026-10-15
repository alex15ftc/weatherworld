// The server's radar network: the radars at the world map's airports and air base
// (js/worldmap/airfields.js), read once from data/worldmap/seed-N/airfields.json (made from the
// seed if missing). WORLD_MAP_SEED picks the map (default 1). WEATHER_RADAR_SITES=generic, or a map
// that can't be read, falls back to the generic seven-radar layout in RadarSimulator.js.
import { loadAirfieldFile, radarLayoutFromAirfields } from '../js/worldmap/airfieldFiles.node.js';
import { createRadarSites } from '../js/radar/RadarSimulator.js';

let layout, failed = false;

export function radarLayout() {
  if (failed || process.env.WEATHER_RADAR_SITES === 'generic') return undefined;
  try {
    layout ??= radarLayoutFromAirfields(loadAirfieldFile(Number(process.env.WORLD_MAP_SEED ?? 1)));
    return layout.length ? layout : undefined;
  } catch (error) {
    failed = true;
    console.warn(`map radars unavailable (${error?.message ?? error}); using the generic radar layout`);
    return undefined;
  }
}

export const radarSitesFor = world => createRadarSites(world, radarLayout());
