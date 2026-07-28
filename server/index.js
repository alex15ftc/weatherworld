import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WeatherAuthorityRuntime } from './WeatherAuthorityRuntime.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const runtime = new WeatherAuthorityRuntime({ seed: process.env.WEATHER_SEED });
const ADVANCE_POLL_MS = 10_000;
const HISTORICAL_DATASET_ROOT = path.resolve(process.env.HISTORICAL_DATASET_ROOT ?? path.join(ROOT, 'data', 'historical', 'spc-cases'));
const HISTORICAL_CASE_ID_RE = /^[A-Za-z0-9._-]+$/;
const perf = { startedAt: Date.now(), totals:{requests:0,cacheHits:0,cacheMisses:0}, endpoints:{}, recent:[] };
function beginRequest(pathname){ return { pathname, started: performance.now() }; }
function finishRequest(trace, detail={}) { const totalMs=performance.now()-trace.started; perf.totals.requests++; const stat=perf.endpoints[trace.pathname]??={count:0,totalMs:0,maxMs:0}; stat.count++;stat.totalMs+=totalMs;stat.maxMs=Math.max(stat.maxMs,totalMs);perf.recent.unshift({path:trace.pathname,totalMs:+totalMs.toFixed(2),...detail,at:new Date().toISOString()});if(perf.recent.length>50)perf.recent.length=50; return totalMs; }
function performanceSnapshot(){ const endpoints=Object.fromEntries(Object.entries(perf.endpoints).map(([k,v])=>[k,{count:v.count,averageMs:v.totalMs/v.count,maxMs:v.maxMs}])); return {version:'2.23.2',uptimeSeconds:Math.round((Date.now()-perf.startedAt)/1000),totals:{requests:perf.totals.requests,cacheHits:runtime.performance.cacheHits,cacheMisses:runtime.performance.cacheMisses},endpoints,recent:perf.recent,productBuilds:runtime.performance.productBuilds}; }
setInterval(() => { runtime.advanceOnTimer(); }, ADVANCE_POLL_MS).unref();

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
  if (url.pathname === '/api/authority/advance' && req.method === 'POST') { const body=await readJsonBody(req); const value=runtime.advance(body.hours);return sendJson(req,res,200,value,{cacheable:false,trace}); }
  if (url.pathname === '/api/authority/seek' && req.method === 'POST') { const body=await readJsonBody(req); const value=runtime.seek(body.validHourUtc);return sendJson(req,res,200,value,{cacheable:false,trace}); }
  if (url.pathname === '/api/authority/clock' && req.method === 'POST') { const body=await readJsonBody(req); return sendJson(req,res,200,runtime.setAutoAdvance(body.enabled),{cacheable:false,trace}); }
  if (url.pathname === '/api/live/metadata') return sendJson(req, res, 200, runtime.metadata(), { trace });
  if (url.pathname === '/api/live/field') return sendJson(req, res, 200, runtime.liveField(url.searchParams.get('product') ?? 'temperature'), { trace });
  if (url.pathname === '/api/live/boundaries') return sendJson(req, res, 200, runtime.boundaries(), { trace });
  if (url.pathname === '/api/live/storms') return sendJson(req, res, 200, runtime.storms(), { trace });
  if (url.pathname === '/api/live/cell') return sendJson(req, res, 200, runtime.cellSummary(url.searchParams.get('row'), url.searchParams.get('column'), url.searchParams.get('day') ?? 'day1'), { cacheable: false, trace });
  if (url.pathname === '/api/live/sounding') return sendJson(req, res, 200, runtime.sounding(url.searchParams.get('row'), url.searchParams.get('column'), url.searchParams.get('day') ?? 'day1'), { cacheable: false, trace });
  if (url.pathname.startsWith('/api/radar/')) return sendJson(req, res, 410, { error: 'Radar is archived in milestone 2.25.0' }, { cacheable:false, trace });
  if (url.pathname === '/api/performance') return sendJson(req,res,200,performanceSnapshot(),{cacheable:false,trace});
  if (url.pathname === '/api/historical/outlooks/catalog') return serveHistoricalJson(req, res, path.join(HISTORICAL_DATASET_ROOT, 'catalog.json'), trace);
  const historicalCase = url.pathname.match(/^\/api\/historical\/outlooks\/cases\/([^/]+)$/);
  if (historicalCase) {
    const caseId = decodeURIComponent(historicalCase[1]);
    if (!HISTORICAL_CASE_ID_RE.test(caseId)) return sendJson(req, res, 400, { error: 'Invalid historical case ID' }, { cacheable: false, trace });
    return serveHistoricalJson(req, res, path.join(HISTORICAL_DATASET_ROOT, 'cases', `${caseId}.json`), trace);
  }
  if (url.pathname === '/api/map/manifest') return sendJson(req,res,200,runtime.mapManifest({scope:url.searchParams.get('scope')??'live',product:url.searchParams.get('product')??'temperature',day:url.searchParams.get('day')??'day1',station:url.searchParams.get('station')??'composite'}),{cacheable:false,trace});
  const tile=url.pathname.match(/^\/api\/tiles\/(live|outlook)\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if(tile){const body=await runtime.productTile({scope:tile[1],z:tile[2],x:tile[3],y:tile[4],product:url.searchParams.get('product')??(tile[1]==='radar'?'reflectivity':'temperature'),day:url.searchParams.get('day')??'day1',station:url.searchParams.get('station')??'composite'});return body?sendBinary(req,res,200,body,'image/png',{trace}):sendJson(req,res,404,{error:'Tile outside pyramid'},{cacheable:false,trace});}
  const outlookField = url.pathname.match(/^\/api\/outlooks\/(day[123])\/field$/);
  if (outlookField) return sendJson(req, res, 200, runtime.outlookField(outlookField[1], url.searchParams.get('product') ?? 'risk'), { trace });
  const outlook = url.pathname.match(/^\/api\/outlooks\/(day[123])$/);
  if (outlook) return sendJson(req, res, 200, runtime.outlook(outlook[1]), { trace });
  return sendJson(req, res, 404, { error: 'Unknown API endpoint' }, { cacheable: false, trace });
}

function serveHistoricalJson(req, res, filename, trace) {
  const resolved = path.resolve(filename);
  const relative = path.relative(HISTORICAL_DATASET_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return sendJson(req, res, 400, { error: 'Invalid historical dataset path' }, { cacheable: false, trace });
  if (!fs.existsSync(resolved)) return sendJson(req, res, 404, { error: 'Historical dataset not built', hint: 'Run npm run build:spc-dataset -- --input <normalized-directory>' }, { cacheable: false, trace });
  try { return sendJson(req, res, 200, JSON.parse(fs.readFileSync(resolved, 'utf8')), { trace }); }
  catch (error) { return sendJson(req, res, 500, { error: `Historical dataset read failed: ${error.message}` }, { cacheable: false, trace }); }
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
server.listen(PORT, () => console.log(`[weather-authority] 2.23.2 listening on http://localhost:${PORT}`));
