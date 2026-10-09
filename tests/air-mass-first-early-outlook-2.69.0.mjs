import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';

function build(seed) {
  const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  const config = generateScenario(world, seed);
  const start = performance.now();
  initializeEvolution(world, config, { profile: 'gameplay' });
  return { world, elapsed: performance.now() - start };
}

for (const seed of [100000, 200000]) {
  const { world, elapsed } = build(seed);
  const product = world.outlookCycle?.products?.day1;
  assert(product, `seed ${seed} must issue a Day 1 product during startup`);
  assert.equal(product.issuanceMode, 'compact-trajectory');
  assert.equal(product.readiness?.ready, true);
  assert.notEqual(product.overallRisk, 'TSTM', `known severe seed ${seed} must not fall back to TSTM`);
  assert(product.ensembleForecast?.outlookAssimilation?.sampleHours?.length >= 5);
  assert(elapsed < 5000, `startup must remain below 5 seconds; got ${elapsed.toFixed(0)}ms`);
  let fractions = 0;
  world.forEachCell(cell => {
    const f = cell.airMassFractions;
    if (!f) return;
    fractions++;
    const sum = Object.values(f).reduce((a,b)=>a+b,0);
    assert(Math.abs(sum - 1) < 1e-6);
  });
  assert.equal(fractions, world.width * world.height);
}
console.log('2.69.0 air-mass-first early outlook restoration: PASS');
