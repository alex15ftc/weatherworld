import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';

const world = new Atmosphere(32, 24);
const config = generateScenario(world, 4); // deterministic outbreak-favorable seed
assert.equal(config.soundingCorridors.version, '2.85.0');
assert.ok(config.soundingCorridors.corridors.length >= 1);
assert.equal(config.soundingCorridors.corridors[0].type, 'historical-warm-sector-overlap');
initializeEvolution(world, config);
advanceAtmosphere(world, 6, { advanceStorms: false });

const corridor = [], backgroundWarmSector = [];
world.forEachCell(cell => {
  const influence = cell.features?.soundingCorridor?.influence ?? 0;
  if (influence >= 0.65) corridor.push(cell);
  else if (influence < 0.08 && cell.features?.warmSector) backgroundWarmSector.push(cell);
});
assert.ok(corridor.length >= 12);
assert.ok(backgroundWarmSector.length >= 20);
const mean = (cells, getter) => cells.reduce((sum, cell) => sum + getter(cell), 0) / cells.length;
const corridorCape = mean(corridor, cell => cell.derived.cape);
const backgroundCape = mean(backgroundWarmSector, cell => cell.derived.cape);
console.log({
  corridorCells: corridor.length,
  backgroundCells: backgroundWarmSector.length,
  corridorCape: Number(corridorCape.toFixed(0)),
  backgroundCape: Number(backgroundCape.toFixed(0)),
  corridorCin: Number(mean(corridor, cell => cell.derived.cin).toFixed(0)),
  backgroundCin: Number(mean(backgroundWarmSector, cell => cell.derived.cin).toFixed(0))
});
assert.ok(corridorCape >= backgroundCape * 0.90);
assert.ok(mean(corridor, cell => cell.derived.cin) < mean(backgroundWarmSector, cell => cell.derived.cin) * 0.75);
assert.ok(mean(corridor, cell => cell.derived.bulkShear) >= 40);
assert.ok(mean(corridor, cell => cell.severeWeather.temporalOverlap) > mean(backgroundWarmSector, cell => cell.severeWeather.temporalOverlap) + 0.15);
assert.ok(corridor.every(cell => cell.severeWeather.targetSounding?.overlap > 0));
