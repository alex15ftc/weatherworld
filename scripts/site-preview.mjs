// Serves the site's pages from this checkout without starting an engine: the pages and their files come
// from here (server/SitePages.js, as the engine serves them) and every /api/ request is passed to a running
// engine, the hosted one by default. For looking at page changes against real data.
//   node scripts/site-preview.mjs [--port 8090] [--api https://weatherworld.up.railway.app] [--replay <recorded day>]
// --replay <dir>: answer /api/synoptic/* and /api/calendar from a day recorded by tools/social/record-live.mjs
// (its raw folder), so a past day's charts can be drawn again (tools/social/make-loop.mjs).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { sitePage, renderPage, NOT_FOUND_PAGE, CONTENT_TYPES } from '../server/SitePages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const PORT = Number(flag('port', 8090)), API = flag('api', 'https://weatherworld.up.railway.app'), REPLAY = flag('replay', null);

// A recorded day's synoptic frames: { hour -> { summary, fields } }, read as they are asked for.
const replay = REPLAY ? (() => {
  const dir = path.resolve(REPLAY, 'synoptic'), hours = fs.readdirSync(dir).filter(f => f.endsWith('.json.gz')).map(f => Number(f.replace('.json.gz', ''))).sort((a, b) => a - b);
  const cache = new Map();
  const frame = hour => { if (!cache.has(hour)) cache.set(hour, JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, `${hour.toFixed(3).padStart(9, '0')}.json.gz`))))); return cache.get(hour); };
  const pick = asked => { const h = Number(asked); return asked != null && hours.includes(h) ? h : hours.at(-1); };
  return {
    answer(url) {
      if (url.pathname === '/api/calendar') return fs.readFileSync(path.resolve(REPLAY, 'calendar.json'), 'utf8');
      if (url.pathname === '/api/synoptic/frame') { const h = pick(url.searchParams.get('frame')); return JSON.stringify({ ...frame(h).summary, frames: hours, latest: h === hours.at(-1) }); }
      if (url.pathname === '/api/synoptic/field') return JSON.stringify(frame(pick(url.searchParams.get('frame'))).fields[url.searchParams.get('key')] ?? { error: 'Not recorded' });
      return null;
    }
  };
})() : null;

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const recorded = replay?.answer(url);
      if (recorded != null) { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(recorded); }
      const upstream = await fetch(API + url.pathname + url.search, { headers: req.headers['x-admin-key'] ? { 'x-admin-key': req.headers['x-admin-key'] } : {} });
      const headers = { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' };
      if (upstream.headers.get('x-product-version')) headers['x-product-version'] = upstream.headers.get('x-product-version');
      res.writeHead(upstream.status, headers);
      return res.end(Buffer.from(await upstream.arrayBuffer()));
    }
    const page = sitePage(url.pathname);
    let filename = page ? path.resolve(ROOT, page) : path.resolve(ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, '')), status = 200;
    if (!filename.startsWith(ROOT) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) { filename = path.resolve(ROOT, NOT_FOUND_PAGE); status = 404; }
    const ext = path.extname(filename).toLowerCase();
    res.writeHead(status, { 'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(ext === '.html' ? renderPage(ROOT, filename) : fs.readFileSync(filename));
  } catch (error) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(error?.message ?? error)); }
}).listen(PORT, () => console.log(`Site preview on http://localhost:${PORT} (API: ${REPLAY ? `replay ${REPLAY}, else ` : ''}${API})`));
