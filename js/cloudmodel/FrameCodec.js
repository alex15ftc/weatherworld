// One detailed storm's frame, byte for byte the format of roblox/src/cloudlab/shared/Model/FrameCodec.luau
// (its header documents the layout; the Roblox side decodes with that module). Encoding only,
// plus a header decode for checks.
import { LOFF } from './CloudModel.js';

export const VERSION = 1;
export const BOX_FIELDS = 12;
export const NEST_FIELDS = 5;
export const HEADER = 42;
const NEST_HEADER = 16;
const CLOUD = 1e-4;

const u8 = x => Math.min(255, Math.max(0, Math.floor(x + 0.5)));
const i8 = x => Math.min(127, Math.max(-127, Math.floor(x + 0.5)));
const logRate = mmh => u8(40 * Math.log10(1 + Math.max(0, mmh)));

export function encodeNest(nest) {
  const b = new DataView(new ArrayBuffer(NEST_HEADER + nest.nx * nest.ny * NEST_FIELDS));
  let X0 = nest.X0, Y0 = nest.Y0, up = nest.parent;
  while (up && up.parent) { X0 += up.X0; Y0 += up.Y0; up = up.parent; }
  b.setUint16(0, nest.nx, true);
  b.setUint16(2, nest.ny, true);
  b.setFloat32(4, nest.dx, true);
  b.setFloat32(8, X0, true);
  b.setFloat32(12, Y0, true);
  let o = NEST_HEADER;
  const qc = nest.f('qc'), p = nest.f('p'), u = nest.f('u'), v = nest.f('v'), zf = nest.lev('zf');
  const { SX, SXY } = nest;
  const um = nest.umove, vm = nest.vmove;
  let mean = 0, cnt = 0;
  for (let j = 1; j <= nest.ny; j++) for (let i = 1; i <= nest.nx; i++) { mean += p[nest.idx(i, j, 1)]; cnt++; }
  mean /= cnt;
  for (let j = 1; j <= nest.ny; j++) {
    for (let i = 1; i <= nest.nx; i++) {
      const col = nest.idx(i, j, 0);
      // (a cloud from the ground up, fog or rain-fog in near-saturated air, is stored as the first
      // step, 25 m: 0 means no cloud below 3 km)
      let zb = -1;
      for (let k = 1; k <= nest.nz; k++) {
        if (zf[k + LOFF] > 3000) break;
        if (qc[col + k * SXY] > CLOUD) { zb = zf[k + LOFF]; break; }
      }
      const n1 = col + SXY;
      const ug = 0.5 * (u[n1] + u[n1 + 1]) + um;
      const vg = 0.5 * (v[n1] + v[n1 + SX]) + vm;
      b.setUint8(o, zb >= 0 ? Math.max(1, u8(zb / 25)) : 0);
      b.setInt8(o + 1, i8(ug * 2));
      b.setInt8(o + 2, i8(vg * 2));
      b.setInt8(o + 3, i8(nest.zeta(i, j, 1) / 0.002));
      b.setUint8(o + 4, u8(Math.max(0, mean - p[n1]) / 10));
      o += NEST_FIELDS;
    }
  }
  return new Uint8Array(b.buffer);
}

// run: an EngineRun; seq: the frame's number. Returns a Uint8Array.
export function encode(run, seq) {
  const m = run.model;
  const nestPart = run.nest ? encodeNest(run.nest) : null;
  const { nx, ny, nz, SX, SXY } = m;
  const nb = nx * ny * BOX_FIELDS;
  const out = new Uint8Array(HEADER + nb + (nestPart ? nestPart.length : 0));
  const b = new DataView(out.buffer);
  const um = m.umove, vm = m.vmove;
  b.setUint8(0, VERSION);
  b.setUint8(1, (nestPart ? 1 : 0) + (run.ended ? 2 : 0));
  b.setUint32(2, seq, true);
  b.setFloat32(6, m.time, true);
  b.setFloat64(10, run.simHour ?? 0, true);
  b.setUint16(18, nx, true);
  b.setUint16(20, ny, true);
  b.setFloat32(22, m.dx, true);
  b.setFloat32(26, (Math.floor(0.5 * nx) - 0.5) * m.dx, true);
  b.setFloat32(30, (Math.floor(0.45 * ny) - 0.5) * m.dx, true);
  b.setFloat32(34, um, true);
  b.setFloat32(38, vm, true);
  const qc = m.f('qc'), qr = m.f('qr'), qh = m.f('qh'), qsn = m.f('qsn'), th = m.f('th'), w = m.f('w'), u = m.f('u'), v = m.f('v');
  const rainSfc = m.f('rainSfc'), hailSfc = m.f('hailSfc');
  const zf = m.lev('zf'), th0 = m.lev('th0'), rho0 = m.lev('rho0'), dzc = m.lev('dzc'), zc = m.lev('zc');
  const k1 = m.levelAt(1000), k5 = m.levelAt(5000);
  const th01 = th0[1 + LOFF];
  let o = HEADER;
  const runs = [0, 0, 0, 0];
  for (let j = 1; j <= ny; j++) {
    for (let i = 1; i <= nx; i++) {
      const col = m.idx(i, j, 0);
      runs.fill(0);
      let nr = 0, inside = false, snowCol = 0;
      for (let k = 1; k <= nz; k++) {
        const n = col + k * SXY;
        const c = qc[n] + qsn[n] + 0.3 * (qr[n] + qh[n]);
        if (c > CLOUD) {
          if (!inside) {
            nr++;
            if (nr <= 2) runs[2 * nr - 2] = zf[k + LOFF];
            inside = true;
          }
          if (nr <= 2) runs[2 * nr - 1] = zf[k + 1 + LOFF];
        } else inside = false;
        if (zc[k + LOFF] > 6000) snowCol += rho0[k + LOFF] * Math.max(0, qsn[n]) * dzc[k + LOFF];
      }
      const n1 = col + SXY;
      const ug = 0.5 * (u[n1] + u[n1 + 1]) + um;
      const vg = 0.5 * (v[n1] + v[n1 + SX]) + vm;
      const cs = (j + 1) * SX + i + 2;
      b.setUint8(o, u8(runs[0] / 100));
      b.setUint8(o + 1, u8(runs[1] / 100));
      b.setUint8(o + 2, u8(runs[2] / 100));
      b.setUint8(o + 3, u8(runs[3] / 100));
      b.setUint8(o + 4, logRate(rainSfc[cs]));
      b.setUint8(o + 5, logRate(hailSfc[cs]));
      b.setInt8(o + 6, i8((th[n1] - th01) * 10));
      b.setInt8(o + 7, i8(ug * 2));
      b.setInt8(o + 8, i8(vg * 2));
      b.setInt8(o + 9, i8(0.5 * (w[col + k5 * SXY] + w[col + (k5 + 1) * SXY]) * 2));
      b.setInt8(o + 10, i8(m.zeta(i, j, k1) * 1000));
      b.setUint8(o + 11, u8(snowCol / 0.05));
      o += BOX_FIELDS;
    }
  }
  if (nestPart) out.set(nestPart, o);
  return out;
}

export function decodeHeader(bytes) {
  const b = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.getUint8(0) !== VERSION) throw new Error('frame version');
  const flags = b.getUint8(1);
  const f = {
    seq: b.getUint32(2, true), time: b.getFloat32(6, true), simHour: b.getFloat64(10, true), ended: (flags & 2) !== 0,
    nx: b.getUint16(18, true), ny: b.getUint16(20, true), dx: b.getFloat32(22, true),
    anchorX: b.getFloat32(26, true), anchorY: b.getFloat32(30, true), um: b.getFloat32(34, true), vm: b.getFloat32(38, true), nest: null,
  };
  if (flags & 1) {
    const o = HEADER + f.nx * f.ny * BOX_FIELDS;
    f.nest = { nx: b.getUint16(o, true), ny: b.getUint16(o + 2, true), dx: b.getFloat32(o + 4, true), X0: b.getFloat32(o + 8, true), Y0: b.getFloat32(o + 12, true), offset: o + NEST_HEADER };
  }
  return f;
}

// --- Client frames (docs/cloudlab/PLAN.md B2, NETWORK.md): what a player's client gets, cut from
// a full frame by the engine. Only what the visuals draw, each field a whole plane (they
// compress about a tenth better than interleaved): a near frame is about 3 KB with Zstd, a far
// one about 1 KB (13-14 KB for the full frame).
//   Header: as the full frame's (42 bytes), but version CLIENT_VERSION; flags bit 0 nest, bit 1
//   ended, bit 2 far; nx, ny and dx those of the client grid (far: half the columns each way,
//   twice the spacing). anchorX, anchorY stay in metres.
//   Box planes, nx * ny bytes each, row by row from the south-west, in CLIENT_BOX order:
//   base1, top1, base2, top2, rain, hail, snow (the full frame's units).
//   Far: each 2 x 2 block becomes one column: bases the lowest of the four (0 none), tops,
//   rain, hail and snow the highest.
//   Then, near frames with a nest only: the nest's 16-byte header and two planes, cloud base
//   (25 m) and pressure drop (10 Pa).
export const CLIENT_VERSION = 129;
export const CLIENT_BOX = [0, 1, 2, 3, 4, 5, 11];
const CLIENT_NEST = [0, 4];

export function clientFrame(full, { far = false } = {}) {
  const src = new DataView(full.buffer, full.byteOffset, full.byteLength);
  if (src.getUint8(0) !== VERSION) throw new Error('frame version');
  const flags = src.getUint8(1), nx = src.getUint16(18, true), ny = src.getUint16(20, true), ncol = nx * ny;
  const boxAt = (c, k) => full[HEADER + c * BOX_FIELDS + k];
  const nestOffset = HEADER + ncol * BOX_FIELDS, hasNest = (flags & 1) !== 0 && !far;
  const nnx = hasNest ? src.getUint16(nestOffset, true) : 0, nny = hasNest ? src.getUint16(nestOffset + 2, true) : 0;
  const cx = far ? Math.ceil(nx / 2) : nx, cy = far ? Math.ceil(ny / 2) : ny, cn = cx * cy;
  const out = new Uint8Array(HEADER + CLIENT_BOX.length * cn + (hasNest ? NEST_HEADER + CLIENT_NEST.length * nnx * nny : 0));
  const b = new DataView(out.buffer);
  out.set(full.subarray(0, HEADER), 0);
  b.setUint8(0, CLIENT_VERSION);
  b.setUint8(1, (hasNest ? 1 : 0) | (flags & 2) | (far ? 4 : 0));
  b.setUint16(18, cx, true); b.setUint16(20, cy, true);
  b.setFloat32(22, src.getFloat32(22, true) * (far ? 2 : 1), true);
  let o = HEADER;
  CLIENT_BOX.forEach((k, plane) => {
    const lowest = plane === 0 || plane === 2;
    for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
      let v;
      if (!far) v = boxAt(j * nx + i, k);
      else {
        v = 0;
        for (let bj = 0; bj < 2; bj++) for (let bi = 0; bi < 2; bi++) {
          const si = 2 * i + bi, sj = 2 * j + bj;
          if (si >= nx || sj >= ny) continue;
          const x = boxAt(sj * nx + si, k);
          if (lowest) { if (x > 0 && (v === 0 || x < v)) v = x; } else if (x > v) v = x;
        }
      }
      out[o++] = v;
    }
  });
  if (hasNest) {
    out.set(full.subarray(nestOffset, nestOffset + NEST_HEADER), o); o += NEST_HEADER;
    const cols = nestOffset + NEST_HEADER;
    for (const k of CLIENT_NEST) for (let c = 0; c < nnx * nny; c++) out[o++] = full[cols + c * NEST_FIELDS + k];
  }
  return out;
}

// A client frame back to numbers (for checks; the Roblox side has ClientFrame.luau).
export function decodeClientFrame(bytes) {
  const b = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.getUint8(0) !== CLIENT_VERSION) throw new Error('client frame version');
  const flags = b.getUint8(1), nx = b.getUint16(18, true), ny = b.getUint16(20, true), n = nx * ny;
  const f = { seq: b.getUint32(2, true), time: b.getFloat32(6, true), simHour: b.getFloat64(10, true), ended: (flags & 2) !== 0, far: (flags & 4) !== 0, nx, ny, dx: b.getFloat32(22, true), anchorX: b.getFloat32(26, true), anchorY: b.getFloat32(30, true), um: b.getFloat32(34, true), vm: b.getFloat32(38, true), nest: null };
  const plane = p => bytes.subarray(HEADER + p * n, HEADER + (p + 1) * n);
  Object.assign(f, { base1: plane(0), top1: plane(1), base2: plane(2), top2: plane(3), rain: plane(4), hail: plane(5), snow: plane(6) });
  if (flags & 1) {
    const o = HEADER + CLIENT_BOX.length * n, nnx = b.getUint16(o, true), nny = b.getUint16(o + 2, true), nn = nnx * nny, p = o + NEST_HEADER;
    f.nest = { nx: nnx, ny: nny, dx: b.getFloat32(o + 4, true), X0: b.getFloat32(o + 8, true), Y0: b.getFloat32(o + 12, true), base: bytes.subarray(p, p + nn), drop: bytes.subarray(p + nn, p + 2 * nn) };
  }
  return f;
}
