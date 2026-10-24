// The storms as the game draws them (js/storms/StormAppearance.js) and the game's frames
// (server/GameFeed.js): the funnel follows the vortex's pressure deficit against the cloud base
// (narrowing to the ground, stopping short of it under a high base or a weak vortex, a wedge
// under a wide strong one); the names only describe the shape; the feed's frames run forward in
// time, a poll gives only what the game lacks, and a game that has lost its place starts again;
// each storm's rain and hail near the ground is a fixed-size grid from the radar's own field.
import assert from 'node:assert/strict';
import { funnelProfile, describeFunnel, FUNNEL, stormLife, buildStormFeedList } from '../js/storms/StormAppearance.js';
import { buildStormGeometry } from '../js/storms/StormGeometry.js';
import { GameFeed, GAME_FEED } from '../server/GameFeed.js';
import { buildSkyAppearance } from '../js/world/SkyAppearance.js';
import { stormPrecipGrid, PRECIP_GRID } from '../js/radar/StormPrecipGrid.js';
import { WIND_PROFILE_LEVELS, WIND_PROFILE_STEP_M } from '../js/radar/PrecipitationField.js';
import { Storm } from '../js/storms/Storm.js';
import { evolveStormStructure } from '../js/storms/StormStructureEngine.js';

const MPH = 0.44704, G = 9.81, r2t = v => Math.round(v * 100) / 100;

// A strong vortex under a low base: condensed to the ground, narrowing all the way down.
const strong = funnelProfile(90, 200, 400);
assert.equal(strong.bottomM, 0, 'a 200 mph vortex under a 400 m base condenses to the ground');
for (let i = 1; i < strong.radii.length; i++) assert.ok(strong.radii[i] >= strong.radii[i - 1], 'the funnel widens toward the cloud base');
assert.equal(describeFunnel(strong, 400).name, 'wedge', 'a wide strong vortex under a low base is a wedge');

// A weak vortex under a high base: the cloud stops short, by the depth its deficit can lift.
const weak = funnelProfile(70 * MPH, 20, 1400);
assert.ok(Math.abs(weak.bottomM - (1400 - FUNNEL.deficitFactor * (70 * MPH) ** 2 / G)) < 1e-6, 'the funnel reaches down K v^2 / g from the base');
assert.equal(weak.radii[0], 0, 'nothing condenses at the ground');
assert.equal(describeFunnel(weak, 1400).name, 'uncondensed');

// A narrow vortex condensed most of the way: thin; leaning or decaying, a rope.
const narrow = funnelProfile(45, 15, 500);
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
