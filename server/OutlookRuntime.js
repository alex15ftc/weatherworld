// Issues the Day 1, 2 and 3 outlooks for the live world. Day 1 is issued afresh every 6
// hours, Day 2 every 12 and Day 3 every 24, all counted from 12Z (OUTLOOK.updateHours), and
// all of them when the server first has a world. The members are run by the forecast pool's
// threads (ForecastPool.js), a few at a time, from a copy of the world taken at issue time; the
// live world keeps running meanwhile. One run serves every outlook that is due, and each
// member reports each outlook day separately. Every member goes into Day 1 and half of them into Day 2
// and Day 3 (OUTLOOK.memberShare), but only the days in OUTLOOK.stormShare are run with storms (8 for
// Day 1, 4 for Day 2, none for Day 3): the Day 2 members run on to Day 3 with the atmosphere alone, and
// Day 3 comes from the ingredients for storms. The longest runs are started first.
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { OUTLOOK, combineOutlook, publicOutlook, hoursToDayEnd, membersFor, stormDaysFor, publishDelayHours } from '../js/forecast/DayOneOutlook.js';
import { WORLD_RISK_ORDER } from '../js/forecast/worldRiskCategories.js';
import { countiesIn, describeRegions } from '../js/forecast/counties.js';
import { countiesFor } from './CountyLayer.js';
import { sharedForecastPool, shareState } from './ForecastPool.js';
// (2026-10-20: issued at the centre's times, OUTLOOK.issueTimesUtc, not every 6, 12 and 24 hours;
// an issue less than OUTLOOK.leadHours before 12Z is for the day that starts then; and each issue
// may raise the category for its day by at most one step from the last, within the caps for Days
// 2 and 3, until the day is under way. The header above describes the earlier schedule.)
// (2026-11-16: each outlook of an issue goes out as soon as its members have run its day, not when the
// longest run ends: the members send their days as they close them, ForecastPool.run onProgress.)

// Outlook issues whose runs are kept for the model page's ensemble products.
const ENSEMBLES_KEPT = 4;
export class OutlookRuntime {
  // runtime: the weather authority (its `engine` is the live AtmosphereWorld). days: which
  // outlooks to issue (a prefix of OUTLOOK.days). pool: the threads that do the runs.
  // cheapPerMember: cheap runs each full run carries (OUTLOOK.cheapPerMember).
  // file: where the issued outlooks are saved (null: not saved). After a restart in the same world
  // they are put back, so the last issue stays up until the next one is ready, and an issue whose
  // slot has not passed is not run again; a new world starts with none.
  constructor({ runtime, members = OUTLOOK.members, cheapPerMember = OUTLOOK.cheapPerMember, days = OUTLOOK.days, pool = sharedForecastPool(), file = null } = {}) {
    this.runtime = runtime; this.members = members; this.cheapPerMember = cheapPerMember; this.days = days; this.pool = pool; this.file = file;
    this.products = {}; this.history = new Map(); this.ensembles = []; this.running = null; this.lastError = null; this.lastRunMs = null; this.failedKey = null;
    this.restore();
  }

  // The issued outlooks of this world and the ensemble runs behind them (the model page), written in the
  // background after each issue.
  save() {
    if (!this.file) return;
    const engine = this.runtime.engine, products = {};
    for (const day of this.days) { const product = this.current(day, engine); if (product) products[day] = { slot: product.slot, outlook: product.outlook, public: product.public }; }
    const ensembles = this.ensembles.filter(e => e.engine === engine).map(({ engine: _, ...e }) => e);
    const bytes = v8.serialize({ version: 1, worldId: this.runtime.worldId, seed: engine.seed, products, history: [...this.history], ensembles });
    // (one write at a time: an issue saves after each outlook it puts out, and two writes of the .tmp must not cross)
    this.saving = (this.saving ?? Promise.resolve()).then(() => fs.promises.mkdir(path.dirname(this.file), { recursive: true }))
      .then(() => fs.promises.writeFile(`${this.file}.tmp`, bytes))
      .then(() => fs.promises.rename(`${this.file}.tmp`, this.file))
      .catch(error => console.warn('[outlooks] not saved:', error.message));
  }

  restore() {
    const engine = this.runtime.engine;
    if (!this.file || !engine || !fs.existsSync(this.file)) return;
    try {
      const saved = v8.deserialize(fs.readFileSync(this.file)), now = engine.world.validHourUtc;
      if (saved.version !== 1 || saved.worldId !== this.runtime.worldId || saved.seed !== engine.seed) return;
      for (const [day, product] of Object.entries(saved.products)) {
        // An issue from later than the world's clock, or for a day already over, is not put back.
        if (!this.days.includes(day) || product.outlook.issuedHourUtc > now + 1e-6 || product.outlook.validToHourUtc <= now) continue;
        this.products[day] = { ...product, engine };
      }
      this.history = new Map(saved.history.filter(([validTo]) => validTo > now));
      // (saves from before 2026-11-11 evening have no ensembles)
      this.ensembles = (saved.ensembles ?? []).filter(e => e.issuedHourUtc <= now + 1e-6).map(e => ({ ...e, engine })).slice(-ENSEMBLES_KEPT);
      const kept = Object.keys(this.products);
      if (kept.length) console.log(`[outlooks] put back ${kept.join(', ')} and ${this.ensembles.length} ensemble issues from before the restart`);
    } catch (error) {
      console.warn('[outlooks] saved outlooks unreadable:', error.message);
    }
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
  key(engine, due, hourUtc = engine.world.validHourUtc) { return `${engine.seed}|${due.map(day => `${day}:${this.slot(day, hourUtc)}`).join(',')}`; }

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
    // Each outlook is issued as soon as every member it takes has sent its day (2026-11-16, the owner's request:
    // until then all of them waited for the longest run), so Day 1 goes out before Day 2 and Day 3 at an issue
    // that has them all. got[m]: member m's days so far, and its cheap runs' ({ days, cheap: [days, ...] }).
    const got = Array.from({ length: this.members }, () => ({ days: [], cheap: [] })), left = new Set(due);
    const take = (m, { index, day, cheap }) => {
      got[m].days[index] = day;
      cheap.forEach((d, j) => { (got[m].cheap[j] ??= [])[index] = d ?? undefined; });
      for (const outlookDay of [...left]) if (got.slice(0, count(outlookDay)).every(g => g.days[indexOf(outlookDay)])) { left.delete(outlookDay); this.publish(outlookDay, got, { engine, issuedHourUtc, dayEnd, index: indexOf(outlookDay), count: count(outlookDay), skipHours }); }
    };
    // (a run that did not stream, as a test's pool, sends its days at the end)
    const whole = (m, member) => { if (!member || member.streamed) return; member.days.forEach((day, index) => take(m, { index, day, cheap: member.cheap.map(days => days[index] ?? null) })); };
    // With threads for most of the members, member 0 runs furthest and is asked for first, so the long runs are
    // not left to the end. With few (the host has one for outlooks: HOSTING.md), the members that run Day 1 alone
    // go first, so Day 1 is out once the long members have run their Day 1 and Day 2 and 3 follow; long first
    // there put Day 1 out last. (Which member runs when does not change what it finds: each has its own seed.)
    const slots = Math.max(1, (this.pool.size ?? this.members) - (this.pool.reserve ?? 0)), order = Array.from({ length: this.members }, (_, member) => member);
    if (slots * 2 <= this.members) order.sort((a, b) => hoursFor(a) - hoursFor(b) || b - a);
    // An issue inside its day (lead 0: the Day 1 updates) is valid from when it is out (OUTLOOK.publishDelayPerHour): its runs
    // do not count the hours before (skipHours). (Only Day 1's period starts at the issue; Day 2 and 3 start at a 12Z.)
    // One made before its day (the 06Z) leaves out OUTLOOK.beforeDaySkipHours, short of 12Z.
    const skipHours = lead ? Math.max(0, Math.min(dayEnd - issuedHourUtc - OUTLOOK.stepHours, OUTLOOK.beforeDaySkipHours ?? 0)) : this.publishDelay(issuedHourUtc, dayEnd);
    const run = Promise.all(order.map(member => this.pool.run('outlook', state, member, hoursFor(member), { options: { stormDays: stormDaysFor(member, this.members, lead), cheapRuns: this.cheapPerMember, skipHours }, onProgress: part => take(member, part) }).then(result => whole(member, result))));
    this.running = { key, due: [...due], issuedHourUtc, hours, startedAt: started };
    try {
      await run;
      // A world that was reset or replaced meanwhile makes these outlooks stale.
      if (this.runtime.engine === engine) {
        // Every run's storm tracks, for the model page's ensemble products (the last ENSEMBLES_KEPT issues).
        const sets = got.flatMap((member, m) => [{ member: m, cheap: null, days: member.days }, ...member.cheap.map((days, j) => ({ member: m, cheap: j, days }))]);
        this.ensembles = this.ensembles.filter(e => e.engine === engine && e.issuedHourUtc !== issuedHourUtc);
        this.ensembles.push({ engine, issuedHourUtc, hours, runs: sets.map(({ member, cheap, days }) => ({ member, cheap, track: days.filter(Boolean).flatMap(d => d.stormTrack ?? []) })) });
        while (this.ensembles.length > ENSEMBLES_KEPT) this.ensembles.shift();
        this.lastError = null; this.failedKey = null;
        this.save();
      }
      this.lastRunMs = Date.now() - started;
      return due.map(day => this.current(day, engine)?.outlook ?? null);
    } catch (error) {
      // (the outlooks already issued from this run stay; the key is of those that were not)
      this.lastError = String(error?.message ?? error); this.failedKey = this.key(engine, due.filter(day => left.has(day)), issuedHourUtc);
      throw error;
    } finally {
      this.running = null;
    }
  }

  // The hours an issue inside its day leaves out (DayOneOutlook.js publishDelayHours).
  publishDelay(issuedHourUtc, dayEnd) { return publishDelayHours(dayEnd - issuedHourUtc); }

  // One outlook of an issue, from the members' days for it (got: as issue() collects them).
  publish(day, got, { engine, issuedHourUtc, dayEnd, index, count, skipHours = 0 }) {
    if (this.runtime.engine !== engine) return;
    const layer = countiesFor(engine.world), regions = layer ? inside => describeRegions(layer, countiesIn(layer, inside, { least: 0.5 })) : null;
    const validFromHourUtc = index ? dayEnd + 24 * (index - 1) : issuedHourUtc + skipHours, validToHourUtc = dayEnd + 24 * index;
    // The caps: the lead's, and one step above the last issue for this day until the day is under way.
    const lastOutlook = this.history.get(validToHourUtc) ?? null, last = lastOutlook?.highest, underWay = issuedHourUtc >= validToHourUtc - 24 + OUTLOOK.nowcastAfterHours;
    const caps = [OUTLOOK.leadCaps[day], !underWay && last ? WORLD_RISK_ORDER[Math.min(WORLD_RISK_ORDER.length - 1, Math.max(WORLD_RISK_ORDER.indexOf('SLGT'), WORLD_RISK_ORDER.indexOf(last) + 1))] : null].filter(Boolean);
    const maxCategory = caps.length ? caps.reduce((a, b) => (WORLD_RISK_ORDER.indexOf(a) <= WORLD_RISK_ORDER.indexOf(b) ? a : b)) : null;
    // Each full run's day, and its cheap runs' days where they ran (the days with storms).
    const runs = got.slice(0, count).flatMap(member => [member.days[index], ...member.cheap.map(days => days?.[index]).filter(Boolean)]);
    const outlook = combineOutlook(runs, { day, issuedHourUtc, validFromHourUtc, validToHourUtc, seed: engine.seed, maxCategory, regions, previous: lastOutlook, continuity: lastOutlook ? OUTLOOK.continuity[underWay ? 'underWay' : 'before'] : 0 });
    this.history.set(validToHourUtc, outlook);
    // (the live record of how the outlooks verify, OutlookScoreboard.js; it only reads the outlook)
    try { this.onIssued?.(outlook); } catch (error) { console.warn('[outlooks] onIssued:', error.message); }
    for (const ended of [...this.history.keys()]) if (ended <= issuedHourUtc) this.history.delete(ended);
    this.products[day] = { slot: this.slot(day, issuedHourUtc), engine, outlook, public: publicOutlook(outlook) };
    // (no longer running: the pages and the game show it as issued)
    if (this.running) this.running.due = this.running.due.filter(d => d !== day);
    this.save();
  }

  // The outlook runs as the model page's ensemble: the issues kept, and one issue's runs and their storms.
  ensembleList(engine = this.runtime.engine) { return { model: 'outlook ensemble', running: this.running ? { issuedHourUtc: this.running.issuedHourUtc, hours: this.running.hours } : null, issues: this.ensembles.filter(e => e.engine === engine).map(e => ({ issuedHourUtc: e.issuedHourUtc, hours: e.hours, runs: e.runs.length, full: e.runs.filter(r => r.cheap === null).length })) }; }
  ensembleTracks(issued, engine = this.runtime.engine) {
    const kept = this.ensembles.filter(e => e.engine === engine), e = issued === undefined || issued === null || issued === '' ? kept.at(-1) : kept.find(k => k.issuedHourUtc === Number(issued));
    return e ? { issuedHourUtc: e.issuedHourUtc, hours: e.hours, columns: ['hourUtc', 'storm', 'xKm', 'yKm', 'dbz', 'uh', 'tornado'], runs: e.runs } : null;
  }

  // When an outlook is next issued afresh (hour UTC of the world).
  nextUpdateHourUtc(day, hourUtc) { const times = OUTLOOK.issueTimesUtc[day], dayNumber = Math.floor((hourUtc + 1e-6) / 24), within = hourUtc - 24 * dayNumber, next = times.find(t => t > within + 1e-6); return next !== undefined ? 24 * dayNumber + next : 24 * (dayNumber + 1) + times[0]; }

  status() {
    const engine = this.runtime.engine;
    return {
      enabled: true, running: Boolean(this.running), runningFor: this.running?.due ?? null, members: this.members, cheapPerMember: this.cheapPerMember, lastRunMs: this.lastRunMs, error: this.lastError,
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
