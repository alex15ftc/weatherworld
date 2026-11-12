// The short range model's large-scale frames (js/forecast/ShortRangeModel.js synopticOf, taken by
// server/SynopticRuntime.js): one every SHORT_RANGE.synopticEvery hours, read without changing the run,
// and served through the live world's synoptic runtime as the synoptic page reads them.
import assert from 'node:assert/strict';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { runShortRange, SHORT_RANGE } from '../js/forecast/ShortRangeModel.js';
import { SynopticRuntime } from '../server/SynopticRuntime.js';
import { ShortRangeRuntime } from '../server/ShortRangeRuntime.js';
avoidBackgroundThrottling();

const live = new AtmosphereWorld({ seed: 4 }); live.advance(4);
const state = live.saveState({ forecast: true });
const synopticOf = atmosphere => new SynopticRuntime({ atmosphere }).frame();
const hours = SHORT_RANGE.synopticEvery;
const plain = runShortRange(structuredClone(state), { hours });
const run = runShortRange(structuredClone(state), { hours, synopticOf });

// Taking the frames changes nothing the run does.
assert.equal(JSON.stringify(run.storms), JSON.stringify(plain.storms), 'the same storms with and without the large-scale frames');
assert.equal(JSON.stringify(run.tracks), JSON.stringify(plain.tracks), 'the same tracks');
assert.deepEqual(plain.synoptic, [], 'no frames unless asked for');

// A frame at the start and every few hours, each the whole model grid.
assert.deepEqual(run.synoptic.map(f => f.forecastHour), [0, hours]);
assert.deepEqual(run.synoptic.map(f => f.hour), [run.initHourUtc, run.initHourUtc + hours]);
const points = live.model.nx * live.model.ny;
for (const frame of run.synoptic) {
  assert.equal(frame.fields.z500.length, points);
  assert.ok(frame.fields.z500.every(Number.isFinite) && frame.fields.mslp.every(Number.isFinite), 'finite fields');
  assert.ok(frame.box.width > 0 && frame.box.height > 0, 'the map has its place in the frame');
}
// The start frame is the live world's own large-scale picture at that hour.
const now = new SynopticRuntime({ atmosphere: live });
assert.deepEqual(Array.from(run.synoptic[0].fields.z500), Array.from(now.frame().fields.z500), 'the first frame is the analysis');
assert.notDeepEqual(Array.from(run.synoptic[1].fields.z500), Array.from(run.synoptic[0].fields.z500), 'the model moves on');

// As the server serves them (ShortRangeRuntime.synopticFrame / synopticField).
const runtime = new ShortRangeRuntime({ runtime: { engine: live }, pool: null });
runtime.runs.push(run);
const first = runtime.synopticFrame(now, null, null), later = runtime.synopticFrame(now, run.initHourUtc, run.initHourUtc + hours);
assert.equal(first.status, 'ready');
assert.equal(first.frameHour, run.initHourUtc);
assert.deepEqual(first.frames, [run.initHourUtc, run.initHourUtc + hours]);
assert.equal(first.run.forecastHour, 0);
assert.equal(later.run.forecastHour, hours);
assert.equal(later.run.runs.length, 1);
const field = runtime.synopticField(now, run.initHourUtc, run.initHourUtc + hours, 'vort500'), wind = runtime.synopticField(now, run.initHourUtc, null, 'wind:500');
assert.equal(field.values.length, points);
assert.equal(field.frameHour, run.initHourUtc + hours);
assert.ok(wind.u.length === points && wind.v.length === points, 'winds as the page reads them');
assert.equal(runtime.synopticField(now, run.initHourUtc, null, 'nothing'), null);
assert.equal(runtime.synopticFrame(now, 12345, null), null, 'no such run');
console.log(`Short range large-scale frames: ${run.synoptic.length} frames of ${points} points, run unchanged`);
