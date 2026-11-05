// One detailed storm's cloud model beside the weather engine (docs/cloudlab/PLAN.md, phase A), on
// the WebAssembly model (js/cloudmodel): the same HTTP service as worker.luau, with the nest in
// the same process (no second process: the native model keeps pace on one core).
//   node tools/cloudlab/worker/worker.mjs <port>
// Endpoints (JSON bodies; localhost only):
//   POST /start   { record, startRows?, opts?, clockRate, frameEvery?, warmS? } -> { ok }
//                 warmS: the run starts that many model seconds back and steps flat out to catch
//                 up; no frame is made until it is within CAUGHT_UP_S of the clock
//   POST /update  record (with simHourUtc; nest: true starts the nest), or { ended: true }
//   GET  /frame   the newest frame (application/octet-stream; header x-frame-seq)
//   GET  /status  { time, simHour, behind (model s), stepMs, seq, ended, nest, warming }
//   POST /stop    stops the worker
import http from 'node:http';
import { avoidBackgroundThrottling } from '../../../js/runtime/processPriority.node.js';
import { EngineRun } from '../../../js/cloudmodel/EngineRun.js';
import { encode } from '../../../js/cloudmodel/FrameCodec.js';

avoidBackgroundThrottling();
const port = Number(process.argv[2] ?? 8790);
let run = null, clockRate = 8, frameEvery = 15;
let startHour = 0, lastHour = 0, lastClock = performance.now();
let frame = null, seq = 0, nextFrame = 0, stepMs = 0, running = true;

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
      run = new EngineRun(body.record, opts);
      run.simHour = body.record.simHourUtc;
      lastHour = body.record.simHourUtc;
      const warmS = Math.max(0, Number(body.warmS) || 0);
      startHour = lastHour - warmS / 3600;
      warming = warmS > CAUGHT_UP_S;
      lastClock = now();
      seq = 0; nextFrame = 0; frame = null;
      return json(res, 200, { ok: true });
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
      return json(res, 200, { started: true, time: run.model.time, simHour: run.simHour, behind: targetTime() - run.model.time, stepMs, seq, ended: run.ended, nest: run.nest != null, warming });
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
      seq++;
      frame = Buffer.from(encode(run, seq));
    }
    setImmediate(loop);
  } else setTimeout(loop, 50);
}
loop();
