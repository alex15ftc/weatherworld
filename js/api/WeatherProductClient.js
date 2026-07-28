import { profiler } from '../performance/PerformanceProfiler.js?v=2.20.13';
const DEFAULT_TIMEOUT_MS = 8000;

export class WeatherProductClient {
  constructor({ baseUrl = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.available = null;
    this.etags = new Map();
    this.cache = new Map();
  }

  async health({ force = false } = {}) {
    if (!force && this.available !== null) return this.available;
    try {
      const result = await this.#json('/api/health', { timeoutMs: 1800, cacheable: true });
      this.available = Boolean(result?.ok);
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  async getAuthorityState() { return this.#json('/api/authority/state'); }
  async resetAuthority(seed, view = {}) { return this.#post('/api/authority/reset', { seed, view }, { timeoutMs: 90000 }); }
  async advanceAuthority(hours = 0.5, view = {}) { return this.#post('/api/authority/advance', { hours, view }, { timeoutMs: 60000 }); }
  async seekAuthority(validHourUtc, view = {}) { return this.#post('/api/authority/seek', { validHourUtc, view }, { timeoutMs: 90000 }); }
  async setAuthorityClock(enabled) { return this.#post('/api/authority/clock', { enabled }); }
  async getLiveMetadata() { return this.#json('/api/live/metadata', { cacheable: true }); }
  async getLiveField(product = 'temperature') { return this.#json(`/api/live/field?product=${encodeURIComponent(product)}`, { cacheable: true }); }
  async getLiveBoundaries() { return this.#json('/api/live/boundaries', { cacheable: true }); }
  async getLiveStorms() { const value = await this.#json(`/api/live/storms?_=${Date.now()}`, { cacheable: false }); return Array.isArray(value) ? value : (value?.storms ?? []); }
  async getCell(row, column, { day = 'day1', revision = '', authority = '' } = {}) { return this.#json(`/api/live/cell?row=${row}&column=${column}&day=${encodeURIComponent(day)}&revision=${encodeURIComponent(revision)}&authority=${encodeURIComponent(authority)}`, { cacheable: false, timeoutMs: 2500 }); }
  async getSounding(row, column, { day = 'day1', revision = '', authority = '' } = {}) { return this.#json(`/api/live/sounding?row=${row}&column=${column}&day=${encodeURIComponent(day)}&revision=${encodeURIComponent(revision)}&authority=${encodeURIComponent(authority)}`, { cacheable: false, timeoutMs: 5000 }); }
  async getRadarSnapshot() { return this.#json('/api/radar/snapshot', { cacheable: true }); }
  async getRadarScan(product = 'reflectivity', station = 'composite') { return this.#json(`/api/radar/scan?product=${encodeURIComponent(product)}&station=${encodeURIComponent(station)}`, { cacheable: true, timeoutMs: 15000 }); }
  async getRadarStations() { return this.#json('/api/radar/stations', { cacheable: true }); }
  async getOutlook(day) { return this.#json(`/api/outlooks/${encodeURIComponent(day)}`, { cacheable: true }); }
  async getOutlookField(day, product = 'risk') { return this.#json(`/api/outlooks/${encodeURIComponent(day)}/field?product=${encodeURIComponent(product)}`, { cacheable: true }); }
  async getPerformance() { return this.#json('/api/performance', { cacheable: false }); }
  async getMapManifest({scope='live',product='temperature',day='day1',station='composite'}={}) { return this.#json(`/api/map/manifest?scope=${encodeURIComponent(scope)}&product=${encodeURIComponent(product)}&day=${encodeURIComponent(day)}&station=${encodeURIComponent(station)}&_=${Date.now()}`, { cacheable: false }); }

  async #post(path, body, { timeoutMs = 20000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST', signal: controller.signal, cache: 'no-store',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {})
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const value = await response.json();
      this.etags.clear(); this.cache.clear();
      profiler.request({ path, status: response.status, totalMs: performance.now() - started, transferBytes: Number(response.headers.get('content-length')) || 0, serverTiming: response.headers.get('server-timing') });
      return value;
    } finally { clearTimeout(timer); profiler.publish(); }
  }

  async #json(path, { timeoutMs = this.timeoutMs, cacheable = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = {};
    if (cacheable && this.etags.has(path)) headers['If-None-Match'] = this.etags.get(path);
    const started = performance.now();
    let response;
    try {
      const networkStarted = performance.now();
      response = await fetch(`${this.baseUrl}${path}`, {
        signal: controller.signal,
        cache: cacheable ? 'default' : 'no-store',
        headers
      });
      const networkMs = performance.now() - networkStarted;
      if (response.status === 304 && this.cache.has(path)) {
        profiler.request({ path, status: 304, cacheHit: true, networkMs, parseMs: 0, totalMs: performance.now() - started, transferBytes: 0 });
        profiler.count('api304');
        return this.cache.get(path);
      }
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const parseStarted = performance.now();
      const value = await response.json();
      const parseMs = performance.now() - parseStarted;
      const etag = response.headers.get('etag');
      if (cacheable) {
        if (etag) this.etags.set(path, etag);
        this.cache.set(path, value);
      }
      profiler.request({ path, status: response.status, cacheHit: false, networkMs, parseMs, totalMs: performance.now() - started, transferBytes: Number(response.headers.get('content-length')) || 0, serverTiming: response.headers.get('server-timing') });
      profiler.count('apiRequests');
      return value;
    } catch (error) {
      profiler.request({ path, status: response?.status ?? 0, failed: true, error: error?.message ?? String(error), totalMs: performance.now() - started });
      throw error;
    } finally { clearTimeout(timer); profiler.publish(); }
  }
}
