const now = () => performance.now();
const navStart = performance.timeOrigin;

class PerformanceProfiler {
  constructor() {
    this.startedAt = 0;
    this.page = document.body?.dataset?.page ?? 'unknown';
    this.spans = [];
    this.events = [];
    this.requests = [];
    this.counters = {};
    this.ready = false;
    this.mark('profiler:created');
    addEventListener('error', e => this.event('error', { message: e.message }));
    addEventListener('unhandledrejection', e => this.event('unhandledrejection', { message: String(e.reason) }));
  }
  mark(name, detail = {}) { this.events.push({ name, atMs: round(now()), detail }); performance.mark(`wx:${name}`); }
  event(name, detail = {}) { this.mark(name, detail); }
  begin(name, detail = {}) { const span = { name, startMs: now(), detail }; this.spans.push(span); return span; }
  end(span, detail = {}) { if (!span || span.durationMs != null) return span; span.endMs = now(); span.durationMs = round(span.endMs - span.startMs); Object.assign(span.detail, detail); return span; }
  async measure(name, fn, detail = {}) { const span = this.begin(name, detail); try { const value = await fn(); this.end(span, { ok: true }); return value; } catch (error) { this.end(span, { ok: false, error: error?.message ?? String(error) }); throw error; } }
  count(name, amount = 1) { this.counters[name] = (this.counters[name] ?? 0) + amount; }
  request(entry) { this.requests.push({ ...entry, atMs: round(now()) }); }
  interactive(detail = {}) { if (this.ready) return; this.ready = true; this.mark('page:interactive', detail); this.publish(); }
  navigation() {
    const n = performance.getEntriesByType('navigation')[0];
    return n ? {
      type: n.type, redirectMs: round(n.redirectEnd - n.redirectStart), dnsMs: round(n.domainLookupEnd - n.domainLookupStart),
      connectMs: round(n.connectEnd - n.connectStart), requestToFirstByteMs: round(n.responseStart - n.requestStart),
      responseMs: round(n.responseEnd - n.responseStart), domInteractiveMs: round(n.domInteractive),
      domContentLoadedMs: round(n.domContentLoadedEventEnd), loadEventMs: round(n.loadEventEnd), transferSize: n.transferSize,
      encodedBodySize: n.encodedBodySize, decodedBodySize: n.decodedBodySize
    } : null;
  }
  resources() {
    return performance.getEntriesByType('resource').map(r => ({
      name: new URL(r.name, location.href).pathname, initiatorType: r.initiatorType, durationMs: round(r.duration),
      startMs: round(r.startTime), transferSize: r.transferSize, encodedBodySize: r.encodedBodySize, decodedBodySize: r.decodedBodySize
    })).sort((a,b)=>b.durationMs-a.durationMs);
  }
  longTasks() { return this._longTasks ?? []; }
  snapshot() {
    return { version:'2.20.13', page:this.page, url:location.href, userAgent:navigator.userAgent, capturedAt:new Date().toISOString(),
      elapsedMs:round(now()), navigation:this.navigation(), spans:this.spans.map(s=>({...s,startMs:round(s.startMs),endMs:s.endMs==null?null:round(s.endMs)})),
      events:this.events, requests:this.requests, counters:this.counters, resources:this.resources(), longTasks:this.longTasks() };
  }
  publish() { window.__WEATHER_PROFILE__ = this.snapshot(); dispatchEvent(new CustomEvent('weather-profile-updated',{detail:window.__WEATHER_PROFILE__})); }
  download() { const blob=new Blob([JSON.stringify(this.snapshot(),null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`weather-profile-${this.page}-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
}
function round(v){return Math.round(v*100)/100;}
export const profiler = new PerformanceProfiler();
try {
  profiler._longTasks=[];
  new PerformanceObserver(list=>{for(const e of list.getEntries())profiler._longTasks.push({startMs:round(e.startTime),durationMs:round(e.duration),name:e.name});}).observe({type:'longtask',buffered:true});
} catch {}
window.weatherProfiler = profiler;
