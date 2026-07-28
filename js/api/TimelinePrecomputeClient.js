export class TimelinePrecomputeClient {
  constructor(url = new URL('../worker/timelinePrecompute.worker.js', import.meta.url)) {
    this.worker = new Worker(url, { type: 'module' });
    this.pending = new Map();
    this.sequence = 0;
    this.progressListeners = new Set();
    this.worker.onmessage = ({ data }) => {
      if (data?.type === 'timeline-progress') {
        for (const listener of this.progressListeners) listener(data.progress);
        return;
      }
      const job = this.pending.get(data?.id);
      if (!job) return;
      this.pending.delete(data.id);
      data.ok ? job.resolve(data.result) : job.reject(new Error(data.error));
    };
  }

  onProgress(listener) {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  request(type, payload = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }

  start({ seed, startHourUtc, hours = 72, stepHours = 0.5 }) {
    return this.request('start', { seed, startHourUtc, hours, stepHours });
  }

  status() { return this.request('status'); }
  getFrame(hourOffset = 0) { return this.request('frame', { hourOffset }); }
  getFrameAt(validHourUtc) { return this.request('frame-at', { validHourUtc }); }
  cancel() { return this.request('cancel'); }
  close() { this.worker.terminate(); }
}
