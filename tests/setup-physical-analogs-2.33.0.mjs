import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { FLOW_REGIMES } from '../js/scenarios/narratives.js';

// Each flow regime must produce its own balanced 500 mb flow: the trough turns the flow,
// so the domain-mean direction may differ from the regime's background by up to ~35°.
const found = new Map();
for (let seed = 1; seed <= 400 && found.size < Object.keys(FLOW_REGIMES).length; seed++) {
  const world = new Atmosphere(50, 50);
  const config = generateScenario(world, seed);
  if (found.has(config.flowRegime)) continue;
  // The whole pattern is rotated by patternRotationDegrees for display; undo it to compare.
  found.set(config.flowRegime, { seed, from: (meanWindDirection(world, 500) + config.patternRotationDegrees + 360) % 360, background: config.synopticPattern.flowFromDeg });
}
assert.deepEqual(new Set(found.keys()), new Set(Object.keys(FLOW_REGIMES)), 'every flow regime must be reachable from seeds');
for (const [regime, { seed, from, background }] of found) {
  const difference = Math.abs(((from - background + 540) % 360) - 180);
  assert.ok(difference <= 35, `${regime} (seed ${seed}): mean 500-mb flow from ${from.toFixed(0)}° vs background ${background.toFixed(0)}°`);
}
assert.ok(found.get('northwest').from >= 280, 'northwest flow must come from the northwest');
assert.ok(found.get('meridional').from <= 240, 'meridional flow must have a strong southerly component');
console.log('Flow regimes passed:', [...found].map(([r, v]) => `${r} from ${v.from.toFixed(0)}°`).join(', '));

function meanWindDirection(world, level) {
  let u = 0, v = 0;
  world.forEachCell(cell => {
    const wind = cell.levels[level], radians = wind.windDirection * Math.PI / 180;
    u += -wind.windSpeed * Math.sin(radians);
    v += -wind.windSpeed * Math.cos(radians);
  });
  return (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
}
