// The admin tool (2026-11-17, the owner's request): a small server of its own, run on this machine only and never
// deployed (tools/ is left out of the engine's image). npm run admin, then open http://localhost:3920.
//   Long range model  the live engine's long range run (its public pages' endpoints, fetched through here): 250 mb
//                     wind and 500 mb height on a slider. With WEATHER_ADMIN_KEY set, the map's place is shown too.
//   Settings          sliders for the large-scale model's jet (QuasiGeostrophicModel: strength, core shear, mean winds,
//                     width) and the region's steering (RegionSteering), starting from the world's own settings.
//                     Exported as a JSON file (and the lines for the code's defaults); a file exported before can be
//                     loaded back.
//   Week preview      the world run ahead with its storms for the coming 7 convective days under the sliders'
//                     settings (SeverePreview.js, on a thread of its own), day by day.
// The world: a local engine's saved one (ADMIN_STATE, default data/cache/atmosphere-state.bin, the file npm start
// keeps), or, without one, a new world for ADMIN_SEED (default 1). ADMIN_PORT (3920), ADMIN_LIVE_URL (the hosted
// engine). Listens on this machine's loopback address only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { QG_DEFAULTS, RETUNABLE } from '../../js/atmosphere/QuasiGeostrophicModel.js';
import { STEERING_DEFAULTS } from '../../js/world/RegionSteering.js';
import { STEERING_KEYS, PREVIEW } from './SeverePreview.js';
import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const PORT = Number(process.env.ADMIN_PORT) || 3920;
const STATE_FILE = path.resolve(ROOT, process.env.ADMIN_STATE ?? 'data/cache/atmosphere-state.bin');
const SEED = Number(process.env.ADMIN_SEED) || 1;
const LIVE = (process.env.ADMIN_LIVE_URL ?? 'https://highrisk.up.railway.app').replace(/\/$/, '');
const KEY = process.env.WEATHER_ADMIN_KEY ?? null;

// What each setting may be set to (the page's sliders use the same ranges).
const WIDEST_JET_KM = Math.round(QG_DEFAULTS.ny * QG_DEFAULTS.gridKm / 3);
const LIMITS = {
  qg: { jetMs: [0, 30], jetShearMs: [-10, 30], upperWindMs: [0, 30], lowerWindMs: [-5, 15], jetWidthKm: [400, WIDEST_JET_KM] },
  steering: {
    windCapKt: [20, 140], southerlyCapKt: [5, 60], wantedLow: [0, 1], wantedHigh: [0, 1], systemSpeedMs: [0, 30], northSpeedMs: [0, 20],
    homeReachKm: [0, 3000], homePull: [0, 1], lookAheadDays: [0, 2], maxMissKm: [0, 2000], moistRangeGkg: [-8, 10], kinds: [0, 1]
  }
};
const pick = (object, keys) => Object.fromEntries(keys.map(key => [key, object?.[key] ?? null]));
const DEFAULTS = { qg: pick(QG_DEFAULTS, RETUNABLE), steering: pick(STEERING_DEFAULTS, STEERING_KEYS) };

// The world previews start from, and its own settings (read again when the saved file changes).
let sourceCache = null;
function source() {
  if (fs.existsSync(STATE_FILE)) {
    const stamp = fs.statSync(STATE_FILE).mtimeMs;
    if (sourceCache?.stamp !== stamp) {
      try {
        const engine = v8.deserialize(fs.readFileSync(STATE_FILE)).engine;
        sourceCache = {
          stamp, kind: 'saved', file: STATE_FILE, seed: engine.seed, hourUtc: engine.regional.hourUtc, savedAt: new Date(stamp).toISOString(),
          settings: { qg: { ...DEFAULTS.qg, ...pick(engine.model.params, RETUNABLE.filter(key => key in engine.model.params)) }, steering: { ...DEFAULTS.steering, ...(engine.steering ? pick(engine.steering.params, STEERING_KEYS.filter(key => key in engine.steering.params)) : {}) } }
        };
      } catch (error) { sourceCache = { stamp, kind: 'seed', seed: SEED, problem: `the saved world could not be read (${error.message})`, settings: DEFAULTS }; }
    }
    return sourceCache;
  }
  return { kind: 'seed', seed: SEED, settings: DEFAULTS };
}

const clampTo = (value, [lo, hi]) => { const v = Number(value); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null; };
// The settings asked for, kept within LIMITS (anything else is dropped).
function clean({ qg = {}, steering = {} } = {}) {
  const outQg = {}, outSteering = {};
  for (const key of RETUNABLE) {
    if (!(key in qg)) continue;
    if (key === 'jetWidthKm') { const v = qg[key] === null ? null : clampTo(qg[key], LIMITS.qg.jetWidthKm); outQg[key] = v === null || v >= WIDEST_JET_KM - 1 ? null : v; continue; }
    const v = clampTo(qg[key], LIMITS.qg[key]); if (v !== null) outQg[key] = v;
  }
  for (const key of STEERING_KEYS) {
    if (!(key in steering)) continue;
    const value = steering[key], range = LIMITS.steering[key];
    if (key === 'moistRangeGkg') { if (Array.isArray(value) && value.length === 2) { const [a, b] = value.map(v => clampTo(v, range)); if (a !== null && b !== null && b > a) outSteering[key] = [a, b]; } continue; }
    if (key === 'kinds') { if (value && typeof value === 'object') { const k = {}; for (const name of ['warmSector', 'nearLow', 'upperLow']) { const v = clampTo(value[name], range); if (v !== null) k[name] = v; } if (Object.values(k).some(v => v > 0)) outSteering[key] = k; } continue; }
    const v = clampTo(value, range); if (v !== null) outSteering[key] = key === 'lookAheadDays' ? Math.round(v) : v;
  }
  return { qg: outQg, steering: outSteering };
}

// One preview at a time.
let running = null, last = null;
function startPreview(asked) {
  if (running) return false;
  const from = source(), settings = clean(asked), startedAt = Date.now();
  const run = running = { startedAt, source: { kind: from.kind, seed: from.seed, hourUtc: from.hourUtc ?? null }, settings, hoursDone: 0, days: [] };
  const worker = new Worker(path.join(HERE, 'preview-worker.mjs'), { workerData: { source: from.kind === 'saved' ? { kind: 'saved', file: from.file } : { kind: 'seed', seed: from.seed }, days: PREVIEW.days, ...settings } });
  const finish = extra => { if (running !== run) return; last = { ...run, realMs: Date.now() - startedAt, ...extra }; running = null; worker.terminate(); };
  worker.on('message', message => {
    if (message.progress?.day) run.days.push(message.progress.day);
    if (Number.isFinite(message.progress?.hoursDone)) run.hoursDone = message.progress.hoursDone;
    if (message.done) finish({ applied: message.done.applied, error: null });
    if (message.error) finish({ error: message.error });
  });
  worker.on('error', error => finish({ error: String(error?.message ?? error) }));
  worker.on('exit', code => finish({ error: code ? `the preview stopped (exit ${code})` : 'the preview stopped' }));
  return true;
}
function status() {
  const r = running;
  return { running: r ? { startedAt: r.startedAt, source: r.source, settings: r.settings, hoursDone: r.hoursDone, days: r.days } : null, last };
}

function settingsAnswer() {
  const from = source();
  return {
    game: from.settings, defaults: DEFAULTS, limits: LIMITS, days: PREVIEW.days,
    domain: { northSouthKm: QG_DEFAULTS.ny * QG_DEFAULTS.gridKm, gridKm: QG_DEFAULTS.gridKm, widestJetKm: WIDEST_JET_KM },
    source: { kind: from.kind, seed: from.seed, file: from.file ?? null, hourUtc: from.hourUtc ?? null, savedAt: from.savedAt ?? null, problem: from.problem ?? null },
    live: { url: LIVE, admin: Boolean(KEY) }
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json' };
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
async function body(req) { let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > 64 * 1024) throw new Error('too large'); chunks.push(chunk); } return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/index.html') { res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(path.join(HERE, 'admin.html'), 'utf8').replace('<!--site:head-->', () => fs.readFileSync(path.join(ROOT, 'site/head.html'), 'utf8'))); }
    if (url.pathname === '/api/settings') return json(res, 200, settingsAnswer());
    if (url.pathname === '/api/preview') {
      if (req.method === 'POST') { const started = startPreview(await body(req)); return json(res, started ? 202 : 409, { started, ...status() }); }
      return json(res, 200, status());
    }
    // The live long range run, through here (its frames carry the map's place for an admin key).
    // (and the calendar and health the site's shared script, js/site.js, asks for)
    const longRange = url.pathname.match(/^\/api\/long-range\/(frame|field)$/), siteAsk = /^\/api\/(calendar|health)$/.test(url.pathname);
    if (longRange || siteAsk) {
      const upstream = await fetch(`${LIVE}${longRange ? `/api/models/long-range/synoptic/${longRange[1]}` : url.pathname}${url.search}`, { headers: KEY ? { 'x-admin-key': KEY } : {} });
      res.writeHead(upstream.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(Buffer.from(await upstream.arrayBuffer()));
    }
    // The site's styles, fonts and icon (its shared <head>, site/head.html), and the engine's modules the page reads.
    if (/^\/(css|fonts|js|site)\//.test(url.pathname)) {
      const file = path.resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
      if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) { res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); return fs.createReadStream(file).pipe(res); }
    }
    json(res, 404, { error: 'not found' });
  } catch (error) { json(res, 500, { error: String(error?.message ?? error) }); }
}).listen(PORT, '127.0.0.1', () => {
  const from = source();
  console.log(`[admin] http://localhost:${PORT}  world: ${from.kind === 'saved' ? `saved (${from.file}, seed ${from.seed})` : `a new world for seed ${from.seed}`}${from.problem ? ` (${from.problem})` : ''}  live: ${LIVE}${KEY ? ' (admin key)' : ''}`);
});
