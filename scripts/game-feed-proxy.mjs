// The weather server's public face for a tunnel (cloudflared, ngrok): only the game's routes are
// passed on: GET /api/game/v1/frames, /manifest, /product/<id> (server/GameProducts.js), the storm
// area: /lab/window, /lab/storms (js/game/LabWindow.js, the game's server/StormHost), and the cloud
// model's storms (js/game/StormWorkers.js, the game's server/LiveStorms): GET /storm/frames and
// POST /storm/players, whose JSON body (where a server's players are, at most BODY_MAX bytes) only
// steers which storms get detail and never touches the world. Everything else (reset, advance,
// pages, /storm/workers) is refused, so a public URL cannot change the world.
//   node scripts/game-feed-proxy.mjs            listens on 127.0.0.1:3001, forwards to :3000
//   PORT=3001 TARGET_PORT=3000 node scripts/game-feed-proxy.mjs
// Then: cloudflared tunnel --url http://localhost:3001
import http from 'node:http';

const TARGET = Number(process.env.TARGET_PORT ?? 3000), PORT = Number(process.env.PORT ?? 3001);
const GAME_ROUTE = /^\/api\/game\/v1\/(frames|manifest|product\/[A-Za-z0-9._-]+|lab\/window|lab\/storms|storm\/frames)$/;
const POST_ROUTE = /^\/api\/game\/v1\/storm\/players$/;
const BODY_MAX = 16 * 1024;
const PASS_IN = ['accept-encoding', 'x-api-key'];
const PASS_OUT = ['content-type', 'content-encoding', 'content-length', 'cache-control', 'vary', 'x-product-version'];

function forward(res, url, method, headers, body) {
  const upstream = http.request({ host: '127.0.0.1', port: TARGET, path: url.pathname + url.search, method, headers }, reply => {
    res.writeHead(reply.statusCode, Object.fromEntries(PASS_OUT.filter(h => reply.headers[h]).map(h => [h, reply.headers[h]])));
    reply.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('weather server unreachable'); });
  upstream.end(body ?? undefined);
}

const refuse = (res, status, text) => { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'text/plain' }); res.end(text); } };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://proxy');
  const post = req.method === 'POST' && POST_ROUTE.test(url.pathname) && !url.search;
  if (!post && (req.method !== 'GET' || !GAME_ROUTE.test(url.pathname))) return refuse(res, 404, 'not found');
  const headers = Object.fromEntries(PASS_IN.filter(h => req.headers[h]).map(h => [h, req.headers[h]]));
  if (!post) return forward(res, url, 'GET', headers, null);
  // (the body is read whole first, refused past BODY_MAX, and passed on only if it is JSON)
  const parts = [];
  let size = 0, refused = false;
  req.on('data', c => {
    if (refused) return;
    size += c.length;
    if (size > BODY_MAX) { refused = true; refuse(res, 413, 'too large'); req.resume(); }
    else parts.push(c);
  });
  req.on('end', () => {
    if (refused) return;
    const body = Buffer.concat(parts);
    try { JSON.parse(body.toString('utf8')); } catch { return refuse(res, 400, 'bad body'); }
    forward(res, url, 'POST', { ...headers, 'content-type': 'application/json', 'content-length': body.length }, body);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`game feed proxy on 127.0.0.1:${PORT} -> 127.0.0.1:${TARGET} (only GET /api/game/v1/frames, manifest, product/<id>, lab/window, lab/storms, storm/frames; POST storm/players)`));
