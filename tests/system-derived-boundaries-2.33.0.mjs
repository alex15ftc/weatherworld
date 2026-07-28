import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { projectBoundaryInfluence } from '../js/mesoscale/MesoscaleEngine.js';

const world = new Atmosphere(50, 40);
const config = generateScenario(world, 5);
initializeEvolution(world, config);

assert.deepEqual(
  world.mesoscale.boundaries.map(boundary => boundary.type).sort(),
  ['cold', 'dryline', 'warm'],
  'mature cyclone should diagnose three distinct environmental gradients'
);
assert.ok(world.mesoscale.topology.triplePointKm, 'triple point should be diagnosed from collocated gradients');

const cold = world.mesoscale.boundaries.find(boundary => boundary.type === 'cold');
assert.ok(regressionDxPerDy(cold.pointsKm) < 0, 'classic cold front should trail southwest from the cyclone');

const before = world.cells.flat().map(cell => ({
  temperature: cell.surface.temperature,
  dewpoint: cell.surface.dewpoint,
  windSpeed: cell.surface.wind.speed,
  windDirection: cell.surface.wind.direction
}));
projectBoundaryInfluence(world, 1);
world.cells.flat().forEach((cell, index) => {
  assert.equal(cell.surface.temperature, before[index].temperature, 'derived boundary changed temperature');
  assert.equal(cell.surface.dewpoint, before[index].dewpoint, 'derived boundary changed dewpoint');
  assert.equal(cell.surface.wind.speed, before[index].windSpeed, 'derived boundary changed wind speed');
  assert.equal(cell.surface.wind.direction, before[index].windDirection, 'derived boundary changed wind direction');
});

advanceAtmosphere(world, 6, { advanceStorms: false });
assert.ok(world.mesoscale.topology.triplePointKm, 'evolving system lost its diagnosed triple point');
assert.ok(
  regressionDxPerDy(world.mesoscale.boundaries.find(boundary => boundary.type === 'cold').pointsKm) < 0,
  'evolved cold front lost its southwest-trailing geometry'
);

console.log('System-derived boundaries passed: gradients are authoritative, non-causal, and triple-point capable.');

function regressionDxPerDy(points) {
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  return points.reduce((sum, point) => sum + (point.y - meanY) * (point.x - meanX), 0)
    / Math.max(1, points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0));
}
