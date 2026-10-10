import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../js/evolution.js';

// Every seed initializes a finite atmosphere and queues its Day 1-3 outlook ensemble.
const narratives = {};
for (let seed = 1; seed <= 20; seed += 1) {
  const world = new Atmosphere(50, 50);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config);
  world.forEachCell(cell => {
    for (const value of [cell.surface.temperature, cell.surface.dewpoint, cell.derived.cape, cell.derived.bulkShear, cell.derived.srh]) assert.ok(Number.isFinite(value), `seed ${seed}: non-finite field`);
  });
  const [request] = world.outlookCycle.pending;
  assert.deepEqual(world.outlookCycle.pending.flatMap(r => r.windows.map(w => [w.key, w.start, w.end])), [['day1', 12, 36], ['day2', 36, 60], ['day3', 60, 84]], `seed ${seed}: initial outlook issuance`);
  assert.ok(request.snapshot?.cells?.length === 50, 'issuance carries a world snapshot');
  narratives[config.narrative] = (narratives[config.narrative] ?? 0) + 1;
}
console.log(JSON.stringify({ seeds: 20, narratives }));
