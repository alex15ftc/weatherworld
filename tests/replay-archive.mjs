// Day replays (server/ReplayArchive.js): the hour's mesoanalysis and large-scale frames and the day's warnings
// are kept as the day runs, written to the day's file, read back after a restart, answered as the live pages'
// own routes answer, and let go after REPLAY.keepDays world days.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReplayArchive, REPLAY } from '../server/ReplayArchive.js';

const world = { validHourUtc: 12 };
const runtime = { worldId: 'world-one-abcdef', engine: { world } };
const surface = { frames: [] }, synoptic = { frames: [] }, archive = { warnings: new Map() };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-replays-'));
const make = () => new ReplayArchive({ runtime, surface, synoptic, archive, dir });
const settle = async replays => { await replays.writing; await new Promise(resolve => setTimeout(resolve, 60)); };
// The world moves on half an hour at a time, each runtime keeping its frame of the hour as the server's do.
function step(replays, hour) {
  world.validHourUtc = hour;
  surface.frames = [{ hour, analysis: { status: 'ready', hourUtc: hour % 24, stations: [{ id: 'S001', temperatureF: 70 + (hour % 5) }] }, fields: new Map([['mlcape', { key: 'mlcape', label: 'CAPE', unit: 'J/kg', values: [hour, 1000.123456, 2500] }]]) }];
  synoptic.frames = [{ hour, fields: { z500: Float32Array.of(5700, 5760 + hour) }, box: { x: 1, y: 2, width: 10, height: 10 }, centres: [], slide: { eastKmh: 40, northKmh: 0, plan: null } }];
  replays.capture();
}

const replays = make();
for (let hour = 12; hour <= 20; hour += 0.5) step(replays, hour);
archive.warnings.set('a', { key: 'a', id: 'A-TOR-1', type: 'tornado', title: 'Tornado Warning 1', colourKey: 'tornado', where: 'Wade County', issuedHourUtc: 19.2, validToHourUtc: 19.7, rings: [[1, 1, 5, 1, 5, 5]], text: 'BULLETIN' });
archive.warnings.set('b', { key: 'b', id: 'A-SVR-1', type: 'severe', title: 'Severe Thunderstorm Warning 1', colourKey: 'severe', where: 'Rooks County', issuedHourUtc: 18.5, validToHourUtc: 19, rings: [[9, 9, 12, 9, 12, 12]], text: '' });
replays.warnings();

// Whole hours are kept, half hours are not; each as the live page's route would answer.
let held = replays.contents(1, runtime.worldId);
assert.equal(held.available, true);
assert.deepEqual(held.mesoHours, [12, 13, 14, 15, 16, 17, 18, 19, 20]);
assert.deepEqual(held.synopticHours, held.mesoHours);
assert.equal(held.warnings, 2);
assert.equal(held.expiresHourUtc, 12 + 24 * REPLAY.keepDays, 'let go 16 world days after the day began');
const at15 = replays.surface(1, runtime.worldId, 15);
assert.equal(at15.frameHour, 15); assert.equal(at15.replay, true); assert.equal(at15.latest, false);
assert.deepEqual(at15.frames, held.mesoHours);
assert.ok(at15.parameters.length > 5, 'the overlay list the page fills its menu from');
assert.equal(replays.surface(1, runtime.worldId, null).frameHour, 12, 'the day\'s first hour when none is named');
assert.deepEqual(replays.parameter(1, runtime.worldId, 'mlcape', 15).values, [15, 1000.123, 2500], 'a field\'s numbers come back as a plain list');
assert.equal(replays.parameter(1, runtime.worldId, 'nothing', 15), null);
// The large-scale frames go through the live synoptic runtime (here a stand-in that shows what it was given).
const viaLive = { describe: (frame, frames, latest) => ({ frameHour: frame.hour, frames, latest, slide: frame.slide }), fieldOf: (frame, key) => ({ key, frameHour: frame.hour, values: Array.from(frame.fields[key] ?? []) }) };
assert.deepEqual(replays.synopticFrame(viaLive, 1, runtime.worldId, 17), { frameHour: 17, frames: held.mesoHours, latest: false, slide: { eastKmh: 40, northKmh: 0, plan: null }, replay: true });
assert.deepEqual(replays.synopticField(viaLive, 1, runtime.worldId, 17, 'z500').values, [5700, 5777]);
// The warnings in the order they were issued, with their polygons.
const list = replays.warningList(1, runtime.worldId);
assert.deepEqual(list.warnings.map(w => [w.key, w.type]), [['b', 'severe'], ['a', 'tornado']]);
assert.deepEqual(list.warnings[1].rings, [[1, 1, 5, 1, 5, 5]]);
assert.deepEqual([list.startHourUtc, list.endHourUtc], [12, 36]);
// Another world's day, and a day never kept, have no replay.
assert.deepEqual(replays.contents(1, 'another-world'), { available: false });
assert.deepEqual(replays.contents(7, runtime.worldId), { available: false });

// The day is a file: a restart reads it back and carries on with it.
step(replays, 21); await settle(replays);
assert.ok(fs.existsSync(replays.fileOf(1)), 'the day\'s file is written as the hours go by');
const again = make();
step(again, 21.5);
held = again.contents(1, runtime.worldId);
assert.deepEqual(held.mesoHours, [12, 13, 14, 15, 16, 17, 18, 19, 20, 21], 'the hours kept before the restart are there');
assert.equal(held.warnings, 2);

// The next day begins: yesterday is written and can still be asked for; today starts empty.
for (let hour = 22; hour <= 37; hour += 0.5) step(again, hour);
await settle(again);
assert.deepEqual(again.contents(2, runtime.worldId).mesoHours, [36, 37]);
assert.equal(again.contents(1, runtime.worldId).mesoHours.length, 24, 'a whole day is 24 hourly frames (12Z to 11Z)');
assert.equal(make().contents(1, runtime.worldId).mesoHours.length, 24, 'a past day is read from its file');

// Sixteen world days on, the replay is let go: its file is removed and it is no longer answered.
step(again, 12 + 24 * REPLAY.keepDays); await settle(again);
assert.equal(fs.existsSync(again.fileOf(1)), false, 'the old day\'s file is gone');
assert.deepEqual(again.contents(1, runtime.worldId), { available: false });
assert.equal(again.contents(2, runtime.worldId).available, true, 'a day inside the 16 is still kept');
// A new world: the old world's replays are not this world's.
runtime.worldId = 'world-two-uvwxyz'; step(again, 12.5);
assert.deepEqual(again.contents(2, 'world-one-abcdef'), { available: false });
console.log('Replay archive checks passed');
