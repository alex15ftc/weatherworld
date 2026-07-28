import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { modeForLifecycle } from '../js/storms/StormModeEngine.js';

const expected = new Set([
  'isolated_supercells', 'loaded_gun', 'mixed_mode', 'hp_supercell',
  'classic_tornado_outbreak', 'giant_hail', 'progressive_mcs', 'qlcs',
  'derecho', 'elevated_mcs', 'pulse_convection', 'cap_bust', 'stable_day'
]);
const contracts = new Map();
const variants = new Map([...expected].map(narrative => [narrative, []]));

for (let seed = 1; seed <= 20000; seed++) {
  const world = new Atmosphere(1, 1);
  const config = generateScenario(world, seed);
  if (expected.has(config.narrative) && !contracts.has(config.narrative)) {
    contracts.set(config.narrative, config.patternLifecycle);
  }
  const samples = variants.get(config.narrative);
  if (samples && samples.length < 3) samples.push(config.patternLifecycle);
  if (contracts.size === expected.size && [...variants.values()].every(values => values.length >= 3)) break;
}

assert.deepEqual(new Set(contracts.keys()), expected, 'every generated narrative must have regression coverage');
for (const [narrative, contract] of contracts) {
  assert.equal(contract.version, 2, `${narrative} must use the staged lifecycle schema`);
  assert.equal(contract.narrative, narrative);
  assert.ok(contract.initiationGeometry);
  assert.ok(contract.initialMode && contract.preferredMatureMode && contract.lateMode);
  assert.ok(contract.initiationDelayHours >= 0);
  assert.ok(contract.modeTransitionHours > contract.initiationDelayHours);
  assert.ok(contract.lateTransitionHours > contract.modeTransitionHours);
  assert.equal(contract.coverageEvolution.length, 3);
  assert.ok(contract.coverageEvolution.every(value => value >= 0 && value <= 1.2));
  assert.ok(contract.coldPoolMultiplier > 0);
  assert.ok(contract.aftermath);
  assert.ok(contract.lifecycleVariant);
  assert.equal(modeForLifecycle(contract, 0), contract.initialMode);
  assert.equal(modeForLifecycle(contract, contract.modeTransitionHours + 0.1), contract.preferredMatureMode);
  assert.equal(modeForLifecycle(contract, contract.lateTransitionHours + 0.1), contract.lateMode);
}

for (const [narrative, samples] of variants) {
  assert.equal(samples.length, 3, `${narrative} needs repeated-seed diversity coverage`);
  const signatures = new Set(samples.map(contract => JSON.stringify({
    variant: contract.lifecycleVariant,
    delay: Number(contract.initiationDelayHours.toFixed(3)),
    transition: Number(contract.modeTransitionHours.toFixed(3)),
    coverage: contract.coverageEvolution.map(value => Number(value.toFixed(3))),
    coldPool: Number(contract.coldPoolMultiplier.toFixed(3)),
    recovery: Number(contract.recoveryMultiplier.toFixed(3))
  })));
  assert.ok(signatures.size >= 2, `${narrative} repeated events must not share an identical trajectory`);
}

assert.deepEqual(
  [contracts.get('loaded_gun').initialMode, contracts.get('loaded_gun').preferredMatureMode],
  ['capped', 'discrete']
);
assert.deepEqual(
  [contracts.get('mixed_mode').initialMode, contracts.get('mixed_mode').lateMode],
  ['discrete', 'linear']
);
assert.deepEqual(
  [contracts.get('derecho').initialMode, contracts.get('derecho').preferredMatureMode, contracts.get('derecho').lateMode],
  ['linear', 'QLCS', 'MCS']
);
assert.deepEqual(
  [contracts.get('elevated_mcs').initialMode, contracts.get('elevated_mcs').preferredMatureMode],
  ['elevated', 'MCS']
);
assert.equal(contracts.get('cap_bust').preferredMatureMode, 'conditional');
assert.equal(contracts.get('stable_day').preferredMatureMode, 'stable');

console.log(JSON.stringify(Object.fromEntries([...contracts].map(([key, value]) => [
  key,
  `${value.initialMode}->${value.preferredMatureMode}->${value.lateMode}`
]))));
