// The storms as the game draws them (js/storms/StormAppearance.js) and the game's frames
// (server/GameFeed.js): the funnel follows the vortex's pressure deficit against the cloud base
// (narrowing to the ground, stopping short of it under a high base or a weak vortex, a wedge
// under a wide strong one); the names only describe the shape; the feed's frames run forward in
// time, a poll gives only what the game lacks, and a game that has lost its place starts again;
// each storm's rain and hail near the ground is a fixed-size grid from the radar's own field.
import assert from 'node:assert/strict';
import { describeFunnel, FUNNEL, stormLife, buildStormFeedList } from '../js/storms/StormAppearance.js';
import { tornadoFunnel, TORNADO_FUNNEL, tornadoTilt, ROPE_LEAN } from '../js/storms/TornadoFunnel.js';
import { burgersDrop } from '../js/storms/StormVortices.js';

// The tilt (TornadoFunnel.js, the frames' and the appearance's one rule): upright under its parent, leaning
// toward it as it falls behind (occludes), joined at its circulation's top; the rope-out's lean as it decays.
{
  const at = (wcEastKm, wcSouthKm, extra = {}) => ({ velocityKph: { east: 60, north: 0 }, geometry: { wallCloud: { xKm: 100 + wcEastKm, yKm: 100 + wcSouthKm } },
    tornado: { positionKm: { x: 100, y: 100 }, windSpeedMph: 100, peakWindSpeedMph: 100, ...extra } });
  const upright = tornadoTilt(at(0, 0), { depthM: 1500, baseM: 600 }).at(600);
  assert.ok(Math.hypot(upright.east, upright.north) < 1e-9, 'a mature tornado under its parent stands upright');
  const occluded = tornadoTilt(at(1, -0.5), { depthM: 1500, baseM: 600 });
  const top = occluded.at(1500), base = occluded.at(600);
  // (scaled by the soft bend toward LEAN_LIMIT, leanShare: here 33 deg at the base, near the mature 35)
  const k = occluded.leanShare;
  assert.ok(k > 0.9 && k <= 1 && Math.abs(top.east - 1000 * k) < 1e-6 && Math.abs(top.north - 500 * k) < 1e-6, 'joined to its parent at its circulation\'s top');
  assert.ok(base.east > 0 && base.east < 1000 && Math.abs(occluded.at(0).east) < 1e-9, 'upright at the ground, leaning toward its parent above');
  const rope = tornadoTilt(at(0, 0, { windSpeedMph: 50 }), { depthM: 1500, baseM: 600 });
  assert.equal(rope.decay, 1);
  assert.ok(Math.abs(rope.at(600).north + ROPE_LEAN * 600) < 0.01 * 600, 'decaying under an eastward storm: its top to the south, right of its track');
}
import { buildStormGeometry } from '../js/storms/StormGeometry.js';
import { GameFeed, GAME_FEED } from '../server/GameFeed.js';
import { buildSkyAppearance } from '../js/world/SkyAppearance.js';
import { stormPrecipGrid, PRECIP_GRID } from '../js/radar/StormPrecipGrid.js';
import { WIND_PROFILE_LEVELS, WIND_PROFILE_STEP_M } from '../js/storms/PrecipitationField.js';
import { Storm } from '../js/storms/Storm.js';
import { evolveStormStructure } from '../js/storms/StormStructureEngine.js';

const MPH = 0.44704, G = 9.81, r2t = v => Math.round(v * 100) / 100;

// The funnel (TornadoFunnel.js, the frames' and the appearance's one rule) at the appearance's levels:
// swirl V m/s (the vortex's own, its ground wind less the storm's motion), core R m, under the wall
// cloud's base and the core's condensation level.
const profile = ({ R, V, wallBaseM, coreBaseM = wallBaseM }) => {
  const f = tornadoFunnel({ R, V, rho: 1.2, wallBaseM, coreBaseM });
  return { radii: Array.from({ length: FUNNEL.levels }, (_, i) => f.radiusAt(wallBaseM * i / (FUNNEL.levels - 1))), bottomM: f.tipM };
};
// A strong vortex under a low base: condensed to the ground, narrowing all the way down.
const strong = profile({ R: 200, V: 90, wallBaseM: 400 });
assert.equal(strong.bottomM, 0, 'a 90 m/s vortex under a 400 m base condenses to the ground');
for (let i = 1; i < strong.radii.length; i++) assert.ok(strong.radii[i] >= strong.radii[i - 1], 'the funnel widens toward the cloud base');
assert.equal(describeFunnel(strong, 400).name, 'wedge', 'a wide strong vortex under a low base is a wedge');

// A weak vortex under a high base: the cloud stops short, by the depth its Burgers-Rott drop (1.70 rho V^2) lifts.
const BR = burgersDrop(0, 1, 1, 1);
assert.ok(Math.abs(BR - 1.70) < 0.005, `Burgers-Rott centre drop ${BR} rho V^2`);
const weak = profile({ R: 20, V: 70 * MPH, wallBaseM: 1400 });
assert.ok(Math.abs(weak.bottomM - (1400 - BR * (70 * MPH) ** 2 / G)) < 1e-6, 'the funnel reaches down 1.70 V^2 / g from the base');
assert.equal(weak.radii[0], 0, 'nothing condenses at the ground');
assert.equal(describeFunnel(weak, 1400).name, 'uncondensed');

// The core's air (rain-cooled outflow) condensing below the wall cloud: the funnel hangs from there, and
// between there and the base it is condensed out to where the core draws its air from.
const moist = tornadoFunnel({ R: 40, V: 19, rho: 1.2, wallBaseM: 660, coreBaseM: 400 });
assert.ok(Math.abs(moist.tipM - (400 - BR * 19 ** 2 / G)) < 1e-6, 'from the core\'s condensation level');
assert.equal(moist.radiusAt(500), TORNADO_FUNNEL.coreAirR * 40, 'condensed out to coreAirR core radii above it');
assert.equal(moist.radiusAt(100), 0, 'nothing below its tip');

// A narrow vortex condensed most of the way: thin; leaning or decaying, a rope.
const narrow = profile({ R: 8, V: 45, wallBaseM: 500, coreBaseM: 300 });
assert.ok(['drillbit', 'rope'].includes(describeFunnel(narrow, 500).name));
assert.equal(describeFunnel(narrow, 500, 0.8, 0.6).name, 'rope', 'leaning and decaying, a thin funnel is a rope');

// The feed: frames stamped a tick and a margin after they fall due, never going backwards.
const feed = new GameFeed({ tickMs: 25_000 });
const world = { storms: [], stormEngine: { validHourUtc: 18 }, validHourUtc: 18 };
feed.restart(world, 1_000_000);
feed.capture(world, 1_025_000);
feed.capture(world, 1_020_000);   // late and out of order: still after the last
const all = JSON.parse(feed.poll(null, 1_030_000));
assert.equal(all.reset, true, 'a game with nothing starts afresh');
assert.deepEqual(all.frames.map(f => f.atMs), [1_000_000 + feed.lagMs, 1_025_000 + feed.lagMs, 1_025_000 + feed.lagMs + 1000]);
assert.equal(feed.lagMs, 25_000 + GAME_FEED.marginMs);
const next = JSON.parse(feed.poll(all.frames[1].seq));
assert.equal(next.reset, false);
assert.deepEqual(next.frames.map(f => f.seq), [all.frames[2].seq], 'a poll gives only the frames after the one named');
assert.equal(JSON.parse(feed.poll(all.latestSeq)).frames.length, 0, 'an up-to-date game gets nothing');
for (let i = 0; i < GAME_FEED.keepFrames + 2; i++) feed.capture(world);
assert.equal(JSON.parse(feed.poll(all.frames[0].seq)).reset, true, 'a game whose last frame is no longer kept starts afresh');

// The sky the game lights the world from: block averages of the cells, whole numbers, the day.
assert.equal(JSON.parse(feed.poll(null)).frames[0].sky, null, 'a world without cells has no sky');
const cell = (x, y) => ({ features: { cloudLow: x === 0 ? 1 : 0, cloudMid: 0.5, cloudHigh: 0 }, surface: { temperature: 80 + y, dewpoint: 60, wind: { speed: 10 * x } }, terrain: { soilMoisture: 0.2 } });
const cells = [0, 1, 2].map(y => [0, 1, 2].map(x => cell(x, y)));
const sky = buildSkyAppearance({ cells, width: 3, height: 3 }, { utcOffsetHours: -6, sunriseLocal: 5, sunsetLocal: 19 });
assert.equal(sky.cols, 2); assert.equal(sky.rows, 2);
assert.deepEqual(sky.low, [50, 0, 50, 0], 'cloud shares average over each block, per cent');
assert.deepEqual(sky.mid, [50, 50, 50, 50]);
assert.deepEqual(sky.tF, [80.5, 80.5, 82, 82], 'temperatures to a tenth');
assert.deepEqual(sky.windKt, [5, 20, 5, 20]);
assert.deepEqual(sky.soil, [20, 20, 20, 20]);
assert.deepEqual({ ...sky.sun, latDeg: 0 }, { latDeg: 0, utcOffsetHours: -6, sunriseLocal: 5, sunsetLocal: 19 });
assert.ok(sky.sun.latDeg < 40.9 && sky.sun.latDeg > 30, 'the map lies south of its NW corner');
// The precipitation grid (js/radar/StormPrecipGrid.js) of a mature supercell with large hail, in
// a veering profile: fixed size, whole dBZ (none under the least), hail where the radar's MESH
// finds it, the storm's centre on the grid, the same each time.
const supercell = new Storm({ id: 'TEST-PRECIP', xKm: 300, yKm: 300, velocityEastKph: 45, velocityNorthKph: 25, sourceCell: { x: 0, y: 0 }, createdHourUtc: 21 });
Object.assign(supercell, {
  ageHours: 2.5, intensity: 0.85, organization: 0.9, updraftStrength: 0.9, updraughtMs: 45, precipitation: 0.9, lowRotation: 0.6, occlusion: 0.2,
  currentHailSizeInches: 2.5, mesocycloneStrength: 1.05, rotationStrength: 1, coldPoolStrength: 0.35, orientationDeg: Math.atan2(45, -25) * 180 / Math.PI
});
evolveStormStructure(supercell, { cape: 3200, bulkShear: 55, lapseRate700500: 7.8, dewpoint: 68 }, 0, 'TEST-PRECIP');
const su = new Float32Array(WIND_PROFILE_LEVELS), sv = new Float32Array(WIND_PROFILE_LEVELS);
for (let k = 0; k < WIND_PROFILE_LEVELS; k++) { const z = k * WIND_PROFILE_STEP_M / 1000, turn = Math.min(1, z / 6) * Math.PI / 2; su[k] = (5 + 3 * z) * Math.sin(turn) - 12.5; sv[k] = -(5 + 3 * z) * Math.cos(turn) * 0.5 - 7; }
const input = { storm: supercell, x: 300, y: 300, top: 12500, freezing: 3600, minus20: 6600, su, sv };
const precip = stormPrecipGrid(input);
assert.ok(precip, 'a mature supercell has rain near the ground');
const gridCells = PRECIP_GRID.cols * PRECIP_GRID.rows;
assert.deepEqual([precip.cols, precip.rows, precip.cellKm], [PRECIP_GRID.cols, PRECIP_GRID.rows, PRECIP_GRID.cellKm], 'the grid is always the same size');
assert.equal(precip.dbz.length, gridCells); assert.equal(precip.hailIn.length, gridCells);
assert.ok(precip.dbz.every(v => Number.isInteger(v) && (v === 0 || v >= PRECIP_GRID.leastDbz)), 'whole dBZ, 0 under the least');
assert.ok(precip.hailIn.every(v => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9), 'hail to a tenth of an inch');
const strongest = Math.max(...precip.dbz);
assert.ok(strongest >= 45, `a core of 45 dBZ or more near the ground, got ${strongest}`);
assert.ok(precip.maxDbz >= strongest, 'the strongest echo aloft is at least that near the ground');
assert.ok(Math.max(...precip.hailIn) >= 0.5, `hail of half an inch or more over the core, got ${Math.max(...precip.hailIn)}`);
assert.ok(precip.hailIn.every((v, i) => v === 0 || precip.dbz[i] >= PRECIP_GRID.columnDbz), 'hail only over a core');
assert.equal(precip.snow, undefined, 'no snow under a 3.6 km freezing level');
assert.equal(precip.freezingLevelM, 3600);
const halfKm = PRECIP_GRID.cols * PRECIP_GRID.cellKm / 2 - PRECIP_GRID.edgeKm;
assert.ok(Math.abs(precip.xKm - 300) <= halfKm + 0.01 && Math.abs(precip.yKm - 300) <= halfKm + 0.01, "the storm's centre is on the grid");
assert.deepEqual(stormPrecipGrid(input), precip, 'the same storm gives the same grid');
const bytes = JSON.stringify(precip).length;
assert.ok(bytes < 3000, `the grid is small enough to send each tick, got ${bytes} bytes`);
console.log(`precip grid: max ${strongest} dBZ near the ground, ${precip.maxDbz} aloft, hail ${Math.max(...precip.hailIn)} in, ${bytes} bytes`);

// Where a storm is in its life (life block): a new tower grows from nothing, a storm at what its
// inflow supports is fully grown, one whose inflow has gone is collapsing; merges and splits show
// for two ticks; a storm that dies leaves its anvil drifting and thinning, one merged glides into
// the storm that took it, one that left the map leaves nothing.
const lifeOf = fields => stormLife(Object.assign(new Storm({ id: 'L', xKm: 0, yKm: 0, velocityEastKph: 0, velocityNorthKph: 0, sourceCell: { x: 0, y: 0 }, createdHourUtc: 18 }), fields));
const newborn = lifeOf({});
assert.deepEqual([newborn.ageMin, newborn.growth, newborn.decay, newborn.towering], [0, 0, 0, 1], 'a new storm is an ungrown tower');
const grown = lifeOf({ ageHours: 2, updraughtMs: 40, updraughtTrend: 0, peakUpdraftStrength: 40 / 65 });
assert.deepEqual([grown.ageMin, grown.growth, grown.decay, grown.towering, grown.trend], [120, 1, 0, 0, 0], 'a storm at its potential is grown and holding');
const halfway = lifeOf({ ageHours: 0.2, updraughtMs: 12, updraughtTrend: 1.5 });
assert.ok(halfway.growth > 0.2 && halfway.growth < 0.6 && halfway.towering === 1 && halfway.trend === 1, 'a young storm is part-grown, still a tower, its trend clamped');
const swinging = lifeOf({ ageHours: 2, updraughtMs: 30, updraughtTrend: -0.25, peakUpdraftStrength: 40 / 65 });
assert.equal(swinging.decay, 0, 'a healthy storm whose target dips is not collapsing');
const dying = lifeOf({ ageHours: 2, updraughtMs: 6, updraughtTrend: -1, peakUpdraftStrength: 40 / 65 });
assert.ok(Math.abs(dying.decay - 34 / 36) < 0.01, `a storm without inflow near the end is almost gone, got ${dying.decay}`);
assert.equal(lifeOf({ ageHours: 1, lastMergedFromId: 'S9', mergedAtAgeHours: 0.95 }).mergedFrom, 'S9');
assert.equal(lifeOf({ ageHours: 1.3, lastMergedFromId: 'S9', mergedAtAgeHours: 0.95 }).mergedFrom, undefined, 'a merger shows for two ticks only');
assert.equal(lifeOf({ ageHours: 0.5, parentId: 'S3', splitAtAgeHours: 0.45 }).splitFrom, 'S3');

const env = { lcl: 1000, cape: 3000, bulkShear: 50, dcape: 900, wind500: { eastKt: 40, northKt: 0 }, wind850: { eastKt: 10, northKt: 30 } };
const liveStorm = (id, x) => { const st = new Storm({ id, xKm: x, yKm: 300, velocityEastKph: 40, velocityNorthKph: 10, sourceCell: { x: 0, y: 0 }, createdHourUtc: 18 }); Object.assign(st, { environment: env, ageHours: 2, updraughtMs: 30, intensity: 0.6, precipitation: 0.6, organization: 0.6, coldPoolStrength: 0.3, peakUpdraftStrength: 0.6 }); buildStormGeometry(st, env); return st; };
const keeper = liveStorm('K', 300), dier = liveStorm('D', 500), merged = liveStorm('M', 310), leaver = liveStorm('X', 700);
const lifeWorld = { storms: [keeper, dier, merged, leaver], stormEngine: { validHourUtc: 20 }, stormArchive: [] };
const listed = buildStormFeedList(lifeWorld);
assert.deepEqual(listed.map(a => a.id), ['K', 'D', 'M', 'X']);
assert.ok(listed.every(a => a.life && Object.entries(a.life).every(([, v]) => typeof v === 'number')), 'a living storm\'s life block is all numbers');
lifeWorld.stormArchive.push({ id: 'D', dissipationReason: 'environmental-decay' }, { id: 'M', dissipationReason: 'merged-into-K' }, { id: 'X', dissipationReason: 'left-domain' });
lifeWorld.storms = [keeper];
const step = () => { lifeWorld.stormEngine.validHourUtc += 1 / 12; keeper.positionKm.x += 40 / 12; return new Map(buildStormFeedList(lifeWorld).map(a => [a.id, a])); };
let after = step();
assert.ok(!after.has('X'), 'a storm that left the map leaves nothing');
const anvil = after.get('D'), lastD = listed[1];
assert.equal(anvil.life.decay, 1); assert.equal(anvil.updraft.speedMs, 0); assert.equal(anvil.rain.intensity, 0); assert.equal(anvil.lightningPerMin, 0);
assert.deepEqual(anvil.anvil.lengthKm, lastD.anvil.lengthKm, 'the anvil stays');
assert.ok(Math.abs(anvil.xKm - (lastD.xKm + 40 * 1.852 / 12)) < 0.02 && anvil.eastKph === r2t(40 * 1.852), 'the anvil drifts with the wind aloft');
assert.ok(Math.abs(anvil.updraft.xKm - anvil.xKm - (lastD.updraft.xKm - lastD.xKm)) < 0.02, 'its parts move with it');
assert.ok(anvil.life.fade > 0 && anvil.life.fade < 0.2);
const gliding = after.get('M');
assert.equal(gliding.life.mergeInto, 'K');
assert.ok(Math.hypot(gliding.xKm - keeper.positionKm.x, gliding.yKm - keeper.positionKm.y) < Math.hypot(listed[2].xKm - listed[0].xKm, 0) + 0.01, 'a merged storm closes on the one that took it');
after = step();
assert.ok(after.has('M') && after.get('D').life.fade > anvil.life.fade, 'the anvil thins');
after = step();
assert.ok(!after.has('M'), 'a merged storm shows for two ticks');
for (let i = 0; i < 6; i++) after = step();
assert.ok(!after.has('D'), 'an orphan anvil is gone within 45 minutes');
const lifeBytes = JSON.stringify(listed[0].life).length;
assert.ok(lifeBytes < 160, `the life block is small, got ${lifeBytes} bytes`);
console.log(`life: ${JSON.stringify(listed[0].life)} (${lifeBytes} bytes)`);

console.log('storm appearance and game feed: ok');
