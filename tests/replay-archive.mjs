// Day replays (server/ReplayArchive.js): the hour's mesoanalysis and large-scale frames and the day's warnings
// are kept as the day runs, written to the day's file, read back after a restart, answered as the live pages'
// own routes answer, and let go after REPLAY.keepDays world days. The tornado radar's waiting list is checked
// with a stand-in for the scan itself (a real scan needs a whole world and the radar: checked by running an engine).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
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

// A tornado's kept scans: what each shows, and one scan's products as bytes.
const n = Math.round(REPLAY.boxKm / REPLAY.cellKm) ** 2, boxes = REPLAY.products.map((_, k) => Buffer.alloc(n, k + 1)), packed = zlib.deflateSync(Buffer.concat(boxes));
replays.current.tornadoes['S1-T1'] = { stormId: 'S1', site: 'KCPL', siteName: 'Central Plains', frames: [
  { hourUtc: 19.25, onGround: false, windMph: 0, xKm: 100, yKm: 200, packed }, { hourUtc: 19.333, onGround: true, windMph: 120, xKm: 101, yKm: 199, packed }] };
const meta = replays.tornadoRadar(1, runtime.worldId, 'S1-T1');
assert.deepEqual(meta.frames.map(f => [f.onGround, f.windMph]), [[false, 0], [true, 120]]);
assert.deepEqual([meta.boxKm, meta.cellKm, meta.size, meta.siteName, meta.waiting], [40, 0.25, 160, 'Central Plains', 0]);
assert.equal(meta.frames[0].packed, undefined, 'the list of scans does not carry their bytes');
const scan = replays.tornadoRadar(1, runtime.worldId, 'S1-T1', '1');
for (const [k, key] of REPLAY.products.entries()) { const bytes = Buffer.from(scan.products[key], 'base64'); assert.equal(bytes.length, n); assert.ok(bytes.every(b => b === k + 1), `${key} comes back as it was kept`); }
assert.equal(replays.tornadoRadar(1, runtime.worldId, 'S1-T1', '9'), null);
assert.equal(replays.tornadoRadar(1, runtime.worldId, 'S9-T1'), null);

// Scans still to be worked out wait on the day's list, which is kept in its file.
for (const hour of [20, 20.083, 20.167]) replays.current.queue.push({ snap: { hour, onGround: true, windMph: 100, at: { x: 1, y: 2 } }, tornado: 'S2-T1', stormId: 'S2' });
assert.deepEqual(replays.contents(1, runtime.worldId).radarWaiting, { 'S2-T1': 3 });
assert.equal(replays.radarCost().waiting, 3);

// The day is a file: a restart reads it back and carries on with it.
step(replays, 21); await settle(replays);
assert.ok(fs.existsSync(replays.fileOf(1)), 'the day\'s file is written as the hours go by');
const again = make();
step(again, 21.5);
held = again.contents(1, runtime.worldId);
assert.deepEqual(held.mesoHours, [12, 13, 14, 15, 16, 17, 18, 19, 20, 21], 'the hours kept before the restart are there');
assert.equal(held.warnings, 2); assert.equal(held.tornadoRadar['S1-T1'], 2);
// The waiting list came back with it, and is worked through in order, one scan at a time, once there are radar threads.
assert.deepEqual(held.radarWaiting, { 'S2-T1': 3 });
let atOnce = 0, most = 0;
const standIn = async (day, job) => {
  most = Math.max(most, ++atOnce); await new Promise(resolve => setTimeout(resolve, 5)); atOnce--;
  (day.tornadoes[job.tornado] ??= { stormId: job.stormId, site: 'KCPL', siteName: 'Central Plains', frames: [] }).frames.push({ hourUtc: job.snap.hour, onGround: true, windMph: 100, xKm: 1, yKm: 2, packed });
};
again.scan = standIn; runtime.radarPool = {};
await again.drain();
held = again.contents(1, runtime.worldId);
assert.deepEqual([held.tornadoRadar['S2-T1'], held.radarWaiting, most], [3, {}, 1]);
assert.deepEqual(again.tornadoRadar(1, runtime.worldId, 'S2-T1').frames.map(f => f.hourUtc), [20, 20.083, 20.167]);
assert.equal(again.radarCost().scans, 3);
// A scan that fails is counted and let go; the rest carry on.
again.current.queue.push({ snap: { hour: 21.6 }, tornado: 'S3-T1', stormId: 'S3' }, { snap: { hour: 21.7 }, tornado: 'S2-T1', stormId: 'S2' });
again.scan = async (day, job) => { if (job.tornado === 'S3-T1') throw new Error('test: a scan that fails'); return standIn(day, job); };
const quiet = console.warn; console.warn = () => {};
await again.drain(); console.warn = quiet;
assert.deepEqual([again.radarCost().failed, again.radarCost().waiting, again.contents(1, runtime.worldId).tornadoRadar['S2-T1']], [1, 0, 4]);
// A day that ends with scans waiting keeps them: they are done after it, and its file is written again.
let release; const held35 = new Promise(resolve => { release = resolve; });
again.scan = async (day, job) => { await held35; return standIn(day, job); };
step(again, 35); again.current.queue.push({ snap: { hour: 35.5 }, tornado: 'S2-T1', stormId: 'S2' }); const late = again.drain();

// The next day begins: yesterday is written and can still be asked for; today starts empty.
for (let hour = 22; hour <= 37; hour += 0.5) step(again, hour);
await settle(again);
assert.deepEqual(again.contents(2, runtime.worldId).mesoHours, [36, 37]);
assert.deepEqual(again.contents(1, runtime.worldId).radarWaiting, { 'S2-T1': 1 }, 'yesterday still has a scan waiting');
release(); await late; await settle(again);
assert.deepEqual([again.contents(1, runtime.worldId).tornadoRadar['S2-T1'], again.contents(1, runtime.worldId).radarWaiting], [5, {}]);
assert.equal(make().contents(1, runtime.worldId).tornadoRadar['S2-T1'], 5, 'and its file has the late scan');
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

// The radar map: the whole map's composite every 10 minutes, taken on the first storm tick of each slot, asked for as
// the radar page asks without marking it looked at, kept deflated in the day's file and sent still deflated.
{
  const mapWorld = { validHourUtc: 12 }, storms = { validHourUtc: 12 }, asked = [];
  const mapRuntime = { worldId: 'world-map-abcdef', engine: { world: mapWorld }, atmosphere: { stormEngine: storms }, radarPool: {}, radarWanted: new Map(),
    radarMosaic(kind) { this.radarWanted.set('mosaic|' + kind, 1); asked.push(storms.validHourUtc); return Promise.resolve({ width: 4, height: 3, resKm: 1, validHourUtc: storms.validHourUtc, bytes: Uint8Array.from({ length: 12 }, (_, k) => k * 10) }); } };
  const mapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-replays-map-'));
  const maps = new ReplayArchive({ runtime: mapRuntime, surface: { frames: [] }, synoptic: { frames: [] }, archive: { warnings: new Map() }, dir: mapDir });
  // Storm ticks every 5 minutes for an hour (with a float's drift): six frames, one a slot.
  for (let k = 0; k <= 12; k++) { storms.validHourUtc = 12 + k / 12 + (k % 3 === 1 ? -1e-9 : 1e-9); mapWorld.validHourUtc = storms.validHourUtc; maps.capture(); }
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(asked.length, 7, 'one mosaic a 10-minute slot (12:00 to 13:00)');
  assert.equal(mapRuntime.radarWanted.size, 0, "the replay does not keep the radar page's mosaic being made");
  mapRuntime.radarWanted.set('mosaic|composite', 5); storms.validHourUtc = 13.17; maps.capture();
  assert.equal(mapRuntime.radarWanted.get('mosaic|composite'), 5, "a page's own look is left as it was");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(maps.contents(1, mapRuntime.worldId).radarFrames, 8);
  const mapMeta = maps.radarMap(1, mapRuntime.worldId);
  assert.deepEqual([mapMeta.width, mapMeta.height, mapMeta.resKm, mapMeta.product, mapMeta.frames.length], [4, 3, 1, 'reflectivity', 8]);
  const one = maps.radarMap(1, mapRuntime.worldId, '2');
  assert.deepEqual([...zlib.inflateRawSync(Buffer.from(one.deflated, 'base64'))], Array.from({ length: 12 }, (_, k) => k * 10), 'a frame comes back as it was kept');
  assert.equal(maps.radarMap(1, mapRuntime.worldId, '40'), null);
  // Kept in the day's file.
  mapWorld.validHourUtc = 14; maps.capture(); await settle(maps);
  assert.equal(new ReplayArchive({ runtime: mapRuntime, surface: { frames: [] }, synoptic: { frames: [] }, archive: { warnings: new Map() }, dir: mapDir }).radarMap(1, mapRuntime.worldId).frames.length, 8);
  // Off, or without radar threads, nothing is asked for.
  const before = asked.length;
  new ReplayArchive({ runtime: mapRuntime, surface: { frames: [] }, synoptic: { frames: [] }, archive: { warnings: new Map() }, dir: null, radarMap: false }).capture();
  new ReplayArchive({ runtime: { ...mapRuntime, radarPool: null }, surface: { frames: [] }, synoptic: { frames: [] }, archive: { warnings: new Map() }, dir: null }).capture();
  assert.equal(asked.length, before);
  assert.equal(maps.radarCost().map.frames, 8);
  // A cache not yet moved on hands back the last tick's mosaic: it is not kept twice.
  const stale = mapRuntime.radarMosaic;
  mapRuntime.radarMosaic = () => Promise.resolve({ width: 4, height: 3, resKm: 1, validHourUtc: 13.17, bytes: new Uint8Array(12) });
  storms.validHourUtc = 13.34; mapWorld.validHourUtc = 13.34; maps.capture(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(maps.radarMap(1, mapRuntime.worldId).frames.length, 8);
  mapRuntime.radarMosaic = stale;
}
console.log('Replay archive checks passed');
