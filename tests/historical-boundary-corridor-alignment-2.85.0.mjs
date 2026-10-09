import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { sampleSynopticPattern } from '../js/scenarios/synopticPattern.js';

let retried = 0;
let alignedCells = 0;
for (let seed = 1; seed <= 60; seed++) {
  const world = new Atmosphere(16, 10);
  const config = generateScenario(world, seed);
  const alignment = config.historicalSpatialAlignment;
  assert.equal(alignment.version, '2.85.0');
  assert.equal(alignment.frameHourUtc, 12);
  assert.equal(alignment.valid, true);
  assert.equal(alignment.smoothedSequence.length, 5);
  assert.deepEqual(alignment.smoothedSequence.map(frame => frame.hourUtc), [12, 18, 24, 30, 36]);
  assert.equal(alignment.corridor.warmSectorContained, true);
  assert.ok(alignment.corridor.cellCount >= 1);
  assert.ok(alignment.corridorCoverage > 0);
  if (config.seedAcceptance.selectedAttempt > 0) retried++;

  for (let step = 0; step <= 10; step++) {
    const fraction = step / 10;
    const nx = alignment.corridor.start.x + (alignment.corridor.end.x - alignment.corridor.start.x) * fraction;
    const ny = alignment.corridor.start.y + (alignment.corridor.end.y - alignment.corridor.start.y) * fraction;
    const sample = sampleSynopticPattern(config.synopticPattern, nx, ny, 0);
    assert.ok(sample.aheadOfColdFront >= 0.5, `seed ${seed} corridor is behind cold front`);
    assert.ok(sample.eastOfDryline >= 0.5, `seed ${seed} corridor is west of dryline`);
    assert.ok(sample.southOfWarmFront >= 0.5, `seed ${seed} corridor is north of warm front`);
  }
  world.forEachCell(cell => {
    if ((cell.features?.soundingCorridor?.influence ?? 0) < 0.25) return;
    alignedCells++;
    const sample = sampleSynopticPattern(
      config.synopticPattern,
      cell.features._patternX,
      cell.features._patternY,
      0
    );
    assert.ok(sample.warmSector >= 0.35, `seed ${seed} has post-frontal corridor influence`);
  });
}
assert.ok(retried >= 5);
assert.ok(alignedCells >= 120);
console.log({ seeds: 60, retried, alignedCells });
