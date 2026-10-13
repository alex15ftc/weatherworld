// Mesoscale discussions: areas of concern, watch probabilities, peak intensities, no repeats.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import v8 from 'node:v8';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { stateFromBytes } from '../js/forecast/DayOneOutlook.js';
import { insideRings } from '../js/forecast/contourShapes.js';
import { MESOSCALE, peakRange, watchStep, concerningLine, areaOutcome, runMesoscaleMember, describeNow, buildMesoscaleDiscussions, publicMesoscaleDiscussion } from '../js/forecast/MesoscaleDiscussion.js';
import { MesoscaleRuntime } from '../server/MesoscaleRuntime.js';

// --- The only probabilities given, the words that go with them, and the ranges of the peaks.
assert.deepEqual(MESOSCALE.steps, [5, 20, 40, 60, 80, 95]);
assert.equal(watchStep(0), 5); assert.equal(watchStep(0.27), 20); assert.equal(watchStep(0.5), 40); assert.equal(watchStep(0.55), 60); assert.equal(watchStep(0.85), 80); assert.equal(watchStep(1), 95);
assert.equal(concerningLine(20, false), 'SEVERE POTENTIAL...WATCH UNLIKELY'); assert.equal(concerningLine(60, true), 'SEVERE POTENTIAL...WATCH POSSIBLE');
assert.equal(concerningLine(80, false), 'SEVERE POTENTIAL...SEVERE THUNDERSTORM WATCH LIKELY'); assert.equal(concerningLine(95, true), 'SEVERE POTENTIAL...TORNADO WATCH LIKELY');
assert.equal(peakRange('tornado', 80), 'UP TO 95 MPH'); assert.equal(peakRange('tornado', 105), '85-115 MPH'); assert.equal(peakRange('tornado', 190), '155+ MPH');
assert.equal(peakRange('wind', 50), 'UP TO 60 MPH'); assert.equal(peakRange('wind', 72), '65-80 MPH'); assert.equal(peakRange('hail', 0.5), 'UP TO 1.25 IN'); assert.equal(peakRange('hail', 2), '1.50-2.50 IN');

// --- Made-up runs: a patch of severe weather in the north-east, of a size and strength set for each run.
const width = 50, height = 50, n = width * height, at = (x, y) => y * width + x;
function run(k, { reports = 0, tornadoes = 0, tornadoMph = 0, gust = 62, hail = 1.2, x0 = 28, y0 = 6, first = 1.5 } = {}) {
  const m = { member: k, width, height, cellMiles: 10, hours: 3, near: new Uint8Array(n), reports: new Uint8Array(n), significant: new Uint8Array(n), hail: new Float32Array(n), gust: new Float32Array(n), tornadoMph: new Float32Array(n), firstHour: new Float32Array(n).fill(Infinity), tornadoes: [] };
  if (!reports && !tornadoes) return m;
  for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) m.near[at(x, y)] = 1;
  for (let r = 0; r < reports; r++) { const i = at(x0 + 1 + r % 6, y0 + 1 + Math.floor(r / 6)); m.reports[i] = 1; m.firstHour[i] = first; }
  m.hail[at(x0 + 3, y0 + 3)] = hail; m.gust[at(x0 + 4, y0 + 3)] = gust;
  for (let t = 0; t < tornadoes; t++) { m.tornadoes.push(at(x0 + 2 + t, y0 + 4)); m.tornadoMph[at(x0 + 2 + t, y0 + 4)] = tornadoMph; }
  return m;
}
const now = (hourUtc = 44, storms = []) => ({ hourUtc, width, height, cellMiles: 10, dewpoint: new Float32Array(n).fill(67), temperature: new Float32Array(n).fill(84), cape: new Float32Array(n).fill(2600), cin: new Float32Array(n).fill(20), shear: new Float32Array(n).fill(45), helicity: new Float32Array(n).fill(210), cloudBaseM: new Float32Array(n).fill(900), storms, lines: [{ type: 'dryline', cells: [at(30, 8), at(30, 10), at(30, 12)] }] });

// Every run has plenty there, two of them with tornadoes (one strong): a tornado watch is likely.
const big = buildMesoscaleDiscussions([run(0, { reports: 14, tornadoes: 3, tornadoMph: 140, gust: 82, hail: 2.2 }), run(1, { reports: 12, tornadoes: 2, tornadoMph: 118, gust: 78, hail: 1.9 }), run(2, { reports: 16, gust: 70, hail: 2.4 }), run(3, { reports: 11, tornadoes: 1, tornadoMph: 100, gust: 74, hail: 1.7 })], now(), { next: 7, seed: 3 });
assert.equal(big.length, 1);
const md = big[0];
assert.equal(md.number, 7); assert.equal(md.issuedHourUtc, 44); assert.equal(md.validToHourUtc, 44 + MESOSCALE.validHours);
assert.equal(md.watchPercent, 95); assert.equal(md.tornadoWatch, true); assert.equal(md.concerning, 'SEVERE POTENTIAL...TORNADO WATCH LIKELY');
assert.equal(md.areaCells, 64); assert.match(md.where, /north-central/);
assert.ok(insideRings(md.rings, 0.63, 0.19) && !insideRings(md.rings, 0.2, 0.8), 'its outline is the area');
// Most probable peaks: the middle of the runs' strongest, given as ranges.
assert.equal(md.peakText.wind, '65-80 MPH'); assert.equal(md.peakText.hail, '1.50-2.50 IN'); assert.equal(md.peakText.tornado, '85-115 MPH');
// Laid out as the real ones are.
assert.match(md.text, /^Mesoscale Discussion 0007\n\nAreas affected\.\.\.[\s\S]*\n\nConcerning\.\.\.SEVERE POTENTIAL\.\.\.TORNADO WATCH LIKELY\n\nValid 022000Z - 022200Z\n\nProbability of Watch Issuance\.\.\.95 percent\n\nSUMMARY\.\.\.[\s\S]*\n\nDISCUSSION\.\.\.[\s\S]*\n\nMOST PROBABLE PEAK TORNADO INTENSITY\.\.\.85-115 MPH\nMOST PROBABLE PEAK WIND GUST\.\.\.65-80 MPH\nMOST PROBABLE PEAK HAIL SIZE\.\.\.1\.50-2\.50 IN$/);
assert.match(md.text, /expected to develop within the next hour or two/); assert.match(md.text, /No storms have formed in the area yet/); assert.match(md.text, /A dryline lies across the area/);
assert.match(md.text, /A tornado watch will likely be needed/);
const sent = publicMesoscaleDiscussion(md); assert.equal(sent.cells, undefined); assert.ok(sent.rings.length && sent.environment.cape > 0);

// Half the runs get to what a watch needs and the others most of the way: possible; and no
// tornado peak is given when few runs have a tornado.
const maybe = buildMesoscaleDiscussions([run(0, { reports: 12 }), run(1, { reports: 11 }), run(2, { reports: 7 }), run(3, { reports: 6, tornadoes: 1, tornadoMph: 85 })], now())[0];
assert.equal(maybe.watchPercent, 60);
assert.equal(buildMesoscaleDiscussions([run(0, { reports: 12 }), run(1, { reports: 11 }), run(2, { reports: 3 }), run(3, { reports: 2 })], now())[0].watchPercent, 40, 'half get there, the others nowhere near');
assert.equal(buildMesoscaleDiscussions([run(0, { reports: 12 }), run(1, { reports: 11 }), run(2, { reports: 13 }), run(3, { reports: 2 })], now())[0].watchPercent, 80); assert.equal(maybe.concerning, 'SEVERE POTENTIAL...WATCH POSSIBLE'); assert.equal(maybe.peakText.tornado, null); assert.doesNotMatch(maybe.text, /PEAK TORNADO/);
// Too little for the lowest probability given, an area too small, or runs that do not agree: nothing.
assert.equal(buildMesoscaleDiscussions([run(0, { reports: 1 }), run(1, { reports: 1 }), run(2, { reports: 1 }), run(3, { reports: 1 })], now()).length, 0);
assert.equal(buildMesoscaleDiscussions([run(0, { reports: 14 }), run(1), run(2), run(3)], now()).length, 0, 'one run in four is not an area of concern');
assert.equal(buildMesoscaleDiscussions([], now()).length, 0);
// Storms already severe there: it says so.
const under = buildMesoscaleDiscussions([0, 1, 2, 3].map(k => run(k, { reports: 12 })), now(44, [{ cell: at(30, 9), hail: 1.5, gust: 60, tornado: false, rotating: true, line: false, intensity: 0.7 }]))[0];
assert.match(under.text, /Severe thunderstorms are ongoing/); assert.match(under.text, /One storm is in the area, 1 of them severe/); assert.equal(under.startsInHours, 0);

// --- No second discussion for the same ground, unless the concern has stepped up.
const strong = [0, 1, 2, 3].map(k => run(k, { reports: 14 })), weak = [0, 1, 2, 3].map(k => run(k, { reports: 5 }));
const first = buildMesoscaleDiscussions(weak, now(44));
assert.equal(first[0].watchPercent, 20, 'no run gets to a watch, but there is severe weather to speak of'); assert.equal(first[0].concerning, 'SEVERE POTENTIAL...WATCH UNLIKELY');
assert.equal(buildMesoscaleDiscussions(weak, now(45), { active: first, next: 2 }).length, 0, 'the same concern an hour later: nothing new');
const stepped = buildMesoscaleDiscussions(strong, now(46), { active: first, next: 2 });
assert.equal(stepped.length, 1, 'a watch now likely: a new one'); assert.equal(stepped[0].number, 2);
assert.equal(buildMesoscaleDiscussions(strong, now(47), { active: [...stepped, ...first], next: 3 }).length, 0);
assert.equal(buildMesoscaleDiscussions(weak, now(44 + MESOSCALE.repeatHours + 1), { active: first, next: 2 }).length, 1, 'long enough after, the ground may be discussed again');
assert.equal(buildMesoscaleDiscussions([0, 1, 2, 3].map(k => run(k, { reports: 12, x0: 5, y0: 35 })), now(45), { active: first, next: 2 }).length, 1, 'other ground is its own discussion');
// What a run does in an area.
const outcome = areaOutcome(run(0, { reports: 5, tornadoes: 1, tornadoMph: 120 }), first[0].cells);
assert.equal(outcome.reports, 5); assert.equal(outcome.tornadoes, 1); assert.equal(outcome.toward, 1, 'one strong tornado is enough');

// --- A real run: the world a few hours ahead, the same run twice the same, another run different.
const atmosphere = new AtmosphereWorld({ seed: 3, spinUpDays: 6 }); atmosphere.advance(31);   // 19Z of the second day
const bytes = v8.serialize(atmosphere.saveState()), before = atmosphere.world.validHourUtc;
const a = runMesoscaleMember(stateFromBytes(bytes), 0, 2), again = runMesoscaleMember(stateFromBytes(bytes), 0, 2), b = runMesoscaleMember(stateFromBytes(bytes), 1, 2);
assert.equal(a.near.length, atmosphere.world.width * atmosphere.world.height); assert.deepEqual(again.gust, a.gust, 'the same run twice is the same run');
assert.ok(a.gust.some((v, i) => v !== b.gust[i]), 'another run draws its storms differently');
assert.equal(atmosphere.world.validHourUtc, before, 'the live world is untouched');
const air = describeNow(atmosphere); assert.equal(air.hourUtc, before); assert.equal(air.cape.length, a.near.length); assert.ok(air.dewpoint.some(v => v > 40));

// --- The server's part: once in each hour of the world, in processes of its own.
const runtime = { engine: atmosphere }, meso = new MesoscaleRuntime({ runtime, members: 2 });
assert.equal(meso.list().discussions.length, 0);
assert.equal(meso.maybeIssue(), true); assert.equal(meso.maybeIssue(), false, 'once for the hour');
assert.equal(meso.list().running, true);
while (meso.running) await new Promise(resolve => setTimeout(resolve, 200));
assert.equal(meso.lastError, null, `the look ahead ran (${meso.lastError})`);
const listed = meso.list();
assert.equal(listed.nowHourUtc, before); assert.ok(Array.isArray(listed.discussions));
for (const d of listed.discussions) { assert.equal(d.cells, undefined); assert.ok(MESOSCALE.steps.includes(d.watchPercent) && d.text.startsWith('Mesoscale Discussion') && d.valid === true); }
assert.equal(meso.maybeIssue(), false, 'the same hour is not looked at twice');
runtime.engine = new AtmosphereWorld({ seed: 4, spinUpDays: 4, storms: false });
assert.equal(meso.list().discussions.length, 0, 'a new world starts its own series');
meso.stop(); await meso.cleanup;
assert.equal(fs.readdirSync(meso.scratchDir).filter(name => name.startsWith(`weatherworld-mesoscale-${process.pid}-`)).length, 0, 'the copy of the world is cleaned up');
console.log(`mesoscale discussions passed (made-up ${md.concerning.toLowerCase()}; the server issued ${listed.discussions.length} in ${(meso.lastRunMs / 1000).toFixed(0)} s)`);
