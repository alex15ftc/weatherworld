import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../js/evolution.js';
import { diagnoseSynopticInitiationBudget, consumeSynopticInitiationBudget } from '../js/synoptic/SynopticObjectEngine.js';

const world = new Atmosphere(50,50);
const config = generateScenario(world, 'dynamic-synoptic-test-250');
initializeEvolution(world, config);
assert.ok(world.synopticObjects?.convectiveBudget?.capacity > 0);
const front = world.synopticObjects.fronts[0];
const corridor = `boundary:${front.id}:segment:1`;
const d = diagnoseSynopticInitiationBudget(world, corridor, { corridorStrength:0.8 });
assert.equal(d.allowed, true);
const before = world.synopticObjects.convectiveBudget.remaining;
consumeSynopticInitiationBudget(world, d);
assert.ok(world.synopticObjects.convectiveBudget.remaining < before);
for (let i=0;i<10;i++) {
  const x=diagnoseSynopticInitiationBudget(world,corridor,{corridorStrength:0.8});
  if (!x.allowed) break;
  consumeSynopticInitiationBudget(world,x);
}
assert.ok((world.synopticObjects.convectiveBudget.segmentUsage[`${front.id}:segment:1`] ?? 0) <= front.segmentBudget);
console.log('2.50.0 dynamic synoptic physics regression: PASS');
