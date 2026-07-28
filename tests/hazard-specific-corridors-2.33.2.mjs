import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../js/evolution.js';
import { updatePredictiveOutlooks } from '../js/forecast/OutlookCycleEngine.js';

const world = new Atmosphere(50, 50);
const config = generateScenario(world, 20270503);
initializeEvolution(world, config);
updatePredictiveOutlooks(world, { force:true });
const product = world.outlookCycle.products.day1;

assert.ok(product.peakForecastHourUtc >= 22.5 && product.peakForecastHourUtc <= 24,
  `surface-based Day-1 peak remained too early (${product.peakForecastHourUtc}Z)`);
assert.ok(product.grid.some(cell => cell.hazardCorridors?.tornado?.peakHourUtc !== cell.hazardCorridors?.wind?.peakHourUtc),
  'tornado and wind guidance did not retain separate maturity windows');
assert.ok(product.grid.every(cell =>
  ['tornado','hail','wind'].every(h => cell.corridorRelocation?.[h]?.method === 'hazard-specific-initiation-to-maturity-ranking')
), 'published cells omitted hazard-specific relocation provenance');

const torPeak = Math.max(...product.grid.map(c => c.hazardCorridors?.tornado?.score ?? 0));
const hailPeak = Math.max(...product.grid.map(c => c.hazardCorridors?.hail?.score ?? 0));
assert.ok(torPeak > 0 && hailPeak > 0, 'hazard-specific trajectory scores were blank');

console.log(`hazard-specific corridors passed; forecast peak ${product.peakForecastHourUtc}Z`);
