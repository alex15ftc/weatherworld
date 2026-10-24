// The daily storm log (storm reports and tornado tracks) and the damage survey made from it.
import assert from 'node:assert/strict';
import { logStormTick, logDays, convectiveDay, LOG } from '../js/reports/stormLog.js';
import { surveyTornado } from '../js/reports/damageSurvey.js';
import { damageAt, efFromWind } from '../js/reports/damageIndicators.js';

// Degrees of damage: no damage below the first degree's bounds; a house's slab swept clean
// only near 200 mph; the estimate stays within the degree's bounds.
assert.equal(damageAt('FR12', 50, 0.5), null);
assert.equal(damageAt('FR12', 215, 0.5).dod, 10);
const roof = damageAt('FR12', 125, 0.5);
assert.ok(roof.dod >= 5 && roof.dod <= 7 && roof.estimatedMph >= roof.lowerMph && roof.estimatedMph <= roof.upperMph, JSON.stringify(roof));
// A tree cannot rate a tornado above EF3: its highest degree's upper bound is 167 mph.
assert.ok(damageAt('TH', 230, 0.5).ef <= 3);
assert.equal(efFromWind(64), -1); assert.equal(efFromWind(110), 1); assert.equal(efFromWind(136), 3);
assert.equal(convectiveDay(12), 1); assert.equal(convectiveDay(35.9), 1); assert.equal(convectiveDay(36), 2);

// A small world: one storm with a tornado crossing a town, then lifting.
const layer = {
  miles: 100, towns: [{ name: 'Testville', x: 50, y: 50, population: 20000 }],
  counties: [{ name: 'Test', office: 'TST' }], at: () => 0
};
const places = { layer, milesPerKm: 1 };
const tornado = { onGround: true, cycleCount: 1, startedHourUtc: 20, windSpeedMph: 160, widthYards: 400, positionKm: { x: 45, y: 50 }, trackPoints: [{ x: 44.5, y: 50, hourUtc: 19.9 }] };
const storm = { id: 'S0001', active: true, tornado, positionKm: { x: 46, y: 50 }, currentHailSizeInches: 2.2, surfaceWind: { gustMph: 80 }, velocityKph: { east: 50, north: 0 } };
const world = { validHourUtc: 20, stormEngine: { validHourUtc: 20 }, storms: [storm], stormHistory: [{ id: 'old' }] };
for (let k = 0; k < 12; k++) {
  world.stormEngine.validHourUtc = 20 + k / 12;
  tornado.positionKm = { x: 45 + k * 0.9, y: 50 };
  storm.positionKm = { x: 46 + k * 0.9, y: 50 };
  logStormTick(world, places);
}
tornado.onGround = false;
world.stormEngine.validHourUtc = 21;
logStormTick(world, places);
const log = world.reportLog, today = log.days[1];
assert.equal(today.tornadoes.length, 1);
const entry = today.tornadoes[0];
assert.ok(entry.ended && entry.points.length === 13, 'the touchdown point and one each tick, then ended');
assert.equal(today.reports.filter(r => r.type === 'tornado').length, 1, 'a tornado is reported once');
const hail = today.reports.filter(r => r.type === 'hail');
// The town under the core reports the core's size (2.2 in, reported as 2 in); anyone else along
// the way reports what fell where they were, never more than the core's.
assert.equal(hail.filter(r => r.location === 'Testville').length >= 1 && hail.find(r => r.location === 'Testville').size, 200, 'the town under the core reports its size');
assert.ok(hail.every(r => r.size >= 100 && r.size <= 200 && r.office === 'TST'), JSON.stringify(hail.map(r => r.size)));
assert.ok(today.reports.some(r => r.type === 'wind' && r.measured), 'a big town close by measures the gust');
assert.deepEqual(world.stormHistory, [{ id: 'old' }], 'within the day the history stays');

// The survey: a centreline, contours up to the wind's EF, the rating from the damage found.
const ground = { groundAt: (x, y) => (Math.hypot(x - 50, y - 50) < 2 ? 'townCore' : 'farm'), schoolAt: () => false, industrialAt: () => false };
const survey = surveyTornado(entry, ground, places, 7);
assert.ok(survey.lengthMi > 9 && survey.lengthMi < 11, `length ${survey.lengthMi}`);
assert.deepEqual(survey.contours.map(c => c.ef), [0, 1, 2, 3], 'contours to EF3 for 160 mph');
assert.ok(survey.points.length > 20, 'a town in the path gives many damage points');
assert.ok(['EF2', 'EF3'].includes(survey.rating), `rated ${survey.rating} from damage`);
assert.ok(survey.towns.includes('Testville'));
// Open country with nothing on it: EF-Unknown.
const empty = surveyTornado(entry, { groundAt: () => null, schoolAt: () => false, industrialAt: () => false }, places, 7);
assert.equal(empty.rating, 'EFU'); assert.equal(empty.points.length, 0);

// A new day lets the old storms go, and the log keeps LOG.keepDays days.
world.stormEngine.validHourUtc = 36.1; world.storms = [];
logStormTick(world, places);
assert.deepEqual(world.stormHistory, []);
assert.deepEqual(logDays(log).map(d => d.day), [2, 1]);
world.stormEngine.validHourUtc = 36 + 24 * LOG.keepDays;
logStormTick(world, places);
assert.ok(!log.days[1], 'days older than the log keeps are dropped');

console.log('storm reports: ok');
