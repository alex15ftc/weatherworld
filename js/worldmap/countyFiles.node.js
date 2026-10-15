// The county files the forecast products read: counties.u16 (the county number of each map
// cell) and counties.json (the counties, the regions' place names and the towns, each with its
// county), and the NWS offices whose county warning areas they make up. Written with the rest of
// the map by scripts/build-world-map.mjs; the server reads them
// (and makes them from the seed if the map was never built).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorldMap, REGIONS } from './WorldMapGenerator.js';

export const countyDir = seed => fileURLToPath(new URL(`../../data/worldmap/seed-${seed}`, import.meta.url));

export function countyFileData(map) {
  const { counties } = map, n = map.size, c = map.cellMiles;
  const countyOf = (x, y) => counties.ids[Math.min(n - 1, Math.floor(y / c)) * n + Math.min(n - 1, Math.floor(x / c))];
  // The farm country along the trunk river takes its name from the river (as the Missouri's does).
  const trunk = [...map.rivers].sort((a, b) => b.mouthDrainageMi2 - a.mouthDrainageMi2)[0];
  const valley = trunk ? `${trunk.name.replace(/ River$/, '')} Valley` : 'Lower Valley';
  const labels = { highPlains: 'High Plains', smokyHills: 'Smoky Hills', sandhills: 'Sandhills', redHills: 'Red Hills', flintHills: 'Flint Hills', midwest: valley, ozarkEdge: 'Ozark Border' };
  return {
    seed: map.params.seed, size: counties.size, cellMiles: counties.cellMiles, miles: n * c,
    regions: REGIONS.map(r => ({ key: r.key, name: r.name, label: labels[r.key] ?? r.name })), counties: counties.list,
    // The NWS offices and their county warning areas (warningAreas.js; each county carries its office).
    offices: map.offices ?? [],
    towns: map.settlements.map(t => ({ name: t.name, kind: t.kind, x: Math.round(t.x * 100) / 100, y: Math.round(t.y * 100) / 100, population: t.population, county: countyOf(t.x, t.y) }))
  };
}

export function writeCountyFiles(map, out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'counties.u16'), Buffer.from(map.counties.ids.buffer));
  writeFileSync(path.join(out, 'counties.json'), JSON.stringify(countyFileData(map)));
}

// The county data for a seed: counties.json with `ids`. Made (and written) from the seed when
// the files are not there (or predate the offices), which takes some seconds.
export function loadCountyFiles(seed = 1, dir = countyDir(seed)) {
  const json = path.join(dir, 'counties.json'), raw = path.join(dir, 'counties.u16');
  if (!existsSync(json) || !existsSync(raw)) writeCountyFiles(generateWorldMap({ seed, streets: false }), dir);
  let data = JSON.parse(readFileSync(json, 'utf8'));
  if (!data.offices) { writeCountyFiles(generateWorldMap({ seed, streets: false }), dir); data = JSON.parse(readFileSync(json, 'utf8')); }
  const bytes = readFileSync(raw);
  return { ...data, ids: new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
}
