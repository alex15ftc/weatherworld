import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../js/evolution.js';
import { projectBoundaryInfluence } from '../js/mesoscale/MesoscaleEngine.js';
import { diagnoseBoundaries } from '../js/diagnostics/boundaryDiagnosis.js';
import { applyStormFeedback } from '../js/storms/StormEngine.js';

const world = new Atmosphere(50, 50);
// Seed 5 is a mature dryline cyclone with authoritative surface boundaries.
// Front-free upslope setups are valid and should not be used as this fixture.
const config = generateScenario(world, 5);
initializeEvolution(world, config);
assert.ok(world.mesoscale.boundaries.length > 0, 'Expected initialized boundary objects');

for (const cell of world.cells.flat()) {
  if (cell.features.primaryBoundaryId) {
    assert.ok(cell.features.boundaryObjectIds.includes(cell.features.primaryBoundaryId), 'Projected boundary ID is inconsistent');
  }
}

const first = world.mesoscale.boundaries[0];
for (const point of first.pointsKm) { point.x += 180; point.y += 40; }
projectBoundaryInfluence(world, 0);
diagnoseBoundaries(world);
for (const cell of world.cells.flat()) {
  if (cell.features.primaryBoundaryId) {
    assert.ok(cell.features.boundaryObjectIds.includes(cell.features.primaryBoundaryId), 'Reprojected boundary ID is inconsistent');
  }
}

const targetX = 20, targetY = 20;
const target = world.getCell(targetX, targetY);
const beforeT = target.surface.temperature;
const beforeTd = target.surface.dewpoint;
world.storms = [{
  active: true,
  intensity: 0.9,
  coldPoolStrength: 0.8,
  positionKm: { x: (targetX + 0.5) * world.cellSizeKm, y: (targetY + 0.5) * world.cellSizeKm }
}];
world.stormEngine = world.stormEngine ?? {};
applyStormFeedback(world, 1);
assert.ok(target.surface.temperature < beforeT, 'Storm feedback did not cool processed air');
assert.ok(target.surface.dewpoint < beforeTd, 'Storm feedback did not modify moisture');
assert.ok(target.features.stormProcessedAir > 0, 'Storm stabilization field missing');
assert.equal(world.stormEngine.feedbackApplied, true, 'Feedback flag not set');

console.log(JSON.stringify({
  boundaries: world.mesoscale.boundaries.length,
  stormCoolingF: Number((beforeT - target.surface.temperature).toFixed(3)),
  stormDryingF: Number((beforeTd - target.surface.dewpoint).toFixed(3))
}, null, 2));
