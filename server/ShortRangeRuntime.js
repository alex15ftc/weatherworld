// The short range model's runs for the live world (js/forecast/ShortRangeModel.js): one at each whole
// simulated hour, 18 hours ahead (48 at 00, 06, 12 and 18Z), done on the forecast pool's threads from a
// copy of the world taken at that hour; the last SHORT_RANGE.keepRuns are kept for the model page.
// A run is listed from its start and shows each forecast hour as soon as the thread has made it (`partial`
// with `readyHours`, the last hour ready); the model pages grey out the hours still to come (2026-11-16).
import { SHORT_RANGE, shortRangeHours } from '../js/forecast/ShortRangeModel.js';
import { cellOf, soundingAnswer } from '../js/forecast/soundingColumns.js';
import { sharedForecastPool, shareState } from './ForecastPool.js';

// A part a run sent while it went (runShortRange / runLongRange onProgress) into the run kept here.
export function streamRun(run, part) {
  Object.assign(run, part.head);
  if (part.parameters) run.parameters = part.parameters;
  for (const key of ['fields', 'soundings', 'storms', 'tracks', 'synoptic']) { const list = part[key]; if (!list?.length) continue; run[key] ??= []; for (const item of list) run[key].push(item); }
  run.readyHours = part.readyHours;
}
// How much of a run is made: a run still going is `partial`, ready to forecast hour `readyHours`.
const readiness = run => ({ partial: Boolean(run.partial), readyHours: run.partial ? run.readyHours : run.failed ? null : run.hours });

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

  async start(engine, init) { return this.startRun(engine, init, 'shortRange', shortRangeHours(init), SHORT_RANGE.keepRuns); }

  // One run on the pool, listed at once as a partial run that fills hour by hour (streamRun), then completed.
  async startRun(engine, init, kind, hours, keepRuns) {
    const startedAt = Date.now(), run = { initHourUtc: init, hours, partial: true, readyHours: null, parameters: [], fields: [], storms: [], tracks: [], synoptic: [], soundings: [] };
    this.running = { initHourUtc: init, hours, startedAt };
    this.keep(run, keepRuns);
    try {
      const state = shareState(engine.saveState({ forecast: true }));
      const result = await this.pool.run(kind, state, 0, hours, { onProgress: part => { if (this.runtime.engine === engine) streamRun(run, part); } });
      if (this.runtime.engine !== engine) return null;
      // (a run that streamed sends back its head; one that did not, everything)
      const { streamed: _, ...rest } = result ?? {};
      Object.assign(run, rest, { readyHours: hours, realMs: Date.now() - startedAt });
      delete run.partial;
      this.lastError = null;
      return run;
    } catch (error) {
      this.lastError = String(error?.message ?? error);
      // (no retry for this hour: the next whole hour starts afresh; the hours it made are let go)
      const at = this.runs.indexOf(run);
      if (at >= 0) this.runs[at] = { initHourUtc: init, hours, failed: this.lastError };
      throw error;
    } finally {
      this.running = null;
    }
  }
  keep(run, keepRuns) {
    this.runs.push(run);
    this.runs.sort((a, b) => a.initHourUtc - b.initHourUtc);
    while (this.runs.length > keepRuns) this.runs.shift();
  }

  run(init) { return this.runs.find(run => run.initHourUtc === Number(init) && !run.failed) ?? null; }
  latest() { return this.runs.filter(run => !run.failed).at(-1) ?? null; }

  // What the model page asks for.
  list() {
    return {
      model: 'short range', running: this.running, error: this.lastError, nowHourUtc: this.runtime.engine?.world?.validHourUtc ?? null,
      runs: this.runs.map(run => ({ initHourUtc: run.initHourUtc, hours: run.hours, failed: run.failed ?? null, ms: run.ms ?? null, ...readiness(run) }))
    };
  }
  meta(init) {
    const run = init === undefined || init === null || init === '' ? this.latest() : this.run(init);
    if (!run || !run.parameters) return null;
    return {
      ...readiness(run),
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
  // The run's sounding at a cell of the map and a forecast hour (the newest run when none is named; the nearest
  // kept hour at or before the one asked for).
  sounding(init, hour, row, column) {
    const run = init === undefined || init === null || init === '' ? this.latest() : this.run(init);
    const frame = run?.soundings?.filter(f => f.hour <= Number(hour) + 1e-6).at(-1) ?? run?.soundings?.[0];
    if (!frame) return null;
    return soundingAnswer(cellOf(frame, Number(row), Number(column)), { row: Number(row), column: Number(column), initHourUtc: run.initHourUtc, forecastHour: frame.hour, validHourUtc: run.initHourUtc + frame.hour });
  }
  tracks(init) {
    const run = this.run(init);
    return run ? { initHourUtc: run.initHourUtc, tracks: run.tracks } : null;
  }

  // The large-scale view of a run (the newest when none is named), for the model page: its frames are the
  // whole large-scale model every few forecast hours, described and computed by the live world's synoptic
  // runtime (the same grid). hour: the valid hour of the frame wanted (the run's start when left out).
  synopticRuns() { return this.runs.filter(run => !run.failed && run.synoptic?.length); }
  synopticRun(init) { return (init === undefined || init === null || init === '' ? this.synopticRuns().at(-1) : this.synopticRuns().find(run => run.initHourUtc === Number(init))) ?? null; }
  synopticFrame(synoptic, init, hour) {
    const run = this.synopticRun(init); if (!run) return null;
    const frame = run.synoptic.find(f => f.hour === Number(hour)) ?? run.synoptic[0];
    // (planned: every frame the run will have, the hours not made yet too, for the page to grey out)
    const every = run.synopticEvery ?? 3, planned = Array.from({ length: Math.floor(run.hours / every) + 1 }, (_, k) => run.initHourUtc + k * every);
    return { ...synoptic.describe(frame, run.synoptic.map(f => f.hour), false), run: { initHourUtc: run.initHourUtc, hours: run.hours, forecastHour: frame.forecastHour, ...readiness(run), planned, runs: this.synopticRuns().map(r => ({ initHourUtc: r.initHourUtc, hours: r.hours, ...readiness(r) })) } };
  }
  synopticField(synoptic, init, hour, key) {
    const run = this.synopticRun(init); if (!run) return null;
    return synoptic.fieldOf(run.synoptic.find(f => f.hour === Number(hour)) ?? run.synoptic[0], key ?? '');
  }
}
