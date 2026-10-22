// Tornado and severe thunderstorm warnings: severe limits and damage tiers, radar-indicated
// and observed tornadoes, PDS, the polygon along the storm's path, statements, cancellation,
// expiry and a new warning downstream.
import assert from 'node:assert/strict';
import { WARNING, hailTag, windTag, thunderstormDamage, warningPolygon, warningMinutes, insidePolygon, observeStorm, createWarningState, updateWarnings, inEffect, publicWarning } from '../js/forecast/Warning.js';

const sites = [{ id: 'KCPL', name: 'Central Plains', xKm: 500, yKm: 500 }];
// A storm moving east at 60 km/h, with whatever hazards it is given.
const storm = (id, { x = 400, y = 500, hail = 0.5, gust = 40, chance = 0, onGround = false, groundMinutes = 0, tornadoMph = 0, line = 0 } = {}) => ({
  id, active: true, positionKm: { x, y }, velocityKph: { east: 60, north: 0 }, currentHailSizeInches: hail, surfaceWind: { gustMph: gust },
  tornado: { probability: chance, onGround, groundTimeMinutes: groundMinutes, windSpeedMph: tornadoMph },
  geometry: { wallCloud: { radiusKm: 1 }, hail: { radiusKm: 3 }, gustFront: { leadKm: 5 }, line: { halfLengthKm: line } }
});
const world = (hourUtc, storms) => ({ validHourUtc: hourUtc, stormEngine: { validHourUtc: hourUtc }, storms });
const scan = (state, hourUtc, storms) => updateWarnings(state, world(hourUtc, storms), sites);

// The tags and tiers: NWS sizes and steps, CONSIDERABLE from 1.75 in / 70 mph, DESTRUCTIVE from 2.75 in / 80 mph.
assert.equal(hailTag(0.97), 0.75); assert.equal(hailTag(1.0), 1); assert.equal(hailTag(1.74), 1.5); assert.equal(hailTag(1.8), 1.75); assert.equal(hailTag(3.3), 3);
assert.equal(windTag(58), 60); assert.equal(windTag(64), 60); assert.equal(windTag(69), 65); assert.equal(windTag(71), 70); assert.equal(windTag(40), 40);
assert.equal(thunderstormDamage(1.5, 65), null); assert.equal(thunderstormDamage(1.75, 60), 'CONSIDERABLE'); assert.equal(thunderstormDamage(1, 70), 'CONSIDERABLE');
assert.equal(thunderstormDamage(2.75, 60), 'DESTRUCTIVE'); assert.equal(thunderstormDamage(1, 80), 'DESTRUCTIVE');

// The polygon starts behind the storm and runs along its motion for the warning's time, wider ahead.
const look = observeStorm(storm('a', { hail: 1.2 }));
const polygon = warningPolygon('severe', look);
assert.ok(insidePolygon(polygon, 400, 500), 'the storm is in its own warning');
assert.ok(insidePolygon(polygon, 400 + 60 * warningMinutes('severe', look) / 60, 500), 'and so is where it will be when the warning ends');
// A severe thunderstorm warning runs as long as the storm takes to cover severeAheadKm, within severeMinutes.
assert.equal(warningMinutes('severe', look), 40); assert.equal(warningMinutes('tornado', look), WARNING.minutes.tornado);
assert.equal(warningMinutes('severe', { ...look, east: 150 }), 30); assert.equal(warningMinutes('severe', { ...look, east: 20 }), 60);
assert.ok(!insidePolygon(polygon, 360, 500), 'not far behind it');
assert.ok(Math.abs(polygon[2][1] - polygon[3][1]) > Math.abs(polygon[0][1] - polygon[1][1]), 'wider ahead than behind');
const line = warningPolygon('severe', observeStorm(storm('l', { hail: 1.2, line: 40 })));
assert.ok(insidePolygon(line, 400, 535) && insidePolygon(line, 400, 465), 'a line\'s warning runs along the line');

// Below severe limits: nothing. Severe: a severe thunderstorm warning with no damage tag.
let state = createWarningState();
assert.equal(scan(state, 20, [storm('a', { hail: 0.9, gust: 55 })]).issued.length, 0);
let found = scan(state, 20 + 1 / 12, [storm('a', { hail: 1.1, gust: 55 })]);
assert.equal(found.issued.length, 1);
let svr = found.issued[0];
assert.equal(svr.type, 'severe'); assert.equal(svr.tags.damage, null); assert.equal(svr.tags.hailInches, 1);
assert.match(svr.text, /^BULLETIN - IMMEDIATE BROADCAST REQUESTED\nSevere Thunderstorm Warning\n/);
assert.match(svr.text, /HAZARD\.\.\.Quarter size hail\./); assert.match(svr.text, /MAX HAIL SIZE\.\.\.1\.00 IN/); assert.match(svr.text, /MAX WIND GUST\.\.\.55 MPH/);
assert.match(svr.text, /located 62 miles west of the Central Plains radar \(KCPL\), moving east at 37 mph/);
assert.doesNotMatch(svr.text, /DAMAGE THREAT/);
// The same storm, still inside its warning, gets no second one. Its gusts reach 80 mph on one
// scan: not yet news (tags go up on what two scans show).
found = scan(state, 20 + 2 / 12, [storm('a', { x: 405, hail: 1.1, gust: 82 })]);
assert.equal(found.issued.length, 0); assert.equal(found.updated.length, 0); assert.equal(svr.tags.damage, null);
// On a second: a statement raises it to DESTRUCTIVE, with an EAS request.
found = scan(state, 20 + 3 / 12, [storm('a', { x: 410, hail: 1.1, gust: 82 })]);
assert.equal(found.updated.length, 1); assert.equal(svr.tags.damage, 'DESTRUCTIVE'); assert.equal(svr.tags.gustMph, 80);
const update = svr.statements.at(-1);
assert.equal(update.kind, 'update'); assert.match(update.text, /^Severe Weather Statement\n/); assert.match(update.text, /THIS IS A DESTRUCTIVE STORM/); assert.match(update.text, /THUNDERSTORM DAMAGE THREAT\.\.\.DESTRUCTIVE/);
assert.match(update.text, /Flying debris will be dangerous/);
// A weaker gust next scan does not lower the tags (they hold the most of the last 15 minutes);
// but the hail has now been severe for 15 minutes, so reports are in: HAIL THREAT...OBSERVED.
found = scan(state, 20 + 4 / 12, [storm('a', { x: 415, hail: 1.1, gust: 60 })]);
assert.equal(svr.tags.gustMph, 80); assert.equal(svr.tags.damage, 'DESTRUCTIVE'); assert.equal(svr.tags.hailSource, 'OBSERVED'); assert.equal(svr.tags.windSource, 'OBSERVED', 'severe gusts for 15 minutes too');
assert.equal(found.updated.length, 1); assert.match(svr.statements.at(-1).text, /HAIL THREAT\.\.\.OBSERVED/); assert.match(svr.statements.at(-1).text, /SOURCE\.\.\.Trained weather spotters\./);
// It falls apart: cancelled after WARNING.quietScans quiet scans (four since 2026-10-20), with the reason.
for (let k = 5; k < 4 + WARNING.quietScans; k++) { scan(state, 20 + k / 12, [storm('a', { x: 395 + 5 * k, hail: 0.3, gust: 30 })]); assert.equal(svr.status, 'in effect'); }
found = scan(state, 20 + (4 + WARNING.quietScans) / 12, [storm('a', { x: 395 + 5 * (4 + WARNING.quietScans), hail: 0.3, gust: 30 })]);
assert.equal(svr.status, 'cancelled'); assert.equal(found.ended[0], svr);
assert.match(svr.statements.at(-1).text, /IS CANCELLED[\s\S]*weakened below severe limits/);

// Tornado: rotation alone (radar indicated); then a confirmed tornado (observed); then a strong one (PDS).
state = createWarningState();
assert.equal(scan(state, 22, [storm('t', { chance: WARNING.tornadoChance - 0.05, hail: 1.2 })]).issued.map(w => w.type).join(), 'severe', 'some rotation: a severe thunderstorm warning');
const svrFirst = state.warnings[0];
assert.equal(svrFirst.tags.tornado, 'POSSIBLE'); assert.match(svrFirst.text, /TORNADO\.\.\.POSSIBLE/);
found = scan(state, 22 + 1 / 12, [storm('t', { x: 405, chance: 0.5, hail: 1.2 })]);
const tor = found.issued[0];
assert.equal(tor.type, 'tornado'); assert.equal(tor.tags.tornado, 'RADAR INDICATED'); assert.equal(tor.validToHourUtc - tor.issuedHourUtc, 0.5);
assert.match(tor.text, /^BULLETIN - EAS ACTIVATION REQUESTED\nTornado Warning\n/); assert.match(tor.text, /SOURCE\.\.\.Radar indicated rotation\./); assert.match(tor.text, /capable of producing a tornado/);
assert.equal(svrFirst.status, 'in effect', 'the severe thunderstorm warning already out stays');
// Down for 5 minutes: not yet confirmed. Down for 10: OBSERVED.
scan(state, 22 + 2 / 12, [storm('t', { x: 410, chance: 0.6, onGround: true, groundMinutes: 5, tornadoMph: 90 })]);
assert.equal(tor.tags.tornado, 'RADAR INDICATED');
scan(state, 22 + 3 / 12, [storm('t', { x: 415, chance: 0.6, onGround: true, groundMinutes: 10, tornadoMph: 115 })]);
assert.equal(tor.tags.tornado, 'OBSERVED'); assert.equal(publicWarning(tor, 22.25).pds, false);
assert.match(tor.statements.at(-1).text, /a confirmed tornado was located/); assert.match(tor.statements.at(-1).text, /TORNADO\.\.\.OBSERVED/);
// EF2 winds on a second scan (one is not enough, above): a particularly dangerous situation.
scan(state, 22 + 4 / 12, [storm('t', { x: 420, chance: 0.7, onGround: true, groundMinutes: 15, tornadoMph: 125 })]);
assert.equal(tor.tags.damage, 'CONSIDERABLE'); assert.equal(publicWarning(tor, 22.33).pds, true);
const pds = tor.statements.at(-1).text;
assert.match(pds, /THIS IS A PARTICULARLY DANGEROUS SITUATION/); assert.match(pds, /TORNADO DAMAGE THREAT\.\.\.CONSIDERABLE/); assert.match(pds, /HAZARD\.\.\.Damaging tornado/); assert.match(pds, /life-threatening situation/);
// No severe thunderstorm warning goes out for a storm under a tornado warning.
assert.ok(inEffect(state, 22.4).every(w => w.type === 'tornado' || w === svrFirst));

// A core growing toward the limits is warned before it gets there: 0.8 to 0.9 inch in 5 minutes
// reaches an inch well within 15.
state = createWarningState();
assert.equal(scan(state, 3, [storm('g', { hail: 0.8 })]).issued.length, 0);
assert.equal(scan(state, 3 + 1 / 12, [storm('g', { x: 405, hail: 0.9 })]).issued[0]?.type, 'severe');

// A storm that has left its office's warning sideways is re-warned, and the old one cancelled.
state = createWarningState();
const sidewise = scan(state, 4, [storm('s', { hail: 1.5 })]).issued[0];
scan(state, 4 + 1 / 12, [storm('s', { x: 405, y: 560, hail: 1.5 })]);
assert.equal(sidewise.status, 'cancelled'); assert.equal(inEffect(state, 4.1).length, 1);
assert.match(sidewise.statements.at(-1).text, /moved out of the warned area/);

// A storm about to leave its warning gets a new one downstream; the old one expires on time.
state = createWarningState();
const first = scan(state, 1, [storm('m', { hail: 1.5 })]).issued[0];
let x = 400, hour = 1, next = null;
while (!next && hour < 2) { hour += 1 / 12; x += 5; next = scan(state, hour, [storm('m', { x, hail: 1.5 })]).issued[0]; }
assert.ok(next && next.number === 2, 'a second warning downstream');
assert.ok(next.issuedHourUtc < first.validToHourUtc, 'before the first expires');
while (hour < first.validToHourUtc + 0.01) { hour += 1 / 12; x += 5; scan(state, hour, [storm('m', { x, hail: 1.5 })]); }
assert.equal(first.status, 'expired'); assert.equal(first.endedHourUtc, first.validToHourUtc);
assert.equal(publicWarning(first, hour).history, undefined, 'the page gets no scan history');
console.log('Warnings: tiers, polygons, statements, tornado tags, PDS, cancellation and reissue all behave.');
