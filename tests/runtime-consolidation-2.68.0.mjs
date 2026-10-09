import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';

const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
const config = generateScenario(world, 100000);
const started = performance.now();
initializeEvolution(world, config, { profile: 'gameplay' });
const initializationMs = performance.now() - started;
assert.equal(world.runtime.profile.name, 'gameplay');
assert.deepEqual(Object.keys(world.outlookCycle.products), ['day1'], 'gameplay startup must issue only the compact Day 1 outlook');
assert.equal(world.outlookCycle.products.day1.issuanceMode, 'compact-trajectory');
assert.ok(initializationMs < 5000, `gameplay startup exceeded 5 seconds: ${initializationMs.toFixed(1)}ms`);
assert.equal(world.runtime.profile.stormSubstepsPerHour, 6);
assert.equal(world.evolution.cadence.thermodynamicsHours, 2);
advanceAtmosphere(world, 0.5);
assert.equal(world.validHourUtc, SIMULATION_CONFIG.startHourUtc + 0.5);
assert.ok(world.evolution.performance.phaseSkips.thermodynamics >= 1, 'half-hour gameplay step should skip full sounding recomputation');

const calibration = new Atmosphere(12, 12);
const calibrationConfig = generateScenario(calibration, 100001);
initializeEvolution(calibration, calibrationConfig, { profile: 'calibration' });
assert.equal(calibration.runtime.profile.name, 'calibration');
assert.deepEqual(Object.keys(calibration.outlookCycle.products).sort(), ['day1','day2','day3']);
assert.equal(calibration.runtime.profile.stormSubstepsPerHour, 12);
console.log(`2.68.0 runtime consolidation: PASS (gameplay startup ${initializationMs.toFixed(1)}ms)`);
