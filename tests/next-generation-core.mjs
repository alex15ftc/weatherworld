import assert from 'node:assert/strict';
import {
  EnvironmentalGrid, SimulationClock, WeatherSimulationCore,
  buildForecastEnsemble, generateWeatherScenario, matchAnalogEnsemble
} from '../js/core/index.js';

const scenario = generateWeatherScenario({ seed: 42, aggression: .72 });
assert.equal(scenario.causalChain.at(-1), 'convective-initiation');
assert.ok(scenario.environmentalPotential >= scenario.realizationProbability);

const grid = new EnvironmentalGrid();
assert.equal(grid.cellCount, 10_000);
assert.ok(grid.fields.mlcape instanceof Float32Array);

const ensemble = buildForecastEnsemble(scenario, { memberCount: 20, leadHours: 72 });
assert.equal(ensemble.members.length, 20);
assert.equal(matchAnalogEnsemble(scenario).length, 10);
assert.ok(Math.abs(ensemble.analogs.reduce((sum, analog) => sum + analog.weight, 0) - 1) < 1e-9);
assert.ok(ensemble.members.every(member => member.realizationProbability <= member.environmentalPotential));

const clock = new SimulationClock();
const due = clock.advance(20 * 60);
assert.equal(due.synoptic, 1);
assert.equal(due.storms, 240);

const core = new WeatherSimulationCore({ seed: 42, grid: { width: 30, height: 30, cellSizeKm: 10 } });
const forecastBefore = JSON.stringify(core.forecast);
const snapshot = core.advance(30 * 60);
assert.equal(JSON.stringify(core.forecast), forecastBefore, 'truth updates must not rewrite an issued forecast');
assert.equal(snapshot.scenarioId, scenario.id);
assert.ok(snapshot.storms.every(storm => !('environment' in storm)), 'network snapshots stay compact');

console.log('next-generation core tests passed');
