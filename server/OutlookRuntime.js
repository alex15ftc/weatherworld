// Issues the Day 1 outlook for the live world: once when the server has a world, and again at
// the start of each outlook day (12Z). The members run in their own processes from a copy of
// the world taken at issue time; the live world keeps running meanwhile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OUTLOOK, combineOutlook, publicOutlook, hoursToDayEnd } from '../js/forecast/DayOneOutlook.js';

const MEMBER_SCRIPT = fileURLToPath(new URL('./outlookMember.js', import.meta.url));
// A period shorter than this is not worth an outlook of its own: the next day's is issued at 12Z.
const SHORTEST_PERIOD_HOURS = 3;

export class OutlookRuntime {
  // runtime: the weather authority (its `engine` is the live AtmosphereWorld).
  constructor({ runtime, members = OUTLOOK.members, memberScript = MEMBER_SCRIPT, scratchDir = os.tmpdir() } = {}) {
    this.runtime = runtime; this.members = members; this.memberScript = memberScript; this.scratchDir = scratchDir;
    this.product = null; this.running = null; this.lastError = null; this.lastRunMs = null; this.children = new Set();
  }

  // The outlook day an hour belongs to (days run 12Z to 12Z), and the engine it is for.
  key(engine = this.runtime.engine) { return `${engine.seed}|${Math.floor((engine.world.validHourUtc - OUTLOOK.dayStartUtc) / 24)}`; }

  // Call now and then: starts an issue when the live world has entered a day with no outlook.
  maybeIssue() {
    const engine = this.runtime.engine;
    if (!engine || this.running) return false;
    if (this.product?.key === this.key(engine) && this.product.engine === engine) return false;
    if (this.failedKey === this.key(engine)) return false;
    if (hoursToDayEnd(engine.world.validHourUtc) < SHORTEST_PERIOD_HOURS && this.product?.engine === engine) return false;
    this.issue().catch(() => {});
    return true;
  }

  async issue() {
    const engine = this.runtime.engine, key = this.key(engine), started = Date.now();
    const issuedHourUtc = engine.world.validHourUtc, hours = hoursToDayEnd(issuedHourUtc);
    const file = path.join(this.scratchDir, `weatherworld-outlook-${process.pid}-${Date.now()}.bin`);
    // The copy is taken now, in one go, so every member starts from the same moment.
    fs.writeFileSync(file, v8.serialize(engine.saveState()));
    const run = Promise.all(Array.from({ length: this.members }, (_, member) => this.runMember(file, member, hours)));
    this.running = { key, issuedHourUtc, startedAt: started };
    try {
      const members = await run;
      // A world that was reset or replaced meanwhile makes this outlook stale.
      if (this.runtime.engine === engine) {
        const outlook = combineOutlook(members, { issuedHourUtc, validToHourUtc: issuedHourUtc + hours, seed: engine.seed });
        this.product = { key, engine, outlook, public: publicOutlook(outlook) };
        this.lastError = null; this.failedKey = null;
      }
      this.lastRunMs = Date.now() - started;
      return this.product?.outlook ?? null;
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

  status() {
    const engine = this.runtime.engine, current = Boolean(this.product && engine && this.product.engine === engine);
    return {
      enabled: true, running: Boolean(this.running), members: this.members, lastRunMs: this.lastRunMs, error: this.lastError,
      issuedHourUtc: current ? this.product.outlook.issuedHourUtc : null, validToHourUtc: current ? this.product.outlook.validToHourUtc : null,
      highest: current ? this.product.outlook.highest : null
    };
  }

  // What the Day 1 page asks for.
  dayOne() {
    const engine = this.runtime.engine;
    if (this.product && engine && this.product.engine === engine) return { ...this.product.public, running: Boolean(this.running), nowHourUtc: engine.world.validHourUtc };
    return { day: 'day1', status: this.running ? 'running' : this.lastError ? 'failed' : 'pending', running: Boolean(this.running), error: this.lastError, members: this.members, nowHourUtc: engine?.world?.validHourUtc ?? null };
  }

  stop() { for (const child of this.children) child.kill(); this.children.clear(); }
}
