// The world map generator: the same seed gives the same map; water runs downhill along every
// river; the map's 10-mile averages stay on the weather engine's slope; and every region,
// settlement kind and interstate turns up.
import assert from 'node:assert/strict';
import { generateWorldMap, describeWorldMap, engineTerrainM, REGIONS } from '../js/worldmap/WorldMapGenerator.js';

const small = { miles: 500, cellMiles: 1, erosionSteps: 12 };
const map = generateWorldMap({ seed: 3, ...small });
const again = generateWorldMap({ seed: 3, ...small });
assert.deepEqual(again.elevation, map.elevation, 'the same seed gives the same ground');
assert.deepEqual(again.settlements.map(s => s.name), map.settlements.map(s => s.name), 'and the same towns');
assert.notDeepEqual(generateWorldMap({ seed: 4, ...small }).elevation, map.elevation, 'another seed gives other ground');

const n = map.size, at = (x, y) => map.elevation[Math.floor(y / map.cellMiles) * n + Math.floor(x / map.cellMiles)];
for (const river of map.rivers) {
  for (let s = 2; s < river.points.length; s += 2) assert.ok(at(river.points[s], river.points[s + 1]) <= at(river.points[s - 2], river.points[s - 1]) + 1e-3, 'rivers run downhill');
}

const summary = describeWorldMap(map);
assert.ok(summary.engineMatch.meanAbsM < 25 && summary.engineMatch.worstM < 80, `the map keeps to the engine's slope (mean ${summary.engineMatch.meanAbsM.toFixed(1)} m, worst ${summary.engineMatch.worstM.toFixed(1)} m)`);
assert.ok(engineTerrainM(0) > engineTerrainM(250) && engineTerrainM(250) >= engineTerrainM(499), 'the engine slope falls to the east');
assert.equal(new Set(map.region).size, REGIONS.length, 'every region is on the map');

const kinds = new Set(map.settlements.map(s => s.kind));
for (const kind of ['metro', 'city', 'smallCity', 'town']) assert.ok(kinds.has(kind), `a ${kind} is placed`);
assert.ok(map.roads.filter(r => r.kind === 'interstate').length >= 3 && map.roads.some(r => r.kind === 'highway'), 'interstates and highways are laid');
const metro = map.settlements.find(s => s.kind === 'metro');
assert.ok(map.roads.filter(r => r.kind === 'interstate').every(r => r.points.some(([x, y]) => Math.hypot(x - metro.x, y - metro.y) < 3) || r.name === 'I-135'), 'the interstates meet at the metro');

console.log(`world map passed (${map.rivers.length} rivers, ${map.settlements.length} settlements, slope match ±${summary.engineMatch.meanAbsM.toFixed(1)} m)`);
