import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';

import { KNOWN_STORM_MODES } from '../js/storms/StormModes.js';
// Use the canonical mode list; a hand-copied list went stale when modes were added.
const knownModes = new Set(KNOWN_STORM_MODES);
let created = 0, organized = 0, feedbackWorlds = 0;
// The 2.32 climatology rebalance changed the deterministic narratives attached
// to the original 1-6 fixture. This window retains a representative mix with
// realized convection while preserving the same six-world test cost.
for (let seed=7; seed<=12; seed++) {
  const world = new Atmosphere(30,30);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config);
  for (let hour=0; hour<4; hour++) advanceAtmosphere(world,1);
  created += world.stormEngine.totalCreated;
  organized += world.stormEngine.totalSplits + world.stormEngine.totalMergers;
  if (world.stormEngine.feedbackApplied) feedbackWorlds++;
  for (const storm of world.storms) {
    assert.ok(knownModes.has(storm.mode), `Unknown mode ${storm.mode}`);
    assert.ok(Number.isFinite(storm.coldPoolRadiusKm) && storm.coldPoolRadiusKm >= 0);
    assert.ok(Number.isFinite(storm.trackKm) && storm.trackKm >= 0);
    assert.ok(storm.modeConfidence >= 0 && storm.modeConfidence <= 1);
  }
}
assert.ok(created >= 2, `Too few storms created: ${created}`);
assert.ok(feedbackWorlds >= 1, `Too few worlds with storm feedback: ${feedbackWorlds}`);
console.log(JSON.stringify({ seeds:'7-12', created, organized, feedbackWorlds }, null, 2));
