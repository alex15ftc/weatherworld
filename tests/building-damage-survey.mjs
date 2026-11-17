// The game's real building damage in the surveys (server/BuildingDamage.js, damageSurvey real):
// the game's indicator tables agree with the survey's; a server's reports are kept and merged
// worst-first; where the game looked, the survey's points are its buildings and no draws; jobs
// lease a lifted tornado to one server at a time.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { surveyTornado } from '../js/reports/damageSurvey.js';
import { DAMAGE_INDICATORS, indicatorOf, ratePoint } from '../js/reports/damageIndicators.js';
import { BuildingDamageArchive, chunkOf } from '../server/BuildingDamage.js';

// 1. Every indicator of the game's Damage.DI (roblox/Shared/StormLab/Sim/Damage.luau) is one of
// the survey's, with the same degrees and winds.
const luau = fs.readFileSync('roblox/Shared/StormLab/Sim/Damage.luau', 'utf8');
const start = luau.indexOf('Damage.DI = {'), table = luau.slice(start, luau.indexOf('\n}', start));
const games = [...table.matchAll(/^\t(\w+) = \{\r?$/gm)].map(m => m[1]);
assert.ok(games.length >= 20, `found ${games.length} game indicators`);
for (const key of games) {
  const di = indicatorOf(key);
  assert.ok(di && DAMAGE_INDICATORS[di], `${key} names a survey indicator`);
  const body = table.slice(table.search(new RegExp(`^\\t${key} = \\{`, 'm'))); const block = body.slice(0, body.indexOf('\n\t}'));
  const rows = [...block.matchAll(/\{\s*\w+,\s*"[^"\\]*(?:\\.[^"\\]*)*",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g)].map(m => m.slice(1, 4).map(Number));
  const dods = DAMAGE_INDICATORS[di].dods;
  if (di !== key) { assert.ok(rows.length > 0, key); continue; } // (house, barn, mobileHome, tree, pole: their own component lists)
  assert.equal(rows.length, dods.length, `${key}: ${rows.length} degrees, survey ${dods.length}`);
  rows.forEach((row, i) => assert.deepEqual(row, dods[i].slice(1, 4), `${key} DOD ${i + 1}`));
}

// 2. A rated point stays within its degree's bounds; quality moves it from lower to upper.
const lo = ratePoint('SM', 6, 0), hi = ratePoint('SM', 6, 1);
assert.ok(lo.estimatedMph >= lo.lowerMph - 2 && hi.estimatedMph <= hi.upperMph + 2 && lo.estimatedMph < hi.estimatedMph, JSON.stringify([lo, hi]));
assert.equal(ratePoint('SM', 99, 0.5), null);

// 3. The archive: reports kept, the worst degree a building reached in a tornado's time.
let worldId = 'w1';
const archive = new BuildingDamageArchive({ hourNow: () => 21, worldId: () => worldId });
const layer = { miles: 100, towns: [{ name: 'Testville', x: 50, y: 50, population: 20000 }], counties: [{ name: 'Test', office: 'TST' }], at: () => 0 };
const places = { layer, milesPerKm: 1 };
// a tornado east along y = 50 from x 45 to 55, 160 mph, 400 yards wide, 20 to 21 UTC
const entry = { id: 'T1', day: 1, ended: true, points: Array.from({ length: 13 }, (_, k) => [45 + k * 10 / 12, 50, 20 + k / 12, 160, 400]) };
const onTrack = chunkOf(50, 50);
const taken = archive.report('srvA', {
  events: [[onTrack, 3, 'SM', 50, 50.02, 4, 0.5, 20.5], [onTrack, 3, 'SM', 50, 50.02, 6, 0.5, 20.51], [onTrack, 4, 'house', 50.1, 50.05, 7, 0.2, 20.52],
    ['0,0', 1, 'nonsense', 1, 1, 1, 1, 20], [onTrack, 9, 'SM', 50, 50, 2, 0.5, 5]],
  covered: [[onTrack, 20.5]]
});
assert.equal(taken.events, 4, 'unknown indicators dropped');
archive.report('srvB', { events: [[onTrack, 3, 'SM', 50, 50.02, 6, 0.5, 20.6]] }); // (another server: the same failure)
const real = archive.realFor(entry, 1);
assert.ok(real, 'the game reported in its time');
const sm = real.buildings.find(b => b.di === 'SM' && b.dod === 6);
assert.ok(sm && real.buildings.filter(b => b.di === 'SM').length === 1, 'one strip mall, at its worst degree in the tornado\'s time');
assert.ok(real.buildings.some(b => b.di === 'FR12' && b.dod === 7), 'the game\'s house is a one- or two-family home');
assert.ok(real.covered(50, 50) && !real.covered(46, 50), 'only the chunk the game looked at is covered');

// 4. The survey: where covered, the game's buildings; elsewhere the draws.
const ground = { groundAt: (x, y) => (Math.hypot(x - 50, y - 50) < 2 ? 'townCore' : 'farm'), schoolAt: () => false, industrialAt: () => false };
const drawn = surveyTornado(entry, ground, places, 7);
const mixed = surveyTornado(entry, ground, places, 7, real);
assert.equal(drawn.real.points, 0);
assert.ok(mixed.real.points === 2 && mixed.points.filter(p => p.real).length === 2, JSON.stringify(mixed.real));
assert.ok(mixed.real.coveredShare > 0 && mixed.real.coveredShare < 1, 'part of the swath covered');
assert.ok(!mixed.points.some(p => !p.real && real.covered(p.x, p.y)), 'no drawn points where the game looked');
// Everything covered (a finished job, nothing broken): only the game's buildings, which here are none.
const all = surveyTornado(entry, ground, places, 7, { buildings: [], covered: () => true });
assert.equal(all.points.length, 0); assert.equal(all.rating, 'EFU'); assert.equal(all.real.coveredShare, 1);

// 5. Jobs: a lifted tornado goes to one server at a time, with the chunks already looked at.
const job = archive.job('srvA', [entry], 1);
assert.ok(job && job.id === 'T1' && job.covered.includes(onTrack) && job.track.length === 13, JSON.stringify(job && { ...job, track: job.track.length }));
assert.equal(archive.job('srvB', [entry], 1), null, 'leased to the first server');
archive.report('srvA', { job: { id: 'T1', done: true } });
assert.equal(archive.job('srvA', [entry], 1), null, 'done for good');
assert.ok(archive.realFor({ ...entry, points: entry.points.map(p => [p[0] + 30, ...p.slice(1)]), id: 'T1' }, 1), 'a finished job surveys from the game even with nothing broken');
assert.equal(archive.job('srvA', [{ ...entry, id: 'T2', ended: false }], 1), null, 'only lifted tornadoes');

// 6. A new world starts afresh.
worldId = 'w2';
archive.report('srvA', {});
assert.equal(archive.realFor(entry, 1), null);

console.log('building damage survey: ok');
