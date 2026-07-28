import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js?v=2.17.0.1';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js?v=2.17.0.1';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js?v=2.17.0.1';

let worldsWithStorms = 0;
let totalStorms = 0;
for (let seed = 1; seed <= 12; seed++) {
  const world = new Atmosphere(50, 50);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config);
  for (let hour = 0; hour < 5; hour++) advanceAtmosphere(world, 1);
  assert.ok(Array.isArray(world.storms), 'Storm registry missing');
  assert.ok(world.storms.every(storm => Number.isFinite(storm.positionKm.x) && Number.isFinite(storm.positionKm.y)), 'Invalid storm position');
  assert.ok(world.storms.every(storm => Number.isFinite(storm.velocityKph.east) && Number.isFinite(storm.velocityKph.north)), 'Invalid storm motion');
  if (world.stormEngine.totalCreated > 0) worldsWithStorms++;
  totalStorms += world.stormEngine.totalCreated;
}
assert.ok(worldsWithStorms >= 2, `Too few convective worlds: ${worldsWithStorms}/12`);
assert.ok(totalStorms > 2, `Too few storms created: ${totalStorms}`);
console.log(JSON.stringify({ seeds: 12, worldsWithStorms, totalStorms }, null, 2));
