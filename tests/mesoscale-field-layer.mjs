import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js?v=2.17.0';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js?v=2.17.0';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js?v=2.17.0';

const world = new Atmosphere(50, 50);
const config = generateScenario(world, 'mesoscale-layer-regression');
initializeEvolution(world, config);

let populated = 0;
let focused = 0;
world.forEachCell(cell => {
  const m = cell.mesoscaleFields;
  if (!m) return;
  populated++;
  assert.equal(m.source, 'atmospheric-grid');
  for (const key of ['thetaE','boundaryLayerDepthM','moisturePooling','convergenceCorridor','capErosion','effectiveInflow','ascent','initiationFocus']) {
    assert.ok(Number.isFinite(m[key]), `${key} should be finite`);
  }
  if (m.initiationFocus > 0.2) focused++;
});
assert.equal(populated, world.width * world.height, 'every cell should receive mesoscale fields');
assert.ok(focused > 0, 'synoptic environment should create at least one mesoscale focus');

const before = world.getCell(Math.floor(world.width/2), Math.floor(world.height/2)).mesoscaleFields.boundaryLayerDepthM;
advanceAtmosphere(world, 1);
const after = world.getCell(Math.floor(world.width/2), Math.floor(world.height/2)).mesoscaleFields.boundaryLayerDepthM;
assert.ok(Number.isFinite(after));
assert.notEqual(world.mesoscale.fieldValidHourUtc, undefined);
assert.equal(world.mesoscale.fieldSource.includes('surface'), true);
console.log(`Mesoscale field layer passed: ${populated} cells, ${focused} focused cells, BL depth ${before.toFixed(0)}→${after.toFixed(0)} m.`);
