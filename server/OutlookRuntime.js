// Issues the Day 1, 2 and 3 outlooks for the live world. Day 1 is issued afresh every 6
// hours, Day 2 every 12 and Day 3 every 24, all counted from 12Z (OUTLOOK.updateHours), and
// all of them when the server first has a world. The members run at the same time, each in
// its own process, from a copy of the world taken at issue time; the live world keeps
// running meanwhile. One run serves every outlook that is due, and each member reports each
// outlook day separately. Fewer members go into the later days (OUTLOOK.memberShare: 8 for
// Day 1, 4 for Day 2, 2 for Day 3), so each member runs only as far as the last day it is in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OUTLOOK, combineOutlook, publicOutlook, hoursToDayEnd, membersFor } from '../js/forecast/DayOneOutlook.js';

const MEMBER_SCRIPT = fileURLToPath(new URL('./outlookMember.js', import.meta.url));

export class OutlookRuntime {
  // runtime: the weather authority (its `engine` is the live AtmosphereWorld). days: which
  // outlooks to issue (a prefix of OUTLOOK.days).
  constructor({ runtime, members = OUTLOOK.members, days = OUTLOOK.days, memberScript = MEMBER_SCRIPT, scratchDir = os.tmpdir() } = {}) {
    this.runtime = runtime; this.members = members; this.days = days; this.memberScript = memberScript; this.scratchDir = scratchDir;
    this.products = {}; this.running = null; this.lastError = null; this.lastRunMs = null; this.children = new Set(); this.failedKey = null;
  }

  // The issue an outlook belongs to at an hour: its update slot, counted from 12Z.
  slot(day, hourUtc) { return Math.floor((hourUtc - OUTLOOK.dayStartUtc + 1e-6) / OUTLOOK.updateHours[day]); }
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
    // Each member goes as far ahead as the furthest outlook due that it is one of the runs for.
    const count = day => membersFor(day, this.members);
    const hoursFor = member => dayEnd - issuedHourUtc + 24 * Math.max(...due.filter(day => member < count(day)).map(day => OUTLOOK.days.indexOf(day)));
    const hours = hoursFor(0);
    const file = path.join(this.scratchDir, `weatherworld-outlook-${process.pid}-${Date.now()}.bin`);
    // The copy is taken now, in one go, so every member starts from the same moment.
    fs.writeFileSync(file, v8.serialize(engine.saveState()));
    // Every member is started at once; they run side by side.
    const run = Promise.all(Array.from({ length: this.members }, (_, member) => this.runMember(file, member, hoursFor(member))));
    this.running = { key, due, issuedHourUtc, hours, startedAt: started };
    try {
      const members = await run;
      // A world that was reset or replaced meanwhile makes these outlooks stale.
      if (this.runtime.engine === engine) {
        for (const day of due) {
          const index = OUTLOOK.days.indexOf(day), validFromHourUtc = index ? dayEnd + 24 * (index - 1) : issuedHourUtc;
          const outlook = combineOutlook(members.slice(0, count(day)).map(member => member[index]), { day, issuedHourUtc, validFromHourUtc, validToHourUtc: dayEnd + 24 * index, seed: engine.seed });
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
      // Retried: on Windows the copy can still be held (a member closing, a scanner) for a moment.
      this.cleanup = fs.promises.rm(file, { force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
    }
  }

  runMember(file, member, hours) {
    return new Promise((resolve, reject) => {
      const child = fork(this.memberScript, [file, String(member), String(hours)], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      this.children.add(child);
      let settled = false;
      const finish = (fn, value) => { if (!settled) { settled = true; this.children.delete(child); fn(value); } };
      child.once('message', message => (message?.ok ? finish(resolve, message.result) : finish(reject, new Error(message?.error ?? 'outlook member failed'))));
      child.once('error', error => finish(reject, error));
      child.once('exit', code => finish(reject, new Error(`outlook member ${member} ended with code ${code} before reporting`)));
    });
  }

  // When an outlook is next issued afresh (hour UTC of the world).
  nextUpdateHourUtc(day, hourUtc) { return OUTLOOK.dayStartUtc + (this.slot(day, hourUtc) + 1) * OUTLOOK.updateHours[day]; }

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

  stop() { for (const child of this.children) child.kill(); this.children.clear(); }
}
