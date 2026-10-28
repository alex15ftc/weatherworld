import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WeatherAuthorityRuntime } from './WeatherAuthorityRuntime.js';
import { SurfaceAnalysisRuntime } from './SurfaceAnalysisRuntime.js';
import { OutlookRuntime } from './OutlookRuntime.js';
import { MesoscaleRuntime } from './MesoscaleRuntime.js';
import { WarningRuntime } from './WarningRuntime.js';
import { ReportsRuntime } from './ReportsRuntime.js';
import { GameProducts } from './GameProducts.js';
import { RadarPool } from './RadarPool.js';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

// Set WEATHER_PRIORITY=normal to leave the process priority alone.
avoidBackgroundThrottling();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
// The authority resumes from its saved state unless WEATHER_SEED names a world to start
// (WEATHER_PERSIST=off keeps nothing on disk; WEATHER_STATE_PATH moves the saved state). A
// fresh world spends about a minute letting the large-scale weather develop before the server
// answers.
const statePath = process.env.WEATHER_PERSIST === 'off' ? null : path.resolve(ROOT, process.env.WEATHER_STATE_PATH ?? 'data/cache/atmosphere-state.bin');
if (process.env.WEATHER_SEED || !statePath || !fs.existsSync(statePath)) console.log('[weather-authority] starting a new world (about a minute)...');
// The radar is worked out on its own threads (WEATHER_RADAR_WORKERS; 0 works it out on this one).
const radarPool = process.env.WEATHER_RADAR_WORKERS === '0' ? null : new RadarPool();
// A review package for each finished day (DayReviewRecorder.js): WEATHER_DAY_REVIEWS=off turns them
// off, WEATHER_DAY_REVIEW_PNG=on adds PNG copies (a headless Chrome or Edge), and the newest
// WEATHER_DAY_REVIEW_DAYS (14) are kept.
const dayReviews = process.env.WEATHER_DAY_REVIEWS === 'off' ? null : { dir: path.resolve(ROOT, process.env.WEATHER_DAY_REVIEW_DIR ?? 'data/day-reviews/live'), png: process.env.WEATHER_DAY_REVIEW_PNG === 'on', keepDays: Number(process.env.WEATHER_DAY_REVIEW_DAYS) || 14 };
const runtime = new WeatherAuthorityRuntime({ seed: process.env.WEATHER_SEED, statePath, radarPool, dayReviews });
const surface = new SurfaceAnalysisRuntime({ atmosphere: runtime.engine });
// The Day 1-3 outlooks: issued when the world is ready, then every 6, 12 and 24 hours (WEATHER_OUTLOOK=off turns them off;
// WEATHER_OUTLOOK_MEMBERS sets how many forecast runs go into it).
const outlooks = process.env.WEATHER_OUTLOOK === 'off' ? null : new OutlookRuntime({ runtime, members: Number(process.env.WEATHER_OUTLOOK_MEMBERS) || undefined });
// The day packages take the day's first Day 1 outlook issued once the day has begun.
runtime.dayReviewOutlook = (from, to) => { const outlook = outlooks?.current('day1')?.outlook; return outlook && outlook.validToHourUtc === to && outlook.issuedHourUtc >= from ? outlook : null; };
// Mesoscale discussions and watches: the world is looked at once in each of its hours, and a
// watch waiting for its storms goes out when they fire (WEATHER_MESOSCALE=off turns them off).
const mesoscale = process.env.WEATHER_MESOSCALE === 'off' ? null : new MesoscaleRuntime({ runtime });
// Tornado and severe thunderstorm warnings: worked out at every volume scan from the storms as
// the radar sees them (WEATHER_WARNINGS=off turns them off).
const warnings = process.env.WEATHER_WARNINGS === 'off' ? null : new WarningRuntime({ runtime });
// Storm reports and damage surveys, from the live world's daily storm log (ReportsRuntime.js).
const reports = new ReportsRuntime({ runtime });
// The products as the Roblox place draws them (GameProducts.js).
const gameProducts = new GameProducts({ runtime, outlooks, mesoscale, warnings, reports });
// Both share the forecast pool's threads (WEATHER_FORECAST_WORKERS). The mesoscale look is
// asked for first: its runs are short and go ahead of an outlook's.
const issueProducts = () => { warnings?.update(); mesoscale?.maybeIssue(); outlooks?.maybeIssue(); };
outlooks?.maybeIssue();
setInterval(issueProducts, 5_000).unref();
// Often enough that a storm tick is worked out within a couple of seconds of falling due: the
// game shows each tick a fixed time after it falls due (GameFeed.js).
const ADVANCE_POLL_MS = 2_000;
const perf = { startedAt: Date.now(), totals:{requests:0,cacheHits:0,cacheMisses:0}, endpoints:{}, recent:[] };
function beginRequest(pathname){ return { pathname, started: performance.now() }; }
function finishRequest(trace, detail={}) { const totalMs=performance.now()-trace.started; perf.totals.requests++; const stat=perf.endpoints[trace.pathname]??={count:0,totalMs:0,maxMs:0}; stat.count++;stat.totalMs+=totalMs;stat.maxMs=Math.max(stat.maxMs,totalMs);perf.recent.unshift({path:trace.pathname,totalMs:+totalMs.toFixed(2),...detail,at:new Date().toISOString()});if(perf.recent.length>50)perf.recent.length=50; return totalMs; }
function performanceSnapshot(){ const endpoints=Object.fromEntries(Object.entries(perf.endpoints).map(([k,v])=>[k,{count:v.count,averageMs:v.totalMs/v.count,maxMs:v.maxMs}])); return {version:'2.23.2',uptimeSeconds:Math.round((Date.now()-perf.startedAt)/1000),totals:{requests:perf.totals.requests,cacheHits:runtime.performance.cacheHits,cacheMisses:runtime.performance.cacheMisses},endpoints,recent:perf.recent,productBuilds:runtime.performance.productBuilds,radarPool:radarPool?.status()??null}; }
setInterval(() => { if (runtime.advanceOnTimer()) { surface.capture(); warnings?.update(); runtime.prewarmRadar(); } }, ADVANCE_POLL_MS).unref();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await serveApi(url, req, res);
    return serveStatic(url.pathname, res);
  } catch (error) { sendJson(req, res, 500, { error: error?.message ?? 'Internal server error' }, { cacheable: false }); }
});

async function serveApi(url, req, res) {
  const trace=beginRequest(url.pathname);
  if (url.pathname === '/api/health') return sendJson(req, res, 200, runtime.metadata(), { trace });
  if (url.pathname === '/api/authority/state') return sendJson(req, res, 200, runtime.authorityState(), { cacheable: false, trace });
  if (url.pathname === '/api/authority/reset' && req.method === 'POST') { const body=await readJsonBody(req); const value=runtime.reset(body.seed);return sendJson(req,res,200,value,{cacheable:false,trace}); }
  if (url.pathname === '/api/authority/advance' && req.method === 'POST') { const body=await readJsonBody(req); const value=runtime.advance(body.hours,()=>surface.capture());return sendJson(req,res,200,value,{cacheable:false,trace}); }
  if (url.pathname === '/api/authority/seek' && req.method === 'POST') { const body=await readJsonBody(req); const value=runtime.seek(body.validHourUtc);return sendJson(req,res,200,value,{cacheable:false,trace}); }
  if (url.pathname === '/api/authority/clock' && req.method === 'POST') { const body=await readJsonBody(req); return sendJson(req,res,200,runtime.setAutoAdvance(body.enabled),{cacheable:false,trace}); }
  if (url.pathname.startsWith('/api/atmosphere/') && surface.atmosphere !== runtime.engine) surface.attach(runtime.engine);
  if (url.pathname === '/api/atmosphere/surface') return sendJson(req, res, 200, { ...surface.analysis(url.searchParams.get('frame')), clockRunning: runtime.autoAdvance }, { cacheable: false, trace });
  if (url.pathname === '/api/atmosphere/parameter') { const field = surface.parameter(url.searchParams.get('key'), url.searchParams.get('frame')); return sendJson(req, res, field ? 200 : 404, field ?? { error: 'Unknown parameter' }, { cacheable: Boolean(field), trace }); }
  if (url.pathname === '/api/live/metadata') return sendJson(req, res, 200, runtime.metadata(), { trace });
  if (url.pathname === '/api/live/field') return sendJson(req, res, 200, runtime.liveField(url.searchParams.get('product') ?? 'temperature'), { trace });
  if (url.pathname === '/api/live/boundaries') return sendJson(req, res, 200, runtime.boundaries(), { trace });
  // The game's storms (GameFeed.js): ?after=<seq> gives the frames after that one. Set
  // WEATHER_GAME_KEY to require it in the x-api-key header.
  if (url.pathname.startsWith('/api/game/v1/') && process.env.WEATHER_GAME_KEY && req.headers['x-api-key'] !== process.env.WEATHER_GAME_KEY) return sendJson(req, res, 401, { error: 'Bad key' }, { cacheable: false, trace });
  if (url.pathname === '/api/game/v1/frames') return sendText(req, res, 200, runtime.gameFeed.poll(url.searchParams.get('after')), trace);
  // The products the game draws (GameProducts.js): the manifest of versions, and each product's text.
  if (url.pathname === '/api/game/v1/lab/window') return sendJson(req, res, 200, runtime.labWindow(url.searchParams.get('x'), url.searchParams.get('y'), url.searchParams.get('half')), { cacheable: false, trace });
  if (url.pathname === '/api/game/v1/lab/storms') return sendJson(req, res, 200, runtime.labStormsAt(url.searchParams.get('x'), url.searchParams.get('y'), url.searchParams.get('half')), { cacheable: false, trace });
  if (url.pathname === '/api/game/v1/manifest') return sendJson(req, res, 200, gameProducts.manifest(), { cacheable: false, trace });
  const gameProduct = url.pathname.match(/^\/api\/game\/v1\/product\/([A-Za-z0-9._-]+)$/);
  if (gameProduct) { const entry = await gameProducts.productAsync(gameProduct[1]); return entry ? sendText(req, res, 200, entry.text, trace, { 'x-product-version': entry.version }) : sendJson(req, res, 404, { error: 'Unknown product' }, { cacheable: false, trace }); }
  if (url.pathname === '/api/live/storms') return sendJson(req, res, 200, runtime.storms(), { trace });
  if (url.pathname === '/api/live/cell') return sendJson(req, res, 200, runtime.cellSummary(url.searchParams.get('row'), url.searchParams.get('column'), url.searchParams.get('day') ?? 'day1'), { cacheable: false, trace });
  if (url.pathname === '/api/live/sounding') return sendJson(req, res, 200, runtime.sounding(url.searchParams.get('row'), url.searchParams.get('column'), url.searchParams.get('day') ?? 'day1'), { cacheable: false, trace });
  // The radar, outlook, mesoscale, warning, storm report and damage survey pages were retired
  // on 2026-10-22: those products are drawn in Roblox from /api/game/v1/* (GameProducts.js).
  if (url.pathname === '/api/performance') return sendJson(req,res,200,performanceSnapshot(),{cacheable:false,trace});
  if (url.pathname === '/api/map/manifest') return sendJson(req,res,200,runtime.mapManifest({scope:url.searchParams.get('scope')??'live',product:url.searchParams.get('product')??'temperature',day:url.searchParams.get('day')??'day1',station:url.searchParams.get('station')??'composite'}),{cacheable:false,trace});
  const tile=url.pathname.match(/^\/api\/tiles\/(live|outlook)\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if(tile){const body=await runtime.productTile({scope:tile[1],z:tile[2],x:tile[3],y:tile[4],product:url.searchParams.get('product')??(tile[1]==='radar'?'reflectivity':'temperature'),day:url.searchParams.get('day')??'day1',station:url.searchParams.get('station')??'composite'});return body?sendBinary(req,res,200,body,'image/png',{trace}):sendJson(req,res,404,{error:'Tile outside pyramid'},{cacheable:false,trace});}
  return sendJson(req, res, 404, { error: 'Unknown API endpoint' }, { cacheable: false, trace });
}

async function readJsonBody(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size += chunk.length; if (size > 64*1024) throw new Error('Request body too large'); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invalid JSON request body'); }
}

function serveStatic(pathname, res) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filename = path.resolve(ROOT, relative);
  if (!filename.startsWith(ROOT) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) return sendFile(path.resolve(ROOT, 'index.html'), res);
  return sendFile(filename, res);
}
function sendFile(filename, res) {
  const ext = path.extname(filename).toLowerCase();
  const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml' };
  res.writeHead(200, { 'content-type': types[ext] ?? 'application/octet-stream', 'cache-control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(filename).pipe(res);
}

function sendBinary(req,res,status,body,contentType,{trace=null}={}){
  const etag=`"${crypto.createHash('sha1').update(body).digest('base64url').slice(0,16)}"`;
  if(req.headers['if-none-match']===etag){const totalMs=trace?finishRequest(trace,{status:304,rawBytes:0,sentBytes:0,cacheHit:true}):0;res.writeHead(304,{etag,'cache-control':'public, max-age=31536000, immutable','server-timing':`total;dur=${totalMs.toFixed(2)}`});return res.end();}
  const totalMs=trace?finishRequest(trace,{status,rawBytes:body.length,sentBytes:body.length}):0;
  res.writeHead(status,{'content-type':contentType,'content-length':body.length,etag,'cache-control':'public, max-age=31536000, immutable','server-timing':`total;dur=${totalMs.toFixed(2)}`});res.end(body);
}

function sendJson(req, res, status, value, { cacheable = true, trace = null } = {}) {
  const serializeStarted=performance.now();
  const raw = Buffer.from(JSON.stringify(value));
  const serializeMs=performance.now()-serializeStarted;
  const etag = `"${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 16)}"`;
  if (cacheable && req.headers['if-none-match'] === etag) {
    const totalMs=trace?finishRequest(trace,{status:304,rawBytes:0,sentBytes:0,serializeMs:+serializeMs.toFixed(2),cacheHit:true}):0;
    res.writeHead(304, { etag, 'cache-control': 'private, max-age=10, must-revalidate','server-timing':`total;dur=${totalMs.toFixed(2)}, serialize;dur=${serializeMs.toFixed(2)}` });
    return res.end();
  }
  const headers = {
    'content-type':'application/json; charset=utf-8',
    'cache-control': cacheable ? 'private, max-age=10, must-revalidate' : 'no-store',
    etag,
    vary: 'Accept-Encoding'
  };
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  if (acceptsGzip && raw.length > 1024) {
    return zlib.gzip(raw, (error, body) => {
      if (error) { res.writeHead(status, { ...headers, 'content-length': raw.length }); return res.end(raw); }
      const totalMs=trace?finishRequest(trace,{status,rawBytes:raw.length,sentBytes:body.length,serializeMs:+serializeMs.toFixed(2),compressed:true}):0;
      res.writeHead(status, { ...headers, 'content-encoding':'gzip', 'content-length':body.length,'server-timing':`total;dur=${totalMs.toFixed(2)}, serialize;dur=${serializeMs.toFixed(2)}` });
      res.end(body);
    });
  }
  const totalMs=trace?finishRequest(trace,{status,rawBytes:raw.length,sentBytes:raw.length,serializeMs:+serializeMs.toFixed(2),compressed:false}):0;
  res.writeHead(status, { ...headers, 'content-length':raw.length,'server-timing':`total;dur=${totalMs.toFixed(2)}, serialize;dur=${serializeMs.toFixed(2)}` });
  res.end(raw);
}
// JSON already written as text (the game feed), compressed when the caller takes gzip.
function sendText(req, res, status, text, trace = null, extraHeaders = {}) {
  const raw = Buffer.from(text), headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Accept-Encoding', ...extraHeaders };
  const done = (body, compressed) => {
    if (trace) finishRequest(trace, { status, rawBytes: raw.length, sentBytes: body.length, compressed });
    res.writeHead(status, { ...headers, ...(compressed ? { 'content-encoding': 'gzip' } : {}), 'content-length': body.length });
    res.end(body);
  };
  if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && raw.length > 1024) return zlib.gzip(raw, (error, body) => error ? done(raw, false) : done(body, true));
  done(raw, false);
}
server.listen(PORT, () => console.log(`[weather-authority] 2.23.2 listening on http://localhost:${PORT}`));
