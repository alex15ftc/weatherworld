import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js?v=2.17.0.1';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js?v=2.17.0.1';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js?v=2.17.0.1';

let worldsWithBoundaries = 0;
let movedBoundaries = 0;
for (let seed = 1; seed <= 8; seed++) {
  const world = new Atmosphere(50, 50);
  initializeEvolution(world, generateScenario(world, seed));
  const initial = new Map((world.mesoscale?.boundaries ?? []).map(boundary => [boundary.id, structuredClone(boundary.pointsKm)]));
  assert.ok(Array.isArray(world.mesoscale?.boundaries), 'Mesoscale boundary registry missing');
  if (initial.size) worldsWithBoundaries++;
  advanceAtmosphere(world, 1);
  for (const boundary of world.mesoscale.boundaries) {
    const before = initial.get(boundary.id);
    if (!before) continue;
    assert.ok(boundary.pointsKm.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)), 'Invalid boundary point');
    if (Math.hypot(boundary.pointsKm[0].x - before[0].x, boundary.pointsKm[0].y - before[0].y) > 1) movedBoundaries++;
  }
  const influenced = world.cells.flat().filter(cell => (cell.features?.explicitBoundaryInfluence ?? 0) > 0.05).length;
  if (world.mesoscale.boundaries.length) assert.ok(influenced > 0, 'Boundary objects did not project influence to cells');
}
assert.ok(worldsWithBoundaries >= 3, `Too few worlds with explicit boundaries: ${worldsWithBoundaries}/8`);
assert.ok(movedBoundaries > 0, 'No boundary moved');
console.log(JSON.stringify({ seeds: 8, worldsWithBoundaries, movedBoundaries }, null, 2));
