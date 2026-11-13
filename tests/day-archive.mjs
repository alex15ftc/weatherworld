// Day summaries (server/DayArchive.js): the day's highest-risk Day 1 outlook is kept as the issues come out,
// the summary counts the day's tornadoes against its risk areas, an admin's save keeps a full copy that
// outlives the day and a restart, and the public list holds only saved days.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DayArchive } from '../server/DayArchive.js';

const square = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1];
// A Day 1 outlook as the game product gives it: Slight over most of the map, Moderate inside it, High inside that.
const outlook = (issuedHourUtc, highest) => ({
  v: 1, id: 'outlook.day1', kind: 'outlook', day: 1, status: 'issued', mapMiles: 500, issuedHourUtc, validFromHourUtc: issuedHourUtc, validToHourUtc: 36,
  highest, headline: `${highest} risk`, categories: ['TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'], hazardOrder: ['tornado', 'wind', 'hail'], hazards: {},
  category: [{ key: 'SLGT', rings: [square(50, 50, 450, 450)] }, { key: 'MDT', rings: [square(150, 150, 350, 350)] }, ...(highest === 'HIGH' ? [{ key: 'HIGH', rings: [square(200, 200, 300, 300)] }] : [])],
  discussion: `Day 1 Convective Outlook\n\n...THERE IS A ${highest === 'HIGH' ? 'HIGH' : 'MODERATE'} RISK OF SEVERE THUNDERSTORMS OVER THE FLINT HILLS...\n\n...SUMMARY...\nSevere thunderstorms are expected today over the Flint Hills. The main hazards: several tornadoes; large hail. The greatest risk is over the Flint Hills.\n`
});
const tornado = (id, rating, x, y, lengthMi) => ({ id, rating, peakWindMph: rating === 'EFU' ? null : 80 + 30 * Number(rating[2]), lengthMi, durationMinutes: lengthMi * 1.5, startHourUtc: 22, startPlace: 'A', endPlace: 'B', ongoing: false,
  centreline: Array.from({ length: 200 }, (_, k) => [x + k * lengthMi / 200, y - k * lengthMi / 400]) });
const surveyed = [tornado('S1-T1', 'EF3', 250, 250, 40), tornado('S2-T1', 'EF2', 160, 160, 12), tornado('S3-T1', 'EF0', 60, 60, 2), tornado('S4-T1', 'EF1', 10, 10, 3), tornado('S5-T1', 'EFU', 400, 400, 1)];

const world = { validHourUtc: 12 };
let issue = { version: 'a', text: JSON.stringify(outlook(12, 'MDT')) };
const runtime = { worldId: 'world-1', engine: { world } };
const products = { product: id => (id === 'outlook.day1' ? issue : null) };
const reports = { log: { days: { 1: { day: 1, reports: [{ type: 'hail', size: 275 }, { type: 'hail', size: 150 }, { type: 'wind' }], tornadoes: surveyed.map(t => ({ id: t.id, points: [[0, 0]] })) } } }, damage: () => ({ tornadoes: surveyed }) };
const archive = {
  watches: new Map([[7, { number: 7, type: 'tornado', pds: true, where: 'the Flint Hills', issuedHourUtc: 20 }], [8, { number: 8, type: 'severe', pds: false, where: 'elsewhere', issuedHourUtc: 40 }]]),
  warnings: new Map([['a', { id: 'A-TOR-1', type: 'tornado', issuedHourUtc: 21 }], ['b', { id: 'A-SVR-1', type: 'severe', issuedHourUtc: 22 }], ['c', { id: 'A-TOR-1', type: 'tornado', issuedHourUtc: 21.5 }], ['d', { id: 'A-TOR-9', type: 'tornado', issuedHourUtc: 40 }]])
};
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ww-days-')), 'days.bin');
const make = () => new DayArchive({ runtime, products, reports, archive, layer: () => ({ miles: 500, counties: [], towns: [] }), file });
const days = make();

// The issues of the day: the highest risk is kept, the earliest issue of it.
days.sync();
assert.equal(days.days.get(1).best.highest, 'MDT');
issue = { version: 'b', text: JSON.stringify(outlook(20, 'HIGH')) }; world.validHourUtc = 20; days.sync();
issue = { version: 'c', text: JSON.stringify(outlook(25, 'MDT')) }; world.validHourUtc = 25; days.sync(); days.sync();
const record = days.days.get(1);
assert.deepEqual(record.issues.map(i => [i.issuedHourUtc, i.highest]), [[12, 'MDT'], [20, 'HIGH'], [25, 'MDT']]);
assert.equal(record.best.issuedHourUtc, 20, 'the High risk issue is the one kept');
assert.deepEqual([...record.warnings.values()].sort(), ['severe', 'tornado'], 'each warning of the day once');

// The live summary: for an admin's eyes until it is saved.
world.validHourUtc = 37;
const live = days.summary('live-1'), n = live.numbers;
assert.equal(live.ended, true);
assert.equal(live.outlook.highest, 'HIGH');
assert.match(live.outlook.headline, /High Risk of severe thunderstorms/);
assert.equal(live.outlook.mainHazards, 'several tornadoes; large hail');
assert.equal(live.product, undefined, 'the outlook product is not sent with the summary');
assert.deepEqual(n.byEf, [1, 1, 1, 1, 0, 0]);
assert.deepEqual([n.tornadoes, n.unrated, n.strong, n.violent], [5, 1, 2, 0]);
assert.deepEqual(n.topAreas, ['HIGH', 'MDT']);
assert.equal(n.topAreaName, 'High or Moderate risk area');
assert.deepEqual([n.inTop, n.strongInTop], [2, 2], 'the EF3 began in the High area and the EF2 in the Moderate');
assert.deepEqual(live.tornadoes.map(t => t.category).sort(), ['HIGH', 'MDT', 'NONE', 'SLGT', 'SLGT']);
assert.equal(n.strongest.rating, 'EF3'); assert.equal(n.longest.lengthMi, 40); assert.equal(n.trackMiles, 58);
assert.equal(n.largestHailInches, 2.75);
assert.deepEqual([n.watches, n.tornadoWatches, n.pdsWatches, n.tornadoWarnings, n.severeWarnings], [1, 1, 1, 1, 1]);
const long = live.tornadoes.find(t => t.id === 'S1-T1').track;
assert.ok(long.length < 120 && long.length > 20, `a long track is thinned (${long.length} points)`);
assert.deepEqual(long[0], [250, 250]); assert.deepEqual(long.at(-1).map(Math.round), [290, 230], 'its ends are kept');

// The maps: the outlook as issued, and the tracks over its areas.
assert.match(days.mapSvg('live-1', 'outlook', 'categorical'), /Risk Level/);
const tracks = days.mapSvg('live-1', 'tracks');
assert.match(tracks, /height="1000" viewBox="0 0 1000 1000"/, 'the track map is the map alone');
assert.equal((tracks.match(/stroke-linecap="round"/g) ?? []).length, 15, 'two strokes and a wide unseen one for each of the five tracks');
assert.equal((tracks.match(/data-tornado="S\d-T1"/g) ?? []).length, 5, 'each track names its tornado');
assert.equal(days.mapSvg('nothing', 'tracks'), null);

// The lists: nothing is public until a day is saved.
assert.deepEqual(days.list(false), { role: 'public', saved: [] });
// (day 2 is there as well: a warning of it has been counted)
assert.deepEqual(days.list(true).recent.map(d => [d.id, d.ended, d.highest, d.tornadoes, d.savedId]), [['live-2', false, null, 0, null], ['live-1', true, 'HIGH', 5, null]]);
assert.equal(days.summary('day-1'), null);

// Saved: a full copy under its own id, public, kept across a restart and after the world has let the day go.
const saved = days.keep(1);
assert.equal(saved.id, 'day-1'); assert.equal(saved.saved, true); assert.equal(saved.numbers.tornadoes, 5);
assert.equal(days.list(false).saved[0].id, 'day-1');
assert.equal(days.list(true).recent.find(d => d.day === 1).savedId, 'day-1');
assert.equal(days.summary('live-1').savedId, 'day-1');
await new Promise(resolve => setTimeout(resolve, 200)); // (the file is written in the background)
delete reports.log.days[1]; issue = null; archive.watches.clear(); archive.warnings.clear();
const later = make();
assert.equal(later.saved.size, 1, 'the saved day came back from the file');
assert.equal(later.summary('day-1').numbers.tornadoes, 5);
assert.match(later.mapSvg('day-1', 'tracks'), /stroke-linecap="round"/, 'its maps can still be drawn');
assert.equal(later.days.get(1).best.highest, 'HIGH', 'the days being gathered come back too (the same world)');
runtime.worldId = 'world-2';
const other = make();
assert.equal(other.saved.size, 1, 'a new world keeps the saved days'); assert.equal(other.days.size, 0, 'but not the old world\'s days');
assert.equal(other.build(1), null);
assert.equal(other.remove('day-1'), true); assert.equal(other.remove('day-1'), false); assert.deepEqual(other.list(false).saved, []);
console.log('Day archive checks passed');
