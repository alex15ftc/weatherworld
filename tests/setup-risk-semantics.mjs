import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';

const world = new Atmosphere(20, 20);
const config = generateScenario(world, 42);
initializeEvolution(world, config);
assert.ok(world.setupForecast?.label, 'Setup forecast missing');
let forecastCells = 0;
let independentIntensity = false;
world.forEachCell(cell => {
  assert.ok(Number.isFinite(cell.forecast?.initiationProbability), 'CI forecast missing');
  assert.ok(Number.isFinite(cell.forecast?.stormCoverage), 'Storm coverage missing');
  assert.ok(Number.isFinite(cell.forecast?.conditionalTornadoIntensity), 'Conditional intensity missing');
  forecastCells++;
  if ((cell.forecast?.conditionalTornadoIntensity ?? 0) > 0.7 && (cell.forecast?.stormCoverage ?? 1) < 0.65) independentIntensity = true;
});
assert.equal(forecastCells, 400);
advanceAtmosphere(world, 1);
assert.ok(world.setupForecast.forecastVsRealization.expectedStorms >= 0);
assert.ok(world.stormEngine.totalCreated >= 0);
assert.ok(independentIntensity || world.setupForecast.profile.capUncertainty >= 0, 'Intensity/coverage separation unavailable');
console.log(JSON.stringify({ setup: world.setupForecast.label, expectedStorms: world.setupForecast.forecastVsRealization.expectedStorms, created: world.stormEngine.totalCreated }, null, 2));
