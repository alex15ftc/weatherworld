import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
for (const seed of [45852182,37873091,41132455,20270503]) {
  const atmosphere = new Atmosphere(30,30);
  const config = generateScenario(atmosphere, seed);
  initializeEvolution(atmosphere, config);
  assert.ok(config.scenarioEvolution?.peakHour > 0);
  const initial = atmosphere.getCell(15,15).features.scenarioMaturity ?? 0;
  advanceAtmosphere(atmosphere, 6, {advanceStorms:false});
  const later = atmosphere.getCell(15,15).features.scenarioMaturity ?? 0;
  assert.ok(Number.isFinite(later) && later >= initial * 0.75);
}
console.log('2.28.13 evolving scenario narrative tests passed');
