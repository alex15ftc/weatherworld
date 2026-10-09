import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { sampleSynopticPattern } from '../js/scenarios/synopticPattern.js';

let southWarmer = 0;
let movingFrames = 0;
let totalDisplacement = 0;
for (let seed = 1; seed <= 60; seed++) {
  const config = generateScenario(new Atmosphere(2, 2), seed);
  const frame = config.analogGuidance.historicalAtmosphereSequence[0];
  assert.equal(frame.domain.gridOrientation, 'north-to-south');
  const north = mean(frame.fields.temperature2mC.slice(0, frame.width));
  const south = mean(frame.fields.temperature2mC.slice((frame.height - 1) * frame.width));
  if (south > north) southWarmer++;

  const corridors = config.historicalSpatialAlignment.movingCorridors;
  assert.deepEqual(corridors.map(item => item.hourUtc), [12, 18, 24, 30, 36]);
  for (const corridor of corridors) {
    assert.ok(corridor.cellCount > 0);
    assert.equal(corridor.warmSectorContained, true);
    for (let step = 0; step <= 8; step++) {
      const fraction = step / 8;
      const x = corridor.start.x + (corridor.end.x - corridor.start.x) * fraction;
      const y = corridor.start.y + (corridor.end.y - corridor.start.y) * fraction;
      const sampled = sampleSynopticPattern(config.synopticPattern, x, y, corridor.hourUtc - 12);
      assert.ok(sampled.warmSector >= 0.35, `seed ${seed} ${corridor.hourUtc}Z corridor escaped its warm sector`);
    }
  }
  for (let index = 1; index < corridors.length; index++) {
    const displacement = Math.hypot(
      corridors[index].center.x - corridors[index - 1].center.x,
      corridors[index].center.y - corridors[index - 1].center.y
    );
    totalDisplacement += displacement;
    if (displacement >= 0.02) movingFrames++;
  }
}
assert.equal(southWarmer, 60, 'bundled historical frames must place colder mean temperatures north of warmer southern air');
assert.ok(movingFrames >= 90, `expected substantial corridor movement, got ${movingFrames}`);
assert.ok(totalDisplacement / 240 >= 0.035);
assert.ok(totalDisplacement / 240 <= 0.16, 'corridor tracking must not jump between unrelated favorable clusters');

const world = new Atmosphere(24, 18);
const config = generateScenario(world, 4);
initializeEvolution(world, config);
const seenFramePairs = new Set();
for (let step = 0; step < 4; step++) {
  if (step) advanceAtmosphere(world, 6, { advanceStorms: false });
  let influential = 0;
  world.forEachCell(cell => {
    const corridor = cell.features?.soundingCorridor;
    if (corridor?.frameHours) seenFramePairs.add(corridor.frameHours.join('-'));
    if ((corridor?.influence ?? 0) < 0.25) return;
    influential++;
    assert.equal(cell.features.warmSector, true);
  });
  assert.ok(influential > 0, `moving corridor disappeared at ${world.validHourUtc}Z`);
}
assert.ok(seenFramePairs.size >= 3);
console.log({
  seeds: 60,
  southWarmer,
  movingFrames,
  meanFrameDisplacement: Number((totalDisplacement / 240).toFixed(3)),
  seenFramePairs: [...seenFramePairs]
});

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
