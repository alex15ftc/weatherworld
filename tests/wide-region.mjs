// The wide window (js/world/WideRegion.js): the regional layer again on a coarser grid about the map, for the
// large-scale pages. It is for display only: a world with it goes exactly as one without; it sits about the map
// with the map's own ground under the map; and a saved state carries it.
import assert from 'node:assert/strict';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { WIDE, wideReady } from '../js/world/WideRegion.js';

const make = () => new AtmosphereWorld({ seed: 3, spinUpDays: 6 });
const plain = make(), withWide = make(), wide = withWide.enableWide();
assert.equal(withWide.enableWide(), wide, 'made once');
assert.deepEqual([wide.nx, wide.ny, Math.round(wide.dx / withWide.regional.dx)], [WIDE.cells, WIDE.cells, WIDE.factor]);
assert.equal(wideReady(wide), false, 'a new window is not shown yet');

const same = (a, b) => a.length === b.length && a.every((v, k) => Object.is(v, b[k]));
for (const hours of [6, 6]) {
  plain.advance(hours); withWide.advance(hours);
  for (const key of ['theta', 'moisture', 'eml', 'heat', 'coldPool']) assert.ok(same(plain.regional[key], withWide.regional[key]), `the map's ${key} is untouched after ${hours} h`);
  assert.ok(same(plain.model.q1, withWide.model.q1) && plain.model.time === withWide.model.time, 'the large-scale model is advanced once, by the map');
  assert.equal(JSON.stringify(plain.world.storms.map(s => [s.id, s.positionKm, s.intensity])), JSON.stringify(withWide.world.storms.map(s => [s.id, s.positionKm, s.intensity])), 'the storms are the same');
}
assert.equal(wide.ageHours, 12); assert.equal(wide.hourUtc, withWide.hourUtc);

// About the map: the map's middle is the window's, and the ground under the map is the map's.
const map = withWide.regional, centre = r => [r.origin.x + r.nx * r.dx / 2, r.origin.y + r.ny * r.dx / 2];
const length = map.model.lengthX, [mx, my] = centre(map), [wx, wy] = centre(wide);
assert.ok(Math.min(Math.abs(mx - wx), length - Math.abs(mx - wx)) < 1 && Math.abs(my - wy) < 1, 'centred on the map');
for (const column of [0, 12, 25, 37, 49]) {
  // (the window's cell that holds the middle of this column of the map)
  const at = map.position(column, 25), x = Math.floor((((at.x - wide.origin.x) % length) + length) % length / wide.dx);
  const own = wide.world.cells[20][x].terrain.elevationM, around = [-2, 2].map(d => map.terrainAt(column + d));
  assert.ok(own >= Math.min(...around) - 1 && own <= Math.max(...around) + 1, `the ground under the map's column ${column} is the map's (${Math.round(own)} m against ${Math.round(map.terrainAt(column))} m)`);
}
// West of the map's geography the high ground holds; east of it the low plains.
assert.equal(Math.round(wide.world.cells[20][0].terrain.elevationM), map.params.terrainWestM);
assert.equal(Math.round(wide.world.cells[20][WIDE.cells - 1].terrain.elevationM), map.params.terrainEastM);

// A saved state carries it; a copy without the window asked for does not step one.
const state = structuredClone(withWide.saveState({ forecast: true }));
const copy = AtmosphereWorld.restore(state);
assert.equal(copy.wide, undefined, 'a copy has no window until it is asked for');
const again = copy.enableWide();
assert.ok(same(again.theta, wide.theta) && same(again.moisture, wide.moisture) && again.ageHours === 12, 'the copy takes up the saved window');
copy.stormsEnabled = false; withWide.stormsEnabled = false;
copy.advance(3); withWide.advance(3);
assert.ok(same(again.theta, wide.theta), 'and goes on as the first does');
assert.equal(plain.saveState({ forecast: true }).wide, undefined, 'a world without one saves none');
console.log(`wide region passed (${WIDE.cells} x ${WIDE.cells} cells of ${Math.round(wide.dx / 1000)} km)`);
