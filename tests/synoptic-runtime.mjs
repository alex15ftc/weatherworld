import assert from 'node:assert/strict';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { SynopticRuntime, SYNOPTIC_FIELDS } from '../server/SynopticRuntime.js';

// The synoptic page's view of the whole large-scale model reads it through the regional layer's
// own conversions, so where the domain and the map overlap the two agree.
const atmosphere = new AtmosphereWorld({ seed: 2, spinUpDays: 6, storms: false });
atmosphere.advance(3);
const synoptic = new SynopticRuntime({ atmosphere });
const summary = synoptic.summary(), { nx, ny } = summary.grid, model = atmosphere.model;
assert.equal(nx, model.nx); assert.equal(ny, model.ny);
assert.ok(summary.map.width > 9 && summary.map.width < 11, 'the 500-mile map is about 10 grid cells wide');
assert.ok(summary.map.x >= 0 && summary.map.x < nx && summary.map.y >= 0 && summary.map.y < ny);

// Every field comes out whole and finite; unknown names give null.
for (const { key } of SYNOPTIC_FIELDS) {
  const field = synoptic.field(key);
  assert.equal(field.values.length, nx * ny, key);
  assert.ok(field.values.every(Number.isFinite), `${key} finite`);
}
for (const level of ['sfc', '850', '500', '250', 'shear']) assert.equal(synoptic.field(`wind:${level}`).u.length, nx * ny);
assert.equal(synoptic.field('nonsense'), null);
assert.equal(synoptic.field('wind:700'), null);

// The map's centre cell against the nearest grid point: 500 mb height and wind as the map has them.
const regional = atmosphere.regional, at = regional.position(25, 25), i = Math.round(at.x / model.d) % nx, j = Math.round(at.y / model.d - 0.5);
const level = atmosphere.world.cells[25][25].levels[500], k = j * nx + i;
// (The grid point is within half a cell, 40 km, of the map's centre.)
assert.ok(Math.abs(synoptic.field('z500').values[k] - level.heightDm) < 3, 'z500 near the map matches the map');
assert.ok(Math.abs(synoptic.field('wspd500').values[k] - level.windSpeed) < 8, '500 mb wind near the map matches the map');

// Lows are lower than highs, and the frames build up as the world steps.
const lows = summary.centres.filter(c => c.type === 'L'), highs = summary.centres.filter(c => c.type === 'H');
if (lows.length && highs.length) assert.ok(Math.min(...lows.map(c => c.hpa)) < Math.max(...highs.map(c => c.hpa)));
atmosphere.advance(0.5); synoptic.capture();
assert.equal(synoptic.summary().frames.length, 2);
console.log(`synoptic runtime: ${SYNOPTIC_FIELDS.length} fields, ${summary.centres.length} centres, map at x ${summary.map.x.toFixed(1)}, y ${summary.map.y.toFixed(1)}`);
