// Issues mesoscale discussions for the live world. Once an hour of the world's time the
// world is copied and run a few hours ahead several times at once, each run in its own
// process, and the areas where most runs put severe weather are discussed (see
// js/forecast/MesoscaleDiscussion.js). An area already under a valid discussion is not
// given another until that one is about to lapse. The live world keeps running meanwhile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MESOSCALE, buildMesoscaleDiscussions, describeNow, publicMesoscaleDiscussion } from '../js/forecast/MesoscaleDiscussion.js';

const MEMBER_SCRIPT = fileURLToPath(new URL('./mesoscaleMember.js', import.meta.url));

export class MesoscaleRuntime {
  // runtime: the weather authority (its `engine` is the live AtmosphereWorld).
  constructor({ runtime, members = MESOSCALE.members, memberScript = MEMBER_SCRIPT, scratchDir = os.tmpdir() } = {}) {
    this.runtime = runtime; this.members = members; this.memberScript = memberScript; this.scratchDir = scratchDir;
    this.engine = null; this.discussions = []; this.next = 1; this.lastSlot = null;
    this.running = null; this.lastError = null; this.lastRunMs = null; this.children = new Set();
  }

  slot(hourUtc) { return Math.floor((hourUtc + 1e-6) / MESOSCALE.everyHours); }

  // Call now and then: looks at the world once in each of its hours.
  maybeIssue() {
    const engine = this.runtime.engine;
    if (!engine || this.running) return false;
    // A new world starts its own series.
    if (engine !== this.engine) { this.engine = engine; this.discussions = []; this.next = 1; this.lastSlot = null; }
    const slot = this.slot(engine.world.validHourUtc);
    if (slot === this.lastSlot) return false;
    this.lastSlot = slot;
    this.issue().catch(() => {});
    return true;
  }

  async issue() {
    const engine = this.runtime.engine, started = Date.now();
    if (engine !== this.engine) { this.engine = engine; this.discussions = []; this.next = 1; }
    const file = path.join(this.scratchDir, `weatherworld-mesoscale-${process.pid}-${Date.now()}.bin`);
    // The copy and the look at the air are taken now, in one go.
    fs.writeFileSync(file, v8.serialize(engine.saveState()));
    const now = describeNow(engine);
    const run = Promise.all(Array.from({ length: this.members }, (_, member) => this.runMember(file, member)));
    this.running = { hourUtc: now.hourUtc, startedAt: started };
    try {
      const members = await run;
      if (this.runtime.engine !== engine) return [];
      const issued = buildMesoscaleDiscussions(members, now, { active: this.discussions, next: this.next, seed: engine.seed });
      this.next += issued.length;
      this.discussions = [...issued.reverse(), ...this.discussions].slice(0, MESOSCALE.kept);
      this.lastError = null; this.lastRunMs = Date.now() - started;
      return issued;
    } catch (error) {
      this.lastError = String(error?.message ?? error);
      throw error;
    } finally {
      this.running = null;
      // Retried: on Windows the copy can still be held for a moment.
      this.cleanup = fs.promises.rm(file, { force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
    }
  }

  runMember(file, member) {
    return new Promise((resolve, reject) => {
      const child = fork(this.memberScript, [file, String(member), String(MESOSCALE.hoursAhead)], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      this.children.add(child);
      let settled = false;
      const finish = (fn, value) => { if (!settled) { settled = true; this.children.delete(child); fn(value); } };
      child.once('message', message => (message?.ok ? finish(resolve, message.result) : finish(reject, new Error(message?.error ?? 'mesoscale member failed'))));
      child.once('error', error => finish(reject, error));
      child.once('exit', code => finish(reject, new Error(`mesoscale member ${member} ended with code ${code} before reporting`)));
    });
  }

  // What the page asks for: the discussions, newest first, each marked valid or lapsed.
  list() {
    const engine = this.runtime.engine, current = engine && engine === this.engine, hour = engine?.world?.validHourUtc ?? null;
    return {
      enabled: true, running: Boolean(this.running), members: this.members, error: this.lastError, lastRunMs: this.lastRunMs, nowHourUtc: hour,
      width: engine?.world?.width ?? null, height: engine?.world?.height ?? null, cellMiles: engine?.world?.cellSizeMiles ?? null,
      discussions: current ? this.discussions.map(md => ({ ...publicMesoscaleDiscussion(md), valid: md.validToHourUtc > hour })) : []
    };
  }

  stop() { for (const child of this.children) child.kill(); this.children.clear(); }
}
