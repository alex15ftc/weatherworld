import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { severeRegimeForSeed } from '../js/atmosphere/SimplifiedSevereWeatherEngine.js';

const regimes = { 'outbreak-favorable': 0, 'severe-favorable': 0, marginal: 0 };
for (let seed = 1; seed <= 100; seed++) regimes[severeRegimeForSeed(seed)]++;
assert.ok(regimes['severe-favorable'] >= 55 && regimes['severe-favorable'] <= 70);
assert.ok(regimes['outbreak-favorable'] >= 12 && regimes['outbreak-favorable'] <= 25);
assert.ok(regimes['severe-favorable'] > regimes['outbreak-favorable']);

let convectiveWorlds = 0, severeWorlds = 0;
for (let seed = 1; seed <= 12; seed++) {
  const world = new Atmosphere(24, 18);
  initializeEvolution(world, generateScenario(world, seed));
  let realizedSevere = false;
  for (let hour = 0; hour < 8; hour++) {
    advanceAtmosphere(world, 1);
    realizedSevere ||= world.storms.some(storm => Math.max(storm.hazards?.hailProbability ?? 0, storm.hazards?.windProbability ?? 0, storm.hazards?.tornadoProbability ?? 0) >= 0.10);
  }
  if (world.stormEngine.totalCreated > 0) convectiveWorlds++;
  if (realizedSevere) severeWorlds++;
  world.forEachCell(cell => {
    assert.ok(cell.severeWeather);
    assert.ok(cell.severeWeather.initiationProbability >= 0 && cell.severeWeather.initiationProbability <= 0.92);
    assert.ok(cell.severeWeather.severePotential >= 0 && cell.severeWeather.severePotential <= 1);
  });
}
assert.ok(convectiveWorlds >= 7, `severe-convective weather should be common: ${convectiveWorlds}/12 worlds`);
assert.ok(severeWorlds >= 5, `realized severe hazards should be common: ${severeWorlds}/12 worlds`);

const initiationSource = await readFile(new URL('../js/storms/InitiationEngine.js', import.meta.url), 'utf8');
assert.doesNotMatch(initiationSource, /scenarioEvolution|narrative|setupKey|forecast\./);
assert.ok(initiationSource.length < 8500, 'simplified initiation engine should remain compact');
console.log({ regimes, convectiveWorlds, severeWorlds });
