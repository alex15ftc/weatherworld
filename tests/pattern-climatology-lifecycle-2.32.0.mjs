import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';

const favorable = new Set([
  'isolated_supercells', 'loaded_gun', 'mixed_mode', 'hp_supercell',
  'classic_tornado_outbreak', 'giant_hail', 'progressive_mcs', 'qlcs', 'derecho'
]);
const weak = new Set(['pulse_convection', 'cap_bust', 'stable_day']);
let favorableCount = 0, weakCount = 0, outbreakCount = 0;
for (let seed = 1; seed <= 5000; seed++) {
  const probe = new Atmosphere(1, 1);
  const config = generateScenario(probe, seed);
  if (favorable.has(config.narrative)) favorableCount++;
  if (weak.has(config.narrative)) weakCount++;
  if (config.narrative === 'classic_tornado_outbreak') outbreakCount++;
}
assert.ok(favorableCount / 5000 >= 0.90, 'severe-weather gameplay patterns should dominate generated days');
assert.ok(weakCount / 5000 <= 0.035, 'weak/bust patterns must remain rare');
assert.ok(outbreakCount / 5000 >= 0.07, 'outbreak-capable patterns must occur often enough to calibrate upper tiers');

const highWorld = new Atmosphere(50, 50);
const highConfig = generateScenario(highWorld, 306);
initializeEvolution(highWorld, highConfig);
assert.equal(highConfig.narrative, 'classic_tornado_outbreak');
assert.equal(highWorld.evolution.outlookAnalysis.overallRisk, 'HIGH');
assert.equal(highWorld.outlookCycle.products.day1.overallRisk, 'HIGH');
let torThirty = 0;
highWorld.forEachCell(cell => {
  if ((cell.derived?.hazards?.tornadoProbability ?? 0) >= 30 && (cell.derived?.hazards?.tornadoCig ?? 0) >= 2) torThirty++;
});
assert.ok(torThirty >= 11, 'HIGH must emerge from a coherent 30%/CIG2 tornado corridor');

let coldSeed = null, coldConfig = null;
for (let seed = 1; seed <= 200 && coldSeed == null; seed++) {
  const probe = new Atmosphere(1, 1);
  const config = generateScenario(probe, seed);
  if (config.setupType === 'progressive_cold_front') { coldSeed = seed; coldConfig = config; }
}
assert.ok(coldSeed != null);
assert.equal(coldConfig.patternLifecycle.initiationGeometry, 'boundary-line');
assert.ok(['linear', 'QLCS', 'MCS'].includes(coldConfig.patternLifecycle.preferredMatureMode));
assert.ok(coldConfig.patternLifecycle.wakeCoolingF >= 5);

const coldWorld = new Atmosphere(20, 20);
coldConfig = generateScenario(coldWorld, coldSeed);
initializeEvolution(coldWorld, coldConfig);
const initialColdFront = coldWorld.mesoscale.boundaries.find(boundary => boundary.type === 'cold');
assert.ok(initialColdFront, 'progressive cold-front setup must initialize a cold boundary');
const initialMeanX = initialColdFront.pointsKm.reduce((sum, point) => sum + point.x, 0) / initialColdFront.pointsKm.length;
advanceAtmosphere(coldWorld, 3, { advanceStorms: false });
const evolvedColdFront = coldWorld.mesoscale.boundaries.find(boundary => boundary.id === initialColdFront.id);
assert.ok(evolvedColdFront, 'cold front should remain active through early evolution');
const evolvedMeanX = evolvedColdFront.pointsKm.reduce((sum, point) => sum + point.x, 0) / evolvedColdFront.pointsKm.length;
assert.ok(evolvedMeanX > initialMeanX + 20, 'cold front must sweep eastward');
const wakeCells = coldWorld.cells.flat().filter(cell => (cell.memory?.synopticColdWake ?? 0) > 0.01);
assert.ok(wakeCells.length > 0, 'cold-front passage must leave a persistent thermodynamic wake');

console.log(JSON.stringify({ favorableCount, weakCount, outbreakCount, highSeed: 306, coldSeed, wakeCells: wakeCells.length }));
