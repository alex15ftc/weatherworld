// Drives one cloud model worker (worker.mjs; worker.luau when a lune path is given) from an exported engine scenario, the way the engine
// will: start, an engine record every 5 game minutes at the game clock's pace, frames fetched
// and checked. Prints the worker's lag and the frames' size and contents.
//   node tools/cloudlab/worker/drive.mjs [scenario] [real seconds] [clock rate] [lune path, or node (the default)]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import os from 'node:os';
import { avoidBackgroundThrottling } from '../../../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const [name = 'SupercellB', secs = '120', rate = '8', lune = 'node'] = process.argv.slice(2);
const clockRate = Number(rate), realSeconds = Number(secs);
const text = readFileSync(path.join(ROOT, 'roblox/src/stormlab/data', `${name}.luau`), 'utf8');
const data = JSON.parse(text.match(/\[(=*)\[([\s\S]*)\]\1\]/)[2]);
const storm = data.storms.find(s => s.id === data.meta.focusStorm) ?? data.storms[0];
let startRows = null, best = Infinity;
for (const c of data.cells) { const d = (c.pos[0] - storm.pos[0]) ** 2 + (c.pos[1] - storm.pos[1]) ** 2; if (d < best) { best = d; startRows = c.sounding; } }
const hour0 = data.meta.simHourUtc;
const record = p => ({ id: storm.id, simHourUtc: hour0 + p.min / 60, motion: p.motion, intensity: p.intensity, coldPoolK: p.coldPoolK, tornado: p.tornado, active: p.active, inflow: p.inflow, updraftMs: storm.updraftMs });

const port = 8790;
// (the default: the WebAssembly model under Node, worker.mjs; a lune path runs worker.luau)
const worker = lune === 'node'
  ? spawn(process.execPath, ['tools/cloudlab/worker/worker.mjs', String(port)], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] })
  : spawn(lune, ['run', 'tools/cloudlab/worker/worker.luau', String(port)], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, LUNE: lune } });
// (this machine slows normal-priority processes after a few seconds: the worker runs above normal)
try { os.setPriority(worker.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch {}
const url = p => `http://127.0.0.1:${port}${p}`;
const post = (p, body) => fetch(url(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { await fetch(url('/status')); break; } catch { await wait(200); } }

await post('/start', { record: record(data.track[0]), startRows, clockRate, opts: { nest: true } });
const t0 = Date.now();
let nextPoint = 1, lastSeq = 0;
while ((Date.now() - t0) / 1000 < realSeconds) {
  const gameMin = (Date.now() - t0) / 1000 * clockRate / 60;
  while (nextPoint < data.track.length && data.track[nextPoint].min <= gameMin) {
    const p = data.track[nextPoint++];
    await post('/update', p.active === false ? { ended: true } : record(p));
  }
  if (nextPoint >= data.track.length && gameMin > data.track.at(-1).min + 5) await post('/update', { ended: true });
  const st = await fetch(url('/status')).then(r => r.json());
  const res = await fetch(url('/frame'));
  if (res.ok) {
    const b = Buffer.from(await res.arrayBuffer());
    const seq = b.readUInt32LE(2);
    if (seq !== lastSeq) {
      lastSeq = seq;
      const nx = b.readUInt16LE(18), ny = b.readUInt16LE(20);
      let cloud = 0, rainMax = 0, wMax = -99;
      for (let c = 0; c < nx * ny; c++) {
        const o = 42 + c * 12;
        if (b[o + 1] > 0) cloud++;
        rainMax = Math.max(rainMax, 10 ** (b[o + 4] / 40) - 1);
        wMax = Math.max(wMax, b.readInt8(o + 9) / 2);
      }
      const nest = (b[1] & 1) ? 'nest' : 'no nest';
      console.log(`game ${gameMin.toFixed(1)} min | model ${(st.time / 60).toFixed(1)} min, behind ${st.behind.toFixed(0)} s, step ${st.stepMs.toFixed(0)} ms | frame ${seq}: ${b.length} B (gzip ${gzipSync(b).length} B, zstd ${zstdCompressSync(b).length} B), ${nest}, cloud cols ${cloud}, rain max ${rainMax.toFixed(0)} mm/h, w5 max ${wMax.toFixed(1)}`);
    }
  }
  await wait(1000);
}
await post('/stop', {}).catch(() => {});
worker.kill();
