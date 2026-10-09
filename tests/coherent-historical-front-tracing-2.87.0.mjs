import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../js/evolution.js';

const counts = { warm: 0, cold: 0, dryline: 0 };
let terminatedFronts = 0;
let directionExceptions = 0;
let maximumSegmentKm = 0;
for (let seed = 1; seed <= 60; seed++) {
  const world = new Atmosphere(16, 10);
  const config = generateScenario(world, seed);
  for (const frame of config.analogGuidance.historicalAtmosphereSequence) {
    assert.equal(frame.features.coherentTraceVersion, '2.87.0');
    assert.ok(frame.features.triplePoint);
  }
  initializeEvolution(world, config);
  const low = world.synopticObjects.surfaceLow.positionKm;
  const domainWidth = world.width * world.cellSizeKm;
  const domainHeight = world.height * world.cellSizeKm;
  for (const front of world.synopticObjects.fronts) {
    counts[front.type]++;
    assert.equal(front.attachedToSurfaceLow, true);
    assert.ok(front.pointsKm.length >= 2);
    assert.ok(Math.hypot(front.pointsKm[0].x - low.x, front.pointsKm[0].y - low.y) < 1);
    if (front.pointsKm.length < 25) terminatedFronts++;
    const last = front.pointsKm.at(-1);
    if (front.type === 'warm' && last.x <= low.x) directionExceptions++;
    if ((front.type === 'cold' || front.type === 'dryline') && last.y <= low.y) directionExceptions++;
    for (let index = 0; index < front.pointsKm.length; index++) {
      const point = front.pointsKm[index];
      assert.ok(point.x >= 0 && point.x <= domainWidth);
      assert.ok(point.y >= 0 && point.y <= domainHeight);
      if (index) maximumSegmentKm = Math.max(maximumSegmentKm, Math.hypot(
        point.x - front.pointsKm[index - 1].x,
        point.y - front.pointsKm[index - 1].y
      ));
    }
  }
}
assert.ok(counts.warm >= 45);
assert.ok(counts.cold >= 45);
assert.ok(terminatedFronts >= 45, 'weak front segments should terminate instead of spanning the domain');
assert.ok(directionExceptions <= 6);
assert.ok(maximumSegmentKm <= 115);
console.log({ seeds: 60, counts, terminatedFronts, directionExceptions, maximumSegmentKm: Number(maximumSegmentKm.toFixed(1)) });
