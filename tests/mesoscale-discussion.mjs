// Mesoscale discussions and watches: areas of concern, watch probabilities, peak intensities,
// lead, no repeats; which watch, PDS, no overlap, no change before expiry, discussions about a watch.
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { stateFromBytes } from '../js/forecast/DayOneOutlook.js';
import { insideRings } from '../js/forecast/contourShapes.js';
import { MESOSCALE, peakRange, watchStep, concerningLine, areaOutcome, runMesoscaleMember, describeNow, buildMesoscaleDiscussions, publicMesoscaleDiscussion } from '../js/forecast/MesoscaleDiscussion.js';
import { WATCH, lookAhead, issueWatch, stormsFiring, probabilityText, publicWatch } from '../js/forecast/Watch.js';
import { MesoscaleRuntime } from '../server/MesoscaleRuntime.js';
import { ForecastPool } from '../server/ForecastPool.js';

// --- The only probabilities given, the words that go with them, and the ranges of the peaks.
assert.deepEqual(MESOSCALE.steps, [5, 20, 40, 60, 80, 95]);
assert.equal(watchStep(0), 5); assert.equal(watchStep(0.27), 20); assert.equal(watchStep(0.5), 40); assert.equal(watchStep(0.55), 60); assert.equal(watchStep(0.85), 80); assert.equal(watchStep(1), 95);
assert.equal(concerningLine(20, false), 'SEVERE POTENTIAL...WATCH UNLIKELY'); assert.equal(concerningLine(60, true), 'SEVERE POTENTIAL...WATCH POSSIBLE');
assert.equal(concerningLine(80, false), 'SEVERE POTENTIAL...SEVERE THUNDERSTORM WATCH LIKELY'); assert.equal(concerningLine(95, true), 'SEVERE POTENTIAL...TORNADO WATCH LIKELY');
assert.equal(peakRange('tornado', 80), 'UP TO 95 MPH'); assert.equal(peakRange('tornado', 105), '85-115 MPH'); assert.equal(peakRange('tornado', 190), '155+ MPH');
assert.equal(peakRange('wind', 50), 'UP TO 60 MPH'); assert.equal(peakRange('wind', 72), '65-80 MPH'); assert.equal(peakRange('hail', 0.5), 'UP TO 1.25 IN'); assert.equal(peakRange('hail', 2), '1.50-2.50 IN');

// --- Made-up runs: a square patch of severe weather (in the north-east unless moved), of a
// size and strength set for each run. storm: when its first storm comes (hours ahead).
const width = 50, height = 50, n = width * height, at = (x, y) => y * width + x;
function run(k, { reports = 0, tornadoes = 0, tornadoMph = 0, gust = 62, hail = 1.2, x0 = 28, y0 = 6, size = 8, first = 1.5, storm = first - 0.5, windSignificant = 0 } = {}) {
  const grid = () => new Uint8Array(n), far = () => new Float32Array(n).fill(Infinity);
  const m = { member: k, width, height, cellMiles: 10, hours: 5, near: grid(), reports: grid(), windReports: grid(), hailReports: grid(), windSignificant: grid(), significant: grid(), hail: new Float32Array(n), gust: new Float32Array(n), tornadoMph: new Float32Array(n), firstHour: far(), stormHour: far(), tornadoes: [], tornadoPeaks: [] };
  if (!reports && !tornadoes) return m;
  for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) m.near[at(x, y)] = 1;
  // Its reports: wind and hail turn about, the first windSignificant of them 75 mph or more.
  for (let r = 0; r < reports; r++) { const i = at(x0 + 1 + r % 6, y0 + 1 + Math.floor(r / 6)); m.reports[i] = 1; (r % 2 ? m.hailReports : m.windReports)[i] = 1; if (r < windSignificant) { m.windSignificant[i] = m.windReports[i] = 1; } m.firstHour[i] = first; }
  m.stormHour[at(x0 + 3, y0 + 3)] = storm; m.hail[at(x0 + 3, y0 + 3)] = hail; m.gust[at(x0 + 4, y0 + 3)] = gust;
  for (let t = 0; t < tornadoes; t++) { m.tornadoes.push(at(x0 + 2 + t, y0 + 4)); m.tornadoPeaks.push(tornadoMph); m.tornadoMph[at(x0 + 2 + t, y0 + 4)] = tornadoMph; }
  return m;
}
const four = settings => [0, 1, 2, 3].map(k => run(k, settings));
const now = (hourUtc = 44, storms = []) => ({ hourUtc, width, height, cellMiles: 10, dewpoint: new Float32Array(n).fill(67), temperature: new Float32Array(n).fill(84), cape: new Float32Array(n).fill(2600), cin: new Float32Array(n).fill(20), shear: new Float32Array(n).fill(45), helicity: new Float32Array(n).fill(210), cloudBaseM: new Float32Array(n).fill(900), storms, lines: [{ type: 'dryline', cells: [at(30, 8), at(30, 10), at(30, 12)] }] });
const stormAt = (x, y, more = {}) => ({ cell: at(x, y), hail: 0.5, gust: 40, tornado: false, rotating: true, line: false, intensity: 0.5, ...more });

// Every run has plenty there, three of them with tornadoes (two strong): a tornado watch is likely.
const big = buildMesoscaleDiscussions([run(0, { reports: 14, tornadoes: 3, tornadoMph: 140, gust: 82, hail: 2.2 }), run(1, { reports: 12, tornadoes: 2, tornadoMph: 118, gust: 78, hail: 1.9 }), run(2, { reports: 16, gust: 70, hail: 2.4 }), run(3, { reports: 11, tornadoes: 1, tornadoMph: 100, gust: 74, hail: 1.7 })], now(), { next: 7, seed: 3 });
assert.equal(big.length, 1);
const md = big[0];
assert.equal(md.number, 7); assert.equal(md.issuedHourUtc, 44); assert.equal(md.validToHourUtc, 44 + MESOSCALE.validHours);
assert.equal(md.watchPercent, 95); assert.equal(md.tornadoWatch, true); assert.equal(md.concerning, 'SEVERE POTENTIAL...TORNADO WATCH LIKELY'); assert.equal(md.watchNumber, null);
assert.equal(md.areaCells, 64); assert.match(md.where, /north-central/);
assert.ok(insideRings(md.rings, 0.63, 0.19) && !insideRings(md.rings, 0.2, 0.8), 'its outline is the area');
// Most probable peaks: the middle of the runs' strongest (a tornado's: of the runs that have one), given as ranges.
assert.equal(md.peakText.wind, '65-80 MPH'); assert.equal(md.peakText.hail, '1.50-2.50 IN'); assert.equal(md.peakText.tornado, '100-130 MPH');
// Laid out as the real ones are.
assert.match(md.text, /^Mesoscale Discussion 0007\n\nAreas affected\.\.\.[\s\S]*\n\nConcerning\.\.\.SEVERE POTENTIAL\.\.\.TORNADO WATCH LIKELY\n\nValid 022000Z - 022200Z\n\nProbability of Watch Issuance\.\.\.95 percent\n\nSUMMARY\.\.\.[\s\S]*\n\nDISCUSSION\.\.\.[\s\S]*\n\nMOST PROBABLE PEAK TORNADO INTENSITY\.\.\.100-130 MPH\nMOST PROBABLE PEAK WIND GUST\.\.\.65-80 MPH\nMOST PROBABLE PEAK HAIL SIZE\.\.\.1\.50-2\.50 IN$/);
assert.match(md.text, /expected to develop within the next hour or two/); assert.match(md.text, /No storms have formed in the area yet/); assert.match(md.text, /A dryline lies across the area/);
assert.match(md.text, /A tornado watch will likely be needed as storms form/);
const sent = publicMesoscaleDiscussion(md); assert.equal(sent.cells, undefined); assert.ok(sent.rings.length && sent.environment.cape > 0);

// Tornadoes of up to 95 mph go with a severe thunderstorm watch, however many of them: a
// tornado watch needs the most probable peak above that range.
const weakTornadoes = buildMesoscaleDiscussions(four({ reports: 12, tornadoes: 3, tornadoMph: 88 }), now())[0];
assert.equal(weakTornadoes.watchPercent, 95); assert.equal(weakTornadoes.peakText.tornado, 'UP TO 95 MPH');
assert.equal(weakTornadoes.tornadoWatch, false); assert.equal(weakTornadoes.concerning, 'SEVERE POTENTIAL...SEVERE THUNDERSTORM WATCH LIKELY');
assert.match(weakTornadoes.text, /a tornado or two/); assert.match(weakTornadoes.text, /A severe thunderstorm watch will likely be needed/);
assert.equal(buildMesoscaleDiscussions(four({ reports: 12, tornadoes: 3, tornadoMph: 104 }), now())[0].concerning, 'SEVERE POTENTIAL...TORNADO WATCH LIKELY', 'the next range up: a tornado watch');

// Half the runs get to what a watch needs and the others most of the way: possible; and no
// tornado peak is given when few runs have a tornado.
const maybe = buildMesoscaleDiscussions([run(0, { reports: 12 }), run(1, { reports: 11 }), run(2, { reports: 7 }), run(3, { reports: 6, tornadoes: 1, tornadoMph: 85 })], now())[0];
assert.equal(maybe.watchPercent, 60);
assert.equal(buildMesoscaleDiscussions([run(0, { reports: 12 }), run(1, { reports: 11 }), run(2, { reports: 3 }), run(3, { reports: 2 })], now())[0].watchPercent, 40, 'half get there, the others nowhere near');
assert.equal(buildMesoscaleDiscussions([run(0, { reports: 12 }), run(1, { reports: 11 }), run(2, { reports: 13 }), run(3, { reports: 2 })], now())[0].watchPercent, 80); assert.equal(maybe.concerning, 'SEVERE POTENTIAL...WATCH POSSIBLE'); assert.equal(maybe.peakText.tornado, null); assert.doesNotMatch(maybe.text, /PEAK TORNADO/);
// Too little for the lowest probability given, an area too small, or runs that do not agree: nothing.
assert.equal(buildMesoscaleDiscussions(four({ reports: 1 }), now()).length, 0);
assert.equal(buildMesoscaleDiscussions([run(0, { reports: 14 }), run(1), run(2), run(3)], now()).length, 0, 'one run in four is not an area of concern');
assert.equal(buildMesoscaleDiscussions([], now()).length, 0);
// Storms already severe there: it says so.
const under = buildMesoscaleDiscussions(four({ reports: 12 }), now(44, [stormAt(30, 9, { hail: 1.5, gust: 60, intensity: 0.7 })]))[0];
assert.match(under.text, /Severe thunderstorms are ongoing/); assert.match(under.text, /One storm is in the area, 1 of them severe/); assert.equal(under.startsInHours, 0); assert.equal(under.stormsInHours, 0);

// --- Lead: a discussion goes out before the storms, and sooner where a tornado watch is in prospect.
assert.deepEqual(MESOSCALE.leadHours, { severe: 1.5, tornado: 3 }); assert.ok(MESOSCALE.hoursAhead > MESOSCALE.leadHours.tornado);
const later = { first: 3.5, storm: 2.5 };
assert.equal(buildMesoscaleDiscussions(four({ reports: 12, ...later }), now()).length, 0, 'severe storms two and a half hours off: not yet');
const early = buildMesoscaleDiscussions(four({ reports: 12, tornadoes: 2, tornadoMph: 125, ...later }), now());
assert.equal(early.length, 1, 'the same with tornadoes: now'); assert.equal(early[0].stormsInHours, 2.5); assert.match(early[0].text, /expected to develop over the next few hours/);
assert.equal(buildMesoscaleDiscussions(four({ reports: 12, first: 2.5, storm: 1.5 }), now()).length, 1, 'and the severe one an hour later');

// --- No second discussion for the same ground, unless the concern has stepped up.
const strong = four({ reports: 14 }), weak = four({ reports: 5 });
const first = buildMesoscaleDiscussions(weak, now(44));
assert.equal(first[0].watchPercent, 20, 'no run gets to a watch, but there is severe weather to speak of'); assert.equal(first[0].concerning, 'SEVERE POTENTIAL...WATCH UNLIKELY');
assert.equal(buildMesoscaleDiscussions(weak, now(45), { active: first, next: 2 }).length, 0, 'the same concern an hour later: nothing new');
const stepped = buildMesoscaleDiscussions(strong, now(46), { active: first, next: 2 });
assert.equal(stepped.length, 1, 'a watch now likely: a new one'); assert.equal(stepped[0].number, 2);
assert.equal(buildMesoscaleDiscussions(strong, now(47), { active: [...stepped, ...first], next: 3 }).length, 0);
assert.equal(buildMesoscaleDiscussions(weak, now(44 + MESOSCALE.repeatHours + 1), { active: first, next: 2 }).length, 1, 'long enough after, the ground may be discussed again');
assert.equal(buildMesoscaleDiscussions(four({ reports: 12, x0: 5, y0: 35 }), now(45), { active: first, next: 2 }).length, 1, 'other ground is its own discussion');
// What a run does in an area.
const outcome = areaOutcome(run(0, { reports: 5, tornadoes: 1, tornadoMph: 120 }), first[0].cells);
assert.equal(outcome.reports, 5); assert.equal(outcome.tornadoes, 1); assert.equal(outcome.strong, 1); assert.equal(outcome.toward, 1, 'one strong tornado is enough');
assert.equal(outcome.wind, 3); assert.equal(outcome.hailCells, 2); assert.equal(outcome.storm, 1);

// --- Watches. An area that calls for one gets it when storms fire there; until then it waits,
// and a discussion says it is coming.
const tornadic = { reports: 14, tornadoes: 2, tornadoMph: 125, gust: 72, hail: 1.8, size: 12 };
const waiting = lookAhead(four(tornadic), now(), { seed: 3 });
assert.equal(waiting.watches.length, 0, 'no storms yet: no watch yet'); assert.equal(waiting.pending.length, 1); assert.equal(waiting.pending[0].type, 'tornado'); assert.equal(waiting.quiet, false);
assert.equal(waiting.discussions.length, 1); assert.equal(waiting.discussions[0].concerning, 'SEVERE POTENTIAL...TORNADO WATCH LIKELY');
// The storms fire: the watch goes out, at that moment.
const liveWorld = (storms = []) => ({ width, height, cellSizeKm: 16, storms });
const liveStorm = (x, y, intensity = 0.5) => ({ active: true, intensity, positionKm: { x: (x + 0.5) * 16, y: (y + 0.5) * 16 } });
assert.equal(stormsFiring(liveWorld([liveStorm(30, 10, 0.1), liveStorm(5, 40)]), waiting.pending[0].cells), 0, 'a weak shower there and a storm elsewhere are not its storms');
assert.equal(stormsFiring(liveWorld([liveStorm(30, 10)]), waiting.pending[0].cells), 1);
const fired = issueWatch(waiting.pending[0], 4, 45.5);
assert.equal(fired.number, 4); assert.equal(fired.issuedHourUtc, 45.5); assert.equal(fired.validToHourUtc, 45.5 + WATCH.hours);
// Storms already firing at the look: the watch goes out with it, and no discussion repeats it.
const firing = now(44, [stormAt(31, 9)]);
const issued = lookAhead(four(tornadic), firing, { seed: 3, nextWatch: 12, nextDiscussion: 5 });
assert.equal(issued.watches.length, 1); assert.equal(issued.pending.length, 0); assert.equal(issued.discussions.length, 0);
const watch = issued.watches[0];
assert.equal(watch.number, 12); assert.equal(watch.type, 'tornado'); assert.equal(watch.pds, false); assert.equal(watch.issuedHourUtc, 44); assert.equal(watch.validToHourUtc, 50);
assert.ok(watch.areaCells >= WATCH.leastCells && watch.areaCells > 144, 'drawn a little wider than the area of concern'); assert.ok(watch.cells[at(30, 10)] && !watch.cells[at(5, 40)]);
assert.ok(insideRings(watch.rings, 0.66, 0.22) && !insideRings(watch.rings, 0.2, 0.8));
assert.deepEqual(watch.probabilities, { tornadoes2: 95, strongTornado: 95, wind10: 5, wind75: 5, hail10: 5, hail2: 5, combined6: 95 });
assert.equal(probabilityText(5), 'Low (<5%)'); assert.equal(probabilityText(40), 'Mod (40%)'); assert.equal(probabilityText(80), 'High (80%)'); assert.equal(probabilityText(95), 'High (>95%)');
assert.match(watch.text, /^URGENT - IMMEDIATE BROADCAST REQUESTED\nTornado Watch Number 12\n\nA tornado watch is in effect for [\s\S]*\nfrom 022000Z until 030200Z\.\n\nPrimary threats include\.\.\.\n  Several tornadoes and a couple of strong tornadoes likely\n/);
assert.match(watch.text, /REMEMBER\.\.\.A tornado watch means/); assert.match(watch.text, /WATCH PROBABILITIES\.\.\.\n  2 or more tornadoes \.+High \(>95%\)/); assert.doesNotMatch(watch.text, /PARTICULARLY DANGEROUS/);
const page = publicWatch(watch); assert.equal(page.cells, undefined); assert.equal(page.title, 'Tornado Watch 12'); assert.equal(page.table.length, 7); assert.ok(page.rings.length);
// Which watch: weak tornadoes, or none, make it a severe thunderstorm watch.
const severe = lookAhead(four({ reports: 14, tornadoes: 3, tornadoMph: 90, size: 12 }), firing).watches[0];
assert.equal(severe.type, 'severe'); assert.match(severe.text, /^URGENT - IMMEDIATE BROADCAST REQUESTED\nSevere Thunderstorm Watch Number 1\n/); assert.match(severe.text, /A tornado or two possible/); assert.match(severe.text, /REMEMBER\.\.\.A severe thunderstorm watch means/);
assert.equal(lookAhead(four({ reports: 9, size: 12 }), firing).watches.length, 0, 'short of what a watch needs: none');
assert.equal(lookAhead(four({ reports: 14, tornadoes: 2, tornadoMph: 125 }), firing).watches.length, 0, 'ground too small for a watch');
assert.equal(lookAhead(four({ reports: 14, tornadoes: 2, tornadoMph: 125 }), firing).discussions.length, 1, 'but still discussed');
// Particularly dangerous situations: several strong tornadoes in most runs; or a derecho.
const outbreak = lookAhead(four({ ...tornadic, tornadoes: 3, tornadoMph: 150 }), firing).watches[0];
assert.equal(outbreak.pds, true); assert.match(outbreak.text, /\n\.\.\.THIS IS A PARTICULARLY DANGEROUS SITUATION\.\.\.\n/); assert.match(outbreak.text, /Several tornadoes and a few intense tornadoes likely/);
assert.equal(lookAhead(four({ ...tornadic, tornadoes: 1, tornadoMph: 150 }), firing).watches[0].pds, false, 'one strong tornado a run is a tornado watch, not a PDS one');
const derecho = lookAhead(four({ reports: 24, gust: 96, windSignificant: 12, size: 12 }), firing).watches[0];
assert.equal(derecho.type, 'severe'); assert.equal(derecho.pds, true); assert.match(derecho.text, /Widespread damaging winds and isolated significant gusts to 95 mph likely/);
assert.equal(lookAhead(four({ reports: 24, gust: 80, windSignificant: 12, size: 12 }), firing).watches[0].pds, false);

// A watch in effect: no other watch on its ground, and it stands as issued until it expires,
// whatever the runs say later.
const worse = four({ ...tornadic, tornadoes: 4, tornadoMph: 160 });
const hourLater = lookAhead(worse, now(45, [stormAt(31, 9)]), { watches: [watch], nextWatch: 13 });
assert.equal(hourLater.watches.length, 0, 'the ground has its watch'); assert.equal(hourLater.pending.length, 0); assert.equal(hourLater.discussions.length, 0, 'and the last word on it has not lapsed');
assert.equal(watch.pds, false); assert.equal(watch.validToHourUtc, 50);
// Other ground at the same time gets its own; where the two would meet, the new one stops.
const beside = lookAhead([0, 1, 2, 3].map(k => run(k, { ...tornadic, x0: 34, y0: 12 })), now(45, [stormAt(42, 20)]), { watches: [watch], nextWatch: 13 });
assert.equal(beside.watches.length, 1); assert.equal(beside.watches[0].number, 13);
assert.ok(beside.watches[0].cells.every((v, i) => !(v && watch.cells[i])), 'no ground under two watches'); assert.ok(beside.watches[0].cells[at(44, 22)]);
// A discussion about the watch, once the last word on it has lapsed: no probability, the watch named.
const status = lookAhead(four(tornadic), now(46, [stormAt(31, 9, { hail: 1.5 })]), { watches: [watch], nextDiscussion: 9 });
assert.equal(status.watches.length, 0); assert.equal(status.discussions.length, 1);
const about = status.discussions[0];
assert.equal(about.number, 9); assert.equal(about.watchNumber, 12); assert.equal(about.watchPercent, null); assert.equal(about.concerning, 'TORNADO WATCH 12');
assert.match(about.text, /\nConcerning\.\.\.TORNADO WATCH 12\n\nValid 022200Z - 030000Z\n\nThe severe weather threat for Tornado Watch 12 continues\.\n\nSUMMARY\.\.\.Severe thunderstorms are ongoing over this part of the watch/); assert.doesNotMatch(about.text, /Probability of Watch Issuance/);
assert.ok(about.cells.every((v, i) => !v || watch.cells[i]), 'it covers the part of the watch under threat');
assert.equal(lookAhead(four(tornadic), now(47, [stormAt(31, 9)]), { watches: [watch], discussions: [about] }).discussions.length, 0, 'not again while that one is valid');
assert.match(lookAhead(four({ reports: 5, size: 12 }), now(46, [stormAt(31, 9)]), { watches: [watch] }).discussions[0].text, /The severe weather threat for Tornado Watch 12 is waning/);
// Expired: the ground is free again.
const after = lookAhead(worse, now(50, [stormAt(31, 9)]), { watches: [watch], nextWatch: 13 });
assert.equal(after.watches.length, 1); assert.equal(after.watches[0].number, 13); assert.equal(after.watches[0].pds, true);
// No run with a storm anywhere: a quiet look.
assert.equal(lookAhead(four(), now()).quiet, true); assert.equal(lookAhead([], now()).quiet, false);

// --- A real run: the world a few hours ahead, the same run twice the same, another run different.
const atmosphere = new AtmosphereWorld({ seed: 3, spinUpDays: 6 }); atmosphere.advance(31);   // 19Z of the second day
const bytes = v8.serialize(atmosphere.saveState()), before = atmosphere.world.validHourUtc;
const a = runMesoscaleMember(stateFromBytes(bytes), 0, 2), again = runMesoscaleMember(stateFromBytes(bytes), 0, 2), b = runMesoscaleMember(stateFromBytes(bytes), 1, 2);
assert.equal(a.near.length, atmosphere.world.width * atmosphere.world.height); assert.deepEqual(again.gust, a.gust, 'the same run twice is the same run');
assert.ok(a.gust.some((v, i) => v !== b.gust[i]), 'another run draws its storms differently');
assert.equal(a.tornadoes.length, a.tornadoPeaks.length); assert.equal(a.stormHour.length, a.near.length);
assert.equal(atmosphere.world.validHourUtc, before, 'the live world is untouched');
// The smaller copy a forecast run starts from gives the very same run.
const small = v8.serialize(atmosphere.saveState({ forecast: true }));
assert.ok(small.length < 0.5 * bytes.length, `the forecast copy is the smaller (${small.length} of ${bytes.length} bytes)`);
assert.deepEqual(runMesoscaleMember(stateFromBytes(small), 0, 2), a, 'a run from the forecast copy is the run from the full one');
const air = describeNow(atmosphere); assert.equal(air.hourUtc, before); assert.equal(air.cape.length, a.near.length); assert.ok(air.dewpoint.some(v => v > 40));

// --- The server's part: once in each hour of the world, on the forecast pool's threads.
const pool = new ForecastPool({ size: 2 }), runtime = { engine: atmosphere }, meso = new MesoscaleRuntime({ runtime, members: 2, pool });
assert.equal(meso.list().discussions.length, 0); assert.equal(meso.list().watches.length, 0);
assert.equal(meso.maybeIssue(), true); assert.equal(meso.maybeIssue(), false, 'once for the hour');
assert.equal(meso.list().running, true);
while (meso.running) await new Promise(resolve => setTimeout(resolve, 200));
assert.equal(meso.lastError, null, `the look ahead ran (${meso.lastError})`);
const listed = meso.list();
assert.equal(listed.nowHourUtc, before); assert.ok(Array.isArray(listed.discussions) && Array.isArray(listed.watches) && Array.isArray(listed.watchesPending));
for (const d of listed.discussions) { assert.equal(d.cells, undefined); assert.ok((d.watchNumber || MESOSCALE.steps.includes(d.watchPercent)) && d.text.startsWith('Mesoscale Discussion') && d.valid === true); }
for (const w of listed.watches) { assert.equal(w.cells, undefined); assert.ok(/Watch \d+$/.test(w.title) && w.text.startsWith('URGENT') && w.valid === true); }
for (const one of meso.watches) for (const other of meso.watches) assert.ok(one === other || one.cells.every((v, i) => !(v && other.cells[i])), 'the watches do not overlap');
assert.equal(meso.maybeIssue(), false, 'the same hour is not looked at twice');
assert.equal(pool.status().runs, 2, 'the runs were the pool\'s'); assert.ok(pool.status().threads <= 2);
// A watch waiting for its storms goes out when they fire, between the hourly looks.
const everywhere = new Uint8Array(a.near.length).fill(1), count = meso.watches.length;
meso.pending = [{ ...waiting.pending[0], cells: everywhere }];
const firingNow = stormsFiring(atmosphere.world, everywhere);
assert.equal(meso.maybeIssue(), false); assert.equal(meso.watches.length, count + (firingNow ? 1 : 0)); assert.equal(meso.pending.length, firingNow ? 0 : 1);
if (firingNow) { assert.equal(meso.watches[0].issuedHourUtc, before); assert.equal(meso.list().watches[0].number, meso.nextWatch - 1); }
runtime.engine = new AtmosphereWorld({ seed: 4, spinUpDays: 4, storms: false });
assert.equal(meso.list().discussions.length, 0, 'a new world starts its own series'); assert.equal(meso.list().watches.length, 0);
await meso.stop();
assert.equal(pool.status().threads, 0, 'the threads are ended');
console.log(`mesoscale discussions and watches passed (made-up ${md.concerning.toLowerCase()}; the server issued ${listed.discussions.length} discussions and ${listed.watches.length} watches in ${(meso.lastRunMs / 1000).toFixed(0)} s)`);
