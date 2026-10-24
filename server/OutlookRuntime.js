// Issues the Day 1, 2 and 3 outlooks for the live world. Day 1 is issued afresh every 6
// hours, Day 2 every 12 and Day 3 every 24, all counted from 12Z (OUTLOOK.updateHours), and
// all of them when the server first has a world. The members are run by the forecast pool's
// threads (ForecastPool.js), a few at a time, from a copy of the world taken at issue time; the
// live world keeps running meanwhile. One run serves every outlook that is due, and each
// member reports each outlook day separately. Every member goes into Day 1 and half of them into Day 2
// and Day 3 (OUTLOOK.memberShare), but only the days in OUTLOOK.stormShare are run with storms (8 for
// Day 1, 4 for Day 2, none for Day 3): the Day 2 members run on to Day 3 with the atmosphere alone, and
// Day 3 comes from the ingredients for storms. The longest runs are started first.
import { OUTLOOK, combineOutlook, publicOutlook, hoursToDayEnd, membersFor, stormDaysFor } from '../js/forecast/DayOneOutlook.js';
import { WORLD_RISK_ORDER } from '../js/forecast/worldRiskCategories.js';
import { countiesIn, describeRegions } from '../js/forecast/counties.js';
import { countiesFor } from './CountyLayer.js';
import { sharedForecastPool, shareState } from './ForecastPool.js';
// (2026-10-20: issued at the centre's times, OUTLOOK.issueTimesUtc, not every 6, 12 and 24 hours;
// an issue less than OUTLOOK.leadHours before 12Z is for the day that starts then; and each issue
// may raise the category for its day by at most one step from the last, within the caps for Days
// 2 and 3, until the day is under way. The header above describes the earlier schedule.)

export class OutlookRuntime {
  // runtime: the weather authority (its `engine` is the live AtmosphereWorld). days: which
  // outlooks to issue (a prefix of OUTLOOK.days). pool: the threads that do the runs.
  constructor({ runtime, members = OUTLOOK.members, days = OUTLOOK.days, pool = sharedForecastPool() } = {}) {
    this.runtime = runtime; this.members = members; this.days = days; this.pool = pool;
    this.products = {}; this.history = new Map(); this.running = null; this.lastError = null; this.lastRunMs = null; this.failedKey = null;
  }

  // The issue an outlook belongs to at an hour: its update slot, counted from 12Z.
  slot(day, hourUtc) { const times = OUTLOOK.issueTimesUtc[day], dayNumber = Math.floor((hourUtc + 1e-6) / 24), within = hourUtc - 24 * dayNumber; return dayNumber * times.length + times.filter(t => t <= within + 1e-6).length; }
  current(day, engine = this.runtime.engine) { const product = this.products[day]; return product && engine && product.engine === engine ? product : null; }

  // The outlooks with no issue for the slot the live world is in.
  due(engine = this.runtime.engine) {
    const hour = engine.world.validHourUtc;
    return this.days.filter(day => this.current(day, engine)?.slot !== this.slot(day, hour));
  }

  // Call now and then: starts an issue when an outlook is due.
  maybeIssue() {
    const engine = this.runtime.engine;
    if (!engine || this.running) return false;
    const due = this.due(engine);
    if (!due.length) return false;
    if (this.failedKey === this.key(engine, due)) return false;
    this.issue(due).catch(() => {});
    return true;
  }
  key(engine, due) { return `${engine.seed}|${due.map(day => `${day}:${this.slot(day, engine.world.validHourUtc)}`).join(',')}`; }

  async issue(due = this.due()) {
    const engine = this.runtime.engine, key = this.key(engine, due), started = Date.now();
    const issuedHourUtc = engine.world.validHourUtc, dayEnd = issuedHourUtc + hoursToDayEnd(issuedHourUtc);
    // Close to 12Z, Day 1 is the day that starts then.
    const lead = hoursToDayEnd(issuedHourUtc) <= OUTLOOK.leadHours ? 1 : 0, indexOf = day => OUTLOOK.days.indexOf(day) + lead;
    // Each member goes as far ahead as the furthest outlook due that it is one of the runs for.
    const count = day => membersFor(day, this.members);
    const hoursFor = member => dayEnd - issuedHourUtc + 24 * Math.max(...due.filter(day => member < count(day)).map(indexOf));
    const hours = hoursFor(0);
    // The copy is taken now, in one go, so every member starts from the same moment.
    const state = shareState(engine.saveState({ forecast: true }));
    // Member 0 runs furthest and is asked for first, so the long runs are not left to the end.
    const run = Promise.all(Array.from({ length: this.members }, (_, member) => this.pool.run('outlook', state, member, hoursFor(member), { options: { stormDays: stormDaysFor(member, this.members, lead) } })));
    this.running = { key, due, issuedHourUtc, hours, startedAt: started };
    try {
      const members = await run;
      // A world that was reset or replaced meanwhile makes these outlooks stale.
      if (this.runtime.engine === engine) {
        const layer = countiesFor(engine.world), regions = layer ? inside => describeRegions(layer, countiesIn(layer, inside, { least: 0.5 })) : null;
        for (const day of due) {
          const index = indexOf(day), validFromHourUtc = index ? dayEnd + 24 * (index - 1) : issuedHourUtc, validToHourUtc = dayEnd + 24 * index;
          // The caps: the lead's, and one step above the last issue for this day until the day is under way.
          const lastOutlook = this.history.get(validToHourUtc) ?? null, last = lastOutlook?.highest, underWay = issuedHourUtc >= validToHourUtc - 24 + OUTLOOK.nowcastAfterHours;
          const caps = [OUTLOOK.leadCaps[day], !underWay && last ? WORLD_RISK_ORDER[Math.min(WORLD_RISK_ORDER.length - 1, Math.max(WORLD_RISK_ORDER.indexOf('SLGT'), WORLD_RISK_ORDER.indexOf(last) + 1))] : null].filter(Boolean);
          const maxCategory = caps.length ? caps.reduce((a, b) => (WORLD_RISK_ORDER.indexOf(a) <= WORLD_RISK_ORDER.indexOf(b) ? a : b)) : null;
          const outlook = combineOutlook(members.slice(0, count(day)).map(member => member[index]), { day, issuedHourUtc, validFromHourUtc, validToHourUtc, seed: engine.seed, maxCategory, regions, previous: lastOutlook, continuity: lastOutlook ? OUTLOOK.continuity[underWay ? 'underWay' : 'before'] : 0 });
          this.history.set(validToHourUtc, outlook);
          for (const ended of [...this.history.keys()]) if (ended <= issuedHourUtc) this.history.delete(ended);
          this.products[day] = { slot: this.slot(day, issuedHourUtc), engine, outlook, public: publicOutlook(outlook) };
        }
        this.lastError = null; this.failedKey = null;
      }
      this.lastRunMs = Date.now() - started;
      return due.map(day => this.current(day, engine)?.outlook ?? null);
    } catch (error) {
      this.lastError = String(error?.message ?? error); this.failedKey = key;
      throw error;
    } finally {
      this.running = null;
    }
  }

  // When an outlook is next issued afresh (hour UTC of the world).
  nextUpdateHourUtc(day, hourUtc) { const times = OUTLOOK.issueTimesUtc[day], dayNumber = Math.floor((hourUtc + 1e-6) / 24), within = hourUtc - 24 * dayNumber, next = times.find(t => t > within + 1e-6); return next !== undefined ? 24 * dayNumber + next : 24 * (dayNumber + 1) + times[0]; }

  status() {
    const engine = this.runtime.engine;
    return {
      enabled: true, running: Boolean(this.running), runningFor: this.running?.due ?? null, members: this.members, lastRunMs: this.lastRunMs, error: this.lastError,
      days: Object.fromEntries(this.days.map(day => { const product = this.current(day, engine); return [day, product ? { issuedHourUtc: product.outlook.issuedHourUtc, validFromHourUtc: product.outlook.validFromHourUtc, validToHourUtc: product.outlook.validToHourUtc, highest: product.outlook.highest, nextUpdateHourUtc: this.nextUpdateHourUtc(day, engine.world.validHourUtc), updateHours: OUTLOOK.updateHours[day] } : null]; })),
      // Kept from when there was only Day 1.
      issuedHourUtc: this.current('day1', engine)?.outlook.issuedHourUtc ?? null, validToHourUtc: this.current('day1', engine)?.outlook.validToHourUtc ?? null, highest: this.current('day1', engine)?.outlook.highest ?? null
    };
  }

  // What an outlook page asks for.
  day(day) {
    const engine = this.runtime.engine, product = this.current(day, engine), running = Boolean(this.running?.due.includes(day));
    if (product) return { ...product.public, running, nowHourUtc: engine.world.validHourUtc, nextUpdateHourUtc: this.nextUpdateHourUtc(day, engine.world.validHourUtc) };
    if (!this.days.includes(day)) return { day, status: 'off', running: false, members: this.members };
    return { day, status: this.running ? 'running' : this.lastError ? 'failed' : 'pending', running: Boolean(this.running), error: this.lastError, members: this.members, nowHourUtc: engine?.world?.validHourUtc ?? null };
  }
  dayOne() { return this.day('day1'); }

  stop() { return this.pool.stop(); }
}
