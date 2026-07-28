import assert from 'node:assert/strict';
import { GAMEPLAY_NARRATIVE_WEIGHTS } from '../js/scenarios/config.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { Atmosphere } from '../js/atmosphere.js';

const expected = new Set([
  'isolated_supercells','loaded_gun','mixed_mode','hp_supercell',
  'classic_tornado_outbreak','giant_hail','progressive_mcs','qlcs',
  'derecho','elevated_mcs','pulse_convection','cap_bust','stable_day'
]);
assert.deepEqual(new Set(GAMEPLAY_NARRATIVE_WEIGHTS.map(n => n.name)), expected);
const total = GAMEPLAY_NARRATIVE_WEIGHTS.reduce((sum, n) => sum + n.weight, 0);
assert.ok(Math.abs(total - 1) < 0.011, `Narrative weights should total approximately 1, got ${total}`);
const tornadoFocused = GAMEPLAY_NARRATIVE_WEIGHTS
  .filter(n => ['isolated_supercells','loaded_gun','mixed_mode','hp_supercell','classic_tornado_outbreak'].includes(n.name))
  .reduce((sum,n)=>sum+n.weight,0);
assert.ok(tornadoFocused >= .55, 'Tornado-oriented narratives should form the majority climatology');
const bust = GAMEPLAY_NARRATIVE_WEIGHTS
  .filter(n => ['cap_bust','stable_day'].includes(n.name))
  .reduce((sum,n)=>sum+n.weight,0);
assert.ok(bust <= .02, 'Explicit bust narratives should remain very rare');
assert.ok(GAMEPLAY_NARRATIVE_WEIGHTS.find(n=>n.name==='classic_tornado_outbreak').weight <= .06);

const seen = new Set();
for (let seed=1; seed<=300; seed++) {
  const world = new Atmosphere(12, 12);
  const scenario = generateScenario(world, seed);
  seen.add(scenario.narrative);
}
assert.ok(seen.has('isolated_supercells'));
assert.ok(seen.has('loaded_gun'));
assert.ok(seen.has('classic_tornado_outbreak'));
console.log('2.28.9 universal narrative checks passed');
