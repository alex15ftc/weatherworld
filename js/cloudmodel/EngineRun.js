// One engine storm shown by the cloud model: a port of roblox/src/cloudlab/shared/Model/EngineRun.luau
// (its header explains the steering) on the WebAssembly model. The nest runs in the same process:
// the native model is fast enough that NestRemote's second process isn't needed.
//   const run = new EngineRun(record, opts); run.update(record | null); run.step()
//   EngineRun.fromScenario(data, opts); run.replayStep()
import { CloudModel, LOFF, soundingFromProfile, memorySnapshot, restoreMemory, nestDiag } from './CloudModel.js';

export const ENGINE_RUN = {
  NEST_START: 30 * 60,
  START: 15 * 60,
  UPDRAFT_Z: 3000,
  UPDRAFT_W: 3,
  WARM_K: -0.5,
  INTO_WARM: 1500,
  COLD_K: 1, // ground air this much below the environment is the cold pool (as the model's own)
  LIFT_SPEED: 2000,
  LIFT_TAU: 5,
  ENV_TAU: 15 * 60,
  COLD_TAU: 10 * 60,
  // the lift as a push (opts.lift 'push', the default): an upward acceleration in a ball PUSH_R
  // across at 0-3 km, at most PUSH_MAX (m/s^2 at its middle; 0.03 is the buoyancy of about 1 K),
  // set once a model minute from the gap between the model's peak updraft near the storm and the
  // engine's updraftMs: PUSH_TAU is how long a whole gap takes to swing it from none to PUSH_MAX.
  // Tuned on seed 2's first storms (tools/cloudlab/synccheck.mjs): weaker or narrower pushes let
  // storms die, stronger or quicker ones swing between nothing and full and overshoot. With the
  // convergence lift (liftRows) 0.35 beat 0.2 (2026-11-05, seed 2's first 3 storms over 3 h): no
  // near-gone readings (was 2/1/2), rotating 14/17/9 of 18 (11/11/5), rotation r with the engine's
  // meso 0.45/0.57/0.25 (0.48/-0.32/0.26). Narrower pushes (3-5 km) let SupercellB die.
  PUSH_MAX: 0.35,
  // with the engine's maintenance lift in the record (record.maintenance, js/storms/StormMaintenance.js,
  // added to the convergence lift) the push only trims: seed 2 and 5150, 3 storms x 3 h, 0.25 kept
  // the storms alive as 0.35 did without it and tracked the engine's strength, updraft and rotation
  // more closely (0.2 let them fade more and miss further; 2026-11-05). Records without it (lab
  // scenarios) keep PUSH_MAX.
  PUSH_MAX_M2: 0.25,
  PUSH_TAU: 8 * 60,
  PUSH_R: 8000,
  // hail (steerHail): once a model minute the model's biggest stone at the ground (the size that
  // about one stone in HAIL_T seconds on a square metre reaches, from its own size distribution
  // and fall speed) is set against the engine's hail size by moving the distribution's intercept:
  // a whole factor-of-e gap in HAIL_TAU. Within N0H_RANGE (m^-4; 0.4-4.5 inch stones at 0.2-4
  // g/kg); hail held aloft but melting before the ground counts as stones too small
  HAIL_T: 600,
  HAIL_TAU: 10 * 60,
  HAIL_QMIN: 1e-5,
  N0H_RANGE: [1e2, 4e5],
  // the tornado (steerTornado), while the engine has one down: a 62.5 m nest (FINE, 2 km across)
  // starts in the 250 m nest on its strongest 50 m spin and follows it; an upward push (a ball
  // TOR_R across at 0-2 TOR_Z, at most TOR_PUSH_MAX m/s^2 at its middle) sits under the finest
  // nest's strongest 50 m spin, stretching it, set once a model minute from the gap between that
  // nest's peak ground wind and the engine's tornado wind (TOR_PUSH_TAU, as PUSH_TAU)
  FINE: { nx: 32, ratio: 4, steps: 4, vortex: 0.03 },
  // Tuned on SupercellB's tornado (2026-11-05): 0.25-1 m/s^2, or a 500 m ball, made no tornado;
  // 2 in a 1 km ball made 76-85 mph, 0.6-0.8 /s at 50 m, a 10-12 hPa low (62.5 m can't hold much
  // more: the engine's 141-185 mph is beyond it); 3 in 700 m, 55-59 mph. 5 min was too slow to
  // build for a tornado of a few minutes. Low (TOR_Z 400: 0-800 m) beat 750 once the nests kept
  // their vortex (keepPlace): SupercellB 10 min at 60-93 mph, spin to 0.86 /s, a 14 hPa low;
  // SupercellLife 12 min of spin over 0.1 /s at 48-61 mph (the engine's 78-83)
  TOR_R: 1000,
  TOR_Z: 400,
  TOR_PUSH_MAX: 2,
  TOR_PUSH_TAU: 2 * 60,
  // the push answers the gust TOR_LEAD model minutes ahead (now plus its last minute's change x
  // TOR_LEAD), not the gust now: a vortex keeps spinning up for minutes after the push that made
  // it, so steering by the gust now overshot (58 m/s against the engine's 38) and rang - the
  // model's tornado formed, overshot, collapsed and came back every 10-20 min (2026-11-05; with the
  // nests holding it, SupercellLife 85 mph within 25% 24 -> 29 of 36 min, SupercellB 110 no change)
  TOR_LEAD: 2,
  // the engine's tornado wind is an EF-scale peak (3 s) gust; the model's is its strongest cell
  // mean at the lowest level: the push compares the engine's with TOR_GUST x the model's (peak
  // gusts over land run 1.3-1.5 x the mean wind)
  TOR_GUST: 1.4,
  // The tornado's shape for the frames (tornadoShape; docs/cloudlab/STATUS.md "Tornado shape"):
  // the model gives where the vortex is at each height of TOR_LEVELS (m; its strongest spin within
  // the height step of the height below's - a lean of at most 45 degrees a step, 2 cells at least)
  // and the cloud base over it (lowest within TOR_SEARCH); the
  // engine gives its strength, which the 62.5 m grid can't hold: a Rankine core whose outer wind
  // falls to EF0's TOR_EF0_MPH at the edge of the engine's damage path, swirling at the engine's
  // peak wind less the storm's motion, in cyclostrophic balance (centre drop rho v^2), and the
  // condensation funnel where that drop reaches the cloud base's (rho g (base - z)).
  TOR_LEVELS: [50, 250, 500, 750, 1000, 1500, 2000, 3000],
  // Large-scale rising air (liftRows): the engine's surface convergence C at the inflow point lifts
  // the inflow air before the model gets it - each level takes the air from w(z) LIFT_S below,
  // w = C z up to LIFT_H, falling to 0 at LIFT_TOP (divergence sinks it). The box's uniform
  // environment has no mesoscale ascent, and under a cap (the engine's -50 to -100 J/kg) the model's
  // storms died in 40-100 min while the engine's lived: SupercellLife lifted by its own 7e-5 /s
  // lived the whole 140 min unsteered (2026-11-05). LIFT_S: about the time the inflow air takes
  // through one engine cell.
  LIFT_S: 3600,
  LIFT_H: 1500,
  LIFT_TOP: 6000,
  // the tornado is the finest nest's strongest spin averaged from the ground to TOR_COLUMN (m): a
  // column joining the ground to the storm, not a ground swirl alone (the strongest 50 m spin was
  // often inflow at the nest's edge from the coarser grid, with the column elsewhere: SupercellB)
  TOR_COLUMN: 1000,
  TOR_SEARCH: 500,
  TOR_EF0_MPH: 65,
  // (FINE.K, the fine nest's own vertical mixing, can be set; lighter mixing (19 or 4.7 m^2/s
  // against 75) made weaker, shorter tornadoes on both test storms, so it is left as the box's)
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

// A nest's strongest spin averaged from the ground to TOR_COLUMN: { i, j, zeta } (i 0: none).
// The sounding rows (p hPa, t, td C, u, v m/s) lifted by the convergence conv (1e-5 /s): each
// level (but the ground) gets the potential temperature and mixing ratio of the air dz = w(z)
// LIFT_S below it (above, for divergence), its mixing ratio at most saturation there. conv 0 or
// missing: the rows as they are.
export function liftRows(rows, conv) {
  if (!rows || !conv) return rows;
  const Rd = 287.04, Cp = 1005.7, g = 9.81, eps = 0.622, kap = Rd / Cp;
  const es = t => 6.112 * Math.exp(17.67 * t / (t + 243.5));
  const mix = (p, t) => eps * es(t) / (p - es(t));
  const n = rows.length, zs = [0], th = [], q = [];
  for (let k = 1; k < n; k++) zs.push(zs[k - 1] + Rd * (0.5 * (rows[k][1] + rows[k - 1][1]) + 273.15) / g * Math.log(rows[k - 1][0] / rows[k][0]));
  for (let k = 0; k < n; k++) { th.push((rows[k][1] + 273.15) * Math.pow(1000 / rows[k][0], kap)); q.push(mix(rows[k][0], rows[k][2])); }
  const at = (arr, z) => {
    if (z <= 0) return arr[0];
    for (let k = 1; k < n; k++) if (zs[k] >= z) return arr[k - 1] + (z - zs[k - 1]) / (zs[k] - zs[k - 1]) * (arr[k] - arr[k - 1]);
    return arr[n - 1];
  };
  const c = conv * 1e-5, H = C.LIFT_H, Z1 = C.LIFT_TOP;
  const out = [rows[0]];
  for (let k = 1; k < n; k++) {
    const z = zs[k], p = rows[k][0];
    const w = z <= H ? c * z : z < Z1 ? c * H * (Z1 - z) / (Z1 - H) : 0;
    const from = z - w * C.LIFT_S;
    const thn = at(th, from), t = thn * Math.pow(p / 1000, kap) - 273.15;
    const qn = Math.min(at(q, from), mix(p, t));
    const e = qn * p / (eps + qn), lg = Math.log(e / 6.112);
    out.push([p, t, Math.min(t, 243.5 * lg / (17.67 - lg)), rows[k][3], rows[k][4]]);
  }
  return out;
}

// The model's own rotation point (the worker's status pin, tools/cloudlab/synccheck.mjs; nothing is
// moved by it since 2026-11-06): the model's tornado at
// the ground while it has one, else the strongest 0-1 km mean spin in the finest grid it has (the
// 250 m nest, or the box), from the box's follow point (CloudModel followStorm): { east, north } km,
// zeta (1/s), tornado (bool); or null. (Read only - the feed side's, not in the Luau twin.)
export function pinPoint(run) {
  const m = run.model, fx = (Math.floor(0.5 * m.nx) - 0.5) * m.dx, fy = (Math.floor(0.45 * m.ny) - 0.5) * m.dx;
  const t = run.torShape;
  if (t?.found) return { east: (t.x - (m.ox - t.ox) * m.dx - fx) / 1000, north: (t.y - (m.oy - t.oy) * m.dx - fy) / 1000, zeta: t.zeta, tornado: true };
  const n = run.nest, c = columnSpin(n ?? m);
  if (!(c.i > 0)) return null;
  const x = n ? (n.get('i0') - 1) * m.dx + (c.i - 0.5) * n.dx : (c.i - 0.5) * m.dx;
  const y = n ? (n.get('j0') - 1) * m.dx + (c.j - 0.5) * n.dx : (c.j - 0.5) * m.dx;
  return { east: (x - fx) / 1000, north: (y - fy) / 1000, zeta: c.zeta, tornado: false };
}

export function columnSpin(top) {
  const kt = Math.max(1, top.levelAt(C.TOR_COLUMN));
  let best = 0, bi = 0, bj = 0;
  for (let j = 2; j <= top.ny - 1; j++) for (let i = 2; i <= top.nx - 1; i++) {
    let s = 0;
    for (let k = 1; k <= kt; k++) s += top.zeta(i, j, k);
    s /= kt;
    if (s > best) { best = s; bi = i; bj = j; }
  }
  return { i: bi, j: bj, zeta: best };
}

export class EngineRun {
  constructor(record, opts = {}) {
    const o = opts;
    // 'push' (the default; ENGINE_RUN.PUSH_MAX) or a number: the old pull, w eased up to that many
    // m/s times the engine's intensity in the ball within LIFT_TAU (kept to compare against)
    this.lift = o.lift ?? 'push';
    this.pushMax = record.maintenance != null ? C.PUSH_MAX_M2 : C.PUSH_MAX;
    this.push = 0.5 * this.pushMax;
    this.wNow = 0;
    this.pushR = o.pushR ?? C.PUSH_R;
    this.liftR = o.liftR ?? 10000;
    // 'push' (the default; steerTornado) or a number: the old pull, w eased up to that many m/s x
    // min(1, mph/100) in a 2.5 km ball at 0-1.4 km under the box's strongest 1 km rotation
    this.torLift = o.torLift ?? 'push';
    this.useFine = o.fine !== false;
    this.fine = null;
    this.torPush = 0;
    this.torSpot = null;
    this.torWind = 0;
    this.useNest = o.nest !== false;
    this.useEnv = o.env !== false;
    this.useCold = o.cold !== false;
    const snd = soundingFromProfile(liftRows(o.startRows ?? record.inflow, (record.convergence ?? 0) + (record.maintenance ?? 0)));
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
      const { th, qv, u, v } = m.profiles(soundingFromProfile(liftRows(record.inflow, (record.convergence ?? 0) + (record.maintenance ?? 0))));
      this.pendingEnv = { th, qv, u, v, psfc: record.inflow[0][0] * 100, tau: C.ENV_TAU };
    }
  }

  // where the storm is fed (EngineRun.liftSpot); box metres, or null. From the strongest updraft
  // at UPDRAFT_Z near the box's storm point, or, with none (between pulses, or a storm that has
  // collapsed), from the middle of the cold pool weighted by how cold it is: either way it walks
  // into the low-level inflow to where the ground air is warm again (the gust front's warm side,
  // where a new cell starts) and INTO_WARM beyond. Without either, null (the lift stays put).
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
    let x = (bi - 0.5) * dx, y = (bj - 0.5) * dx;
    const t0 = m.lev('th0')[1 + LOFF];
    if (bi === 0) {
      let sw = 0, sx = 0, sy = 0;
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
        const d = t0 - th[(i + 2) + (j + 1) * SX + 2 * SXY];
        if (d > C.COLD_K) { sw += d; sx += d * (i - 0.5) * dx; sy += d * (j - 0.5) * dx; }
      }
      if (sw === 0) return null;
      x = sx / sw; y = sy / sw;
    }
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
    if (sr < 0.5) return [x, y];
    const ex = -su / sr, ey = -sv / sr;
    for (let s = 0; s < 40; s++) {
      const ci = Math.min(nx, Math.max(1, Math.floor(x / dx) + 1));
      const cj = Math.min(ny, Math.max(1, Math.floor(y / dx) + 1));
      if (th[(ci + 2) + (cj + 1) * SX + 2 * SXY] - t0 > C.WARM_K) return [x + ex * C.INTO_WARM, y + ey * C.INTO_WARM];
      x += ex * 500;
      y += ey * 500;
    }
    return [x, y];
  }

  // The push's strength: the model's peak updraft (any height, within 16 km of the box's storm
  // point, where liftSpot looks) against the engine's; a weaker model storm is pushed harder.
  steerPush(target) {
    const m = this.model, w = m.f('w');
    const { nx, ny, nz, SX, SXY } = m;
    const ti = Math.floor(nx / 2), tj = Math.floor(0.45 * ny);
    let wmax = 0;
    for (let k = 1; k <= nz; k++)
      for (let j = Math.max(1, tj - 16); j <= Math.min(ny, tj + 16); j++)
        for (let i = Math.max(1, ti - 16); i <= Math.min(nx, ti + 16); i++) {
          const v = w[(i + 2) + (j + 1) * SX + (k + 1) * SXY];
          if (v > wmax) wmax = v;
        }
    this.wNow = wmax;
    if (!(target > 0)) { this.push = 0; return; }
    const gap = Math.max(-1, Math.min(1, (target - wmax) / target));
    this.push = Math.max(0, Math.min(this.pushMax, (this.push ?? 0.5 * this.pushMax) + this.pushMax * gap * 60 / C.PUSH_TAU));
  }

  // The model's biggest stone at the ground (m), where it has the most ground hail; 0 with hail
  // only aloft; null with none. N(D) = n0 e^(-lam D) falling at c sqrt(D): the stones larger than
  // D reaching a square metre in HAIL_T are (n0 / lam) e^(-lam D) c sqrt(D) HAIL_T; D where that is 1.
  hailSize() {
    const m = this.model, qh = m.f('qh');
    const { nx, ny, nz, SX, SXY } = m;
    const rho = m.lev('rho0');
    let q = 0, aloft = 0;
    for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
      const col = (i + 2) + (j + 1) * SX;
      q = Math.max(q, qh[col + 2 * SXY]);
      for (let k = 2; k <= nz; k++) aloft = Math.max(aloft, qh[col + (k + 1) * SXY]);
    }
    if (q < C.HAIL_QMIN) return aloft >= 10 * C.HAIL_QMIN ? 0 : null;
    const n0 = m.n0h, r = rho[1 + LOFF];
    const lam = Math.pow(Math.PI * 900 * n0 / (r * q), 0.25), c = Math.sqrt(4 * 9.81 * 900 / (1.8 * r));
    let D = 10 / lam;
    for (let k = 0; k < 20; k++) D = Math.max(1e-4, (Math.log(n0 * c * C.HAIL_T / lam) + 0.5 * Math.log(D)) / lam);
    return D;
  }

  // The hail intercept steered toward the engine's hail size (both models: the nest's too).
  steerHail(inches) {
    const m = this.model;
    const D = this.hailSize();
    this.hailNow = D;
    if (D == null || !(inches > 0)) return;
    const f = D > 0 ? Math.max(-1, Math.min(1, Math.log(inches * 0.0254 / D))) : 1;
    // the biggest stone goes as n0^(-1/4): a factor e in size is a factor e^4 in n0
    const n0 = Math.max(C.N0H_RANGE[0], Math.min(C.N0H_RANGE[1], m.n0h * Math.exp(-4 * f * 60 / C.HAIL_TAU)));
    m.n0h = n0;
    if (this.nest) this.nest.n0h = n0;
  }

  // The tornado, once a model minute: with the engine's tornado down, the fine nest starts on the
  // 250 m nest's strongest 50 m spin, and the push is placed under the finest nest's strongest 50
  // m spin (box metres) and set from the gap between that nest's peak ground wind and the engine's
  // tornado wind. With none down the push is off and the model's vortex is left to itself.
  steerTornado(tornado) {
    const m = this.model;
    if (!tornado || !this.nest) { this.torPush = 0; this.torSpot = null; this.torShape = null; return; }
    if (this.useFine && !this.fine) {
      const d = nestDiag(this.nest), F = C.FINE, span = F.nx / F.ratio;
      const i0 = Math.max(3, Math.min(this.nest.nx - span - 2, d.i - Math.floor(span / 2)));
      const j0 = Math.max(3, Math.min(this.nest.ny - span - 2, d.j - Math.floor(span / 2)));
      this.fine = this.nest.addNest({ nx: F.nx, ny: F.nx, ratio: F.ratio, steps: F.steps, i0, j0, vortex: F.vortex });
      if (F.K != null) this.fine.K = F.K;
    }
    const top = this.fine ?? this.nest;
    const d = nestDiag(top), col = columnSpin(top);
    const prevWind = this.torWind;
    this.torWind = C.TOR_GUST * d.vmax;
    this.torShape = this.tornadoShape(tornado, top, d, col);
    if (col.i === 0) { this.torSpot = null; return; } // (no spin at all to stretch)
    // the spot in the box: the nests' corners (X0, Y0 in their parents) and the cell's middle
    let x = (col.i - 0.5) * top.dx, y = (col.j - 0.5) * top.dx;
    for (let n = top; n.parent; n = n.parent) { x += n.get('X0'); y += n.get('Y0'); }
    this.torSpot = [x, y, m.ox, m.oy];
    const target = (tornado.mph ?? 0) * 0.44704;
    if (!(target > 0)) { this.torPush = 0; return; }
    const ahead = this.torWind + (prevWind > 0 ? (this.torWind - prevWind) * C.TOR_LEAD : 0);
    const gap = Math.max(-1, Math.min(1, (target - ahead) / target));
    this.torPush = Math.max(0, Math.min(C.TOR_PUSH_MAX, this.torPush + C.TOR_PUSH_MAX * gap * 60 / C.TOR_PUSH_TAU));
  }

  // The tornado for the frames (FrameCodec TORNADO), from the finest nest top, its diag d and its
  // column spin col (read only: the model is not touched). Box metres; ox, oy the box's shift then
  // (frames move it on).
  tornadoShape(tornado, top, d, col) {
    const m = this.model;
    const found = col.i > 0;
    const corner = [0, 0];
    for (let n = top; n.parent; n = n.parent) { corner[0] += n.get('X0'); corner[1] += n.get('Y0'); }
    const ci = found ? col.i : Math.ceil(top.nx / 2), cj = found ? col.j : Math.ceil(top.ny / 2);
    const at = (i, j) => [corner[0] + (i - 0.5) * top.dx, corner[1] + (j - 0.5) * top.dx];
    const [x, y] = at(ci, cj);
    // the engine's core
    const rho = top.lev('rho0')[1 + LOFF], g = 9.81;
    const V = (tornado.mph ?? 0) * 0.44704, W = (tornado.yards ?? 0) * 0.9144;
    const swirl = Math.max(0, V - Math.hypot(m.umove, m.vmove));
    const R = V > 0 && W > 0 ? Math.max(10, Math.min(W / 2, (W / 2) * C.TOR_EF0_MPH * 0.44704 / V)) : 0;
    const P = rho * swirl * swirl;
    // the cloud base over the vortex (the wall cloud): lowest cloud within TOR_SEARCH
    const qc = top.f('qc'), zf = top.lev('zf'), reach = Math.ceil(C.TOR_SEARCH / top.dx);
    let base = Infinity;
    for (let j = Math.max(1, cj - reach); j <= Math.min(top.ny, cj + reach); j++) for (let i = Math.max(1, ci - reach); i <= Math.min(top.nx, ci + reach); i++) {
      if (Math.hypot(i - ci, j - cj) * top.dx > C.TOR_SEARCH) continue;
      for (let k = 1; k <= top.nz && zf[k + LOFF] < 4000; k++) if (qc[top.idx(i, j, k)] > 1e-4) { base = Math.min(base, zf[k + LOFF]); break; }
    }
    const cloud = base < Infinity;
    const tip = cloud ? Math.max(0, base - P / (rho * g)) : 0;
    // the funnel's radius at height z: where the core's drop reaches the drop that condenses there
    const funnel = z => {
      if (!cloud || R <= 0) return 0;
      if (z >= base) return C.TOR_SEARCH;
      const need = rho * g * (base - z);
      if (need >= P) return 0;
      const r = need >= P / 2 ? R * Math.sqrt(2 * (1 - need / P)) : R * Math.sqrt(P / (2 * need));
      return Math.min(C.TOR_SEARCH, r);
    };
    // the vortex by height: its strongest spin near the height below's centre
    const levels = [];
    let pi = ci, pj = cj, lost = !found, zPrev = C.TOR_LEVELS[0];
    for (const z of C.TOR_LEVELS) {
      const k = Math.max(1, top.levelAt(z));
      if (!lost && z > C.TOR_LEVELS[0]) {
        const lean = Math.max(2 * top.dx, z - zPrev), span = Math.ceil(lean / top.dx);
        let best = -Infinity, bi = pi, bj = pj;
        for (let j = Math.max(2, pj - span); j <= Math.min(top.ny - 1, pj + span); j++) for (let i = Math.max(2, pi - span); i <= Math.min(top.nx - 1, pi + span); i++) {
          if (Math.hypot(i - pi, j - pj) * top.dx > lean) continue;
          const zt = top.zeta(i, j, k);
          if (zt > best) { best = zt; bi = i; bj = j; }
        }
        // (at the nest's edge or no spin: the vortex has left the nest above here)
        if (!(best > 0) || bi <= 2 || bj <= 2 || bi >= top.nx - 1 || bj >= top.ny - 1) lost = true;
        else { pi = bi; pj = bj; }
      }
      zPrev = z;
      const [lx, ly] = at(pi, pj);
      levels.push({ z, dx: lx - x, dy: ly - y, found: !lost, funnel: funnel(z) });
    }
    const zeta = found ? col.zeta : 0, prev = this.torShape?.zeta ?? zeta;
    // the model's own drop at the column: the nest's mean lowest-level p' less the lowest within 2
    // cells (as nestDiag's, which takes it at the strongest 50 m spin)
    const p = top.f('p');
    let mean = 0, nm = 0, plo = Infinity;
    for (let j = 3; j <= top.ny - 2; j++) for (let i = 3; i <= top.nx - 2; i++) { mean += p[top.idx(i, j, 1)]; nm++; }
    mean /= nm;
    for (let j = Math.max(1, cj - 2); j <= Math.min(top.ny, cj + 2); j++) for (let i = Math.max(1, ci - 2); i <= Math.min(top.nx, ci + 2); i++) plo = Math.min(plo, p[top.idx(i, j, 1)]);
    const modelDrop = found ? Math.max(0, mean - plo) : 0;
    // (the engine's rating comes as "EF2")
    const ef = tornado.ef == null ? null : Number(String(tornado.ef).replace(/[^0-9]/g, ''));
    return { found, x, y, ox: m.ox, oy: m.oy, mph: tornado.mph ?? 0, yards: tornado.yards ?? 0, ef: Number.isFinite(ef) ? ef : null,
      R, drop: P, base: cloud ? base : 0, tip, gust: this.torWind, zeta, dzeta: zeta - prev, modelDrop, levels };
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
      // (the engine's cold pool: its deficit and, E2, its depth: js/storms/ColdPool.js)
      if (this.useCold && rec.coldPoolDepthM != null) m.cpTop = rec.coldPoolDepthM;
      if (this.useCold && alive) this.coldMean = m.coldPoolRate(rec.coldPoolK ?? 0, C.COLD_TAU);
      else m.cpRate = 0;
      if (alive && t >= C.START) this.steerPush(rec.updraftMs ?? 0);
      if (alive && t >= C.START && rec.hailIn != null) this.steerHail(rec.hailIn);
      if (this.torLift === 'push') this.steerTornado(alive ? rec.tornado : null);
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
      const lift = this.lift === 'push'
        ? { w: this.push ?? 0.5 * this.pushMax, push: true }
        : { w: this.lift * (rec.intensity ?? 0), push: false };
      m.setDrive(1, alive ? { x: this.lx, y: this.ly, inBox: true, r: this.lift === 'push' ? (this.pushR ?? C.PUSH_R) : this.liftR, z: 1500, rz: 1500, w: lift.w, push: lift.push, tau: C.LIFT_TAU, t1: Infinity, ramp: 0 } : null);
      if (this.torLift === 'push') {
        if (this.torSpot) {
          // (the box shifts with the storm: the spot moves back by the shift)
          this.torSpot[0] -= (m.ox - this.torSpot[2]) * m.dx;
          this.torSpot[1] -= (m.oy - this.torSpot[3]) * m.dx;
          this.torSpot[2] = m.ox; this.torSpot[3] = m.oy;
        }
        m.setDrive(2, alive && this.torSpot && this.torPush > 0 ? { x: this.torSpot[0], y: this.torSpot[1], inBox: true, r: C.TOR_R, z: C.TOR_Z, rz: C.TOR_Z, w: this.torPush, push: true, tau: C.LIFT_TAU, t1: Infinity, ramp: 0 } : null);
      } else if (this.torLift > 0 && alive && rec.tornado) {
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

  // The run's whole state: the module's memory (both models in it) and the run's own fields
  // (plain values). EngineRun.restore(snap) in a fresh thread carries on bit for bit.
  snapshot() {
    const state = {};
    for (const [k, v] of Object.entries(this)) if (k !== 'model' && k !== 'nest' && k !== 'fine' && k !== 'scenario') state[k] = v;
    return { memory: memorySnapshot(), json: JSON.stringify({ state, modelPtr: this.model.ptr, nestPtr: this.nest?.ptr ?? null, finePtr: this.fine?.ptr ?? null }) };
  }

  static restore({ memory, json }) {
    restoreMemory(memory);
    const { state, modelPtr, nestPtr, finePtr } = JSON.parse(json);
    const run = Object.create(EngineRun.prototype);
    Object.assign(run, state);
    run.model = CloudModel.wrap(modelPtr);
    run.nest = null;
    if (nestPtr != null) { run.nest = CloudModel.wrap(nestPtr); run.nest.parent = run.model; run.model.child = run.nest; }
    run.fine = null;
    if (finePtr != null && run.nest) { run.fine = CloudModel.wrap(finePtr); run.fine.parent = run.nest; run.nest.child = run.fine; }
    return run;
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
    // (the convergence: the exported cell nearest the storm then - the export has no inflow point's)
    const convAt = pos => {
      let bd = Infinity, cv = 0;
      if (pos) for (const c of data.cells) { const d = (c.pos[0] - pos[0]) ** 2 + (c.pos[1] - pos[1]) ** 2; if (d < bd) { bd = d; cv = c.convergence ?? 0; } }
      return cv;
    };
    const record = p => ({ motion: p.motion, intensity: p.intensity, coldPoolK: p.coldPoolK, tornado: p.tornado, active: p.active, inflow: p.inflow, convergence: opts.lift0 ? 0 : convAt(p.pos), updraftMs: storm.updraftMs, hailIn: p.hailIn ?? storm.hailIn });
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
