// The airfields file: airfields.json (the airports, NWS offices and air base of airfields.js, and
// the weather radars at them). Written with the rest of the map by scripts/build-world-map.mjs;
// the server reads it to place its radars (and makes it from the seed if the map was never built).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateWorldMap } from './WorldMapGenerator.js';
import { countyDir } from './countyFiles.node.js';

export function writeAirfieldFile(map, out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'airfields.json'), JSON.stringify({ seed: map.params.seed, miles: map.size * map.cellMiles, airfields: map.airfields, radars: map.radars }));
}

export function loadAirfieldFile(seed = 1, dir = countyDir(seed)) {
  const file = path.join(dir, 'airfields.json');
  if (!existsSync(file)) writeAirfieldFile(generateWorldMap({ seed, streets: false }), dir);
  return JSON.parse(readFileSync(file, 'utf8'));
}

// The radar network as createRadarSites (js/radar/RadarSimulator.js) takes it: each radar's place
// as a share of the map's width and height, which the weather's domain spans.
export function radarLayoutFromAirfields(data) {
  return data.radars.map(r => ({ id: r.id, name: r.name, fx: r.x / data.miles, fy: r.y / data.miles, operator: r.operator, airfield: r.airfield }));
}
