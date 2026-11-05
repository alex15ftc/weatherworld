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
// Open (PLAN A5): a storm that becomes detailed when it is already mature starts its model from
// the beginning, so for its first half hour the model storm is younger than the engine's.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync, constants as ZSTD } from 'node:zlib';
import { labStorm } from './LabWindow.js';
import { clientFrame } from '../cloudmodel/FrameCodec.js';

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
  // Zstd level of the kept frames (19: about 15% smaller than the default, a few ms a frame).
  zstdLevel: 19
});

const WORKER_SCRIPT = fileURLToPath(new URL('../../tools/cloudlab/worker/worker.mjs', import.meta.url));
const defaultMax = () => Number(process.env.WEATHER_STORM_WORKERS) || Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 4)));
const zstd = (bytes, level) => zstdCompressSync(bytes, { params: { [ZSTD.ZSTD_c_compressionLevel]: level } });

// The record EngineRun steers by (js/cloudmodel/EngineRun.js reads motion, intensity, coldPoolK,
// tornado, active, inflow and updraftMs).
export function workerRecord(world, storm, simHourUtc) {
  const s = labStorm(world, storm, () => [0, 0], [], { withInflow: true });
  return { id: s.id, simHourUtc, motion: s.motion, intensity: s.intensity, coldPoolK: s.coldPoolK, tornado: s.tornado, active: storm.active !== false, inflow: s.inflow, updraftMs: s.updraftMs };
}

// The bundle with nothing in it (the workers off).
export const EMPTY_FRAMES = Buffer.from([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

export class StormWorkers {
  // clockRate: game seconds per real second (8 at the 8x clock). spawnWorker(port) -> a child
  // process (a test may pass its own).
  constructor({ max = defaultMax(), clockRate = 8, params = {}, spawnWorker = null } = {}) {
    this.max = Math.max(0, max); this.clockRate = clockRate;
    this.params = { ...STORM_WORKERS, ...params };
    this.spawnWorker = spawnWorker ?? (port => spawn(process.execPath, [WORKER_SCRIPT, String(port)], { stdio: ['ignore', 'ignore', 'inherit'] }));
    this.players = new Map();   // server -> { at, list: [[x, y]] }
    this.workers = new Map();   // storm id -> worker
    this.freePorts = [];
    this.nextPort = this.params.basePort;
    this.poller = setInterval(() => this.poll(), this.params.pollMs);
    this.poller.unref?.();
  }

  // players: [[xKm, yKm], ...] on the map (y south).
  reportPlayers(server, players) {
    const list = (Array.isArray(players) ? players : []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, 200);
    this.players.set(String(server ?? 'default'), { at: Date.now(), list });
    return { detailed: [...this.workers.values()].filter(w => !w.stopping).map(w => ({ id: w.id, nest: w.nest, seq: w.seq, warming: w.status?.warming === true, modelMinutes: w.status?.time != null ? +(w.status.time / 60).toFixed(1) : null })) };
  }

  livePlayers(now = Date.now()) {
    const out = [];
    for (const [server, entry] of this.players) {
      if (now - entry.at > this.params.playerTtlS * 1000) { this.players.delete(server); continue; }
      out.push(...entry.list);
    }
    return out;
  }

  // After every storm tick of the live world (it only reads the world).
  stormTick(world) {
    const p = this.params, now = Date.now(), players = this.livePlayers(now);
    const simHourUtc = Number(world.stormEngine?.validHourUtc ?? world.validHourUtc);
    const storms = new Map((world.storms ?? []).filter(s => s.active !== false).map(s => [s.id, s]));
    // (where each shown storm is as of this tick, for the bundle: a game server places and moves
    // its storms from these, js frames())
    this.tickHour = simHourUtc;
    for (const w of this.workers.values()) {
      const s = storms.get(w.id);
      if (s) { w.posKm = [s.positionKm.x, s.positionKm.y]; w.motion = [(s.velocityKph?.east ?? 0) / 3.6, (s.velocityKph?.north ?? 0) / 3.6]; }
    }
    const nearest = s => { let d = Infinity; for (const [x, y] of players) d = Math.min(d, Math.hypot(s.positionKm.x - x, s.positionKm.y - y)); return d; };

    // Storms that have ended (or left the world): their model storms are let die, then stopped.
    for (const w of this.workers.values()) {
      if (!storms.has(w.id) && !w.endedAt) { w.endedAt = now; this.post(w, '/update', { ended: true }); }
      if (w.endedAt && now - w.endedAt > p.endedLingerS * 1000) this.stop(w);
    }
    // The storms wanted in detail, nearest first (those already shown a little ahead, so two at
    // about the same distance do not swap back and forth).
    const ranked = [];
    for (const s of storms.values()) {
      const d = nearest(s), has = this.workers.get(s.id);
      if (d <= p.detailKm || (has && !has.endedAt && d <= p.releaseKm)) ranked.push({ s, d, rank: has ? 0.8 * d : d });
    }
    ranked.sort((a, b) => a.rank - b.rank);
    const wanted = new Map(ranked.slice(0, this.max).map(r => [r.s.id, r]));
    for (const w of this.workers.values()) {
      if (w.endedAt || w.stopping) continue;
      if (wanted.has(w.id)) w.unwantedSince = null;
      else { w.unwantedSince ??= now; if (now - w.unwantedSince > p.releaseS * 1000) this.stop(w); }
    }
    const running = () => [...this.workers.values()].filter(w => !w.stopping).length;
    for (const { s, d } of wanted.values()) {
      let w = this.workers.get(s.id);
      if (!w) {
        // A slot: free, or taken from the worker unwanted longest.
        if (running() >= this.max) {
          const spare = [...this.workers.values()].filter(x => !x.stopping && (x.unwantedSince || x.endedAt)).sort((a, b) => (a.unwantedSince ?? a.endedAt) - (b.unwantedSince ?? b.endedAt))[0];
          if (!spare) continue;
          this.stop(spare);
        }
        w = this.start(workerRecord(world, s, simHourUtc), d <= p.nestKm, Math.min(p.warmMaxS, Math.max(0, (s.ageHours ?? 0) * 3600)));
        w.posKm = [s.positionKm.x, s.positionKm.y]; w.motion = [(s.velocityKph?.east ?? 0) / 3.6, (s.velocityKph?.north ?? 0) / 3.6];
        continue;
      }
      const record = workerRecord(world, s, simHourUtc);
      if (d <= p.nestKm && !w.nest) { w.nest = true; record.nest = true; }
      this.post(w, '/update', record);
    }
  }

  start(record, nest, warmS = 0) {
    const port = this.freePorts.pop() ?? this.nextPort++;
    const proc = this.spawnWorker(port);
    try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch {}
    const w = { id: record.id, port, proc, nest, seq: 0, full: null, near: null, far: null, ended: false, startedAt: Date.now(), endedAt: null, unwantedSince: null, stopping: false, status: null, queue: Promise.resolve() };
    this.workers.set(record.id, w);
    proc.on?.('exit', () => { if (this.workers.get(w.id) === w) this.workers.delete(w.id); if (!this.freePorts.includes(port)) this.freePorts.push(port); });
    // (the worker takes a moment to listen: /start is retried until it answers)
    w.queue = (async () => {
      for (let tries = 0; tries < 50 && !w.stopping; tries++) {
        try { await this.request(w, '/start', { record, clockRate: this.clockRate, warmS, opts: { nest } }); return; }
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
  frames(have = '', parts = ['full', 'near', 'far'], { paused = false } = {}) {
    const held = new Map();
    for (const item of String(have ?? '').split(',')) { const k = item.lastIndexOf(':'); if (k > 0) held.set(item.slice(0, k), Number(item.slice(k + 1)) || 0); }
    const want = new Set(parts), chunks = [], live = [];
    let count = 0;
    const u8 = v => Uint8Array.of(v), u16 = v => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }, u32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
    const f32s = (...v) => { const b = new Uint8Array(4 * v.length), d = new DataView(b.buffer); v.forEach((x, k) => d.setFloat32(4 * k, Number(x) || 0, true)); return b; };
    let nLive = 0;
    const idBytes = id => { const b = Buffer.from(String(id), 'utf8').subarray(0, 255); return [u8(b.length), b]; };
    for (const w of this.workers.values()) {
      if (w.stopping) continue;
      live.push(...idBytes(w.id), u8(w.status?.warming ? 1 : 0), f32s(w.posKm?.[0], w.posKm?.[1], w.motion?.[0], w.motion?.[1]));
      nLive++;
      if (!w.full || w.seq <= (held.get(String(w.id)) ?? 0)) continue;
      count++;
      chunks.push(...idBytes(w.id), u32(w.seq), u8((w.ended ? 1 : 0) | (w.nest ? 2 : 0)));
      for (const part of ['full', 'near', 'far']) { const bytes = want.has(part) ? w[part] : null; chunks.push(u32(bytes?.length ?? 0)); if (bytes) chunks.push(bytes); }
    }
    const tail = new Uint8Array(9); new DataView(tail.buffer).setFloat64(0, Number(this.tickHour) || 0, true); tail[8] = paused ? 1 : 0;
    return Buffer.concat([u8(2), u16(count), ...chunks, u16(nLive), ...live, tail]);
  }

  status() {
    return {
      max: this.max, players: this.livePlayers().length,
      workers: [...this.workers.values()].map(w => ({ id: w.id, port: w.port, nest: w.nest, seq: w.seq, ended: w.ended, stopping: w.stopping, warming: w.status?.warming ?? null, behindS: w.status?.behind ?? null, stepMs: w.status?.stepMs ?? null, modelMinutes: w.status?.time != null ? +(w.status.time / 60).toFixed(1) : null, bytes: { full: w.full?.length ?? 0, near: w.near?.length ?? 0, far: w.far?.length ?? 0 } }))
    };
  }

  close() { clearInterval(this.poller); for (const w of this.workers.values()) this.stop(w); }
}
