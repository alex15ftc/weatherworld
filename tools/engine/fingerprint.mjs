// A fingerprint of the live world's run, for changes that must not change it (speed-ups): the
// world built for a seed and stepped like the server (storm ticks of 5 min, the atmosphere every
// 30 min, a game feed frame every tick), with a hash of every feed frame and of the whole world
// state (cells and storms) after each atmosphere step. Two runs agree only if every number does.
//   node tools/engine/fingerprint.mjs [seed] [sim hours] [out.json]
//   node tools/engine/fingerprint.mjs --compare a.json b.json
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../../js/world/AtmosphereWorld.js';
import { GameFeed } from '../../server/GameFeed.js';

avoidBackgroundThrottling();
const args = process.argv.slice(2);
if (args[0] === '--compare') {
  const a = JSON.parse(readFileSync(args[1], 'utf8')), b = JSON.parse(readFileSync(args[2], 'utf8'));
  const first = (x, y) => x.findIndex((h, i) => h !== y[i]);
  const f = first(a.frames, b.frames), s = first(a.states, b.states);
  console.log(f < 0 && s < 0 && a.frames.length === b.frames.length ? `identical (${a.frames.length} frames, ${a.states.length} states)` : `DIFFER: first frame ${f}, first state ${s}`);
  console.log(`time: ${a.ms.toFixed(0)} ms -> ${b.ms.toFixed(0)} ms (feed ${a.feedMs.toFixed(0)} -> ${b.feedMs.toFixed(0)}, atmosphere ${a.atmMs.toFixed(0)} -> ${b.atmMs.toFixed(0)}, storms ${a.stormMs.toFixed(0)} -> ${b.stormMs.toFixed(0)})`);
  process.exit(f < 0 && s < 0 ? 0 : 1);
}
const seed = Number(args[0] ?? 1000), hours = Number(args[1] ?? 12), out = args[2] ?? 'fingerprint.json';

// a deep hash of everything reachable (own enumerable keys, in order; numbers by their bits)
function hashState(root) {
  const h = createHash('sha256'), seen = new Map(), f64 = new Float64Array(1), b = new Uint8Array(f64.buffer);
  const walk = v => {
    if (v === null || v === undefined) { h.update(v === null ? 'N' : 'U'); return; }
    const t = typeof v;
    if (t === 'number') { f64[0] = v; h.update(b); return; }
    if (t === 'string') { h.update('s' + v.length + ':' + v); return; }
    if (t === 'boolean') { h.update(v ? 'T' : 'F'); return; }
    if (t === 'function' || t === 'symbol' || t === 'bigint') return;
    if (seen.has(v)) { h.update('@' + seen.get(v)); return; }
    seen.set(v, seen.size);
    if (ArrayBuffer.isView(v)) { h.update('V'); h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); return; }
    if (v instanceof Map) { h.update('M'); for (const [k, x] of v) { walk(k); walk(x); } return; }
    if (v instanceof Set) { h.update('S'); for (const x of v) walk(x); return; }
    h.update(Array.isArray(v) ? '[' : '{');
    for (const k of Object.keys(v)) { h.update(k); walk(v[k]); }
  };
  walk(root);
  return h.digest('hex').slice(0, 16);
}

const engine = new AtmosphereWorld({ seed }), world = engine.world;
const feed = new GameFeed({ tickMs: 37500 });
const frames = [], states = [];
let feedMs = 0, atmMs = 0, stormMs = 0, tick = 0;
const T0 = performance.now();
for (let half = 0; half < hours * 2; half++) {
  for (let k = 0; k < 6; k++) {
    let t = performance.now();
    engine.advanceStormLayer(1 / 12);
    stormMs += performance.now() - t;
    t = performance.now();
    feed.capture(world, 1e12 + 37500 * tick++);
    feedMs += performance.now() - t;
    frames.push(createHash('sha256').update(feed.frames.at(-1).text).digest('hex').slice(0, 16));
  }
  const t = performance.now();
  engine.advance(0.5, { advanceStorms: false });
  atmMs += performance.now() - t;
  states.push(hashState({ cells: world.cells, storms: world.storms, hour: world.validHourUtc }));
}
const ms = performance.now() - T0;
writeFileSync(out, JSON.stringify({ seed, hours, ms, feedMs, atmMs, stormMs, frames, states }));
console.log(`seed ${seed}, ${hours} h: ${frames.length} frames, ${states.length} states; ${(ms / 1000).toFixed(1)} s (feed ${(feedMs / 1000).toFixed(1)}, atmosphere ${(atmMs / 1000).toFixed(1)}, storms ${(stormMs / 1000).toFixed(1)}) -> ${out}`);
