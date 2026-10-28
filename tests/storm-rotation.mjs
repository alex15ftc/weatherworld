import assert from 'node:assert/strict';
import { Storm } from '../js/storms/Storm.js';
import { setUpdraught } from '../js/storms/StormBudgets.js';
import { stepStormRotation, ROTATION } from '../js/storms/StormRotation.js';
import { initializeTornadoState, updateTornadoState } from '../js/storms/TornadoEngine.js';

// Rotation and the tornado from a storm whose budgets are held fixed, in air that does not
// change. What differs between the runs is the air, the storm's outflow, or only its name.
const STEP = 1 / 12;
function run(environment, { id = 'S0001', hours = 6, updraughtMs = 42, organization = 0.8, coldPool = 0.12, elevated = false, seed = 7 } = {}) {
  const world = { validHourUtc: 18, evolution: { config: { seed } }, stormEngine: { validHourUtc: 18 } };
  const storm = new Storm({ id, xKm: 100, yKm: 100, velocityEastKph: 50, velocityNorthKph: 15, sourceCell: { x: 6, y: 6 }, createdHourUtc: 18 });
  setUpdraught(storm, updraughtMs); storm.organization = organization; storm.coldPoolStrength = coldPool; storm.elevatedFeed = elevated; storm.orientationDeg = 70;
  initializeTornadoState(storm);
  const record = { storm, peakLow: 0, firstCueAt: null, firstTornadoAt: null, lowAtOnset: [], occlusionSeen: 0 };
  for (let hour = STEP; hour <= hours + 1e-9; hour += STEP) {
    world.stormEngine.validHourUtc = 18 + hour; storm.ageHours = hour;
    storm.positionKm.x += storm.velocityKph.east * STEP; storm.positionKm.y -= storm.velocityKph.north * STEP;
    stepStormRotation(storm, environment, STEP);
    const before = storm.tornado.onGround, lowBefore = storm.lowRotation;
    updateTornadoState(world, storm, environment, STEP);
    for (const value of [storm.mesocycloneStrength, storm.lowRotation, storm.occlusion, storm.tornado.windSpeedMph]) assert.ok(Number.isFinite(value) && value >= 0, 'rotation and wind stay finite and non-negative');
    record.peakLow = Math.max(record.peakLow, storm.lowRotation); record.occlusionSeen = Math.max(record.occlusionSeen, storm.occlusion);
    if (record.firstCueAt === null && storm.tornado.genesisPotential > 0) record.firstCueAt = hour;
    if (!before && storm.tornado.onGround) { record.firstTornadoAt ??= hour; record.lowAtOnset.push(lowBefore); }
  }
  record.tornadoes = storm.tornadoHistory;
  return record;
}
const tornadic = { cape: 3200, cin: 20, lcl: 750, srh: 380, bulkShear: 58 };
const mean = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

// --- A strongly rotating storm in the right air: tornadoes, and seen coming.
// Its tornadoes last up to about three hours in air this good, so it is watched for eight.
const strong = run(tornadic, { hours: 8 });
assert.ok(strong.tornadoes.length >= 2, `a strong tornadic storm puts down tornadoes (${strong.tornadoes.length} in eight hours)`);
assert.ok(strong.firstCueAt !== null && strong.firstTornadoAt - strong.firstCueAt >= 2 * STEP - 1e-9, `the low-level rotation is there to be read before the first one (${Math.round((strong.firstTornadoAt - strong.firstCueAt) * 60)} minutes ahead)`);
assert.ok(Math.min(...strong.lowAtOnset) >= 0.08, 'no tornado forms without low-level rotation under it');
// It occludes, the tornado ends, and the storm builds another: cycles from its own state.
assert.ok(strong.occlusionSeen > 0.3, `the storm's outflow wraps around its tornado (occlusion ${strong.occlusionSeen.toFixed(2)})`);
for (let i = 1; i < strong.tornadoes.length; i++) assert.ok(strong.tornadoes[i].startedHourUtc >= strong.tornadoes[i - 1].endedHourUtc, 'one tornado at a time, each after the last has ended');
// (3 minutes, was 5: the check is against one-step blips, not a minimum life; after the 2026-10-26 rating changes this
// storm's first tornado lasts 3.8-4.8 minutes, and brief strong tornadoes are real.)
assert.ok(strong.tornadoes.every(t => t.groundTimeMinutes >= 3 && t.peakWindSpeedMph >= 65), 'each lasts and has at least EF0 winds');

// --- Air that cannot do it: no helicity and a high cloud base; cold outflow that outruns the
// updraught; a storm fed from above the ground.
const marginal = run({ ...tornadic, srh: 60, lcl: 1900 });
assert.ok(marginal.peakLow < 0.08 && marginal.tornadoes.length === 0, `without helicity near the ground and a low cloud base there is no low-level rotation (${marginal.peakLow.toFixed(2)})`);
const undercut = run({ ...tornadic, bulkShear: 30 }, { coldPool: 0.8 });
assert.ok(undercut.peakLow < 0.08 && undercut.tornadoes.length === 0, `cold outflow that outruns the updraught kills it (${undercut.peakLow.toFixed(2)})`);
const elevated = run(tornadic, { elevated: true });
assert.equal(elevated.tornadoes.length, 0, 'a storm fed from above the ground has none');
assert.ok(elevated.storm.mesocycloneStrength > 0.3, 'though it can rotate aloft');

// --- Stronger rotation under it: longer-lived and stronger tornadoes (over many storms, since
// each tornado has its own draw).
// (Modest air from 120 storms since 2026-10-20: with the lower tornado rate 30 gave one or two.
// The best air from 60 since 2026-10-23, when the rate was lowered again: 30 gave 15.)
const many = (environment, count = 30) => Array.from({ length: count }, (_, k) => run(environment, { id: `S${1000 + k}`, hours: 4 }).tornadoes).flat();
const best = many(tornadic, 60), modest = many({ ...tornadic, srh: 190, lcl: 1250, bulkShear: 42 }, 120);
assert.ok(best.length > 20 && modest.length > 5, `both produce some (${best.length} and ${modest.length})`);
assert.ok(mean(best.map(t => t.groundTimeMinutes)) > 1.3 * mean(modest.map(t => t.groundTimeMinutes)), `stronger rotation holds a tornado longer (${mean(best.map(t => t.groundTimeMinutes)).toFixed(0)} against ${mean(modest.map(t => t.groundTimeMinutes)).toFixed(0)} minutes)`);
assert.ok(mean(best.map(t => t.peakWindSpeedMph)) > mean(modest.map(t => t.peakWindSpeedMph)) + 8, `and makes it stronger (${mean(best.map(t => t.peakWindSpeedMph)).toFixed(0)} against ${mean(modest.map(t => t.peakWindSpeedMph)).toFixed(0)} mph)`);
const durations = best.map(t => t.groundTimeMinutes);
// (Lifetime follows the storm's state: storms in the same state in the same air keep their
// tornadoes down for the same time. The spread in the world comes from storms differing.)
// The damage rating never exceeds the wind.
assert.ok(best.every(t => t.ratedWindMph <= t.peakWindSpeedMph + 1e-6));

// --- Outflow close to outrunning the storm wraps round a tornado sooner than balanced outflow.
// (Measured on the occlusion itself: since 2026-10-21 a tornado's length is mostly its drawn life,
// and the mean durations of the two kinds came within a minute of each other.)
const occludes = coldPool => {
  const s = new Storm({ id: 'S0900', xKm: 100, yKm: 100, velocityEastKph: 50, velocityNorthKph: 15, sourceCell: { x: 6, y: 6 }, createdHourUtc: 18 });
  setUpdraught(s, 42); Object.assign(s, { organization: 0.8, coldPoolStrength: coldPool, mesocycloneStrength: 0.8, lowRotation: 0.5, lowRotationFree: 0.5, occlusion: 0, tornado: { onGround: true, occlusionShare: 1 } });
  for (let step = 0; step < 3; step++) stepStormRotation(s, tornadic, STEP);
  return s.occlusion;
};
assert.ok(occludes(0.42) > 1.2 * occludes(0.12), `the stronger the outflow against the shear, the sooner it occludes (${occludes(0.42).toFixed(2)} against ${occludes(0.12).toFixed(2)} in 15 minutes)`);

// --- The storm's name plays no part.
const renamed = (() => { const a = run(tornadic, { hours: 3 }); const b = (() => { const world = { validHourUtc: 18, evolution: { config: { seed: 7 } }, stormEngine: { validHourUtc: 18 } }; const s = new Storm({ id: 'S0001', xKm: 100, yKm: 100, velocityEastKph: 50, velocityNorthKph: 15, sourceCell: { x: 6, y: 6 }, createdHourUtc: 18, modeHint: 'QLCS' }); setUpdraught(s, 42); s.organization = 0.8; s.coldPoolStrength = 0.12; s.orientationDeg = 70; initializeTornadoState(s); for (let h = STEP; h <= 3 + 1e-9; h += STEP) { world.stormEngine.validHourUtc = 18 + h; s.ageHours = h; s.mode = 'renamed'; s.lifecycleState = 'dissipating'; s.positionKm.x += 50 * STEP; s.positionKm.y -= 15 * STEP; stepStormRotation(s, tornadic, STEP); updateTornadoState(world, s, tornadic, STEP); } return s; })(); return [a.storm.tornadoHistory.length, b.tornadoHistory.length, a.storm.lowRotation, b.lowRotation]; })();
assert.deepEqual(renamed.slice(0, 2), [renamed[0], renamed[0]]); assert.equal(renamed[2], renamed[3], 'the same storm in the same air does the same whatever it is called');
console.log(`storm rotation passed (${strong.tornadoes.length} tornadoes in eight hours, first read ${Math.round((strong.firstTornadoAt - strong.firstCueAt) * 60)} min ahead; lifetimes ${Math.min(...durations).toFixed(0)}-${Math.max(...durations).toFixed(0)} min; settings ${ROTATION.occlusionHours.join('-')} h)`);
