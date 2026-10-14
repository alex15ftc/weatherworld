// Issues mesoscale discussions and watches for the live world. Once an hour of the world's
// time the world is copied and run a few hours ahead several times by the forecast pool's
// threads (ForecastPool.js; every other hour while nothing new is in sight), and the areas where most runs put severe weather are discussed
// (js/forecast/MesoscaleDiscussion.js); those that call for a watch get one as soon as storms
// are firing in them (js/forecast/Watch.js), which is checked every time this is called, not
// only at the hourly look. The live world keeps running meanwhile.
import { MESOSCALE, describeNow, publicMesoscaleDiscussion } from '../js/forecast/MesoscaleDiscussion.js';
import { WATCH, lookAhead, nextLookHourUtc, issueWatch, stormsFiring, readyHourUtc, publicWatch } from '../js/forecast/Watch.js';
import { sharedForecastPool, shareState } from './ForecastPool.js';

export class MesoscaleRuntime {
  // runtime: the weather authority (its `engine` is the live AtmosphereWorld). pool: the
  // threads that do the runs.
  constructor({ runtime, members = MESOSCALE.members, pool = sharedForecastPool() } = {}) {
    this.runtime = runtime; this.members = members; this.pool = pool;
    this.running = null; this.lastError = null; this.lastRunMs = null;
    this.adopt(null);
  }

  // A new world starts its own series.
  adopt(engine) {
    this.engine = engine; this.discussions = []; this.watches = []; this.pending = [];
    this.next = 1; this.nextWatch = 1; this.lastSlot = null; this.nextLookHourUtc = -Infinity;
  }

  slot(hourUtc) { return Math.floor((hourUtc + 1e-6) / MESOSCALE.everyHours); }

  // Call now and then: issues the watches whose storms have begun, and looks at the world
  // once in each of its hours.
  maybeIssue() {
    const engine = this.runtime.engine;
    if (!engine) return false;
    if (engine !== this.engine) this.adopt(engine);
    this.issuePending();
    if (this.running) return false;
    const hour = engine.world.validHourUtc, slot = this.slot(hour);
    if (slot === this.lastSlot) return false;
    this.lastSlot = slot;
    if (hour < this.nextLookHourUtc - 1e-6) return false;
    this.issue().catch(() => {});
    return true;
  }

  // The watches waiting: each goes out when a storm is firing on its ground, or, following a
  // watch over severe weather still going, at the hour that one expires.
  issuePending() {
    const world = this.engine?.world;
    if (!world || !this.pending.length) return [];
    const issued = [];
    this.pending = this.pending.filter(draft => { const hour = readyHourUtc(draft, world); if (hour !== null) issued.push(issueWatch(draft, this.nextWatch++, hour, stormsFiring(world, draft.cells) || draft.here.forming)); return hour === null; });
    if (issued.length) this.watches = [...issued.reverse(), ...this.watches].slice(0, WATCH.kept);
    return issued;
  }

  async issue() {
    const engine = this.runtime.engine, started = Date.now();
    if (engine !== this.engine) this.adopt(engine);
    // The copy and the look at the air are taken now, in one go.
    const state = shareState(engine.saveState({ forecast: true })), now = describeNow(engine);
    // Ahead of any outlook runs waiting: these are short, and a watch should not wait.
    const run = Promise.all(Array.from({ length: this.members }, (_, member) => this.pool.run('mesoscale', state, member, MESOSCALE.hoursAhead, { priority: 1 })));
    this.running = { hourUtc: now.hourUtc, startedAt: started };
    try {
      const members = await run;
      if (this.runtime.engine !== engine) return { discussions: [], watches: [], pending: [] };
      const found = lookAhead(members, now, { discussions: this.discussions, watches: this.watches, nextDiscussion: this.next, nextWatch: this.nextWatch, seed: engine.seed });
      this.next += found.discussions.length; this.nextWatch += found.watches.length;
      this.discussions = [...found.discussions.reverse(), ...this.discussions].slice(0, MESOSCALE.kept);
      this.watches = [...found.watches.reverse(), ...this.watches].slice(0, WATCH.kept);
      this.pending = found.pending;
      this.nextLookHourUtc = nextLookHourUtc(found, now.hourUtc, this.watches);
      this.lastError = null; this.lastRunMs = Date.now() - started;
      return found;
    } catch (error) {
      this.lastError = String(error?.message ?? error);
      throw error;
    } finally {
      this.running = null;
    }
  }

  // What the page asks for: the watches and the discussions, newest first, each marked valid or lapsed.
  list() {
    const engine = this.runtime.engine, current = engine && engine === this.engine, hour = engine?.world?.validHourUtc ?? null;
    return {
      enabled: true, running: Boolean(this.running), members: this.members, error: this.lastError, lastRunMs: this.lastRunMs, nowHourUtc: hour,
      width: engine?.world?.width ?? null, height: engine?.world?.height ?? null, cellMiles: engine?.world?.cellSizeMiles ?? null,
      watches: current ? this.watches.map(watch => ({ ...publicWatch(watch), valid: watch.validToHourUtc > hour })) : [],
      // Watches that will be issued when storms fire on their ground.
      watchesPending: current ? this.pending.map(draft => ({ type: draft.type, pds: draft.pds, where: draft.where, rings: draft.rings, follows: draft.follows ?? null, atHourUtc: draft.notBeforeHourUtc ?? null })) : [],
      discussions: current ? this.discussions.map(md => ({ ...publicMesoscaleDiscussion(md), valid: md.validToHourUtc > hour })) : []
    };
  }

  stop() { return this.pool.stop(); }
}
