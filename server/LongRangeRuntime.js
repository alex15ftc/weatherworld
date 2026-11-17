// The long range model's runs for the live world (js/forecast/LongRangeModel.js): one at each 06Z, 7 days
// ahead, done on one of the forecast pool's threads from a copy of the world taken at that hour (about three
// real minutes); the last LONG_RANGE.keepRuns are kept for the model pages. A server that has no run yet (a
// first start, or a restart: runs are held in memory) makes one at its first whole hour, so the page is not
// empty until the next 06Z.
// It answers the large-scale page the way the short range model's runs do (ShortRangeRuntime.js).
import { LONG_RANGE, longRangeDue } from '../js/forecast/LongRangeModel.js';
import { sharedForecastPool } from './ForecastPool.js';
import { ShortRangeRuntime } from './ShortRangeRuntime.js';

export class LongRangeRuntime extends ShortRangeRuntime {
  constructor({ runtime, pool = sharedForecastPool() } = {}) { super({ runtime, pool }); }

  // Call now and then: starts a run at 06Z (or at the first whole hour when there is none yet).
  maybeRun() {
    const engine = this.runtime.engine;
    if (!engine) return false;
    if (engine !== this.engine) { this.engine = engine; this.runs = []; }
    const hour = engine.world.validHourUtc, init = Math.round(hour);
    if (this.running || Math.abs(hour - init) > 1e-6 || this.runs.some(run => run.initHourUtc === init)) return false;
    if (!longRangeDue(init) && this.runs.length) return false;
    this.start(engine, init).catch(() => {});
    return true;
  }

  async start(engine, init) { return this.startRun(engine, init, 'longRange', LONG_RANGE.hours, LONG_RANGE.keepRuns); }

  list() {
    return {
      model: 'long range', running: this.running, error: this.lastError, nowHourUtc: this.runtime.engine?.world?.validHourUtc ?? null, atUtc: LONG_RANGE.atUtc,
      runs: this.runs.map(run => ({ initHourUtc: run.initHourUtc, hours: run.hours, failed: run.failed ?? null, ms: run.ms ?? null, frames: run.synoptic?.length ?? 0, partial: Boolean(run.partial), readyHours: run.partial ? run.readyHours : run.failed ? null : run.hours }))
    };
  }
}
