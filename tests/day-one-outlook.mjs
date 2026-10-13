import assert from 'node:assert/strict';
import fs from 'node:fs';
import v8 from 'node:v8';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { OUTLOOK, runOutlookMember, stateFromBytes, combineOutlook, publicOutlook, describeArea, hoursToDayEnd, writeDiscussion } from '../js/forecast/DayOneOutlook.js';
import { WORLD_RISK_HAZARDS, WORLD_RISK_ORDER, WORLD_RISK_THRESHOLDS } from '../js/forecast/worldRiskCategories.js';
import { OutlookRuntime } from '../server/OutlookRuntime.js';

const rank = c => WORLD_RISK_ORDER.indexOf(c);

// --- The outlook day runs 12Z to 12Z.
assert.equal(hoursToDayEnd(12), 24); assert.equal(hoursToDayEnd(36), 24); assert.equal(hoursToDayEnd(18), 18); assert.equal(hoursToDayEnd(11.5), 0.5); assert.equal(hoursToDayEnd(60.5), 23.5);

// --- From made-up members: chances are the members' average; categories and hatching follow.
const width = 30, height = 30, n = width * height;
function member(k, { tornadoAt = null, strength = 1, storms = true } = {}) {
  const chance = Object.fromEntries(WORLD_RISK_HAZARDS.map(h => [h, new Float32Array(n)])), thunder = new Uint8Array(n);
  if (tornadoAt) for (let i = 0; i < n; i++) {
    const d = Math.hypot(i % width - tornadoAt.x, Math.floor(i / width) - tornadoAt.y), fall = Math.exp(-(d * d) / 60);
    chance.tornado[i] = 90 * strength * fall; chance.tornadoSig[i] = 40 * strength * fall; chance.hail[i] = 60 * fall; chance.wind[i] = 50 * fall; chance.windSig[i] = 5 * fall;
    if (storms && d < 14) thunder[i] = 1;
  }
  const byHour = { storms: new Array(24).fill(0), severe: new Array(24).fill(0), tornado: new Array(24).fill(0) };
  if (tornadoAt) { byHour.storms[21] = 6; byHour.storms[22] = 4; byHour.severe[22] = 2; byHour.severe[23] = 2; byHour.severe[0] = 2; byHour.tornado[0] = 2; byHour.tornado[1] = 1; }
  return { member: k, width, height, cellMiles: 10, chance, thunder, storms: tornadoAt ? 30 + k : 0, tornadoes: tornadoAt ? Math.round(6 * strength) + k : 0, maxHailInches: tornadoAt ? 2.5 : 0, maxGustMph: tornadoAt ? 70 : 0, strongestTornadoMph: tornadoAt ? 150 : 0, byHour,
    environment: { moistShare: 0.6, cape: 3200, capeMedian: 2200, cin: 30, shear: 48, helicity: 220, dewpoint: 66, cloudBaseM: 1000, aloftKt: 55, aloftFromDeg: 240 }, lines: [{ type: 'dryline', x: 0.3, y: 0.5, lengthKm: 400, northSouth: true }] };
}
const spot = { x: 22, y: 8 };   // the north-east of the map
const strong = [0, 1, 2, 3].map(k => member(k, { tornadoAt: spot }));
const o = combineOutlook(strong, { issuedHourUtc: 36, validToHourUtc: 60, seed: 9 });
const centre = spot.y * width + spot.x, corner = (height - 1) * width;
assert.ok(Math.abs(o.chance.tornado[centre] - 90) < 1e-3, 'where every member agrees the chance is the members\' chance');
assert.equal(o.highest, 'HIGH'); assert.equal(o.category[centre], 'HIGH'); assert.equal(o.category[corner], 'NONE');
assert.equal(o.hatch.tornado[centre], 2, 'cross-hatched where a significant tornado is likely'); assert.equal(o.hatch.wind[centre], 0, 'not hatched where it is not'); assert.equal(o.hatch.tornado[corner], 0);
// Categories are nested: every place at a higher category is inside every lower one's area.
for (let k = 2; k < WORLD_RISK_ORDER.length; k++) assert.ok(o.areas[WORLD_RISK_ORDER[k]] <= o.areas[WORLD_RISK_ORDER[k - 1]] + 1e-9, 'a higher category covers no more of the map');
// The hatched area lies where the significant chance passes the hatching level.
for (let i = 0; i < n; i++) assert.equal(o.hatch.tornado[i] >= 1, o.chance.tornadoSig[i] >= OUTLOOK.hatchChance[0]);
// Half the members without the event: half the chance, a lower category.
const split = combineOutlook([member(0, { tornadoAt: spot }), member(1, { tornadoAt: spot }), member(2), member(3)], { issuedHourUtc: 36, validToHourUtc: 60 });
assert.ok(Math.abs(split.chance.tornado[centre] - 45) < 1e-3 && rank(split.highest) < rank(o.highest), 'members that disagree give a lower chance and category');
assert.equal(split.expected.membersWithTornado, 2);
// Storms without severe weather are a thunderstorm area; nothing at all is no area.
const quiet = combineOutlook([0, 1, 2].map(k => ({ ...member(k), thunder: Uint8Array.from({ length: n }, (_, i) => (i < 200 ? 1 : 0)) })), { issuedHourUtc: 36, validToHourUtc: 60 });
assert.equal(quiet.highest, 'TSTM'); assert.equal(quiet.category[0], 'TSTM'); assert.equal(quiet.category[n - 1], 'NONE'); assert.equal(quiet.leading, null);

// --- The discussion says what the maps show.
assert.match(o.discussion, /THERE IS A HIGH RISK OF SEVERE THUNDERSTORMS OVER .*NORTHEASTERN/);
assert.match(o.discussion, /\.\.\.SUMMARY\.\.\.[\s\S]*\.\.\.SYNOPSIS\.\.\.[\s\S]*TORNADO:[\s\S]*HAIL:[\s\S]*WIND:[\s\S]*\.\.\.UNCERTAINTY\.\.\./, 'summary, synopsis, each hazard and the uncertainty, in that order');
assert.match(o.discussion, /reaches 90% over the northeastern part/); assert.match(o.discussion, /strong \(EF2\+\) tornado reaches 40% \(hatched\)/);
assert.match(o.discussion, /southwesterly flow of about 55 kt/); assert.match(o.discussion, /a dryline over the western part/);
assert.match(o.discussion, /develop from about 21Z \(3 pm local\)/);
assert.match(quiet.discussion, /NO SEVERE THUNDERSTORM AREAS FORECAST/); assert.doesNotMatch(quiet.discussion, /TORNADO:/);
assert.equal(writeDiscussion(o), o.discussion, 'the same outlook gives the same words');
assert.equal(describeArea(new Array(n).fill(true), width, height), 'most of the region');
assert.equal(describeArea(new Array(n).fill(false), width, height), null);
assert.match(describeArea(Array.from({ length: n }, (_, i) => i % width < 10 && Math.floor(i / width) >= 20), width, height), /southwestern/);

// --- What the page gets: plain arrays, the three hazards with their significant chances and hatching.
const page = publicOutlook(o);
assert.equal(page.status, 'issued'); assert.equal(page.category.length, n); assert.equal(page.categories[page.category[centre]], 'HIGH');
for (const hazard of ['tornado', 'hail', 'wind']) { assert.equal(page.chance[hazard].length, n); assert.equal(page.significant[hazard].length, n); assert.equal(page.hatch[hazard].length, n); }
assert.ok(JSON.stringify(page).length < 400000, 'small enough to send');
assert.ok(WORLD_RISK_THRESHOLDS.HIGH.tornado <= 90, 'the test\'s High case is past the High threshold');

// --- A real member: the world run ahead with its storms' chances drawn afresh.
const atmosphere = new AtmosphereWorld({ seed: 3, spinUpDays: 6 }); atmosphere.advance(30);   // to 18Z of the second day
const bytes = v8.serialize(atmosphere.saveState()), hours = 8;
const first = runOutlookMember(stateFromBytes(bytes), 0, hours), again = runOutlookMember(stateFromBytes(bytes), 0, hours), other = runOutlookMember(stateFromBytes(bytes), 1, hours);
for (const hazard of WORLD_RISK_HAZARDS) { assert.equal(first.chance[hazard].length, atmosphere.world.width * atmosphere.world.height); assert.ok(first.chance[hazard].every(v => v >= 0 && v <= 100)); }
assert.deepEqual(again.chance.wind, first.chance.wind, 'the same member twice is the same run'); assert.equal(again.storms, first.storms);
assert.ok(first.storms > 0 && other.storms > 0, `storms in both members (${first.storms}, ${other.storms})`);
assert.ok(first.storms !== other.storms || first.chance.wind.some((v, i) => v !== other.chance.wind[i]) || first.chance.hail.some((v, i) => v !== other.chance.hail[i]), 'another member draws its storms differently');
assert.ok(first.environment && first.environment.aloftKt > 0, 'the air the storms will have is described');
// The live world is untouched by the forecast.
const before = atmosphere.world.validHourUtc; assert.equal(before, 12 + 30);
const real = combineOutlook([first, other], { issuedHourUtc: before, validToHourUtc: before + hours, seed: 3 });
assert.ok(real.discussion.startsWith('Day 1 Convective Outlook'));

// --- The server's part: members in their own processes, one outlook per outlook day.
const runtime = { engine: atmosphere }, outlooks = new OutlookRuntime({ runtime, members: 2 });
assert.equal(outlooks.dayOne().status, 'pending');
assert.equal(outlooks.maybeIssue(), true, 'a world with no outlook gets one'); assert.equal(outlooks.maybeIssue(), false, 'not twice at once');
assert.equal(outlooks.dayOne().status, 'running'); assert.equal(outlooks.status().running, true);
while (outlooks.running) await new Promise(resolve => setTimeout(resolve, 250));
assert.equal(outlooks.lastError, null, `the outlook ran (${outlooks.lastError})`);
const issued = outlooks.dayOne();
assert.equal(issued.status, 'issued'); assert.equal(issued.members, 2); assert.equal(issued.issuedHourUtc, before); assert.equal(issued.validToHourUtc, before + hoursToDayEnd(before));
assert.ok(issued.discussion.length > 200 && issued.category.length === atmosphere.world.width * atmosphere.world.height);
assert.equal(outlooks.maybeIssue(), false, 'the same day is not issued again');
assert.equal(atmosphere.world.validHourUtc, before, 'the live world did not move while its outlook was made');
// A new world on the server makes the old outlook stale.
runtime.engine = new AtmosphereWorld({ seed: 4, spinUpDays: 4, storms: false });
assert.equal(outlooks.dayOne().status, 'pending');
outlooks.stop();
assert.equal(fs.readdirSync(outlooks.scratchDir).filter(name => name.startsWith(`weatherworld-outlook-${process.pid}-`)).length, 0, 'the copy of the world is cleaned up');
console.log(`day one outlook passed (made-up day ${o.highest}; real members ${first.storms} and ${other.storms} storms; server issued ${issued.highest} in ${(outlooks.lastRunMs / 1000).toFixed(0)} s)`);
