// One detailed storm's cloud model beside the weather engine (docs/cloudlab/PLAN.md, phase A), on
// the WebAssembly model (js/cloudmodel): the same HTTP service as worker.luau, with the nest in
// the same process (no second process: the native model keeps pace on one core).
//   node tools/cloudlab/worker/worker.mjs <port>
// Endpoints (JSON bodies; localhost only):
//   POST /start   { record, startRows?, opts?, clockRate, frameEvery?, warmS?, restorePath?, expect? }
//                 -> { ok, restored }
//                 warmS: the run starts that many model seconds back and steps flat out to catch
//                 up; no frame is made until it is within CAUGHT_UP_S of the clock
//                 restorePath: carry on from a /save file instead, if its meta has expect's fields
//                 (the engine's world tag and the storm's id); otherwise a fresh start as above
//   POST /save    { path, meta } -> { ok, bytes, ms }: the run's whole state (EngineRun.snapshot,
//                 bit for bit) with this worker's clock and meta, written to path (via path.tmp)
//   POST /update  record (with simHourUtc; nest: true starts the nest), or { ended: true }
//   GET  /frame   the newest frame (application/octet-stream; header x-frame-seq)
//   GET  /status  { time, simHour, behind (model s), stepMs, seq, frames, ended, nest, warming, restored,
//                 pin } - pin: where the model's tornado (or else its 0-1 km mesocyclone) is from
//                 the box's follow point, { east, north } km, zeta (1/s), tornado (bool); or null
// Frame numbers (seq) start at the Unix time in seconds, so a later worker for the same storm (a
// restart, or the storm shown again) always numbers its frames above an earlier one's.
//   POST /stop    stops the worker
import http from 'node:http';
import fs from 'node:fs';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { avoidBackgroundThrottling } from '../../../js/runtime/processPriority.node.js';
import { EngineRun, pinPoint } from '../../../js/cloudmodel/EngineRun.js';
import { encode } from '../../../js/cloudmodel/FrameCodec.js';

avoidBackgroundThrottling();
const port = Number(process.argv[2] ?? 8790);
let run = null, clockRate = 8, frameEvery = 15;
let startHour = 0, lastHour = 0, lastClock = performance.now();
let frame = null, seq = 0, frames = 0, nextFrame = 0, stepMs = 0, running = true, restored = false;
const MAGIC = 'CMS1';
const nowSeq = () => Math.floor(Date.now() / 1000);
function makeFrame() {
  seq = seq > 0 ? seq + 1 : nowSeq();
  frames++;
  frame = Buffer.from(encode(run, seq));
}

// A /save file: MAGIC, u32 length + JSON { meta, clock, run }, then the module memory, Zstd level 1.
function saveRun(file, meta) {
  const t0 = performance.now();
  const snap = run.snapshot();
  // (the game hour the model's time stands for: its clock runs from startHour)
  const clock = { modelHour: startHour + run.model.time / 3600, seq, clockRate, frameEvery };
  const head = Buffer.from(JSON.stringify({ meta, clock, run: snap.json }), 'utf8');
  const len = Buffer.alloc(4); len.writeUInt32LE(head.length);
  const body = Buffer.concat([Buffer.from(MAGIC), len, head, zstdCompressSync(snap.memory, { params: { 100: 1 } })]);
  fs.writeFileSync(file + '.tmp', body);
  fs.renameSync(file + '.tmp', file);
  return { bytes: body.length, ms: Math.round(performance.now() - t0) };
}
function readSave(file) {
  const b = fs.readFileSync(file);
  if (b.subarray(0, 4).toString() !== MAGIC) throw new Error('not a model save');
  const n = b.readUInt32LE(4);
  const head = JSON.parse(b.subarray(8, 8 + n).toString('utf8'));
  return { ...head, memory: new Uint8Array(zstdDecompressSync(b.subarray(8 + n))) };
}

const CAUGHT_UP_S = 30;
let warming = false;
const now = () => performance.now() / 1000;
const targetTime = () => (lastHour - startHour) * 3600 + (now() - lastClock) * clockRate;
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((ok, fail) => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => ok(Buffer.concat(parts).toString('utf8'))); req.on('error', fail); });

// A worker nobody has asked anything for IDLE_EXIT_S stops by itself: the engine that started it
// polls it every few seconds (js/game/StormWorkers.js), so this only happens when the engine has
// gone without stopping it.
const IDLE_EXIT_S = Number(process.env.CLOUD_WORKER_IDLE_S) || 120;
let lastRequest = Date.now();
setInterval(() => { if (Date.now() - lastRequest > IDLE_EXIT_S * 1000) process.exit(0); }, 5000).unref();

const server = http.createServer(async (req, res) => {
  lastRequest = Date.now();
  try {
    const { method } = req, path = req.url.split('?')[0];
    if (method === 'POST' && path === '/start') {
      const body = JSON.parse(await readBody(req));
      clockRate = body.clockRate ?? clockRate;
      frameEvery = body.frameEvery ?? frameEvery;
      const opts = { ...(body.opts ?? {}), startRows: body.startRows ?? undefined };
      lastHour = body.record.simHourUtc;
      lastClock = now();
      seq = 0; frames = 0; nextFrame = 0; frame = null; restored = false;
      if (body.restorePath && !run) {
        try {
          const save = readSave(body.restorePath);
          const want = body.expect ?? {};
          for (const k of Object.keys(want)) if (save.meta?.[k] !== want[k]) throw new Error(`a save for another ${k}`);
          run = EngineRun.restore({ memory: save.memory, json: save.run });
          if (opts.nest) run.useNest = true;
          run.update(body.record);
          run.simHour = body.record.simHourUtc;
          // carry on from the save's clock: ahead of the world, wait; behind, catch up flat out
          startHour = save.clock.modelHour - run.model.time / 3600;
          seq = Math.max(save.clock.seq, nowSeq() - 1);
          warming = targetTime() - run.model.time > CAUGHT_UP_S;
          makeFrame();
          nextFrame = run.model.time + frameEvery;
          restored = true;
          return json(res, 200, { ok: true, restored: true });
        } catch (e) {
          console.error(`[worker ${port}] not restored: ${e?.message ?? e}`);
          run = null;
        }
      }
      run = new EngineRun(body.record, opts);
      run.simHour = body.record.simHourUtc;
      const warmS = Math.max(0, Number(body.warmS) || 0);
      startHour = lastHour - warmS / 3600;
      warming = warmS > CAUGHT_UP_S;
      return json(res, 200, { ok: true, restored: false });
    }
    if (method === 'POST' && path === '/save') {
      if (!run) return json(res, 409, { error: 'not started' });
      const body = JSON.parse(await readBody(req));
      return json(res, 200, { ok: true, ...saveRun(String(body.path), body.meta ?? {}) });
    }
    if (method === 'POST' && path === '/update') {
      if (!run) return json(res, 409, { error: 'not started' });
      const body = JSON.parse(await readBody(req));
      if (body.ended) run.update(null);
      else { run.update(body); run.simHour = body.simHourUtc; lastHour = body.simHourUtc; lastClock = now(); }
      // (a player came near: the nest starts, at 30 model minutes or now if later; js/game/StormWorkers.js)
      if (body.nest === true) run.useNest = true;
      return json(res, 200, { ok: true, behind: targetTime() - run.model.time });
    }
    if (method === 'GET' && path === '/frame') {
      if (!frame) return json(res, 404, { error: 'no frame yet' });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-frame-seq': String(seq) });
      return res.end(frame);
    }
    if (method === 'GET' && path === '/status') {
      if (!run) return json(res, 200, { started: false });
      return json(res, 200, { started: true, time: run.model.time, simHour: run.simHour, behind: targetTime() - run.model.time, stepMs, seq, frames, ended: run.ended, nest: run.nest != null, warming, restored, pin: pinPoint(run) });
    }
    if (method === 'POST' && path === '/stop') {
      running = false;
      json(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 50);
      return;
    }
    json(res, 404, { error: `unknown ${method} ${path}` });
  } catch (e) {
    json(res, 500, { error: String(e?.message ?? e) });
  }
});
server.listen(port, '127.0.0.1', () => console.log(`cloud model worker on port ${port}`));

// the step loop: one step per turn of the event loop, so requests get in between
function loop() {
  if (!running) return;
  if (run && run.model.time < targetTime()) {
    const t0 = performance.now();
    run.step();
    stepMs = 0.8 * stepMs + 0.2 * (performance.now() - t0);
    if (warming && targetTime() - run.model.time < CAUGHT_UP_S) warming = false;
    if (!warming && run.model.time >= nextFrame) {
      nextFrame = run.model.time + frameEvery;
      makeFrame();
    }
    setImmediate(loop);
  } else setTimeout(loop, 50);
}
loop();
