// The chaser network (server/ChaserArchive.js): game servers' player reports become live dots and
// day tracks; the public view carries no names, ids or servers and renumbers tracks each day; the
// admin view carries them; a Studio server leaves no tracks; points are one a sampleS; world days
// split at 24 UTC; tracks survive a save and restore and are dropped for a new world. Under a second.
//   node tests/chaser-archive.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChaserArchive, roleOf } from '../server/ChaserArchive.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chasers-')), file = path.join(dir, 'chasers.bin');
const runtime = { worldId: 'w1' };
let hour = 48 + 20;                       // world day 2, 20 UTC
const make = () => new ChaserArchive({ runtime, hourNow: () => hour, milesPerKm: () => 0.5, file, params: { saveEveryS: 0 } });
const a = make();
let ms = 1_000_000;
const at = (h, players, server = 'job-aaaaaaaaaaaa') => { hour = h; a.report(server, players, ms); ms += 15_000; };

at(68, [[100, 200, 111, 'Alice', 'alice_r'], [300, 50, 222, 'Bob', 'bobby']]);
at(68.05, [[102, 200, 111, 'Alice', 'alice_r'], [300, 52, 222, 'Bob', 'bobby']]);
a.report('studio', [[10, 10, 999, 'Dev', 'dev']], ms - 5000);
// A second report inside sampleS adds no point.
a.report('job-aaaaaaaaaaaa', [[104, 200, 111, 'Alice', 'alice_r'], [300, 52, 222, 'Bob', 'bobby']], ms - 14_000);

const pub = a.publicLive(ms);
assert.equal(pub.count, 2, 'studio players are not public');
assert.deepEqual(Object.keys(pub), ['hourUtc', 'count', 'dots']);
assert.ok(pub.dots.every(d => d.length === 2), 'public dots are bare positions');
assert.ok(!JSON.stringify(pub).match(/Alice|alice_r|111|job-/), 'no names, ids or servers in public live');

const adm = a.adminLive(ms);
assert.equal(adm.count, 3, 'admin sees studio players too');
assert.ok(adm.players.some(p => p.name === 'Alice' && p.user === 'alice_r' && p.userId === '111'));
assert.equal(adm.players.find(p => p.name === 'Bob').x, 150, 'km to map miles');

const pd = a.dayTracks(2), ad = a.dayTracks(2, { admin: true });
assert.equal(pd.tracks.length, 2, 'the studio player left no track');
assert.equal(pd.stride, 3); assert.equal(ad.stride, 4);
assert.equal(ad.tracks.find(t => t.name === 'Alice').points.length, 2 * 4, 'one point a sampleS');
assert.ok(!JSON.stringify(pd).match(/Alice|alice_r|111|job-|userId|servers"/), 'no names, ids or servers in public tracks');
assert.equal(ad.servers[0], 'job-aaaa');

// Past 24 UTC: a new day, with new public track numbers.
at(72.1, [[110, 200, 111, 'Alice', 'alice_r']]);
assert.deepEqual(a.dayList().days.map(d => d.day), [3, 2]);
assert.equal(a.dayTracks(3).tracks[0].points[0], 6, 'minutes into the world day');
const idDay2 = pd.tracks.map(t => t.id), idDay3 = a.dayTracks(3).tracks[0].id;
assert.ok(!idDay2.includes(idDay3) || idDay2.length === 0, 'a public track number is new each day');

// Saved and restored; a new world starts empty.
await a.save(true);
while (a.saving) await a.saving;
const b = make();
assert.equal(b.dayList().days.length, 2, 'both days kept across a restart');
assert.equal(b.dayTracks(2, { admin: true }).tracks.length, 2, 'tracks kept across a restart');
assert.deepEqual(b.dayTracks(2).tracks.map(t => t.id), idDay2, 'public numbers stay the same within a day');
runtime.worldId = 'w2';
assert.equal(make().dayList().days.length, 0, 'a new world has no tracks');

// Roles: the admin key, or this machine when no key is set.
const req = (key, ip = '10.0.0.5') => ({ headers: key ? { 'x-admin-key': key } : {}, socket: { remoteAddress: ip } });
delete process.env.WEATHER_ADMIN_KEY;
assert.equal(roleOf(req(null, '127.0.0.1')), 'admin'); assert.equal(roleOf(req(null)), 'public');
process.env.WEATHER_ADMIN_KEY = 'sekret';
assert.equal(roleOf(req('sekret')), 'admin'); assert.equal(roleOf(req('nope')), 'public'); assert.equal(roleOf(req(null, '127.0.0.1')), 'public');

fs.rmSync(dir, { recursive: true, force: true });
console.log('chaser archive: ok');
