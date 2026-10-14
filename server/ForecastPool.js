// The forecast runs behind the outlooks, the mesoscale discussions and the watches, done by a
// few threads. Every run starts from a copy of the world taken at issue time; the threads
// share its bytes and each run reads its own world out of them, so nothing is written to
// disk. Runs wait their turn when the threads are busy, the more urgent first (a mesoscale
// look ahead goes before the rest of an outlook), so the load is never more than `size` cores
// however many products are due at once; and one thread is kept free for the urgent runs, so
// a look ahead does not wait behind an outlook's long ones. A thread that has run before has
// its code compiled already, so the later runs of a batch start faster; but a thread keeps
// about 450 MB after a run (measured: the memory is not handed back while it lives), so one
// with nothing to do is let go after half a minute.
//   WEATHER_FORECAST_WORKERS sets the number of threads (default: a quarter of the cores, 1 to 4).
//   WEATHER_FORECAST_IDLE_SECONDS sets how long a thread with nothing to do is kept.
import os from 'node:os';
import v8 from 'node:v8';
import { Worker } from 'node:worker_threads';

const WORKER_SCRIPT = new URL('./forecastWorker.js', import.meta.url);
const defaultSize = () => Number(process.env.WEATHER_FORECAST_WORKERS) || Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 4)));

// A world's saved state as bytes every thread can read (see AtmosphereWorld.saveState).
export function shareState(state) {
  const bytes = v8.serialize(state), shared = new Uint8Array(new SharedArrayBuffer(bytes.length));
  shared.set(bytes);
  return shared;
}

export class ForecastPool {
  // idleMs: a thread with nothing to do for this long is let go.
  constructor({ size = defaultSize(), idleMs = (Number(process.env.WEATHER_FORECAST_IDLE_SECONDS) || 30) * 1000, workerScript = WORKER_SCRIPT } = {}) {
    this.size = Math.max(1, size); this.idleMs = idleMs; this.workerScript = workerScript;
    // Threads the runs that are not urgent (priority 0) leave free.
    this.reserve = this.size > 1 ? 1 : 0;
    this.workers = new Set(); this.idle = []; this.queue = []; this.order = 0;
    this.stats = { runs: 0, busyMs: 0, longestWaitMs: 0 };
  }

  // One run. kind: 'outlook' or 'mesoscale'; state: shareState's bytes; priority: higher goes first.
  run(kind, state, member, hours, { priority = 0, options = {} } = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ message: { kind, state, member, hours, options }, priority, order: this.order++, queuedAt: Date.now(), resolve, reject });
      this.queue.sort((a, b) => b.priority - a.priority || a.order - b.order);
      this.pump();
    });
  }

  pump() {
    while (this.queue.length) {
      // The queue has the most urgent first.
      const free = this.idle.length + this.size - this.workers.size;
      if (free <= (this.queue[0].priority > 0 ? 0 : this.reserve)) return;
      const worker = this.idle.pop() ?? this.start();
      const task = this.queue.shift();
      clearTimeout(worker.idleTimer);
      task.startedAt = Date.now(); this.stats.longestWaitMs = Math.max(this.stats.longestWaitMs, task.startedAt - task.queuedAt);
      worker.task = task;
      // A thread at work keeps the process up; one with nothing to do does not.
      worker.ref(); worker.postMessage(task.message);
    }
  }

  start() {
    const worker = new Worker(this.workerScript);
    this.workers.add(worker);
    const settle = (fn, value) => { const task = worker.task; worker.task = null; if (task) { this.stats.runs++; this.stats.busyMs += Date.now() - task.startedAt; task[fn](value); } };
    worker.on('message', message => {
      settle(message?.ok ? 'resolve' : 'reject', message?.ok ? message.result : new Error(message?.error ?? 'forecast run failed'));
      worker.unref(); this.idle.push(worker);
      worker.idleTimer = setTimeout(() => this.retire(worker), this.idleMs); worker.idleTimer.unref();
      this.pump();
    });
    // A thread that dies takes its run with it; another is started for the runs still waiting.
    const lost = error => { if (!this.workers.delete(worker)) return; this.idle = this.idle.filter(w => w !== worker); clearTimeout(worker.idleTimer); settle('reject', error); this.pump(); };
    worker.on('error', lost);
    worker.on('exit', code => lost(new Error(`forecast thread ended with code ${code} before reporting`)));
    return worker;
  }

  retire(worker) {
    if (worker.task || !this.workers.delete(worker)) return;
    this.idle = this.idle.filter(w => w !== worker); clearTimeout(worker.idleTimer);
    return worker.terminate();
  }

  status() { return { threads: this.workers.size, size: this.size, busy: this.workers.size - this.idle.length, waiting: this.queue.length, ...this.stats }; }

  // Ends every thread; runs under way or waiting fail.
  stop() {
    const waiting = this.queue; this.queue = [];
    for (const task of waiting) task.reject(new Error('the forecast pool was stopped'));
    const workers = [...this.workers]; this.workers.clear(); this.idle = [];
    return Promise.all(workers.map(worker => { clearTimeout(worker.idleTimer); const task = worker.task; worker.task = null; task?.reject(new Error('the forecast pool was stopped')); return worker.terminate(); }));
  }
}

// The pool the server's products share.
let shared = null;
export function sharedForecastPool() { return (shared ??= new ForecastPool()); }
