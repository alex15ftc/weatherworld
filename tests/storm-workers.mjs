// The cloud model workers (js/game/StormWorkers.js) on a live runtime, with real worker processes:
// a player beside a storm gives it a worker and frames, the bundle reads back (full, near and far
// frames), and the worker is let go when the player leaves. About a minute.
//   node tests/storm-workers.mjs [bundle out path, for the Luau reader's check]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';
import { StormWorkers } from '../js/game/StormWorkers.js';
import { decodeHeader, decodeClientFrame } from '../js/cloudmodel/FrameCodec.js';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();
const wait = ms => new Promise(r => setTimeout(r, ms));
const runtime = new WeatherAuthorityRuntime({ seed: 2, spinUpDays: 6 });
runtime.saveState = () => {};
const world = runtime.atmosphere;
for (let i = 0; i < 48 && !(world.storms ?? []).some(s => s.active && s.intensity > 0.3); i++) runtime.advance(0.5);
const storm = (world.storms ?? []).filter(s => s.active).sort((a, b) => b.intensity - a.intensity)[0];
assert.ok(storm, 'the world has a storm');

const workers = new StormWorkers({ max: 2, clockRate: 8, params: { pollMs: 300, releaseS: 2, endedLingerS: 2, warmMaxS: 5 * 60 } });
runtime.stormWorkers = workers;
try {
  const here = [storm.positionKm.x + 5, storm.positionKm.y];
  const far = [storm.positionKm.x + 400, storm.positionKm.y + 400];
  const otherNear = (world.storms ?? []).filter(s => s.active && Math.hypot(s.positionKm.x - far[0], s.positionKm.y - far[1]) < 90).length;
  workers.reportPlayers('test', [here]);
  runtime.engine.advanceStormLayer(1 / 12);
  assert.ok(workers.workers.has(storm.id), 'a player 5 km away gives the storm a worker');
  assert.equal(workers.workers.get(storm.id).nest, true, '...with its nest (within nestKm)');

  // Frames: the worker runs from the engine's record; a frame every 15 model seconds. An old storm
  // first warms up (here 5 model minutes, flat out) and sends no frame meanwhile.
  let st, sawWarming = false;
  for (let t = 0; t < 60; t++) {
    await wait(1000);
    st = workers.status().workers.find(w => w.id === storm.id);
    if (st?.warming) { sawWarming = true; assert.equal(st.seq, 0, 'no frames while warming up'); }
    if (st?.seq >= 2) break;
    if (t % 5 === 4) { workers.reportPlayers('test', [here]); runtime.engine.advanceStormLayer(1 / 12); }
  }
  assert.ok(st?.seq >= 2, `frames arrive (seq ${st?.seq})`);
  if ((storm.ageHours ?? 0) * 60 > 1) assert.ok(sawWarming || st.modelMinutes >= 5, 'an old storm warms up first');
  console.log(`storm age ${Math.round((storm.ageHours ?? 0) * 60)} min: warm-up seen ${sawWarming}, model ${st.modelMinutes} min at the first frames`);

  // The bundle.
  const bundle = workers.frames('');
  if (process.argv[2]) fs.writeFileSync(process.argv[2], bundle);
  const b = new DataView(bundle.buffer, bundle.byteOffset, bundle.byteLength);
  assert.equal(b.getUint8(0), 2, 'bundle version 2');
  assert.equal(b.getUint16(1, true), 1, 'one storm in the bundle');
  let o = 3;
  const idLen = bundle[o++], id = bundle.subarray(o, o + idLen).toString('utf8'); o += idLen;
  const seq = b.getUint32(o, true); o += 4; const flags = bundle[o++];
  const parts = [];
  for (let k = 0; k < 3; k++) { const n = b.getUint32(o, true); o += 4; parts.push(bundle.subarray(o, o + n)); o += n; }
  assert.equal(id, String(storm.id)); assert.ok(seq >= 2); assert.ok(flags & 2, 'flagged as having its nest');
  // the live list: the storm with where it is (map km, as of the tick) and its motion; the clock
  assert.equal(b.getUint16(o, true), 1, 'one storm shown'); o += 2;
  const lLen = bundle[o++]; assert.equal(bundle.subarray(o, o + lLen).toString('utf8'), String(storm.id)); o += lLen;
  o += 1; // flags
  const xKm = b.getFloat32(o, true), yKm = b.getFloat32(o + 4, true), ue = b.getFloat32(o + 8, true); o += 16;
  assert.ok(Math.hypot(xKm - storm.positionKm.x, yKm - storm.positionKm.y) < 0.01, `the storm's position (${xKm}, ${yKm})`);
  assert.ok(Math.abs(ue - storm.velocityKph.east / 3.6) < 0.01, 'its motion');
  assert.ok(Math.abs(b.getFloat64(o, true) - world.stormEngine.validHourUtc) < 1e-6, 'the tick hour'); o += 8;
  assert.equal(bundle[o], 0, 'not paused'); assert.equal(o + 1, bundle.length, 'nothing after');
  const full = decodeHeader(new Uint8Array(zstdDecompressSync(parts[0])));
  const near = decodeClientFrame(new Uint8Array(zstdDecompressSync(parts[1])));
  const farFrame = decodeClientFrame(new Uint8Array(zstdDecompressSync(parts[2])));
  assert.equal(full.nx, 64); assert.equal(near.nx, 64); assert.equal(farFrame.nx, 32); assert.equal(farFrame.dx, 2 * near.dx);
  assert.ok(near.seq === seq && farFrame.seq === seq && full.seq === seq, 'all three parts are the same frame');
  console.log(`bundle ${bundle.length} B: full ${parts[0].length}, near ${parts[1].length}, far ${parts[2].length} B (model ${st.modelMinutes} min)`);
  const empty = workers.frames(`${storm.id}:${seq}`);
  assert.equal(new DataView(empty.buffer, empty.byteOffset).getUint16(1, true), 0, 'nothing new for a caller that holds the newest');

  // The player leaves: the worker goes after releaseS.
  workers.reportPlayers('test', [far]);
  runtime.engine.advanceStormLayer(1 / 12);
  await wait(2500);
  runtime.engine.advanceStormLayer(1 / 12);
  assert.ok(!workers.workers.get(storm.id) || workers.workers.get(storm.id).stopping, 'the worker is let go when no player is near');
  for (let t = 0; t < 20 && workers.workers.has(storm.id); t++) await wait(250);
  assert.ok(!workers.workers.has(storm.id), 'its process has exited');
  assert.ok(workers.workers.size <= otherNear, 'only storms near the new spot have workers');
  console.log('storm workers: ok');
} finally {
  workers.close();
}
setTimeout(() => process.exit(0), 1000);
