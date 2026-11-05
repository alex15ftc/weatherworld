// The cloud model for the storm workers: the C core (native/cloudmodel/cloudmodel.c, built to
// cloudmodel.wasm) with the base state, soundings and field access in JavaScript. A port of
// roblox/src/cloudlab/shared/Model/CloudModel.luau, Nest.luau and Sounding.luau, which stay the
// reference and the Studio lab's model (docs/cloudlab/STATUS.md round 15).
//
// Fields are read straight from the module's memory, 1-based and laid out like the Luau's:
//   m.f('w')[n], n = m.idx(i, j, k); levels m.lev('zc')[k + LOFF]
// (views are rebuilt whenever the module's memory grows; don't keep them across a step)
import { readFileSync } from 'node:fs';

const WASM_URL = new URL('./cloudmodel.wasm', import.meta.url);
export const LOFF = 2;
const G = 9.81, CP = 1004.0, RD = 287.04, P00 = 1e5;
const KAPPA = RD / CP;
const FIELDS = ['u', 'v', 'w', 'p', 'th', 'qv', 'qc', 'qr', 'qh', 'qsn'];
const GRID_ID = { B: 30, rainSfc: 31, hailSfc: 32 };
FIELDS.forEach((f, q) => { GRID_ID[f] = q; GRID_ID[f + 'S'] = 10 + q; GRID_ID['R' + f] = 20 + q; });
const LEV_ID = { zf: 40, zc: 41, dzc: 42, dzw: 43, th0: 44, qv0: 45, u0: 46, v0: 47, pi0: 48, p0: 49, rho0: 50, rhow: 51, lapTh: 52, lapQv: 53, lapU: 54, lapV: 55, envTh: 56, envQv: 57, envU: 58, envV: 59 };
const SCALAR = { time: 0, umove: 1, vmove: 2, ox: 3, oy: 4, stormI: 5, stormJ: 6, uhMax: 7, cpRate: 8, psfc: 9, dx: 10, dt: 11, nx: 12, ny: 13, nz: 14, SX: 15, SXY: 16, N: 17, X0: 18, Y0: 19, i0: 20, j0: 21, ztop: 22, zdamp: 23, cd: 24, driveOn: 25, drive2On: 26, K: 27, Kh: 28, ratio: 29 };

let shared = null;
// One module instance per thread (a worker runs one storm; several models can share it).
export function loadModule() {
  if (shared) return shared;
  const mod = new WebAssembly.Module(readFileSync(WASM_URL));
  let inst = null;
  const wasi = {
    // (malloc's only import: fill with pseudo-random bytes; nothing depends on them)
    random_get(ptr, len) { const b = new Uint8Array(inst.exports.memory.buffer, ptr, len); for (let i = 0; i < len; i++) b[i] = (i * 151 + 17) & 255; return 0; },
  };
  inst = new WebAssembly.Instance(mod, { wasi_snapshot_preview1: new Proxy(wasi, { get: (t, k) => t[k] ?? (() => 52) }) });
  inst.exports._initialize?.();
  shared = inst.exports;
  return shared;
}

export function satMix(p, T) {
  return 380.2 / p * Math.exp(17.27 * (T - 273.15) / (T - 35.86));
}

function faceHeights(cfg) {
  if (cfg.zf) return cfg.zf.slice();
  const zf = [undefined, 0];
  if (cfg.dzmin) {
    let dz = cfg.dzmin;
    const top = cfg.ztop ?? 16000;
    let k = 1;
    while (zf[k] < top - 1) {
      zf[k + 1] = zf[k] + dz;
      k++;
      dz = Math.min(cfg.dzmax ?? 700, dz * (cfg.stretch ?? 1.12));
    }
  } else {
    for (let k = 1; k <= cfg.nz; k++) zf[k + 1] = k * cfg.dz;
  }
  return zf;
}

export class CloudModel {
  constructor(ex, ptr) {
    this.ex = ex;
    this.ptr = ptr;
    this.buf = null;
    this.views = {};
    for (const k of ['nx', 'ny', 'nz', 'SX', 'SXY', 'N', 'dx', 'dt']) this[k] = ex.cm_get(ptr, SCALAR[k]);
  }

  // CloudModel.new: cfg as the Luau's Config; snd a sounding (Sounding.fromProfile)
  static create(cfg, snd) {
    const ex = loadModule();
    const zf = faceHeights(cfg);
    const nz = zf.length - 2;
    const K = cfg.K ?? 75;
    const ptr = ex.cm_new(cfg.nx, cfg.ny, nz, cfg.dx, cfg.dt ?? 6, cfg.cs ?? 150, K, cfg.Kh ?? K, cfg.umove ?? 0, cfg.vmove ?? 0,
      cfg.zdamp ?? NaN, cfg.z0 ?? 0.1, cfg.follow === false ? 0 : 1, cfg.hail === false ? 0 : 1, cfg.n0h ?? 4e4, cfg.autoToIce === true ? 1 : 0);
    const m = new CloudModel(ex, ptr);
    const zfv = m.lev('zf');
    for (let k = 1; k <= nz + 1; k++) zfv[k + LOFF] = zf[k];
    ex.cm_metrics(ptr);
    const { th, qv, u, v } = m.profiles(snd);
    const names = ['th0', 'qv0', 'u0', 'v0'];
    [th, qv, u, v].forEach((arr, q) => { const t = m.lev(names[q]); for (let k = 1; k <= nz; k++) t[k + LOFF] = arr[k]; });
    ex.cm_base(ptr, snd.psfc);
    return m;
  }

  // a typed-array view of a grid field (1-based, length N + 1)
  f(name) {
    this.check();
    let v = this.views[name];
    if (!v) {
      const len = name === 'rainSfc' || name === 'hailSfc' ? this.SXY + 1 : this.N + 1;
      v = this.views[name] = new Float64Array(this.ex.memory.buffer, this.ex.cm_ptr(this.ptr, GRID_ID[name]), len);
    }
    return v;
  }

  // a typed-array view of a level array (level k at k + LOFF)
  lev(name) {
    this.check();
    const key = 'L' + name;
    let v = this.views[key];
    if (!v) v = this.views[key] = new Float64Array(this.ex.memory.buffer, this.ex.cm_ptr(this.ptr, LEV_ID[name]), this.nz + 12);
    return v;
  }

  check() {
    if (this.buf !== this.ex.memory.buffer) { this.buf = this.ex.memory.buffer; this.views = {}; }
  }

  get(name) { return this.ex.cm_get(this.ptr, SCALAR[name]); }
  get time() { return this.get('time'); }
  get umove() { return this.get('umove'); }
  get vmove() { return this.get('vmove'); }
  get ox() { return this.get('ox'); }
  get oy() { return this.get('oy'); }
  get stormI() { return this.get('stormI') || null; }
  get stormJ() { return this.get('stormJ') || null; }
  get uhMax() { return this.get('uhMax'); }
  get X0() { return this.get('X0'); }
  get Y0() { return this.get('Y0'); }
  get i0() { return this.get('i0'); }
  get j0() { return this.get('j0'); }
  feedJump(name) { return this.ex.cm_get(this.ptr, 30 + FIELDS.indexOf(name)); }

  idx(i, j, k) { return (i + 2) + (j + 1) * this.SX + (k + 1) * this.SXY; }
  levelAt(z) { return this.ex.cm_level_at(this.ptr, z); }
  zeta(i, j, k) { return this.ex.cm_zeta(this.ptr, i, j, k); }

  // A sounding's theta, water vapour and wind at the cell centres (1..nz) (CloudModel.profiles)
  profiles(snd) {
    const nz = this.nz, zcv = this.lev('zc');
    const th0 = [], qv0 = [], u0 = [], v0 = [];
    const piS = (snd.psfc / P00) ** KAPPA;
    for (let it = 0; it < 3; it++) {
      let piPrev = piS, zPrev = 0, thvPrev = null;
      for (let k = 1; k <= nz; k++) {
        const z = zcv[k + LOFF];
        const th = snd.theta(z);
        const thv = th * (1 + 0.61 * (qv0[k] ?? 0));
        const tv0 = thvPrev ?? snd.theta(0) * (1 + 0.61 * (qv0[1] ?? 0));
        const pik = piPrev - G / CP * (z - zPrev) / (0.5 * (thv + tv0));
        th0[k] = th;
        const pk = P00 * pik ** (1 / KAPPA);
        qv0[k] = Math.min(snd.qvMax, snd.rh(z) * satMix(pk, th * pik));
        piPrev = pik; zPrev = z; thvPrev = thv;
      }
    }
    for (let k = 1; k <= nz; k++) [u0[k], v0[k]] = snd.wind(zcv[k + LOFF]);
    return { th: th0, qv: qv0, u: u0, v: v0 };
  }

  // the engine's newest air: env = { th, qv, u, v (1..nz), tau, psfc }; null clears it
  setEnv(env) {
    if (!env) { this.ex.cm_set_env(this.ptr, 0, 0, 0, 0); return; }
    const names = ['envTh', 'envQv', 'envU', 'envV'];
    [env.th, env.qv, env.u, env.v].forEach((arr, q) => { const t = this.lev(names[q]); for (let k = 1; k <= this.nz; k++) t[k + LOFF] = arr[k]; });
    this.ex.cm_set_env(this.ptr, 1, env.tau, env.psfc ?? 0, env.psfc != null ? 1 : 0);
  }

  setMotion(um, vm) { this.ex.cm_set_motion(this.ptr, um, vm); }
  coldPoolRate(targetK, tau) { return this.ex.cm_cold_pool_rate(this.ptr, targetK, tau); }
  set cpRate(x) { this.ex.cm_set(this.ptr, 8, x); }
  get cpRate() { return this.get('cpRate'); }

  // a drive (CloudModel.applyDrive's table; null turns it off); which 1 or 2
  setDrive(which, d) {
    if (!d) { this.ex.cm_set_drive(this.ptr, which, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0); return; }
    const hasO = d.ox != null || d.oy != null;
    this.ex.cm_set_drive(this.ptr, which, 1, d.x, d.y, hasO ? 1 : 0, d.ox ?? 0, d.oy ?? 0, d.inBox ? 1 : 0, d.r, d.z, d.rz, d.w, d.tau, d.t1, d.ramp);
  }

  step() { this.ex.cm_step(this.ptr); }
  followStorm() { this.ex.cm_follow_storm(this.ptr); }
  // one step of the model and its nest (Nest.step)
  nestStep() { this.ex.cm_nest_step(this.ptr); }

  // Nest.place: the south-west corner cell for a nest of nxn cells at ratio
  placeNest(nxn, ratio) {
    const r = this.ex.cm_nest_place(this.ptr, nxn, ratio);
    return [r % 65536, Math.floor(r / 65536)];
  }

  // Nest.new
  addNest({ nx = 48, ny = 48, ratio = 4, steps = ratio, i0, j0, vortex = 0.01 }) {
    const ptr = this.ex.cm_nest_new(this.ptr, nx, ny, ratio, steps, i0, j0, vortex);
    const nest = new CloudModel(this.ex, ptr);
    nest.parent = this;
    this.child = nest;
    return nest;
  }
}

// Nest.diag: near-ground vortex diagnostics of a nest
export function nestDiag(nest) {
  let zmax = 0, zi = 0, zj = 0, pmin = 0, vmax = 0;
  const um = nest.umove, vm = nest.vmove;
  const u = nest.f('u'), v = nest.f('v'), p = nest.f('p'), qc = nest.f('qc'), th = nest.f('th');
  const zf = nest.lev('zf'), th0 = nest.lev('th0');
  for (let j = 3; j <= nest.ny - 1; j++) for (let i = 3; i <= nest.nx - 1; i++) {
    const z = nest.zeta(i, j, 1);
    if (z > zmax) { zmax = z; zi = i; zj = j; }
    const n = nest.idx(i, j, 1);
    if (p[n] < pmin) pmin = p[n];
    const uu = 0.5 * (u[n] + u[n + 1]) + um, vv = 0.5 * (v[n] + v[n + nest.SX]) + vm;
    const s = Math.sqrt(uu * uu + vv * vv);
    if (s > vmax) vmax = s;
  }
  let zlow = Infinity;
  const med = [];
  for (let j = 3; j <= nest.ny - 2; j++) for (let i = 3; i <= nest.nx - 2; i++) {
    for (let k = 1; k <= nest.nz; k++) {
      if (qc[nest.idx(i, j, k)] > 1e-4) {
        const zb = zf[k + LOFF];
        if (zb < zlow) zlow = zb;
        med.push(zb);
        break;
      }
    }
  }
  med.sort((a, b) => a - b);
  const base = med[Math.max(1, Math.floor(med.length / 2)) - 1] ?? 0;
  let mean = 0, nm = 0, plo = Infinity;
  for (let j = 3; j <= nest.ny - 2; j++) for (let i = 3; i <= nest.nx - 2; i++) { mean += p[nest.idx(i, j, 1)]; nm++; }
  mean /= nm;
  for (let j = Math.max(1, zj - 2); j <= Math.min(nest.ny, zj + 2); j++) for (let i = Math.max(1, zi - 2); i <= Math.min(nest.nx, zi + 2); i++) plo = Math.min(plo, p[nest.idx(i, j, 1)]);
  const nv = nest.idx(Math.max(1, zi), Math.max(1, zj), 1);
  return { zeta: zmax, i: zi, j: zj, pmin, pdrop: mean - plo, thv: th[nv] - th0[1 + LOFF], vmax, cloudLow: zlow < Infinity ? zlow : 0, cloudBase: base };
}

// ---- soundings (Sounding.luau) ---------------------------------------------------------------

// An engine sounding (js/game/LabWindow.js rows, surface first: [p hPa, T C, Td C, u, v]) as the
// model's base state (Sounding.fromProfile)
export function soundingFromProfile(rows) {
  const EPS = 0.622, KAP = 287.04 / 1004;
  const es = tc => 6.112 * Math.exp(17.67 * tc / (tc + 243.5));
  const zs = [], ths = [], rhs = [], us = [], vs = [];
  let z = 0;
  const tv = row => { const e = es(row[2]); const w = EPS * e / (row[0] - e); return (row[1] + 273.15) * (1 + 0.61 * w); };
  rows.forEach((r, n) => {
    const [p, t, td] = r;
    if (n > 0) {
      const q = rows[n - 1];
      z += 287.04 * 0.5 * (tv(q) + tv(r)) / 9.81 * Math.log(q[0] / p);
    }
    zs[n] = z;
    ths[n] = (t + 273.15) * (1000 / p) ** KAP;
    rhs[n] = Math.min(1, Math.max(0.01, es(td) / es(t)));
    us[n] = r[3]; vs[n] = r[4];
  });
  const nr = rows.length;
  const at = (arr, zz, extrapolate) => {
    if (zz <= zs[0]) return arr[0];
    for (let n = 1; n < nr; n++) {
      if (zz <= zs[n]) { const a = (zz - zs[n - 1]) / (zs[n] - zs[n - 1]); return arr[n - 1] + a * (arr[n] - arr[n - 1]); }
    }
    if (extrapolate) { const g = (arr[nr - 1] - arr[nr - 2]) / (zs[nr - 1] - zs[nr - 2]); return arr[nr - 1] + g * (zz - zs[nr - 1]); }
    return arr[nr - 1];
  };
  return {
    theta: zz => at(ths, zz, true),
    rh: zz => at(rhs, zz, false),
    wind: zz => [at(us, zz, false), at(vs, zz, false)],
    qvMax: 1,
    psfc: rows[0][0] * 100,
    ztop: zs[nr - 1],
  };
}
