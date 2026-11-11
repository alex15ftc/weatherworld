// The Studio network tests (docs/cloudlab/NETWORK.md, "Tests before building on this", 1 and 2):
// serves fixed bytes and a real cloud model frame for the lab's NetTest script to check.
//   node tools/cloudlab/worker/nettest.mjs [port 8792] [scenario SupercellB] [model minutes 40]
// Endpoints (localhost only):
//   GET /bytes       256 bytes, 0 to 255
//   GET /frame.raw   a frame (FrameCodec) of the storm at that age, with its nest
//   GET /frame.zst   the same frame, Zstd-compressed
//   GET /info        { rawLength, rawHash, zstLength, zstHash } (hash: FNV-1a 32-bit of the bytes)
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';
import { avoidBackgroundThrottling } from '../../../js/runtime/processPriority.node.js';
import { EngineRun } from '../../../js/cloudmodel/EngineRun.js';
import { encode } from '../../../js/cloudmodel/FrameCodec.js';

avoidBackgroundThrottling();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const [port = '8792', name = 'SupercellB', minutes = '40'] = process.argv.slice(2);

// The storm, started as drive.mjs starts it, and run on (unpaced) to the age asked for.
const text = readFileSync(path.join(ROOT, 'roblox/Shared/StormLab/Data', `${name}.luau`), 'utf8');
const data = JSON.parse(text.match(/\[(=*)\[([\s\S]*)\]\1\]/)[2]);
const storm = data.storms.find(s => s.id === data.meta.focusStorm) ?? data.storms[0];
let startRows = null, best = Infinity;
for (const c of data.cells) { const d = (c.pos[0] - storm.pos[0]) ** 2 + (c.pos[1] - storm.pos[1]) ** 2; if (d < best) { best = d; startRows = c.sounding; } }
const hour0 = data.meta.simHourUtc;
const record = p => ({ id: storm.id, simHourUtc: hour0 + p.min / 60, motion: p.motion, intensity: p.intensity, coldPoolK: p.coldPoolK, tornado: p.tornado, active: p.active, inflow: p.inflow, updraftMs: storm.updraftMs });
const run = new EngineRun(record(data.track[0]), { nest: true, startRows });
run.simHour = record(data.track[0]).simHourUtc;
let next = 1;
const t0 = performance.now();
while (run.model.time < Number(minutes) * 60) {
  while (next < data.track.length && data.track[next].min * 60 <= run.model.time) { const p = data.track[next++]; if (p.active !== false) { run.update(record(p)); run.simHour = record(p).simHourUtc; } }
  run.step();
}
const raw = Buffer.from(encode(run, 1)), zst = zstdCompressSync(raw);
const fnv = bytes => { let h = 0x811c9dc5; for (const b of bytes) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
const info = { rawLength: raw.length, rawHash: fnv(raw), zstLength: zst.length, zstHash: fnv(zst), bytesHash: fnv(bytes), nest: run.nest != null, modelMinutes: run.model.time / 60 };
console.log(`frame ready in ${((performance.now() - t0) / 1000).toFixed(0)} s:`, JSON.stringify(info));

const send = (res, type, body) => { res.writeHead(200, { 'content-type': type, 'content-length': body.length }); res.end(body); };
http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  console.log(new Date().toISOString().slice(11, 19), req.method, p);
  if (p === '/bytes') return send(res, 'application/octet-stream', bytes);
  if (p === '/frame.raw') return send(res, 'application/octet-stream', raw);
  if (p === '/frame.zst') return send(res, 'application/octet-stream', zst);
  if (p === '/info') return send(res, 'application/json', Buffer.from(JSON.stringify(info)));
  res.writeHead(404); res.end();
}).listen(Number(port), '127.0.0.1', () => console.log(`nettest on http://127.0.0.1:${port}`));
