import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';

const world = new Atmosphere(50,50);
const config = generateScenario(world, 'synoptic-object-test-249');
initializeEvolution(world, config);
assert.equal(world.synopticObjects?.authoritative, true);
assert.ok(world.synopticObjects.surfaceLow);
assert.ok(world.synopticObjects.fronts.length >= 2);
assert.ok(world.mesoscale.boundaries.every(b => b.pointsKm.length >= 2));
const before = world.synopticObjects.surfaceLow.positionKm.x;
advanceAtmosphere(world, 1, { advanceStorms:false });
assert.notEqual(world.synopticObjects.surfaceLow.positionKm.x, before);
assert.ok(world.synopticObjects.warmSectorCoverage >= 0 && world.synopticObjects.warmSectorCoverage <= 1);
assert.ok(world.evolution.boundaryObjects.every(b => b.authoritative === true));
console.log('2.49.0 synoptic object engine regression: PASS');
