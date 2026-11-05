// Speed test of option B (docs/cloudlab/PLAN.md C2): CloudModel.slow in JavaScript (typed arrays) and
// in C (slow.c), on a dumped box state (dump_slow.luau), each timed and compared value for value
// with the Luau's own tendencies.
//   node tools/cloudlab/native/run_slow.mjs <dump dir> [reps] [slow.exe]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { avoidBackgroundThrottling } from '../../../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();
const [dir, repsArg = '50', exe] = process.argv.slice(2);
const reps = Number(repsArg);
const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const { nx, ny, nz, SX, SXY, N } = meta;
writeFileSync(path.join(dir, 'params.txt'), [nx, ny, nz, SX, SXY, N, meta.dx, meta.K, meta.Kh, meta.zdamp, meta.ztop, meta.umove, meta.vmove, meta.cd].map(x => (typeof x === 'number' && !Number.isInteger(x) ? x.toPrecision(17) : String(x))).join(' '));

// 1-based like the Luau: grid index n at n, level k at k + 1
const grid = name => { const b = readFileSync(path.join(dir, `${name}.bin`)); const a = new Float64Array(N + 1); a.set(new Float64Array(b.buffer, b.byteOffset, N), 1); return a; };
const levels = name => { const b = readFileSync(path.join(dir, `${name}.lev`)); return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const m = {};
for (const f of ['u', 'v', 'w', 'th', 'qv', 'qc', 'qr', 'qh', 'qsn']) m[f] = grid(f);
for (const f of ['th0', 'qv0', 'u0', 'v0', 'zc', 'zf', 'dzc', 'dzw', 'lapTh', 'lapQv', 'lapU', 'lapV']) m[f] = levels(f);
for (const f of ['Ru', 'Rv', 'Rw', 'Rth', 'Rqv', 'Rqc', 'Rqr', 'Rqh', 'Rqsn', 'B']) m[f] = new Float64Array(N + 1);
const nrows = N / SX;
const spans = [0, 1, 2, 3].map(() => ({ lo: new Int32Array(nrows), hi: new Int32Array(nrows) }));
const G = 9.81;

function up3(f, n, s, a, c) {
  if (a >= 0) return a * c * (2 * f[n + s] + 3 * f[n] - 6 * f[n - s] + f[n - 2 * s]);
  return a * c * (-f[n + 2 * s] + 6 * f[n + s] - 3 * f[n] - 2 * f[n - s]);
}
function lap(f, n, sy, sz, kh, kv, up, dn) {
  const c = f[n];
  return (f[n + 1] + f[n - 1] + f[n + sy] + f[n - sy] - 4 * c) * kh + ((f[n + sz] - c) / up - (c - f[n - sz]) / dn) * kv;
}
function rowSpans(f, lo, hi) {
  for (let r = 0; r < nrows; r++) {
    const b = r * SX;
    let a = SX + 1, z = 0;
    for (let i = 1; i <= SX; i++) if (f[b + i] !== 0) { a = i; break; }
    if (a <= SX) for (let i = SX; i >= a; i--) if (f[b + i] !== 0) { z = i; break; }
    lo[r] = a; hi[r] = z;
  }
}
const L = (arr, k) => arr[k + 1];

function slow() {
  const { u, v, w, th, qv, qc, qr, qh, qsn, Ru, Rv, Rw, Rth, Rqv, B } = m;
  const cx = 1 / (6 * meta.dx), K = meta.K, kh = meta.Kh / (meta.dx * meta.dx);
  const sy = SX, sz = SXY, zd = meta.zdamp, ztop = meta.ztop, um = meta.umove, vm = meta.vmove;
  const u0g = L(m.u0, 1), v0g = L(m.v0, 1), s0 = Math.sqrt(u0g * u0g + v0g * v0g);
  const SY = SXY / SX;
  const HF = [qc, qr, qh, qsn], HR = [m.Rqc, m.Rqr, m.Rqh, m.Rqsn];
  for (let f = 0; f < 4; f++) rowSpans(HF[f], spans[f].lo, spans[f].hi);
  for (let k = 1; k <= nz; k++) {
    const t0 = L(m.th0, k), q0 = L(m.qv0, k);
    for (let j = 1; j <= ny; j++) {
      const n = 2 + (j + 1) * SX + (k + 1) * SXY;
      for (let i = 1; i <= nx; i++) { const c = n + i; B[c] = G * ((th[c] - t0) / t0 + 0.61 * (qv[c] - q0) - qc[c] - qr[c] - qh[c] - qsn[c]); }
    }
  }
  for (let k = 1; k <= nz; k++) {
    const z = L(m.zc, k), zfk = L(m.zf, k);
    const damp = z > zd ? (1 - Math.cos(0.5 * Math.PI * (z - zd) / (ztop - zd))) / 300 : 0;
    const dampW = zfk > zd ? (1 - Math.cos(0.5 * Math.PI * (zfk - zd) / (ztop - zd))) / 300 : 0;
    const ue = L(m.u0, k) - um, ve = L(m.v0, k) - vm;
    const czc = 1 / (6 * L(m.dzc, k)), czw = 1 / (6 * L(m.dzw, k));
    const kvc = K / L(m.dzc, k), kvw = K / L(m.dzw, k);
    const upC = L(m.dzw, k + 1), dnC = L(m.dzw, k), upW = L(m.dzc, k), dnW = L(m.dzc, k - 1);
    const cd = k === 1 ? meta.cd / L(m.dzc, 1) : 0;
    const bTh = L(m.lapTh, k), bQv = L(m.lapQv, k), bU = L(m.lapU, k), bV = L(m.lapV, k), th0k = L(m.th0, k);
    for (let j = 1; j <= ny; j++) {
      const n0 = 2 + (j + 1) * SX + (k + 1) * SXY;
      for (let i = 1; i <= nx; i++) {
        const n = n0 + i;
        const U = 0.5 * (u[n] + u[n + 1]), V = 0.5 * (v[n] + v[n + sy]), W = 0.5 * (w[n] + w[n + sz]);
        Rth[n] = -(up3(th, n, 1, U, cx) + up3(th, n, sy, V, cx) + up3(th, n, sz, W, czc)) + lap(th, n, sy, sz, kh, kvc, upC, dnC) - bTh - damp * (th[n] - th0k);
        Rqv[n] = -(up3(qv, n, 1, U, cx) + up3(qv, n, sy, V, cx) + up3(qv, n, sz, W, czc)) + lap(qv, n, sy, sz, kh, kvc, upC, dnC) - bQv;
        {
          const Vu = 0.25 * (v[n] + v[n - 1] + v[n + sy] + v[n - 1 + sy]), Wu = 0.25 * (w[n] + w[n - 1] + w[n + sz] + w[n - 1 + sz]);
          const a = u[n];
          let r = -(up3(u, n, 1, a, cx) + up3(u, n, sy, Vu, cx) + up3(u, n, sz, Wu, czc)) + lap(u, n, sy, sz, kh, kvc, upC, dnC) - bU - damp * (a - ue);
          if (cd > 0) { const ug = a + um, vg = Vu + vm; r -= cd * (Math.sqrt(ug * ug + vg * vg) * ug - s0 * u0g); }
          Ru[n] = r;
        }
        {
          const Uv = 0.25 * (u[n] + u[n + 1] + u[n - sy] + u[n + 1 - sy]), Wv = 0.25 * (w[n] + w[n - sy] + w[n + sz] + w[n - sy + sz]);
          const a = v[n];
          let r = -(up3(v, n, 1, Uv, cx) + up3(v, n, sy, a, cx) + up3(v, n, sz, Wv, czc)) + lap(v, n, sy, sz, kh, kvc, upC, dnC) - bV - damp * (a - ve);
          if (cd > 0) { const ug = Uv + um, vg = a + vm; r -= cd * (Math.sqrt(ug * ug + vg * vg) * vg - s0 * v0g); }
          Rv[n] = r;
        }
        if (k >= 2) {
          const Uw = 0.25 * (u[n] + u[n + 1] + u[n - sz] + u[n + 1 - sz]), Vw = 0.25 * (v[n] + v[n + sy] + v[n - sz] + v[n + sy - sz]);
          const a = w[n];
          Rw[n] = -(up3(w, n, 1, Uw, cx) + up3(w, n, sy, Vw, cx) + up3(w, n, sz, a, czw)) + lap(w, n, sy, sz, kh, kvw, upW, dnW) + 0.5 * (B[n] + B[n - sz]) - dampW * a;
        } else Rw[n] = 0;
      }
    }
    for (let f = 0; f < 4; f++) {
      const { lo, hi } = spans[f], F = HF[f], R = HR[f];
      for (let j = 1; j <= ny; j++) {
        const r = (j + 1) + (k + 1) * SY;
        let a = lo[r] - 2, z = hi[r] + 2;
        for (let d = 1; d <= 2; d++) for (const q of [r - d, r + d, r - d * SY, r + d * SY]) { if (lo[q] < a) a = lo[q]; if (hi[q] > z) z = hi[q]; }
        const i1 = Math.max(1, a - 2), i2 = Math.min(nx, z - 2), n0 = 2 + (j + 1) * SX + (k + 1) * SXY;
        if (i1 > i2) { for (let i = 1; i <= nx; i++) R[n0 + i] = 0; continue; }
        for (let i = 1; i < i1; i++) R[n0 + i] = 0;
        for (let i = i2 + 1; i <= nx; i++) R[n0 + i] = 0;
        for (let i = i1; i <= i2; i++) {
          const n = n0 + i;
          const U = 0.5 * (u[n] + u[n + 1]), V = 0.5 * (v[n] + v[n + sy]), W = 0.5 * (w[n] + w[n + sz]);
          R[n] = -(up3(F, n, 1, U, cx) + up3(F, n, sy, V, cx) + up3(F, n, sz, W, czc)) + lap(F, n, sy, sz, kh, kvc, upC, dnC);
        }
      }
    }
  }
}

for (let r = 0; r < 5; r++) slow(); // (warm the JIT)
const t0 = performance.now();
for (let r = 0; r < reps; r++) slow();
const jsMs = (performance.now() - t0) / reps;
let differ = 0, worst = 0;
for (const f of ['Ru', 'Rv', 'Rw', 'Rth', 'Rqv', 'Rqc', 'Rqr', 'Rqh', 'Rqsn', 'B']) {
  const ref = grid(f), got = m[f];
  for (let n = 1; n <= N; n++) if (ref[n] !== got[n]) { differ++; worst = Math.max(worst, Math.abs(ref[n] - got[n]) / Math.max(Math.abs(ref[n]), 1e-30)); }
}
console.log(`Luau slow(): ${meta.luauMs.toFixed(2)} ms per call`);
console.log(`JS slow():   ${jsMs.toFixed(2)} ms per call (${(meta.luauMs / jsMs).toFixed(1)}x); ${differ} of ${10 * N} values differ from the Luau (worst relative ${worst.toExponential(2)})`);
if (exe && existsSync(exe)) {
  const out = execFileSync(exe, [dir, String(reps)], { encoding: 'utf8' }).trim();
  const cMs = Number(out.match(/([\d.]+) ms/)[1]);
  console.log(`${out.replace('C slow(): ', 'C slow():    ')} (${(meta.luauMs / cMs).toFixed(1)}x)`);
}
