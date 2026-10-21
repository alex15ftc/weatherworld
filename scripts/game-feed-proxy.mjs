// The weather server's public face for a tunnel (cloudflared, ngrok): only the game's read-only
// routes are passed on (GET /api/game/v1/frames, /manifest and /product/<id>; server/GameProducts.js);
// everything else (reset, advance, pages) is refused, so a public URL cannot change the world.
//   node scripts/game-feed-proxy.mjs            listens on 127.0.0.1:3001, forwards to :3000
//   PORT=3001 TARGET_PORT=3000 node scripts/game-feed-proxy.mjs
// Then: cloudflared tunnel --url http://localhost:3001
import http from 'node:http';

const TARGET = Number(process.env.TARGET_PORT ?? 3000), PORT = Number(process.env.PORT ?? 3001);
const GAME_ROUTE = /^\/api\/game\/v1\/(frames|manifest|product\/[A-Za-z0-9.]+)$/;
const PASS_IN = ['accept-encoding', 'x-api-key'];
const PASS_OUT = ['content-type', 'content-encoding', 'content-length', 'cache-control', 'vary', 'x-product-version'];

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://proxy');
  if (req.method !== 'GET' || !GAME_ROUTE.test(url.pathname)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  const headers = Object.fromEntries(PASS_IN.filter(h => req.headers[h]).map(h => [h, req.headers[h]]));
  const upstream = http.request({ host: '127.0.0.1', port: TARGET, path: url.pathname + url.search, method: 'GET', headers }, reply => {
    res.writeHead(reply.statusCode, Object.fromEntries(PASS_OUT.filter(h => reply.headers[h]).map(h => [h, reply.headers[h]])));
    reply.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('weather server unreachable'); });
  upstream.end();
}).listen(PORT, '127.0.0.1', () => console.log(`game feed proxy on 127.0.0.1:${PORT} -> 127.0.0.1:${TARGET} (only GET /api/game/v1/frames, manifest, product/<id>)`));
