// The storms as the game draws them, one frame per storm tick (js/storms/StormAppearance.js).
//
// The game's clock runs behind the engine by one storm tick and a margin (GAME_LAG_MS): a frame
// is shown in the game at atMs, which is when its tick fell due plus the lag. So every game
// server already holds the frame after the one it is showing, and moves each storm smoothly
// between known places instead of guessing ahead; a tornado's touchdown and its end are known
// before they are shown. The margin covers the wait for the server's timer, the tick's work and
// the game's next poll. Every game server places frames by atMs on the wall clock, so all of
// them show the same storm in the same place at the same moment.
//
// Each storm carries its rain and hail near the ground as a small grid (js/radar/StormPrecipGrid.js:
// the radar's own precipitation field, a little coarser), for the game's rain and hail shafts.
//
// Each frame also carries the sky (js/world/SkyAppearance.js): the clouds, air and wind the game
// lights the world from, and where the sun is.
//
// Frames are kept as JSON text, written once, so a poll costs a string join however many game
// servers ask.
import { buildStormFeedList } from '../js/storms/StormAppearance.js';
import { buildSkyAppearance } from '../js/world/SkyAppearance.js';
import { buildStormPrecipGrids } from '../js/radar/StormPrecipGrid.js';

export const GAME_FEED = Object.freeze({ marginMs: 15_000, keepFrames: 12, maxPerPoll: 6 });

export class GameFeed {
  // regional: the regional layer's settings (its day), for the sky.
  constructor({ tickMs, regional = {} }) {
    this.regional = regional;
    this.tickMs = Math.round(tickMs);
    this.lagMs = this.tickMs + GAME_FEED.marginMs;
    this.frames = [];          // { seq, atMs, text }, oldest first
    this.seq = 0;
    this.epoch = Date.now();   // changes when the world is replaced or jumps: the game drops what it holds
  }

  // A fresh start: a new world, or a jump the game should not glide across.
  restart(world, dueMs = Date.now()) {
    this.frames = [];
    this.epoch = Date.now();
    this.capture(world, dueMs);
  }

  // The frame for the storm tick that fell due at dueMs.
  capture(world, dueMs = Date.now()) {
    // Living storms, and for a while the remnants of those that have gone (StormAppearance.js).
    const storms = buildStormFeedList(world, buildStormPrecipGrids(world));
    // Never before the frame already given: the game's frames only run forward.
    const atMs = Math.max(Math.round(dueMs + this.lagMs), (this.frames.at(-1)?.atMs ?? -Infinity) + 1000);
    const frame = { seq: ++this.seq, atMs, simHourUtc: +(world.stormEngine?.validHourUtc ?? world.validHourUtc).toFixed(4), storms, sky: buildSkyAppearance(world, this.regional) };
    this.frames.push({ seq: frame.seq, atMs: frame.atMs, text: JSON.stringify(frame) });
    if (this.frames.length > GAME_FEED.keepFrames) this.frames.shift();
  }

  // The frames after `after` (a seq the game already holds); without one, or if the game has
  // fallen behind what is kept, the latest few, so it has one to start from before its "now".
  poll(after, nowMs = Date.now()) {
    const last = Number(after);
    const known = Number.isFinite(last) && last > 0 && this.frames.some(f => f.seq === last);
    const frames = known ? this.frames.filter(f => f.seq > last).slice(-GAME_FEED.maxPerPoll) : this.frames.slice(-GAME_FEED.maxPerPoll);
    const head = { v: 1, epoch: this.epoch, nowMs: nowMs, lagMs: this.lagMs, tickMs: this.tickMs, latestSeq: this.seq, reset: !known };
    return `${JSON.stringify(head).slice(0, -1)},"frames":[${frames.map(f => f.text).join(',')}]}`;
  }
}
