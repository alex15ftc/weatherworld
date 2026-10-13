import assert from 'node:assert/strict';
import fs from 'node:fs';
import v8 from 'node:v8';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { insideRings } from '../js/forecast/contourShapes.js';
import { OUTLOOK, runOutlookMember, stateFromBytes, combineOutlook, publicOutlook, describeArea, hoursToDayEnd, writeDiscussion } from '../js/forecast/DayOneOutlook.js';
import { WORLD_RISK_ORDER, WORLD_HAZARDS, PROBABILITY_LEVELS, worldCategoryFromHazard } from '../js/forecast/worldRiskCategories.js';
import { CHANCE_FIELDS } from '../js/verification/truth.js';
import { OutlookRuntime } from '../server/OutlookRuntime.js';

const rank = c => WORLD_RISK_ORDER.indexOf(c);

// --- The outlook day runs 12Z to 12Z.
assert.equal(hoursToDayEnd(12), 24); assert.equal(hoursToDayEnd(36), 24); assert.equal(hoursToDayEnd(18), 18); assert.equal(hoursToDayEnd(11.5), 0.5); assert.equal(hoursToDayEnd(60.5), 23.5);

// --- From made-up members: chances are the members' average; contour levels, intensity groups
// and categories follow.
const width = 30, height = 30, n = width * height;
function member(k, { tornadoAt = null, strength = 1, storms = true } = {}) {
  const chance = Object.fromEntries(CHANCE_FIELDS.map(f => [f, new Float32Array(n)])), thunder = new Uint8Array(n);
  if (tornadoAt) for (let i = 0; i < n; i++) {
    const d = Math.hypot(i % width - tornadoAt.x, Math.floor(i / width) - tornadoAt.y), fall = Math.exp(-(d * d) / 60);
    // 90% tornado at the heart, EF2+ 40%, EF3+ 15%, EF4+ 4%; hail 60% (2 in 12%); wind 50% (75 mph 5%).
    chance.tornado[i] = 90 * strength * fall; chance.tornadoSig[i] = 40 * strength * fall; chance.tornadoExtreme[i] = 15 * strength * fall; chance.tornadoViolent[i] = 4 * strength * fall;
    chance.hail[i] = 60 * fall; chance.hailSig[i] = 12 * fall; chance.wind[i] = 50 * fall; chance.windSig[i] = 5 * fall;
    if (storms && d < 14) thunder[i] = 1;
  }
  const byHour = { storms: new Array(24).fill(0), severe: new Array(24).fill(0), tornado: new Array(24).fill(0) };
  if (tornadoAt) { byHour.storms[21] = 6; byHour.storms[22] = 4; byHour.severe[22] = 2; byHour.severe[23] = 2; byHour.severe[0] = 2; byHour.tornado[0] = 2; byHour.tornado[1] = 1; }
  return { member: k, width, height, cellMiles: 10, chance, thunder, storms: tornadoAt ? 30 + k : 0, tornadoes: tornadoAt ? Math.round(6 * strength) + k : 0, maxHailInches: tornadoAt ? 2.5 : 0, maxGustMph: tornadoAt ? 70 : 0, strongestTornadoMph: tornadoAt ? 150 : 0, byHour,
    environment: { moistShare: 0.6, cape: 3200, capeMedian: 2200, cin: 30, shear: 48, helicity: 220, dewpoint: 66, cloudBaseM: 1000, aloftKt: 55, aloftFromDeg: 240 }, lines: [{ type: 'dryline', x: 0.3, y: 0.5, lengthKm: 400, northSouth: true }] };
}
const spot = { x: 22, y: 8 };   // the north-east of the map
const o = combineOutlook([0, 1, 2, 3].map(k => member(k, { tornadoAt: spot })), { issuedHourUtc: 36, validToHourUtc: 60, seed: 9 });
const centre = spot.y * width + spot.x, corner = (height - 1) * width;
assert.ok(Math.abs(o.chance.tornado[centre] - 90) < 1e-3, 'where every member agrees the chance is the members\' chance');
// The chance is given only as the contour level it has reached.
assert.equal(o.level.tornado[centre], 60); assert.equal(o.level.hail[centre], 60); assert.equal(o.level.wind[centre], 45); assert.equal(o.level.tornado[corner], 0);
for (const hazard of WORLD_HAZARDS) assert.ok(o.level[hazard].every(v => v === 0 || PROBABILITY_LEVELS[hazard].includes(v)), `${hazard}: only contour levels`);
assert.deepEqual(o.top.tornado.level, 60); assert.equal(o.top.wind.level, 45);
// Intensity groups: the highest tier with a 10% chance. EF3+ at 15%: CIG2; 2 in hail at 12%: CIG1; 75 mph wind at 5%: none.
assert.equal(o.cig.tornado[centre], 2); assert.equal(o.cig.hail[centre], 1); assert.equal(o.cig.wind[centre], 0); assert.equal(o.cig.tornado[corner], 0);
assert.equal(o.top.tornado.cig, 2);
// The category is what the chance and the group give together, for the hazard that gives most.
assert.equal(o.category[centre], worldCategoryFromHazard('tornado', 90, 2)); assert.equal(o.highest, o.category[centre]); assert.equal(o.leading, 'tornado');
assert.equal(o.category[corner], 'NONE');
for (let k = 2; k < WORLD_RISK_ORDER.length; k++) assert.ok(o.areas[WORLD_RISK_ORDER[k]] <= o.areas[WORLD_RISK_ORDER[k - 1]] + 1e-9, 'a higher category covers no more of the map');
// Half the members without the event: half the chance, a lower contour, a lower category.
const split = combineOutlook([member(0, { tornadoAt: spot }), member(1, { tornadoAt: spot }), member(2), member(3)], { issuedHourUtc: 36, validToHourUtc: 60 });
assert.equal(split.level.tornado[centre], 45); assert.equal(split.cig.tornado[centre], 1, 'EF3+ at 7.5% no longer makes CIG2; EF2+ at 20% makes CIG1');
assert.ok(rank(split.highest) < rank(o.highest), 'members that disagree give a lower category'); assert.equal(split.expected.membersWithTornado, 2);
// Storms without severe weather are a thunderstorm area (10% or more of the members); nothing at all is no area.
const calm = combineOutlook([0, 1, 2].map(k => ({ ...member(k), thunder: Uint8Array.from({ length: n }, (_, i) => (i < 200 ? 1 : 0)) })), { issuedHourUtc: 36, validToHourUtc: 60 });
assert.equal(calm.highest, 'TSTM'); assert.equal(calm.category[0], 'TSTM'); assert.equal(calm.category[n - 1], 'NONE'); assert.equal(calm.leading, null);

// --- The discussion says what the maps show, and gives chances only as contour levels.
assert.match(o.discussion, new RegExp(`THERE IS (A|AN) [A-Z]+ RISK OF SEVERE THUNDERSTORMS OVER .*NORTHEASTERN`));
assert.match(o.discussion, /\.\.\.SUMMARY\.\.\.[\s\S]*\.\.\.SYNOPSIS\.\.\.[\s\S]*TORNADO:[\s\S]*HAIL:[\s\S]*WIND:[\s\S]*\.\.\.UNCERTAINTY\.\.\./, 'summary, synopsis, each hazard and the uncertainty, in that order');
assert.match(o.discussion, /\(60% tornado area, CIG2\)/); assert.match(o.discussion, /\(60% hail area, CIG1\)/); assert.match(o.discussion, /\(45% wind area\)/);
const percents = [...o.discussion.matchAll(/(\d+(?:\.\d+)?)%/g)].map(m => Number(m[1])), allowed = new Set([...PROBABILITY_LEVELS.tornado, ...PROBABILITY_LEVELS.wind, ...PROBABILITY_LEVELS.hail]);
assert.ok(percents.length > 0 && percents.every(p => allowed.has(p)), `every percentage in the discussion is a contour level (${percents.join(', ')})`);
assert.match(o.discussion, /intense \(EF3\+\)/); assert.match(o.discussion, /southwesterly flow aloft \(55 kt at 500 mb\)/); assert.match(o.discussion, /a dryline over the western part/);
assert.match(o.discussion, /develop from about 21Z \(3 pm local\)/);
assert.match(calm.discussion, /NO SEVERE THUNDERSTORM AREAS FORECAST/); assert.doesNotMatch(calm.discussion, /TORNADO:/);
assert.equal(writeDiscussion(o), o.discussion, 'the same outlook gives the same words');
assert.equal(describeArea(new Array(n).fill(true), width, height), 'most of the region');
assert.equal(describeArea(new Array(n).fill(false), width, height), null);
assert.match(describeArea(Array.from({ length: n }, (_, i) => i % width < 10 && Math.floor(i / width) >= 20), width, height), /southwestern/);

// --- What the page gets: the three hazards, each with its intensity groups, and the levels to draw.
const page = publicOutlook(o);
assert.equal(page.status, 'issued'); assert.equal(page.category.length, n); assert.equal(page.categories[page.category[centre]], o.highest);
for (const hazard of WORLD_HAZARDS) { assert.equal(page.chance, undefined, 'the chances themselves are not sent'); assert.equal(page.cig[hazard].length, n); assert.deepEqual(page.levels[hazard], PROBABILITY_LEVELS[hazard]); }
assert.equal(page.thunderLevel, 10); assert.deepEqual(page.maxCig, { tornado: 3, wind: 3, hail: 2 });
assert.ok(JSON.stringify(page).length < 400000, 'small enough to send');
// The areas go out as outlines: one per category and contour level reached, and per intensity group.
const centreAt = [(centre % width + 0.5) / width, (Math.floor(centre / width) + 0.5) / height], cornerAt = [(corner % width + 0.5) / width, (Math.floor(corner / width) + 0.5) / height];
assert.equal(page.shapes.category.at(-1).key, o.highest);
assert.ok(insideRings(page.shapes.category.at(-1).rings, ...centreAt) && !insideRings(page.shapes.category.at(-1).rings, ...cornerAt));
assert.deepEqual(page.shapes.tornado.levels.map(entry => entry.level), PROBABILITY_LEVELS.tornado.filter(level => level <= o.top.tornado.level), 'only contour levels, and only those reached');
for (const hazard of WORLD_HAZARDS) { assert.equal(page.shapes[hazard].groups.length, o.top[hazard].cig); for (const entry of page.shapes[hazard].levels) assert.ok(insideRings(entry.rings, ...centreAt) && !insideRings(entry.rings, ...cornerAt)); }
assert.ok(insideRings(page.shapes.tornado.groups.at(-1).rings, ...centreAt));
assert.deepEqual(publicOutlook(calm).shapes.tornado, { levels: [], groups: [] });

// --- A real member: the world run ahead with its storms' chances drawn afresh.
const atmosphere = new AtmosphereWorld({ seed: 3, spinUpDays: 6 }); atmosphere.advance(30);   // to 18Z of the second day
const bytes = v8.serialize(atmosphere.saveState()), hours = 8;
const first = runOutlookMember(stateFromBytes(bytes), 0, hours), again = runOutlookMember(stateFromBytes(bytes), 0, hours), other = runOutlookMember(stateFromBytes(bytes), 1, hours);
for (const field of CHANCE_FIELDS) { assert.equal(first.chance[field].length, atmosphere.world.width * atmosphere.world.height); assert.ok(first.chance[field].every(v => v >= 0 && v <= 100)); }
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
console.log(`day one outlook passed (made-up day ${o.highest}; real members ${first.storms} and ${other.storms} storms; server issued ${issued.highest} in ${(outlooks.lastRunMs / 1000).toFixed(0)} s; cig level ${OUTLOOK.cigChance}%)`);
