import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js?v=2.17.0.3';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js?v=2.17.0.3';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js?v=2.17.0.3';

let emlWorlds = 0;
const seedCount = 8;
for (let seed = 1; seed <= seedCount; seed++) {
  const world = new Atmosphere(40, 40);
  const config = generateScenario(world, 88000 + seed);
  initializeEvolution(world, config);
  assert.equal(world.regions.length, 6, 'six labeled climatological regions required');
  assert.ok(world.synopticCoherence.score >= 0.45, 'initial synoptic pattern should be coherent');
  if (world.airMassEngine?.eml?.strength > 0.2) emlWorlds++;
  // This regression validates the environment itself; storm-object growth is
  // covered separately and needlessly dominates runtime here.
  for (let h = 0; h < 6; h++) advanceAtmosphere(world, 1, { advanceStorms: false });
  assert.ok(world.synopticCoherence.score >= 0.35, 'evolved synoptic pattern should remain plausible');
  for (const boundary of world.mesoscale?.boundaries ?? []) {
    if (boundary.type === 'cold') {
      assert.ok(boundary.velocityKph.east >= -8.001, 'cold front cannot persist with strong westward motion');
      assert.ok(boundary.velocityKph.north <= 14.001, 'cold front cannot persist with strong poleward motion');
    }
    if (boundary.type === 'warm') assert.ok(boundary.velocityKph.north >= -10.001, 'warm front cannot persist with strong equatorward motion');
  }
  let assigned = 0, emlCells = 0;
  world.forEachCell(cell => { if (cell.region?.id) assigned++; if ((cell.features.emlInfluence ?? 0) > 0.1) emlCells++; });
  assert.equal(assigned, 1600, 'every cell must belong to a region');
  assert.ok(emlCells > 0, 'EML should project into the domain');
}
assert.ok(emlWorlds >= 6, 'most Plains patterns should include an EML source plume');
console.log(`Synoptic realism passed: ${emlWorlds}/${seedCount} EML worlds, six regions, constrained boundary motion.`);
