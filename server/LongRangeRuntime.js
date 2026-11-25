// The long range model's runs for the live world (js/forecast/LongRangeModel.js): one at each 06Z, 7 days
// ahead, done on one of the forecast pool's threads from a copy of the world taken at that hour (about three
// real minutes); the last LONG_RANGE.keepRuns are kept for the model pages. A server that has no run yet (a
// first start, or a restart: runs are held in memory) makes one at its first whole hour, so the page is not
// empty until the next 06Z.
// It answers the large-scale page the way the short range model's runs do (ShortRangeRuntime.js).
import { LONG_RANGE, longRangeDue } from '../js/forecast/LongRangeModel.js';
import { chanceOfCount } from '../js/forecast/DayOneOutlook.js';
import { sharedForecastPool } from './ForecastPool.js';
import { ShortRangeRuntime } from './ShortRangeRuntime.js';

const list = values => Array.from(values ?? []);

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

  // The tornado chances of a run (the newest when none is named), for an admin on the model page (2026-11-18, the
  // owner's request), stepped through as the ensemble's run totals are. Without a frame: the outlook days, each with
  // its frames (forecast hours) and, once done, its highest chances. With frame (a forecast hour): that frame's chance
  // (percent) of a tornado within 25 miles, and of an EF2+, EF3+ and EF4+ one, on the map's cells (row 0 the map's
  // northern edge): `total` over its day so far (from 12Z), `recent` over the hours since the frame before it.
  tornadoes(init, frame = null) {
    const run = init === undefined || init === null || init === '' ? this.latest() : this.run(init);
    if (!run?.tornadoFrames) return null;
    const frames = run.tornadoFrames, base = { initHourUtc: run.initHourUtc, hours: run.hours, partial: Boolean(run.partial) };
    if (frame === null || frame === undefined || frame === '') {
      const days = new Map();
      for (const f of frames) { if (!days.has(f.day)) days.set(f.day, { day: f.day, validFromHourUtc: f.validToHourUtc - 24, validToHourUtc: f.validToHourUtc, frameHours: [], done: false }); days.get(f.day).frameHours.push(f.forecastHour); }
      for (const d of run.tornadoDays ?? []) if (days.has(d.day)) Object.assign(days.get(d.day), { done: true, countedToHourUtc: d.countedToHourUtc, peak: d.peak });
      return { ...base, days: [...days.values()] };
    }
    const at = frames.findIndex(f => f.forecastHour === Number(frame));
    if (at < 0) return null;
    const f = frames[at], before = frames[at - 1]?.day === f.day ? frames[at - 1] : null;
    const chances = sums => Object.fromEntries(Object.entries(sums).map(([field, values]) => [field, list(values).map(chanceOfCount)]));
    const recent = Object.fromEntries(Object.entries(f.near).map(([field, values]) => [field, Float32Array.from(values, (v, i) => v - (before?.near[field][i] ?? 0))]));
    return { ...base, forecastHour: f.forecastHour, day: f.day, fromForecastHour: before?.forecastHour ?? null, validFromHourUtc: f.validToHourUtc - 24, validToHourUtc: f.validToHourUtc, width: f.width, height: f.height, total: chances(f.near), recent: chances(recent) };
  }

  list() {
    return {
      model: 'long range', running: this.running, error: this.lastError, nowHourUtc: this.runtime.engine?.world?.validHourUtc ?? null, atUtc: LONG_RANGE.atUtc,
      runs: this.runs.map(run => ({ initHourUtc: run.initHourUtc, hours: run.hours, failed: run.failed ?? null, ms: run.ms ?? null, frames: run.synoptic?.length ?? 0, partial: Boolean(run.partial), readyHours: run.partial ? run.readyHours : run.failed ? null : run.hours }))
    };
  }
}
