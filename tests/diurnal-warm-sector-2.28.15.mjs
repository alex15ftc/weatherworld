import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { applyDiurnalAdjustment } from '../js/evolution.js';

const world = new Atmosphere(20, 20);
world.validHourUtc = 12;
generateScenario(world, 48146082);
const warmCells = [];
world.forEachCell(cell => { if (cell.features?.warmSector) warmCells.push(cell); });
assert.ok(warmCells.length > 0, 'seed should contain a warm sector');
const mean = key => warmCells.reduce((sum, cell) => sum + Number(cell.surface[key] || 0), 0) / warmCells.length;
const morningMeanTemperature = mean('temperature');
const morningMaximumTemperature = Math.max(...warmCells.map(cell => cell.surface.temperature));
for (let hour = 12.5; hour <= 24; hour += 0.5) applyDiurnalAdjustment(world, hour, 0.5);
const eveningMeanTemperature = mean('temperature');
assert.ok(eveningMeanTemperature > morningMeanTemperature + 2.5,
  `warm sector should build through the day (${morningMeanTemperature.toFixed(1)} -> ${eveningMeanTemperature.toFixed(1)} F)`);
assert.ok(morningMaximumTemperature < 86,
  `12Z warm-sector maximum should not initialize fully heated (${morningMaximumTemperature.toFixed(1)} F)`);
assert.ok(warmCells.some(cell => Number(cell.derived?.diagnostics?.energyBudget?.preConvectiveRecovery) > 0),
  'energy budget should record pre-convective recovery');
console.log('2.28.15 diurnal warm-sector regression passed');
