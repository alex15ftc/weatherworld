// The cloud model workers beside the engine (docs/cloudlab/PLAN.md, phase A3-A4): which storms are
// shown in detail, a worker process for each (tools/cloudlab/worker/worker.mjs), fed the
// engine's record of its storm after every storm tick, and the newest frames kept for the game.
//
// The Roblox servers say where their players are (reportPlayers, map km, y south). A storm gets a
// worker when a player is within detailKm of it, and its 250 m nest when one is within nestKm
// (the nest is only ever added: EngineRun starts it at 30 model minutes and keeps it). It keeps
// its worker until no player has been within releaseKm for releaseS, or until it ends. At most
// `max` workers run (WEATHER_STORM_WORKERS; each takes about 8% of a core, 17% with its nest, at
// the 8x clock), the nearest storms first. A storm without a worker keeps its engine look.
//
// Each frame is kept three ways, Zstd-compressed (FrameCodec.js): full (for the Roblox server:
// winds, damage), near and far (cut down for the clients, about 3 KB and 1 KB). frames() bundles
// those newer than what the caller holds (layout below).
//
// A storm already mature when it gets a worker warms up first (warmMaxS). Restarts (PLAN A5):
// with saveDir, every model is saved each time the world is (saveModels, called by the runtime's
// saveState), bit for bit, beside the world's state; a storm that gets a worker again carries on
// from its save when the save is from the same world (worldTag: code version and seed) and its
// storm is near where the save had it. A save is removed when its storm ends; any older than
// saveMaxAgeS are cleared at start.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync, constants as ZSTD } from 'node:zlib';
import { labStorm } from './LabWindow.js';
import { clientFrame } from '../cloudmodel/FrameCodec.js';
import { buildStormFrame } from '../storms/StormStructure.js';
import { rainFieldKey } from '../storms/StormRainFields.js';
import { flashRatePerMin, buildStormAppearance } from '../storms/StormAppearance.js';
import { chargeOf } from '../storms/Lightning.js';

export const STORM_WORKERS = Object.freeze({
  detailKm: 60, nestKm: 20, releaseKm: 90, releaseS: 120,
  // A server's report counts for this long.
  playerTtlS: 30,
  // How often each worker's newest frame is fetched.
  pollMs: 2000,
  basePort: 8800,
  // A worker whose storm has ended is kept this long, so the model storm can be seen to die.
  endedLingerS: 60,
  // A storm already this old when it gets a worker (or older) starts its model this far back and
  // runs flat out to catch up (the worker sends no frames meanwhile), so a mature storm shows as a
  // grown model storm rather than a young one. Model seconds; the model's storm matures in 30-45 min.
  warmMaxS: 45 * 60,
  // A save is used only for a storm within this of where the save had it (km, plus its motion
  // over the time between), and saves older than saveMaxAgeS (real s) are cleared at start.
  restoreKm: 15, saveMaxAgeS: 24 * 3600,
  // Engine-only (engineFrames "only"): at most this many storms get engine frames, the nearest first
  // (a build is about 110-130 ms of the engine's thread, once a storm tick).
  engineMax: 6,
  // Zstd level of the kept frames (19: about 15% smaller than the default, a few ms a frame).
  zstdLevel: 19
});

const WORKER_SCRIPT = fileURLToPath(new URL('../../tools/cloudlab/worker/worker.mjs', import.meta.url));
const defaultMax = () => Number(process.env.WEATHER_STORM_WORKERS) || Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 4)));
const zstd = (bytes, level) => zstdCompressSync(bytes, { params: { [ZSTD.ZSTD_c_compressionLevel]: level } });

// Where a storm's model is drawn (map km): its box follows the model's updraught (CloudModel
// followStorm), so it goes at the engine's updraught - which leans 1-5 km downwind of the storm's
// position, its low-level mesocyclone, in a rotating storm (js/storms/StormGeometry.js) - and then
// the model's own mesocyclone and tornado land where the model has them relative to it.
export function drawnAt(s) {
  const u = s.geometry?.updraught;
  return u && Number.isFinite(u.xKm) && Number.isFinite(u.yKm) ? [u.xKm, u.yKm] : [s.positionKm.x, s.positionKm.y];
}

// The engine's numbers a game client builds its drawn storm from (the bundle's version 4 look
// record; roblox/Client/Modules/FrameWorld.luau): the same numbers the lab window's storms carry
// (LabWindow labStorm, Storm.fromEngine / setEngine), so every game server's clients draw the
// same storm from them. Map km, y south.
export const LOOK_FIELDS = 14;
export function lookOf(s) {
  let a = null;
  try { a = buildStormAppearance(s); } catch { a = null; }
  return {
    values: [s.positionKm.x, s.positionKm.y, s.updraughtMs ?? 0, s.mesocycloneStrength ?? 0, s.lowRotation ?? 0, s.occlusion ?? 0,
      (s.ageHours ?? 0) * 60, a?.updraft?.radiusKm ?? 0, a?.anvil?.lengthKm ?? 0, a?.anvil?.bearingDeg ?? 0, s.intensity ?? 0,
      s.tornado?.onGround ? Number(s.tornado.windSpeedMph) || 0 : 0,
      a?.updraft?.baseM ?? 0, a?.wallCloud?.loweringM ?? 0],
    leftMover: !!s.leftMover,
  };
}

// The record EngineRun steers by (js/cloudmodel/EngineRun.js reads motion, intensity, coldPoolK,
// coldPoolDepthM, tornado, active, inflow, convergence, maintenance, updraftMs and hailIn).
export function workerRecord(world, storm, simHourUtc) {
  const s = labStorm(world, storm, () => [0, 0], [], { withInflow: true });
  return { id: s.id, simHourUtc, motion: s.motion, intensity: s.intensity, coldPoolK: s.coldPoolK, coldPoolDepthM: s.coldPoolDepthM, tornado: s.tornado, active: storm.active !== false, inflow: s.inflow, convergence: s.inflowConvergence, maintenance: s.maintenanceConvergence, updraftMs: s.updraftMs, hailIn: s.hailIn };
}

// The bundle with nothing in it (the workers off).
export const EMPTY_FRAMES = Buffer.from([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

export class StormWorkers {
  // clockRate: game seconds per real second (8 at the 8x clock). spawnWorker(port) -> a child
  // process (a test may pass its own).
  // rainFields(world, storms) -> Promise of Map storm id -> field: the storms' rain fields
  // (js/storms/StormRainFields.js) worked out off this thread (server/index.js: the radar's pool);
  // without it the frames work them out here.
  constructor({ max = defaultMax(), clockRate = 8, params = {}, spawnWorker = null, saveDir = null, worldTag = '', rainFields = null } = {}) {
    this.rainFields = rainFields;
    // (worldTag: a string, or a function giving it, read each time: a reset can change the world)
    this.saveDir = saveDir; this.tagOf = typeof worldTag === 'function' ? worldTag : () => worldTag;
    if (saveDir) {
      try {
        fs.mkdirSync(saveDir, { recursive: true });
        for (const f of fs.readdirSync(saveDir)) {
          const file = path.join(saveDir, f);
          if (Date.now() - fs.statSync(file).mtimeMs > (params.saveMaxAgeS ?? STORM_WORKERS.saveMaxAgeS) * 1000) fs.rmSync(file, { force: true });
        }
      } catch (e) { console.warn('[storm-workers] save folder:', e.message); }
    }
    this.max = Math.max(0, max); this.clockRate = clockRate;
    this.params = { ...STORM_WORKERS, ...params };
    this.spawnWorker = spawnWorker ?? (port => spawn(process.execPath, [WORKER_SCRIPT, String(port)], { stdio: ['ignore', 'ignore', 'inherit'] }));
    this.players = new Map();   // server -> { at, list: [[x, y]] }
    this.workers = new Map();   // storm id -> worker
    this.freePorts = [];
    this.nextPort = this.params.basePort;
    // Engine-built frames (js/storms/StormStructure.js, docs/research/ENGINE-PHYSICS-PLAN.md): "side"
    // gives each storm with a worker a second frame built by the engine, id "<id>~engine", for a
    // side-by-side; "only" builds them for the storms wanted in detail and starts no workers.
    // ("model", or nothing: the cloud model workers alone. server/index.js gives the game "only".)
    const mode = params.engineFrames ?? process.env.WEATHER_ENGINE_FRAMES ?? null;
    this.engineMode = mode === 'model' ? null : mode;
    this.engine = new Map();   // "<id>~engine" -> the same fields frames() reads from a worker
    this.engineSeq = Math.floor(Date.now() / 1000);
    this.poller = setInterval(() => this.poll(), this.params.pollMs);
    this.poller.unref?.();
  }

  // players: [[xKm, yKm], ...] on the map (y south).
  reportPlayers(server, players) {
    const list = (Array.isArray(players) ? players : []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, 200);
    this.players.set(String(server ?? 'default'), { at: Date.now(), list });
    return { detailed: [...this.workers.values(), ...(this.engineMode === 'only' ? this.engine.values() : [])].filter(w => !w.stopping).map(w => ({ id: w.id, nest: w.nest, seq: w.seq, warming: w.status?.warming === true, modelMinutes: w.status?.time != null ? +(w.status.time / 60).toFixed(1) : null })) };
  }

  livePlayers(now = Date.now()) {
    const out = [];
    for (const [server, entry] of this.players) {
      if (now - entry.at > this.params.playerTtlS * 1000) { this.players.delete(server); continue; }
      out.push(...entry.list);
    }
    return out;
  }

  // After every storm tick of the live world. It only reads the world (the cloud model gives the
  // engine nothing back since 2026-11-06: docs/research/ENGINE-PHYSICS-PLAN.md).
  stormTick(world) {
    const p = this.params, now = Date.now(), players = this.livePlayers(now);
    const simHourUtc = Number(world.stormEngine?.validHourUtc ?? world.validHourUtc);
    const storms = new Map((world.storms ?? []).filter(s => s.active !== false).map(s => [s.id, s]));
    // (where each shown storm is as of this tick, for the bundle: a game server places and moves
    // its storms from these, js frames())
    this.tickHour = simHourUtc;
    this.tickAtMs = now;
    for (const w of this.workers.values()) {
      const s = storms.get(w.id);
      if (s) { w.posKm = drawnAt(s); w.motion = [(s.velocityKph?.east ?? 0) / 3.6, (s.velocityKph?.north ?? 0) / 3.6]; w.look = lookOf(s); }
    }
    const nearest = s => { let d = Infinity; for (const [x, y] of players) d = Math.min(d, Math.hypot(s.positionKm.x - x, s.positionKm.y - y)); return d; };

    // Storms that have ended (or left the world): their model storms are let die, then stopped.
    for (const w of this.workers.values()) {
      if (!storms.has(w.id) && !w.endedAt) { w.endedAt = now; this.post(w, '/update', { ended: true }); }
      if (w.endedAt && now - w.endedAt > p.endedLingerS * 1000) { this.stop(w); const f = this.saveFile(w.id); if (f) fs.rmSync(f, { force: true }); }
    }
    // The storms wanted in detail, nearest first (those already shown a little ahead, so two at
    // about the same distance do not swap back and forth).
    const ranked = [];
    const only = this.engineMode === 'only';
    for (const s of storms.values()) {
      const d = nearest(s), has = only ? this.engine.get(`${s.id}~engine`) : this.workers.get(s.id);
      if (d <= p.detailKm || (has && !has.endedAt && d <= p.releaseKm)) ranked.push({ s, d, rank: has ? 0.8 * d : d });
    }
    ranked.sort((a, b) => a.rank - b.rank);
    const wanted = new Map(ranked.slice(0, only ? p.engineMax : this.max).map(r => [r.s.id, r]));
    for (const w of this.workers.values()) {
      if (w.endedAt || w.stopping) continue;
      if (wanted.has(w.id)) w.unwantedSince = null;
      else { w.unwantedSince ??= now; if (now - w.unwantedSince > p.releaseS * 1000) this.stop(w); }
    }
    const running = () => [...this.workers.values()].filter(w => !w.stopping).length;
    if (this.engineMode) this.engineTick(world, storms, wanted);
    for (const { s, d } of this.engineMode === 'only' ? [] : wanted.values()) {
      let w = this.workers.get(s.id);
      if (!w) {
        // A slot: free, or taken from the worker unwanted longest.
        if (running() >= this.max) {
          const spare = [...this.workers.values()].filter(x => !x.stopping && (x.unwantedSince || x.endedAt)).sort((a, b) => (a.unwantedSince ?? a.endedAt) - (b.unwantedSince ?? b.endedAt))[0];
          if (!spare) continue;
          this.stop(spare);
        }
        w = this.start(workerRecord(world, s, simHourUtc), d <= p.nestKm, Math.min(p.warmMaxS, Math.max(0, (s.ageHours ?? 0) * 3600)), this.usableSave(s, simHourUtc));
        w.posKm = drawnAt(s); w.motion = [(s.velocityKph?.east ?? 0) / 3.6, (s.velocityKph?.north ?? 0) / 3.6]; w.look = lookOf(s);
        continue;
      }
      const record = workerRecord(world, s, simHourUtc);
      if (d <= p.nestKm && !w.nest) { w.nest = true; record.nest = true; }
      this.post(w, '/update', record);
    }
  }

  // The engine's own frames for the storms shown (see the constructor), rebuilt every storm tick
  // from each storm's rain field (js/storms/StormRainFields.js, the radar's). With rainFields the
  // fields are worked out elsewhere first and the frames built when they are in, if the world is
  // still at the same storm tick (if not, the next tick builds them).
  engineTick(world, storms, wanted) {
    const ids = this.engineMode === 'only' ? [...wanted.keys()] : [...this.workers.values()].filter(w => !w.stopping && !w.endedAt).map(w => w.id);
    const shown = ids.map(id => storms.get(id)).filter(Boolean);
    if (!this.rainFields) return this.engineFrames(world, ids, storms, null);
    const at = rainFieldKey(world), tick = this.engineTickNo = (this.engineTickNo ?? 0) + 1;
    return this.rainFields(world, shown).then(fields => {
      if (rainFieldKey(world) === at && tick === this.engineTickNo) this.engineFrames(world, ids, storms, fields);
    }, e => console.warn('[storm-structure] rain fields:', e?.message ?? e));
  }

  // fields: Map storm id -> rain field (null: each worked out here).
  engineFrames(world, ids, storms, fields) {
    const keep = new Set();
    for (const id of ids) {
      const s = storms.get(id);
      if (!s) continue;
      const key = `${id}~engine`;
      keep.add(key);
      try {
        const { bytes, info } = buildStormFrame(world, s, { seq: ++this.engineSeq, rainField: fields?.get(id) });
        const level = this.params.zstdLevel;
        this.engine.set(key, { id: key, seq: this.engineSeq, nest: true, ended: false, status: { warming: false }, info,
          posKm: [s.positionKm.x, s.positionKm.y], motion: [(s.velocityKph?.east ?? 0) / 3.6, (s.velocityKph?.north ?? 0) / 3.6], look: lookOf(s),
          // (its lightning, for the game server to place in the frame: js/storms/Lightning.js's rate and charge)
          lightning: (() => { const c = chargeOf(s); return [flashRatePerMin(Number(s.geometry?.updraught?.speedMs ?? s.updraughtMs) || 0), c.groundShare, c.positiveShare]; })(),
          full: zstd(bytes, level), near: zstd(clientFrame(bytes), level), far: zstd(clientFrame(bytes, { far: true }), level) });
      } catch (e) { console.warn('[storm-structure]', id, e?.message ?? e); }
    }
    for (const key of [...this.engine.keys()]) if (!keep.has(key)) this.engine.delete(key);
  }

  // A model save's file, and its meta if it can be read.
  saveFile(id) { return this.saveDir ? path.join(this.saveDir, String(id).replace(/[^A-Za-z0-9._-]/g, '_') + '.cms') : null; }
  saveMeta(file) {
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, 0);
        if (head.subarray(0, 4).toString() !== 'CMS1') return null;
        const n = head.readUInt32LE(4), body = Buffer.alloc(n); fs.readSync(fd, body, 0, n, 8);
        return JSON.parse(body.toString('utf8')).meta ?? null;
      } finally { fs.closeSync(fd); }
    } catch { return null; }
  }
  // The save a storm can carry on from, or null: the same world, the same storm, near where it was.
  usableSave(s, simHourUtc) {
    const file = this.saveFile(s.id);
    if (!file || !fs.existsSync(file)) return null;
    const meta = this.saveMeta(file);
    if (!meta || meta.worldTag !== String(this.tagOf()) || String(meta.id) !== String(s.id) || !meta.posKm) return null;
    const hours = Math.abs(simHourUtc - (meta.simHour ?? simHourUtc));
    const speedKmh = Math.hypot(s.velocityKph?.east ?? 0, s.velocityKph?.north ?? 0);
    const at = drawnAt(s);
    if (Math.hypot(at[0] - meta.posKm[0], at[1] - meta.posKm[1]) > this.params.restoreKm + speedKmh * hours) return null;
    return file;
  }

  // Every running model saved (worker side, each in its own process), after the world is.
  saveModels() {
    if (!this.saveDir) return Promise.resolve([]);
    const jobs = [];
    for (const w of this.workers.values()) {
      if (w.stopping || w.endedAt || !w.status?.frames || w.status?.warming) continue;
      const meta = { id: String(w.id), worldTag: String(this.tagOf()), posKm: w.posKm ?? null, simHour: this.tickHour ?? null };
      jobs.push(new Promise(done => { w.queue = w.queue.then(() => this.request(w, '/save', { path: this.saveFile(w.id), meta })).then(r => r?.json?.()).then(done, e => { console.warn('[storm-workers] save', w.id, e?.message ?? e); done(null); }); }));
    }
    return Promise.all(jobs);
  }

  start(record, nest, warmS = 0, restorePath = null) {
    const port = this.freePorts.pop() ?? this.nextPort++;
    const proc = this.spawnWorker(port);
    try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch {}
    const w = { id: record.id, port, proc, nest, seq: 0, full: null, near: null, far: null, ended: false, startedAt: Date.now(), endedAt: null, unwantedSince: null, stopping: false, status: null, queue: Promise.resolve() };
    this.workers.set(record.id, w);
    proc.on?.('exit', () => { if (this.workers.get(w.id) === w) this.workers.delete(w.id); if (!this.freePorts.includes(port)) this.freePorts.push(port); });
    // (the worker takes a moment to listen: /start is retried until it answers)
    w.queue = (async () => {
      for (let tries = 0; tries < 50 && !w.stopping; tries++) {
        try { await this.request(w, '/start', { record, clockRate: this.clockRate, warmS, opts: { nest }, restorePath, expect: { id: String(record.id), worldTag: String(this.tagOf()) } }); return; }
        catch { await new Promise(r => setTimeout(r, 200)); }
      }
    })();
    return w;
  }

  stop(w) {
    if (w.stopping) return;
    w.stopping = true;
    this.request(w, '/stop', {}).catch(() => {}).finally(() => setTimeout(() => { try { w.proc.kill(); } catch {} }, 500));
  }

  // Requests to one worker go in order (a record never overtakes the start).
  post(w, path, body) { w.queue = w.queue.then(() => this.request(w, path, body)).catch(() => {}); }

  async request(w, path, body) {
    const res = await fetch(`http://127.0.0.1:${w.port}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res;
  }

  async poll() {
    for (const w of this.workers.values()) {
      if (w.stopping || w.polling) continue;
      w.polling = true;
      try {
        const status = await (await this.request(w, '/status')).json();
        w.status = status;
        if (status.seq > w.seq) {
          const res = await this.request(w, '/frame');
          if (res.ok) {
            const full = new Uint8Array(await res.arrayBuffer()), seq = Number(res.headers.get('x-frame-seq')) || status.seq;
            const level = this.params.zstdLevel;
            w.full = zstd(full, level); w.near = zstd(clientFrame(full), level); w.far = zstd(clientFrame(full, { far: true }), level);
            w.seq = seq; w.ended = (full[1] & 2) !== 0; w.frameAt = Date.now();
          }
        }
      } catch { /* not up yet, or gone */ }
      w.polling = false;
    }
  }

  // The frames newer than the caller holds, as one binary bundle (little-endian):
  //   u8 version (1), u16 count, then per storm: u8 id length, id (UTF-8), u32 seq,
  //   u8 flags (bit 0: ended, bit 1: has its nest), then u32 length + bytes for each of the full,
  //   near and far frames (Zstd; length 0 when that part was not asked for);
  //   then u16 count + (u8 length, id) of every storm shown in detail now.
  // have: "id:seq,id:seq" (what the caller holds); parts: any of full, near, far.
  // The bundle (version 2): u8 2, u16 count, per storm with a newer frame: u8 id length, id, u32
  // seq, u8 flags (bit 0 ended, bit 1 nest), then u32 length + bytes of the full, near and far
  // frames; then u16 count of every storm shown in detail, each: u8 id length, id, u8 flags (bit 0
  // warming up), f32 x, y (map km, y south, as of the tick), f32 east, north motion (m/s); then
  // f64 the tick's sim hour, u8 1 if the engine's clock is paused.
  // Version 3 (now): as 2, and each shown storm's entry ends with f32 flashes a minute (sim time),
  // the share of them reaching the ground and the share of those that are positive (zeros for a
  // model worker's storm).
  // Version 4 (now): as 3, and then u8 look flags (bit 0 the look record follows, bit 1 a left
  // mover) and, with bit 0, LOOK_FIELDS f32: the storm's position (map km, its low-level
  // mesocyclone), updraught m/s, mesocyclone strength, low-level rotation, occlusion, age (min),
  // updraught radius (km), anvil length (km) and bearing (deg), intensity, tornado mph (0 none)
  // (lookOf); version 5 adds the cloud base (m, the inflow's LCL) and the wall cloud's lowering (m). The bundle then ends with f64 the tick's wall-clock time (Unix ms) after the paused
  // byte: every game server moves its storms on from the same moment (not from when it polled).
  frames(have = '', parts = ['full', 'near', 'far'], { paused = false } = {}) {
    const held = new Map();
    for (const item of String(have ?? '').split(',')) { const k = item.lastIndexOf(':'); if (k > 0) held.set(item.slice(0, k), Number(item.slice(k + 1)) || 0); }
    const want = new Set(parts), chunks = [], live = [];
    let count = 0;
    const u8 = v => Uint8Array.of(v), u16 = v => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }, u32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
    const f32s = (...v) => { const b = new Uint8Array(4 * v.length), d = new DataView(b.buffer); v.forEach((x, k) => d.setFloat32(4 * k, Number(x) || 0, true)); return b; };
    let nLive = 0;
    const idBytes = id => { const b = Buffer.from(String(id), 'utf8').subarray(0, 255); return [u8(b.length), b]; };
    for (const w of [...this.workers.values(), ...this.engine.values()]) {
      if (w.stopping) continue;
      live.push(...idBytes(w.id), u8(w.status?.warming ? 1 : 0), f32s(w.posKm?.[0], w.posKm?.[1], w.motion?.[0], w.motion?.[1], ...(w.lightning ?? [0, 0, 0])));
      live.push(u8((w.look ? 1 : 0) | (w.look?.leftMover ? 2 : 0)));
      if (w.look) live.push(f32s(...w.look.values));
      nLive++;
      if (!w.full || w.seq <= (held.get(String(w.id)) ?? 0)) continue;
      count++;
      chunks.push(...idBytes(w.id), u32(w.seq), u8((w.ended ? 1 : 0) | (w.nest ? 2 : 0)));
      for (const part of ['full', 'near', 'far']) { const bytes = want.has(part) ? w[part] : null; chunks.push(u32(bytes?.length ?? 0)); if (bytes) chunks.push(bytes); }
    }
    const tail = new Uint8Array(17), td = new DataView(tail.buffer);
    td.setFloat64(0, Number(this.tickHour) || 0, true); tail[8] = paused ? 1 : 0; td.setFloat64(9, Number(this.tickAtMs) || 0, true);
    return Buffer.concat([u8(5), u16(count), ...chunks, u16(nLive), ...live, tail]);
  }

  status() {
    return {
      max: this.max, players: this.livePlayers().length,
      engine: [...this.engine.values()].map(e => ({ id: e.id, seq: e.seq, info: e.info, bytes: { full: e.full.length, near: e.near.length, far: e.far.length } })),
      workers: [...this.workers.values()].map(w => ({ id: w.id, port: w.port, nest: w.nest, seq: w.seq, ended: w.ended, stopping: w.stopping, warming: w.status?.warming ?? null, restored: w.status?.restored ?? null, frames: w.status?.frames ?? 0, behindS: w.status?.behind ?? null, stepMs: w.status?.stepMs ?? null, modelMinutes: w.status?.time != null ? +(w.status.time / 60).toFixed(1) : null, bytes: { full: w.full?.length ?? 0, near: w.near?.length ?? 0, far: w.far?.length ?? 0 } }))
    };
  }

  close() { clearInterval(this.poller); for (const w of this.workers.values()) this.stop(w); }
}
