import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js?v=2.17.0.1';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js?v=2.17.0.1';
import { initializeEvolution } from '../js/evolution.js?v=2.17.0.1';

const counts = { TSTM: 0, MRGN: 0, SLGT: 0, ENH: 0, MDT: 0, HIGH: 0 };
let mismatch = 0;
for (let seed = 1; seed <= 100; seed += 1) {
  const world = new Atmosphere(50, 50);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config);
  const risk = world.evolution.outlookAnalysis.overallRisk;
  assert.ok(risk in counts, `Unknown risk category: ${risk}`);
  counts[risk] += 1;
  if (world.initialAuthoritativeOutlook.overallRisk !== risk) mismatch += 1;
}
assert.equal(mismatch, 0, 'Initialized and displayed outlook paths diverged');
console.log(JSON.stringify({ seeds: 100, counts, mismatch }, null, 2));
