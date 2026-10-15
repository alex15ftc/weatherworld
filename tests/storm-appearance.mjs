// The storms as the game draws them (js/storms/StormAppearance.js) and the game's frames
// (server/GameFeed.js): the funnel follows the vortex's pressure deficit against the cloud base
// (narrowing to the ground, stopping short of it under a high base or a weak vortex, a wedge
// under a wide strong one); the names only describe the shape; the feed's frames run forward in
// time, a poll gives only what the game lacks, and a game that has lost its place starts again.
import assert from 'node:assert/strict';
import { funnelProfile, describeFunnel, FUNNEL } from '../js/storms/StormAppearance.js';
import { GameFeed, GAME_FEED } from '../server/GameFeed.js';

const MPH = 0.44704, G = 9.81;

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
console.log('storm appearance and game feed: ok');
