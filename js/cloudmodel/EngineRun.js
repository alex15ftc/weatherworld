// One engine storm shown by the cloud model: a port of roblox/src/cloudlab/shared/Model/EngineRun.luau
// (its header explains the steering) on the WebAssembly model. The nest runs in the same process:
// the native model is fast enough that NestRemote's second process isn't needed.
//   const run = new EngineRun(record, opts); run.update(record | null); run.step()
//   EngineRun.fromScenario(data, opts); run.replayStep()
import { CloudModel, LOFF, soundingFromProfile } from './CloudModel.js';

export const ENGINE_RUN = {
  NEST_START: 30 * 60,
  START: 15 * 60,
  UPDRAFT_Z: 3000,
  UPDRAFT_W: 3,
  WARM_K: -0.5,
  INTO_WARM: 1500,
  LIFT_SPEED: 2000,
  LIFT_TAU: 5,
  ENV_TAU: 15 * 60,
  COLD_TAU: 10 * 60,
};
const C = ENGINE_RUN;

// the model's strongest 1 km rotation within r cells of (ci, cj)
function mesoNear(m, k1, ci, cj, r) {
  let best = 0, bi = ci, bj = cj;
  for (let j = Math.max(2, cj - r); j <= Math.min(m.ny - 1, cj + r); j++)
    for (let i = Math.max(2, ci - r); i <= Math.min(m.nx - 1, ci + r); i++) {
      const z = m.zeta(i, j, k1);
      if (z > best) { best = z; bi = i; bj = j; }
    }
  return [best, bi, bj];
}

export class EngineRun {
  constructor(record, opts = {}) {
    const o = opts;
    this.lift = o.lift ?? 8;
    this.liftR = o.liftR ?? 10000;
    this.torLift = o.torLift ?? 6;
    this.useNest = o.nest !== false;
    this.useEnv = o.env !== false;
    this.useCold = o.cold !== false;
    const snd = soundingFromProfile(o.startRows ?? record.inflow);
    const nx = o.nx ?? 64;
    const m = CloudModel.create({
      nx, ny: nx, dx: 1000, dzmin: 100, dzmax: 700, stretch: 1.12, ztop: 16000, dt: 6,
      cs: 150, K: 75, umove: record.motion[0], vmove: record.motion[1], z0: 0.1, follow: false,
      n0h: o.n0h, autoToIce: o.autoToIce,
    }, snd);
    this.model = m;
    this.nest = null;
    this.L = nx * m.dx;
    this.k1 = m.levelAt(1000);
    this.k3 = m.levelAt(C.UPDRAFT_Z);
    this.liftAt = o.liftAt ?? 'inflow';
    this.lx = 0.5 * this.L;
    this.ly = 0.45 * this.L;
    this.lox = 0;
    this.loy = 0;
    this.record = record;
    this.ended = false;
    if (o.startRows) this.update(record);
    this.coldMean = 0;
    this.nextMin = 60;
    this.nextSpot = C.START;
    m.setDrive(1, { x: 0.5 * this.L, y: 0.5 * this.L, ox: 0, oy: 0, r: Math.max(5000, this.liftR), z: 1500, rz: 1500, w: Math.min(10, record.updraftMs ?? 10), tau: 5, t1: 15 * 60, ramp: 5 * 60 });
  }

  update(record) {
    if (!record) { this.ended = true; return; }
    this.record = record;
    const m = this.model;
    if (record.motion) m.setMotion(record.motion[0], record.motion[1]);
    if (this.useEnv && record.inflow) {
      const { th, qv, u, v } = m.profiles(soundingFromProfile(record.inflow));
      this.pendingEnv = { th, qv, u, v, psfc: record.inflow[0][0] * 100, tau: C.ENV_TAU };
    }
  }

  // where the storm is fed (EngineRun.liftSpot); box metres, or null
  liftSpot() {
    const m = this.model;
    const { nx, ny, dx, SX, SXY } = m;
    const w = m.f('w'), th = m.f('th');
    const k = this.k3;
    const ti = Math.floor(nx / 2), tj = Math.floor(0.45 * ny);
    let best = C.UPDRAFT_W, bi = 0, bj = 0;
    for (let j = Math.max(3, tj - 16); j <= Math.min(ny - 2, tj + 16); j++)
      for (let i = Math.max(3, ti - 16); i <= Math.min(nx - 2, ti + 16); i++) {
        let sum = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) sum += w[(i + di + 2) + (j + dj + 1) * SX + (k + 1) * SXY];
        if (sum / 9 > best) { best = sum / 9; bi = i; bj = j; }
      }
    if (bi === 0) return null;
    const zc = m.lev('zc'), u0 = m.lev('u0'), v0 = m.lev('v0');
    const um = m.umove, vm = m.vmove;
    let su = 0, sv = 0, n = 0;
    for (let kk = 1; kk <= m.nz; kk++) {
      if (zc[kk + LOFF] > 1000) break;
      su += u0[kk + LOFF] - um;
      sv += v0[kk + LOFF] - vm;
      n++;
    }
    su /= n; sv /= n;
    const sr = Math.sqrt(su * su + sv * sv);
    if (sr < 0.5) return [(bi - 0.5) * dx, (bj - 0.5) * dx];
    const ex = -su / sr, ey = -sv / sr;
    let x = (bi - 0.5) * dx, y = (bj - 0.5) * dx;
    const t0 = m.lev('th0')[1 + LOFF];
    for (let s = 0; s < 40; s++) {
      const ci = Math.min(nx, Math.max(1, Math.floor(x / dx) + 1));
      const cj = Math.min(ny, Math.max(1, Math.floor(y / dx) + 1));
      if (th[(ci + 2) + (cj + 1) * SX + 2 * SXY] - t0 > C.WARM_K) return [x + ex * C.INTO_WARM, y + ey * C.INTO_WARM];
      x += ex * 500;
      y += ey * 500;
    }
    return [x, y];
  }

  step() {
    const m = this.model, rec = this.record;
    const t = m.time;
    const alive = !this.ended && rec.active !== false;
    if (this.pendingEnv && t >= C.START) {
      m.setEnv(this.pendingEnv);
      this.pendingEnv = null;
    }
    if (t >= this.nextMin) {
      this.nextMin += 60;
      if (this.useCold && alive) this.coldMean = m.coldPoolRate(rec.coldPoolK ?? 0, C.COLD_TAU);
      else m.cpRate = 0;
    }
    if (t >= 15 * 60) {
      if (this.liftAt === 'inflow') {
        const ox = m.ox, oy = m.oy;
        this.lx -= (ox - this.lox) * m.dx;
        this.ly -= (oy - this.loy) * m.dx;
        this.lox = ox; this.loy = oy;
        if (t >= this.nextSpot) {
          this.nextSpot = t + 60;
          const spot = this.liftSpot();
          if (spot) {
            const ddx = spot[0] - this.lx, ddy = spot[1] - this.ly;
            const d = Math.sqrt(ddx * ddx + ddy * ddy);
            const f = d > C.LIFT_SPEED ? C.LIFT_SPEED / d : 1;
            this.lx += f * ddx;
            this.ly += f * ddy;
          }
        }
      }
      m.setDrive(1, alive ? { x: this.lx, y: this.ly, inBox: true, r: this.liftR, z: 1500, rz: 1500, w: this.lift * (rec.intensity ?? 0), tau: C.LIFT_TAU, t1: Infinity, ramp: 0 } : null);
      if (this.torLift > 0 && alive && rec.tornado) {
        const [zm, bi, bj] = mesoNear(m, this.k1, Math.floor(m.nx / 2), Math.floor(0.45 * m.ny), 12);
        if (zm > 0.005) m.setDrive(2, { x: (bi - 0.5) * m.dx, y: (bj - 0.5) * m.dx, inBox: true, r: 2500, z: 700, rz: 700, w: this.torLift * Math.min(1, (rec.tornado.mph ?? 0) / 100), tau: C.LIFT_TAU, t1: t + 60, ramp: 0 });
      }
    }
    if (this.useNest && !this.nest && t >= C.NEST_START) {
      const [i0, j0] = m.placeNest(48, 4);
      this.nest = m.addNest({ nx: 48, ny: 48, ratio: 4, steps: 2, i0, j0 });
    }
    m.nestStep();
  }

  // an exported engine scenario replayed as the game would get it (EngineRun.fromScenario)
  static fromScenario(data, opts = {}) {
    const focus = data.meta.focusStorm;
    let storm = data.storms[0];
    for (const s of data.storms) if (s.id === focus) storm = s;
    let best = Infinity, startRows = null;
    for (const c of data.cells) {
      const d = (c.pos[0] - storm.pos[0]) ** 2 + (c.pos[1] - storm.pos[1]) ** 2;
      if (d < best) { best = d; startRows = c.sounding; }
    }
    const record = p => ({ motion: p.motion, intensity: p.intensity, coldPoolK: p.coldPoolK, tornado: p.tornado, active: p.active, inflow: p.inflow, updraftMs: storm.updraftMs });
    const o = { ...opts };
    o.startRows = o.startRows ?? startRows;
    const run = new EngineRun(record(data.track[0]), o);
    run.scenario = { data, storm, record, nextRec: 5 * 60 };
    return run;
  }

  replayStep() {
    const sc = this.scenario;
    if (this.model.time >= sc.nextRec) {
      const p = sc.data.track[Math.floor(sc.nextRec / 300)];
      sc.nextRec += 5 * 60;
      this.update(p && p.active !== false ? sc.record(p) : null);
    }
    this.step();
  }

  trackNow() {
    const tr = this.scenario.data.track;
    return tr[Math.min(tr.length - 1, Math.floor(this.model.time / 300))];
  }
}

// a stormlab scenario file (roblox/src/stormlab/data/<name>.luau: JSON inside [==[ ]==])
export function readScenarioText(text) {
  return JSON.parse(text.match(/\[==\[([\s\S]*)\]==\]/)[1]);
}
