import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { validateWorldFramework } from '../js/world/WorldFramework.js';

const world = new Atmosphere(50, 50);
const config = generateScenario(world, 20270503);
initializeEvolution(world, config);

const initial = world.worldFramework.cells.map(row => row.map(cell => ({
  regionId: cell.regionId,
  elevationM: cell.elevationM,
  roughness: cell.roughness,
  soilMoisture: cell.soilMoisture,
  landCover: cell.landCover
})));

for (let hour = 0; hour < 8; hour++) {
  advanceAtmosphere(world, 1);
  const validation = validateWorldFramework(world);
  assert.equal(validation.valid, true, `static world drifted at step ${hour + 1}`);
  world.forEachCell((cell, x, y) => {
    const fixed = initial[y][x];
    assert.equal(cell.features.regionId, fixed.regionId);
    assert.equal(cell.terrain.elevationM, fixed.elevationM);
    assert.equal(cell.terrain.roughness, fixed.roughness);
    assert.equal(cell.terrain.soilMoisture, fixed.soilMoisture);
    assert.equal(cell.terrain.landCover, fixed.landCover);
  });
}

assert.equal(world.worldFramework.version, '2.13.2');
assert.equal(world.worldFramework.regions.length, 6);
console.log('World framework remained fixed through 8 forecast hours.');
