// The short range model's runs for the live world (js/forecast/ShortRangeModel.js): one at each whole
// simulated hour, 18 hours ahead (48 at 00, 06, 12 and 18Z), done on the forecast pool's threads from a
// copy of the world taken at that hour; the last SHORT_RANGE.keepRuns are kept for the model page.
import { SHORT_RANGE, shortRangeHours } from '../js/forecast/ShortRangeModel.js';
import { sharedForecastPool, shareState } from './ForecastPool.js';

export class ShortRangeRuntime {
  constructor({ runtime, pool = sharedForecastPool() } = {}) {
    this.runtime = runtime; this.pool = pool;
    this.engine = null; this.runs = []; this.running = null; this.lastError = null;
  }

  // Call now and then: starts a run at a whole hour that has none.
  maybeRun() {
    const engine = this.runtime.engine;
    if (!engine) return false;
    if (engine !== this.engine) { this.engine = engine; this.runs = []; }
    const hour = engine.world.validHourUtc, init = Math.round(hour);
    if (this.running || Math.abs(hour - init) > 1e-6 || this.runs.some(run => run.initHourUtc === init)) return false;
    this.start(engine, init).catch(() => {});
    return true;
  }

  async start(engine, init) {
    const hours = shortRangeHours(init), startedAt = Date.now();
    this.running = { initHourUtc: init, hours, startedAt };
    try {
      const state = shareState(engine.saveState({ forecast: true }));
      const run = await this.pool.run('shortRange', state, 0, hours);
      if (this.runtime.engine !== engine) return null;
      run.realMs = Date.now() - startedAt;
      this.runs.push(run);
      this.runs.sort((a, b) => a.initHourUtc - b.initHourUtc);
      while (this.runs.length > SHORT_RANGE.keepRuns) this.runs.shift();
      this.lastError = null;
      return run;
    } catch (error) {
      this.lastError = String(error?.message ?? error);
      // (no retry for this hour: the next whole hour starts afresh)
      this.runs.push({ initHourUtc: init, hours, failed: this.lastError });
      throw error;
    } finally {
      this.running = null;
    }
  }

  run(init) { return this.runs.find(run => run.initHourUtc === Number(init) && !run.failed) ?? null; }
  latest() { return this.runs.filter(run => !run.failed).at(-1) ?? null; }

  // What the model page asks for.
  list() {
    return {
      model: 'short range', running: this.running, error: this.lastError, nowHourUtc: this.runtime.engine?.world?.validHourUtc ?? null,
      runs: this.runs.map(run => ({ initHourUtc: run.initHourUtc, hours: run.hours, failed: run.failed ?? null, ms: run.ms ?? null }))
    };
  }
  meta(init) {
    const run = init === undefined || init === null || init === '' ? this.latest() : this.run(init);
    if (!run) return null;
    return {
      initHourUtc: run.initHourUtc, hours: run.hours, shareHours: run.shareHours, seed: run.seed, width: run.width, height: run.height, cellKm: run.cellKm,
      parameters: run.parameters, fieldHours: run.fields.map(f => f.hour), stormMinutes: run.storms.map(f => f.minute), ms: run.ms
    };
  }
  field(init, hour, key) {
    const run = this.run(init), frame = run?.fields.find(f => f.hour === Number(hour)), values = frame?.values[key];
    if (!values) return null;
    const p = run.parameters.find(q => q.key === key), scale = 10 ** (p?.decimals ?? 1), round = v => Math.round(v * scale) / scale;
    const second = frame.values[`${key}:second`];
    return { key, hour: frame.hour, values: Array.from(values, round), ...(second ? { second: Array.from(second, v => Math.round(v * 10) / 10) } : {}), ...(frame.values[`${key}:barbs`] ? { barbs: frame.values[`${key}:barbs`] } : {}) };
  }
  storms(init, minute) {
    const run = this.run(init), frame = run?.storms.find(f => f.minute === Number(minute));
    return frame ? { minute: frame.minute, storms: frame.list } : null;
  }
  tracks(init) {
    const run = this.run(init);
    return run ? { initHourUtc: run.initHourUtc, tracks: run.tracks } : null;
  }
}
