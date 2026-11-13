// What a model run keeps of its cells for soundings (js/forecast/soundingColumns.js): the sounding made from it is
// the cell's own, figure for figure; a place off the map has none.
import assert from 'node:assert/strict';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { buildSounding } from '../js/sounding.js';
import { packColumns, cellOf, soundingAnswer, COLUMN_COUNT } from '../js/forecast/soundingColumns.js';
import { ShortRangeRuntime } from '../server/ShortRangeRuntime.js';

const atmosphere = new AtmosphereWorld({ seed: 4, spinUpDays: 6 });
atmosphere.advance(9);
const world = atmosphere.world, packed = packColumns(world);
assert.equal(packed.values.length, world.width * world.height * COLUMN_COUNT);
for (const [row, column] of [[5, 5], [25, 25], [40, 10], [10, 44], [49, 49], [0, 0]]) {
  const live = buildSounding(world.cells[row][column]), kept = soundingAnswer(cellOf(packed, row, column), { row, column });
  for (const key of ['mlcape', 'sbcape', 'mucape', 'mlcin', 'lclM', 'srh01', 'srh03', 'shear06', 'scp', 'stp', 'dcape', 'precipWater']) {
    assert.ok(Math.abs(live.params[key] - kept.params[key]) <= 0.002 * Math.max(1, Math.abs(live.params[key])), `${key} at ${row},${column}: ${kept.params[key]} against ${live.params[key]}`);
  }
  assert.equal(kept.profile.length, live.profile.length);
  assert.ok(kept.display && Number.isFinite(kept.context.surface.temperatureF));
}
for (const [row, column] of [[50, 0], [-1, 3], [2.5, 2], ['x', 1]]) assert.equal(cellOf(packed, row, column), null);
assert.equal(soundingAnswer(null), null);

// The runtime's answer: the hour asked for, or the nearest kept hour before it; the newest run when none is named.
const runtime = new ShortRangeRuntime({ runtime: { engine: null }, pool: null });
runtime.runs = [{ initHourUtc: 30, hours: 6, soundings: [{ hour: 0, ...packed }, { hour: 3, ...packed }] }];
const answer = runtime.sounding('', 4, 25, 25);
assert.deepEqual([answer.initHourUtc, answer.forecastHour, answer.validHourUtc, answer.row, answer.column], [30, 3, 33, 25, 25]);
assert.equal(runtime.sounding(30, 0, 25, 25).forecastHour, 0);
assert.equal(runtime.sounding(31, 0, 25, 25), null, 'no such run');
assert.equal(runtime.sounding(30, 0, 99, 25), null, 'off the map');
console.log(`sounding columns passed (${COLUMN_COUNT} numbers a cell, ${Math.round(packed.values.byteLength / 1024)} KB a frame)`);
