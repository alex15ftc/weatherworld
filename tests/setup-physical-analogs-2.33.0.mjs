import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../js/evolution.js';

const cases = [
  { seed: 2, setup: 'high_plains_upslope', level: 850, direction: [100, 170] },
  { seed: 3, setup: 'northwest_flow', level: 500, direction: [285, 335] },
  { seed: 69, setup: 'elevated_mcs', level: 850, direction: [155, 205], minimumMuCape: 900, peak: [14, 19] }
];

for (const expected of cases) {
  const world = new Atmosphere(50, 40);
  const config = generateScenario(world, expected.seed);
  assert.equal(config.setupType, expected.setup);
  initializeEvolution(world, config);
  const direction = meanWindDirection(world, expected.level);
  assert.ok(
    direction >= expected.direction[0] && direction <= expected.direction[1],
    `${expected.setup}: ${expected.level}-mb flow ${direction.toFixed(1)}° outside analog range`
  );
  if (expected.minimumMuCape) {
    const meanMuCape = meanCellValue(world, cell => cell.derived?.sounding?.mucape);
    assert.ok(meanMuCape >= expected.minimumMuCape, `elevated MCS MUCAPE too weak: ${meanMuCape.toFixed(0)}`);
    assert.ok(
      config.scenarioEvolution.peakHour >= expected.peak[0]
        && config.scenarioEvolution.peakHour <= expected.peak[1],
      `elevated MCS lifecycle does not peak overnight: +${config.scenarioEvolution.peakHour.toFixed(1)}h`
    );
  }
}

console.log('Setup physical analogs passed: upslope, northwest-flow, and nocturnal elevated regimes are distinct.');

function meanWindDirection(world, level) {
  let u = 0;
  let v = 0;
  world.forEachCell(cell => {
    const wind = cell.levels[level];
    const radians = wind.windDirection * Math.PI / 180;
    u += -wind.windSpeed * Math.sin(radians);
    v += -wind.windSpeed * Math.cos(radians);
  });
  return (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
}

function meanCellValue(world, selector) {
  let sum = 0;
  let count = 0;
  world.forEachCell(cell => {
    const value = Number(selector(cell));
    if (!Number.isFinite(value)) return;
    sum += value;
    count++;
  });
  return sum / Math.max(1, count);
}
