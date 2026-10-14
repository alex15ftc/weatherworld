// The radar is worked out by a few threads, so the authority's own thread is never held up by
// it (a scene and its mosaic take seconds of work every five simulated minutes). Each storm's
// precipitation is worked out on whichever thread is free, into memory every thread can read;
// the scene put together from them is handed to the threads once, and the mosaic is then built
// in strips, and each scan on one thread. The results are the same bytes the single-thread
// functions in RadarSimulator.js give. A thread holds the scene it was last given (about
// 150 MB, shared), so one with nothing to do is let go after a minute.
//   WEATHER_RADAR_WORKERS sets the number of threads (default: a third of the cores, 2 to 8).
//   WEATHER_RADAR_IDLE_SECONDS sets how long a thread with nothing to do is kept.
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { radarSceneInputs, assembleRadarScene, mosaicSize } from '../js/radar/RadarSimulator.js';

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
    this.workers = new Set(); this.idle = []; this.queue = []; this.sceneCount = 0;
    this.stats = { tasks: 0, busyMs: 0 };
  }

  // The scene for a world as it is now (the world is read before this returns).
  async buildScene(world) {
    const inputs = radarSceneInputs(world);
    const echoes = await Promise.all(inputs.storms.map(input => this.run({ kind: 'echo', input: { ...input, storm: stormToSend(input.storm) } })));
    const scene = assembleRadarScene(inputs, echoes);
    // Threads are given the scene with their first task for it, and keep it.
    Object.defineProperty(scene, 'poolId', { value: ++this.sceneCount });
    return scene;
  }

  async mosaic(scene, sites) {
    const { height } = mosaicSize(scene), count = Math.min(height, this.size * STRIPS_PER_THREAD);
    const started = performance.now();
    const strips = await Promise.all(Array.from({ length: count }, (_, k) =>
      this.run({ kind: 'mosaic', sites, rows: [Math.round(k * height / count), Math.round((k + 1) * height / count)] }, scene)));
    const bytes = new Uint8Array(strips[0].width * height);
    for (const strip of strips) bytes.set(strip.bytes, strip.rows[0] * strip.width);
    const { rows, buildMs, ...rest } = strips[0];
    return { ...rest, bytes, buildMs: performance.now() - started };
  }

  scan(scene, site, tiltDeg) { return this.run({ kind: 'scan', site, tiltDeg }, scene); }

  run(message, scene = null) {
    return new Promise((resolve, reject) => { this.queue.push({ message, scene, resolve, reject }); this.pump(); });
  }

  pump() {
    while (this.queue.length && (this.idle.length || this.workers.size < this.size)) {
      const task = this.queue.shift();
      // A thread that already holds the task's scene is preferred.
      const index = this.idle.findIndex(w => task.scene && w.sceneId === task.scene.poolId);
      const worker = index >= 0 ? this.idle.splice(index, 1)[0] : this.idle.pop() ?? this.start();
      clearTimeout(worker.idleTimer);
      const message = { ...task.message };
      if (task.scene && worker.sceneId !== task.scene.poolId) { message.scene = task.scene; message.sceneId = task.scene.poolId; worker.sceneId = task.scene.poolId; }
      worker.task = task; task.startedAt = performance.now();
      worker.ref(); worker.postMessage(message);
    }
  }

  start() {
    const worker = new Worker(this.workerScript);
    this.workers.add(worker);
    const settle = (fn, value) => { const task = worker.task; worker.task = null; if (task) { this.stats.tasks++; this.stats.busyMs += performance.now() - task.startedAt; task[fn](value); } };
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

  status() { return { threads: this.workers.size, size: this.size, busy: this.workers.size - this.idle.length, waiting: this.queue.length, ...this.stats }; }

  stop() {
    const waiting = this.queue; this.queue = [];
    for (const task of waiting) task.reject(new Error('the radar pool was stopped'));
    const workers = [...this.workers]; this.workers.clear(); this.idle = [];
    return Promise.all(workers.map(worker => { clearTimeout(worker.idleTimer); const task = worker.task; worker.task = null; task?.reject(new Error('the radar pool was stopped')); return worker.terminate(); }));
  }
}

function stormToSend(storm) {
  const out = {};
  for (const key of Object.keys(storm)) if (!NOT_SENT.has(key)) out[key] = storm[key];
  return out;
}
