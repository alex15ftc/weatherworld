export class WorkerWeatherClient {
  constructor(url = new URL('../worker/weatherAuthority.worker.js', import.meta.url)) {
    this.worker = new Worker(url, { type: 'module' });
    this.pending = new Map(); this.sequence = 0;
    this.worker.onmessage = ({ data }) => { const job = this.pending.get(data.id); if (!job) return; this.pending.delete(data.id); data.ok ? job.resolve(data.result) : job.reject(new Error(data.error)); };
  }
  request(type, payload = {}) { const id = ++this.sequence; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, type, payload }); }); }
  init(seed) { return this.request('init', { seed }); }
  getAuthorityState(seed) { return this.request('state', { seed }); }
  getLiveField(product, seed) { return this.request('field', { product, seed }); }
  getRadarSnapshot(seed) { return this.request('radar', { seed }); }
  getOutlook(day, seed) { return this.request('outlook', { day, seed }); }
  advance(hours) { return this.request('advance', { hours }); }
  close() { this.worker.terminate(); }
}
