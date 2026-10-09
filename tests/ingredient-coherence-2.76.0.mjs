import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';

const groups = { 'outbreak-favorable': [], 'severe-favorable': [], marginal: [] };
let failureModes = 0;
for (let seed = 1; seed <= 100; seed++) {
  const config = generateScenario(new Atmosphere(2, 2), seed);
  const spatialOverlap = 1 - Math.min(1, Math.hypot(
    config.moistureAxisX - config.lljX,
    config.moistureAxisY - config.lljY
  ) / 0.30);
  const capSuitability = 1 - Math.min(1, Math.abs(config.capBase - 118) / 90);
  const realizedOverlap = Math.min(
    (config.gulfDewpoint - 55) / 16,
    config.capePotential / 4000,
    config.jet500 / 65,
    config.llj850 / 42,
    config.forcing / 0.80,
    capSuitability,
    spatialOverlap
  );
  groups[config.severeRegime].push(realizedOverlap);
  if (config.ingredientCoherence.failureMode) failureModes++;
  assert.equal(config.ingredientCoherence.version, '2.76.0');
}
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
assert.ok(mean(groups['outbreak-favorable']) > mean(groups['severe-favorable']) + 0.07);
assert.ok(mean(groups['severe-favorable']) > mean(groups.marginal) + 0.10);
assert.ok(failureModes >= 3 && failureModes <= 20, `expected a minority of authentic failure modes, got ${failureModes}`);
console.log({
  meanOverlap: Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, Number(mean(values).toFixed(3))])),
  failureModes
});
