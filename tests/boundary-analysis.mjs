import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { analyseBoundaries } from '../js/atmosphere/BoundaryAnalysis.js';
import { QuasiGeostrophicModel } from '../js/atmosphere/QuasiGeostrophicModel.js';
import { RegionalAtmosphere } from '../js/atmosphere/RegionalAtmosphere.js';

// A 40 x 40 world with a north-south contrast zone centred on column `at`, about 3 cells wide:
// cold or dry air to the west. `wind` is the surface wind (kt, direction it blows from).
function world({ at = 20, temperature = [60, 80], dewpoint = [55, 55], wind = { speed: 0, direction: 270 } } = {}) {
  const w = new Atmosphere(40, 40);
  w.forEachCell((cell, x) => {
    const share = 0.5 * (1 + Math.tanh((x - at) / 1.5));
    cell.surface.temperature = temperature[0] + (temperature[1] - temperature[0]) * share;
    cell.surface.dewpoint = dewpoint[0] + (dewpoint[1] - dewpoint[0]) * share;
    cell.surface.pressure = 1000; cell.surface.wind = { ...wind };
  });
  return w;
}
const only = (analysis, type) => { const found = analysis.boundaries.filter(b => b.type === type); assert.equal(found.length, 1, `one ${type} (found ${analysis.boundaries.map(b => b.type).join(', ') || 'nothing'})`); return found[0]; };
const column = (boundary, w) => boundary.pointsKm.reduce((sum, p) => sum + p.x, 0) / boundary.pointsKm.length / w.cellSizeKm - 0.5;

// --- Nothing to find in uniform air.
assert.equal(analyseBoundaries(world({ temperature: [75, 75] })).boundaries.length, 0, 'no lines in uniform air');

// --- The kind of front follows from which way the cold air is moving.
{
  const w = world({ wind: { speed: 20, direction: 270 } }), front = only(analyseBoundaries(w), 'cold');
  assert.ok(front.lengthKm > 400, `it runs the length of the zone (${front.lengthKm} km)`);
  assert.ok(front.advanceMs > 5, 'the cold air is advancing');
  // Drawn on the warm edge of the zone: east of its centre, but not out in the warm air.
  const at = column(front, w);
  assert.ok(at > 20 && at < 25, `on the warm edge of the zone (column ${at.toFixed(1)}, zone centred on 20)`);
  only(analyseBoundaries(world({ wind: { speed: 20, direction: 90 } })), 'warm');
  only(analyseBoundaries(world({ wind: { speed: 20, direction: 180 } })), 'stationary');
  only(analyseBoundaries(world({ wind: { speed: 2, direction: 270 } })), 'stationary');
}

// --- The line follows the contrast wherever it is, and whichever way it faces.
{
  const w = world({ at: 12, wind: { speed: 20, direction: 270 } }), at = column(only(analyseBoundaries(w), 'cold'), w);
  assert.ok(at > 12 && at < 17, `it moves with the contrast (column ${at.toFixed(1)}, zone centred on 12)`);
  const flipped = world({ temperature: [80, 60], wind: { speed: 20, direction: 90 } });   // cold air to the east, blowing west
  assert.ok(column(only(analyseBoundaries(flipped), 'cold'), flipped) < 20, 'and sits on the warm side when the cold air is to the east');
}

// --- A weak contrast is not a front.
assert.equal(analyseBoundaries(world({ temperature: [74, 77] })).boundaries.length, 0, 'a few degrees across the map is not a front');

// --- A dryline is a moisture line whose dry side is not the cold side.
{
  const dry = world({ temperature: [88, 84], dewpoint: [30, 65] });
  const line = only(analyseBoundaries(dry), 'dryline');
  assert.ok(Math.abs(column(line, dry) - 20) < 1.5, 'the dryline sits on the moisture contrast');
  // The same moisture change with much colder air on the dry side is a front, not a dryline.
  const frontal = analyseBoundaries(world({ temperature: [60, 84], dewpoint: [30, 65], wind: { speed: 20, direction: 270 } }));
  assert.equal(frontal.boundaries.filter(b => b.type === 'dryline').length, 0, 'the moisture change of a cold front is not a dryline');
  only(frontal, 'cold');
}

// --- Moist air is usually the cooler air mass. That contrast along a dryline is not a front.
{
  const w = world({ temperature: [98, 82], dewpoint: [30, 66], wind: { speed: 15, direction: 90 } });
  const found = analyseBoundaries(w).boundaries;
  assert.deepEqual(found.map(b => b.type), ['dryline'], 'hot dry air beside cooler moist air is a dryline only');
}

// --- Symbols go on the side the line says: toward the warm air for a cold front, toward the
// cold air for a warm front, toward the moist air for a dryline (+1 = left of the drawing direction).
{
  const leftIsEast = line => { const a = line.pointsKm[0], b = line.pointsKm.at(-1); return b.y - a.y > 0; };   // drawn southward, its left is east
  const cold = only(analyseBoundaries(world({ wind: { speed: 20, direction: 270 } })), 'cold');
  assert.equal(cold.symbolSide, leftIsEast(cold) ? 1 : -1, 'cold-front triangles point at the warm air (east)');
  const warm = only(analyseBoundaries(world({ wind: { speed: 20, direction: 90 } })), 'warm');
  assert.equal(warm.symbolSide, leftIsEast(warm) ? -1 : 1, 'warm-front half-circles point at the cold air (west)');
  const dry = only(analyseBoundaries(world({ temperature: [88, 84], dewpoint: [30, 65] })), 'dryline');
  assert.equal(dry.symbolSide, leftIsEast(dry) ? 1 : -1, 'dryline scallops face the moist air (east)');
}

// --- On the regional atmosphere: a dryline in the afternoon, in the western half, dry to its west.
{
  const model = new QuasiGeostrophicModel({ seed: 3, initialNoise: 4e-4 });
  model.advance(8 * 86400);
  const regional = new RegionalAtmosphere(model, { diagnostics: false, geographyOffset: 0 });   // the whole geography, high ground included
  let found = 0, afternoons = 0;
  for (let step = 0; step < 4 * 48; step++) {
    regional.step();
    if (step < 48 || regional.hourUtc % 24 !== 22) continue;
    afternoons++;
    for (const line of analyseBoundaries(regional.world).boundaries.filter(b => b.type === 'dryline' && b.lengthKm > 250)) {
      const at = column(line, regional.world);
      assert.ok(at > 3 && at < 35, `the dryline is in the western part of the map (column ${at.toFixed(0)})`);
      found++;
      break;
    }
    for (const line of analyseBoundaries(regional.world).boundaries) for (const point of line.pointsKm) assert.ok(point.x >= 0 && point.y >= 0 && point.x <= regional.world.domainWidthKm && point.y <= regional.world.domainHeightKm, 'every point is on the map');
  }
  assert.ok(found >= afternoons - 1, `a dryline on ${found} of ${afternoons} afternoons`);
}
console.log('boundary analysis passed');
