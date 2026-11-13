// The long range model (js/forecast/LongRangeModel.js): without its timing error a run ends with the map exactly
// where the world's own steering takes it; with the error, the map is off along the belt by the error's speed
// times the time run, the same every time for a given start; and it keeps the large-scale frames it should.
import assert from 'node:assert/strict';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { LONG_RANGE, longRangeDue, runLongRange } from '../js/forecast/LongRangeModel.js';
import { LongRangeRuntime } from '../server/LongRangeRuntime.js';

assert.deepEqual([6, 30, 150, 7, 18].map(longRangeDue), [true, true, true, false, false], 'runs start at 06Z');
assert.equal(LONG_RANGE.hours, 168);

const live = new AtmosphereWorld({ seed: 4, spinUpDays: 6 });
live.advance(18);   // to 06Z, when a run starts and the day's steering plan is made
assert.ok(longRangeDue(live.world.validHourUtc));
const state = () => structuredClone(live.saveState({ forecast: true })), HOURS = 30;
const synopticOf = atmosphere => ({ hour: atmosphere.world.validHourUtc });

const exact = runLongRange(state(), { hours: HOURS, synopticOf, timingMs: 0 });
const run = runLongRange(state(), { hours: HOURS, synopticOf }), again = runLongRange(state(), { hours: HOURS });
live.advance(HOURS);
const length = live.model.nx * live.model.d, apart = (a, b) => { const d = Math.abs(a - b) % length; return Math.min(d, length - d); };

// Exact: the map ends where the world's does (its storms make no difference to the steering).
assert.ok(apart(exact.endOrigin.x, live.regional.origin.x) < 1000 && Math.abs(exact.endOrigin.y - live.regional.origin.y) < 1000, 'a run without the error follows the world');
// With the error: off by the error's speed over the hours run (the day's plan was the same: made at the start).
assert.ok(Math.abs(run.timingErrorMs) > 0.01, 'the run has a timing error');
const expected = Math.abs(run.timingErrorMs) * HOURS * 3600, off = apart(run.endOrigin.x, exact.endOrigin.x);
assert.ok(Math.abs(off - expected) < Math.max(20000, expected * 0.25), `the map is off by about the error times the time (${Math.round(off / 1000)} km against ${Math.round(expected / 1000)} km)`);
assert.deepEqual([again.timingErrorMs, again.endOrigin], [run.timingErrorMs, run.endOrigin], 'the same run every time');
// What it keeps: a frame at the start and every LONG_RANGE.synopticEvery hours.
assert.deepEqual(run.synoptic.map(f => f.forecastHour), Array.from({ length: HOURS / LONG_RANGE.synopticEvery + 1 }, (_, k) => k * LONG_RANGE.synopticEvery));
assert.equal(run.synoptic.at(-1).hour, run.initHourUtc + HOURS);

// The runtime: a run at 06Z, none at other hours once there is one; a server with none yet makes one at once.
const world = { validHourUtc: 31 }, engine = { world, saveState: () => ({}) }, asked = [];
const pool = { run: async (kind, saved, member, hours) => { asked.push([kind, hours]); return { initHourUtc: world.validHourUtc, hours, synoptic: [{ hour: world.validHourUtc }], ms: 1 }; } };
const longRange = new LongRangeRuntime({ runtime: { engine }, pool });
assert.equal(longRange.maybeRun(), true, 'none yet: one is made at the first whole hour');
await new Promise(resolve => setTimeout(resolve, 20));
world.validHourUtc = 31.5; assert.equal(longRange.maybeRun(), false);
world.validHourUtc = 40; assert.equal(longRange.maybeRun(), false, 'not at other hours');
for (const hour of [54, 78, 102, 126]) { world.validHourUtc = hour; assert.equal(longRange.maybeRun(), true, '06Z'); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(longRange.maybeRun(), false, 'once'); }
assert.deepEqual(asked.at(-1), ['longRange', 168]);
assert.deepEqual(longRange.list().runs.map(r => r.initHourUtc), [54, 78, 102, 126], `the last ${LONG_RANGE.keepRuns} are kept`);
console.log(`long range model passed (timing error ${run.timingErrorMs} m/s: ${Math.round(off / 1000)} km off after ${HOURS} h; ${run.ms} ms for ${HOURS} h)`);
