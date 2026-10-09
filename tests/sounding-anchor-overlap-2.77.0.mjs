import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';

const overlap = { 'outbreak-favorable': [0, 0, 0, 0], 'severe-favorable': [0, 0, 0, 0], marginal: [0, 0, 0, 0] };
let failureModes = 0;
for (let seed = 1; seed <= 100; seed++) {
  const config = generateScenario(new Atmosphere(2, 2), seed);
  const schedule = config.soundingAnchors;
  assert.equal(schedule.version, '2.77.0');
  assert.deepEqual(schedule.anchors.map(anchor => anchor.hourUtc), [12, 18, 24]);
  for (const anchor of schedule.anchors) {
    assert.ok(anchor.overlap >= 0 && anchor.overlap <= 1);
    assert.ok(Array.isArray(anchor.limitingFactors));
  }
  const bucket = overlap[config.severeRegime];
  schedule.anchors.forEach((anchor, index) => { bucket[index] += anchor.overlap; });
  bucket[3]++;
  if (config.ingredientCoherence.failureMode) failureModes++;
}
const means = Object.fromEntries(Object.entries(overlap).map(([regime, values]) => [
  regime, values.slice(0, 3).map(value => value / values[3])
]));
console.log({ means, failureModes });
assert.ok(means['outbreak-favorable'][1] > means['severe-favorable'][1] + 0.07);
assert.ok(means['outbreak-favorable'][2] > means['severe-favorable'][2] + 0.07);
assert.ok(means['outbreak-favorable'][1] > means['outbreak-favorable'][0] + 0.25);
assert.ok(means['severe-favorable'][1] > means.marginal[1]);
assert.ok(failureModes >= 3 && failureModes <= 20);

const world = new Atmosphere(12, 10);
initializeEvolution(world, generateScenario(world, 4));
advanceAtmosphere(world, 1, { advanceStorms: false });
assert.equal(world.soundingSchedule.version, '2.77.0');
assert.equal(world.severeWeatherEngine.soundingGuidance.leftHourUtc, 12);
assert.equal(world.severeWeatherEngine.soundingGuidance.rightHourUtc, 18);
