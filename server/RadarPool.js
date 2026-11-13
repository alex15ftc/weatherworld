// The radar is worked out by a few threads, so the authority's own thread is never held up by
// it (a scene and its mosaic take seconds of work every five simulated minutes). Each storm's
// precipitation is worked out on whichever thread is free, into memory every thread can read;
// the scene put together from them is handed to the threads once, and the mosaic is then built
// in strips, and each scan on one thread. The results are the same bytes the single-thread
// functions in RadarSimulator.js give. A thread holds the scene it was last given (about
// 150 MB, shared), so one with nothing to do is let go after a minute.
// Work that can wait (the day replays' tornado radar, ReplayArchive.js) is given with low = true: it is started
// only when nothing else is waiting, one piece at a time, and never on the last free thread, so the live radar
// and the game feed are never behind it.
//   WEATHER_RADAR_WORKERS sets the number of threads (default: a third of the cores, 2 to 8).
//   WEATHER_RADAR_IDLE_SECONDS sets how long a thread with nothing to do is kept.
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { assembleRadarScene, mosaicSize, MOSAIC_RES_KM, MOSAIC_PRODUCT } from '../js/radar/RadarSimulator.js';
import { rainFieldInputs, rainFieldsFor } from '../js/storms/StormRainFields.js';

const WORKER_SCRIPT = new URL('./radarWorker.js', import.meta.url);
const defaultSize = () => Number(process.env.WEATHER_RADAR_WORKERS) || Math.max(2, Math.min(8, Math.floor(os.availableParallelism() / 3)));
// The mosaic is cut into this many strips per thread: rows with storms take far longer than
// clear ones, and smaller strips keep every thread busy to the end.
const STRIPS_PER_THREAD = 4;
// What a storm's precipitation is not worked out from, and need not be copied to a thread.
const NOT_SENT = new Set(['trackPoints', 'internalField', 'children', 'mergedStormIds']);

export class RadarPool {
  constructor({ size = defaultSize(), idleMs = (Number(process.env.WEATHER_RADAR_IDLE_SECONDS) || 60) * 1000, workerScript = WORKER_SCRIPT } = {}) {
    this.size = Math.max(1, size); this.idleMs = idleMs; this.workerScript = workerScript;
    this.workers = new Set(); this.idle = []; this.queue = []; this.low = []; this.lowRunning = 0; this.sceneCount = 0;
    this.stats = { tasks: 0, busyMs: 0, lowTasks: 0, lowBusyMs: 0 };
  }

  // The scene for a world as it is now (the world is read before this returns). Its storms' fields
  // are the engine's (js/storms/StormRainFields.js): those already worked out this storm tick are
  // used as they are, the rest worked out here and kept for the engine.
  async buildScene(world) {
    const inputs = rainFieldInputs(world);
    const echoes = await rainFieldsFor(world, inputs.storms, input => this.field(input));
    const scene = assembleRadarScene(inputs, echoes);
    // Threads are given the scene with their first task for it, and keep it.
    Object.defineProperty(scene, 'poolId', { value: ++this.sceneCount });
    return scene;
  }

  // kind: 'composite' or 'base' (buildRadarMosaic).
  async mosaic(scene, sites, kind = 'composite') {
    const { height } = mosaicSize(scene), count = Math.min(height, this.size * STRIPS_PER_THREAD);
    const started = performance.now();
    const strips = await Promise.all(Array.from({ length: count }, (_, k) =>
      this.run({ kind: 'mosaic', sites, mosaicKind: kind, rows: [Math.round(k * height / count), Math.round((k + 1) * height / count)] }, scene)));
    const bytes = new Uint8Array(strips[0].width * height);
    for (const strip of strips) bytes.set(strip.bytes, strip.rows[0] * strip.width);
    const { rows, buildMs, ...rest } = strips[0];
    return { ...rest, bytes, buildMs: performance.now() - started };
  }

  // Composite, echo tops, VIL and hail size together (buildRadarMosaics: one pass for all the kinds
  // asked for, the same bytes as each alone): { kind: mosaic }.
  async mosaics(scene, sites, kinds) {
    const { height } = mosaicSize(scene), count = Math.min(height, this.size * STRIPS_PER_THREAD);
    const started = performance.now();
    const strips = await Promise.all(Array.from({ length: count }, (_, k) =>
      this.run({ kind: 'mosaics', sites, kinds, rows: [Math.round(k * height / count), Math.round((k + 1) * height / count)] }, scene)));
    const { width, validHourUtc } = strips[0], buildMs = performance.now() - started;
    return Object.fromEntries(kinds.map(kind => {
      const bytes = new Uint8Array(width * height);
      for (const strip of strips) bytes.set(strip.bytes[kind], strip.rows[0] * width);
      return [kind, { width, height, resKm: MOSAIC_RES_KM, kind, product: MOSAIC_PRODUCT[kind], composite: kind === 'composite', validHourUtc, bytes, buildMs }];
    }));
  }

  // The rotation one radar's scans show (detectRotation), worked out on a thread. Only the
  // velocity and reflectivity of each scan are sent.
  rotation(site, scans) { return this.run({ kind: 'rotation', site, scans: scans.map(rotationInputs) }); }

  // The radars' lowest scans' low-level shear laid on the mosaic grid (lowLevelShearGrid for each):
  // a Float32Array of width * height.
  shearGrid(width, height, sites, scans) { return this.run({ kind: 'shearGrid', width, height, sites, scans: scans.map(scan => scan && rotationInputs(scan)) }); }

  // These storms' fields (as above), worked out on the threads: Map of storm id -> field or null.
  async stormFields(world, storms) {
    const ids = new Set(storms.map(s => s.id)), inputs = rainFieldInputs(world).storms.filter(input => ids.has(input.storm.id));
    const fields = await rainFieldsFor(world, inputs, input => this.field(input));
    return new Map(inputs.map((input, k) => [input.storm.id, fields[k]]));
  }

  field(input, low = false) { return this.run({ kind: 'echo', input: { ...input, storm: stormToSend(input.storm) } }, null, low); }

  // The game feed's rain grids (js/radar/StormPrecipGrid.js, buildStormPrecipGrids' Map) for the
  // storms as they are now, worked out on the threads: the world is read before this returns, and
  // the Promise gives the same grids buildStormPrecipGrids(world) would have then. (The storms'
  // inputs are the ones the radar's fields are worked out from: rainFieldInputs.)
  precipGrids(world) {
    if (!(world.storms ?? []).some(storm => storm.active !== false && storm.structure)) return new Map();
    const inputs = rainFieldInputs(world).storms;
    return Promise.all(inputs.map(input => this.run({ kind: 'precipGrid', input: { ...input, storm: stormToSend(input.storm) } })))
      .then(grids => new Map(inputs.map((input, k) => [input.storm.id, grids[k]])));
  }

  // (gateKm: the gates' length, RADAR_GATE_KM unless a close look asks for finer)
  scan(scene, site, tiltDeg, gateKm = undefined, low = false) { return this.run({ kind: 'scan', site, tiltDeg, gateKm }, scene, low); }

  // The satellite's images from satelliteInputs (js/satellite/Satellite.js), on a thread: the same
  // bytes renderSatellite gives here.
  satellite(inputs) { return this.run({ kind: 'satellite', inputs }); }

  run(message, scene = null, low = false) {
    return new Promise((resolve, reject) => { (low ? this.low : this.queue).push({ message, scene, resolve, reject, low }); this.pump(); });
  }

  pump() {
    const room = () => this.idle.length || this.workers.size < this.size;
    while (this.queue.length && room()) this.give(this.queue.shift());
    // Work that can wait: one piece at a time, and only while another thread stays free for the rest.
    const busy = () => this.workers.size - this.idle.length;
    while (this.low.length && !this.queue.length && !this.lowRunning && busy() < Math.max(1, this.size - 1) && room()) { this.lowRunning++; this.give(this.low.shift()); }
  }

  give(task) {
    // A thread that already holds the task's scene is preferred.
    const index = this.idle.findIndex(w => task.scene && w.sceneId === task.scene.poolId);
    const worker = index >= 0 ? this.idle.splice(index, 1)[0] : this.idle.pop() ?? this.start();
    clearTimeout(worker.idleTimer);
    const message = { ...task.message };
    if (task.scene && worker.sceneId !== task.scene.poolId) { message.scene = task.scene; message.sceneId = task.scene.poolId; worker.sceneId = task.scene.poolId; }
    worker.task = task; task.startedAt = performance.now();
    worker.ref(); worker.postMessage(message);
  }

  start() {
    const worker = new Worker(this.workerScript);
    this.workers.add(worker);
    const settle = (fn, value) => { const task = worker.task; worker.task = null; if (task) { const ms = performance.now() - task.startedAt; if (task.low) { this.lowRunning--; this.stats.lowTasks++; this.stats.lowBusyMs += ms; } else { this.stats.tasks++; this.stats.busyMs += ms; } task[fn](value); } };
    worker.on('message', message => {
      settle(message?.ok ? 'resolve' : 'reject', message?.ok ? message.result : new Error(message?.error ?? 'radar task failed'));
      worker.unref(); this.idle.push(worker);
      worker.idleTimer = setTimeout(() => this.retire(worker), this.idleMs); worker.idleTimer.unref();
      this.pump();
    });
    const lost = error => { if (!this.workers.delete(worker)) return; this.idle = this.idle.filter(w => w !== worker); clearTimeout(worker.idleTimer); settle('reject', error); this.pump(); };
    worker.on('error', lost);
    worker.on('exit', code => lost(new Error(`radar thread ended with code ${code} before reporting`)));
    return worker;
  }

  retire(worker) {
    if (worker.task || !this.workers.delete(worker)) return;
    this.idle = this.idle.filter(w => w !== worker); clearTimeout(worker.idleTimer);
    return worker.terminate();
  }

  status() { return { threads: this.workers.size, size: this.size, busy: this.workers.size - this.idle.length, waiting: this.queue.length, lowWaiting: this.low.length, ...this.stats }; }

  stop() {
    const waiting = [...this.queue, ...this.low]; this.queue = []; this.low = [];
    for (const task of waiting) task.reject(new Error('the radar pool was stopped'));
    const workers = [...this.workers]; this.workers.clear(); this.idle = [];
    return Promise.all(workers.map(worker => { clearTimeout(worker.idleTimer); const task = worker.task; worker.task = null; task?.reject(new Error('the radar pool was stopped')); return worker.terminate(); }));
  }
}

function rotationInputs(scan) {
  return { tiltDeg: scan.tiltDeg, products: { velocity: scan.products.velocity, reflectivity: scan.products.reflectivity } };
}

// (also what the day replays keep of a storm for a later scan: ReplayArchive.js)
export function stormToSend(storm) {
  const out = {};
  for (const key of Object.keys(storm)) if (!NOT_SENT.has(key)) out[key] = storm[key];
  return out;
}
