// Worker threads for the outlook ensemble, so that it never runs on the server's main thread.
// Members are split across the workers.
import { Worker } from 'node:worker_threads';

export class OutlookEnsemblePool {
  constructor(size) {
    this.size = Math.max(1, Math.floor(size));
    this.workers = [];
    this.jobs = new Map();
    this.nextJobId = 1;
  }

  // source: { snapshot } (serialized world, SharedArrayBuffer) or { seed } (a system's first
  // hour). Resolves with every member's result, ordered by member index.
  runMembers(source, specs) {
    this.ensureWorkers();
    const shares = this.workers.map((_, i) => specs.filter((__, index) => index % this.workers.length === i));
    return Promise.all(shares.map((share, i) => share.length ? this.post(this.workers[i], { ...source, specs: share }).then(m => m.results) : []))
      .then(parts => parts.flat().sort((a, b) => a.index - b.index));
  }

  post(worker, message) {
    return new Promise((resolve, reject) => {
      const jobId = this.nextJobId++;
      this.jobs.set(jobId, { resolve, reject, worker });
      worker.postMessage({ jobId, ...message });
    });
  }

  ensureWorkers() {
    while (this.workers.length < this.size) {
      const worker = new Worker(new URL('../js/forecast/ensembleWorker.js', import.meta.url));
      worker.on('message', message => {
        const job = this.jobs.get(message.jobId);
        if (!job) return;
        this.jobs.delete(message.jobId);
        if (message.error) job.reject(new Error(message.error)); else job.resolve(message);
      });
      worker.on('error', error => this.failWorker(worker, error));
      worker.on('exit', code => { if (code !== 0) this.failWorker(worker, new Error(`ensemble worker exited (${code})`)); });
      worker.unref();
      this.workers.push(worker);
    }
  }

  failWorker(worker, error) {
    this.workers = this.workers.filter(w => w !== worker);
    for (const [jobId, job] of this.jobs) if (job.worker === worker) { this.jobs.delete(jobId); job.reject(error); }
  }

  close() {
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
  }
}
