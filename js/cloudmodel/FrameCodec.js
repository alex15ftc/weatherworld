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

// The tornado (EngineRun.tornadoShape), while the engine has one down: after the nest part, flags
// bit 2 (client frames bit 3, near and far alike). Little-endian, TORNADO + 8 bytes a level:
//   u8 flags (bit 0 the model has a vortex: else the place is its finest nest's middle; bit 1 a
//   cloud over it)    u8 engine EF (255 none)    u16 engine wind (mph)    u16 damage width (yd)
//   f32 x, y (box m: the vortex at the ground, moved on to the frame's box shift)
//   u16 core radius (m)   u16 core pressure drop (Pa)   u16 cloud base over it (m)
//   u16 funnel tip (m above the ground; 0 at the ground)   (core, drop and tip from the engine's
//   wind and width by vortex physics; the cloud base from the model)
//   u8 the model's ground gust (m/s)   u8 its spin, 0-1 km mean (0.005 /s)   i8 change since the
//   minute before (0.005 /s)   u16 its own pressure drop (Pa)   u8 level count
//   u16 the core's condensation level (m: the surface air it draws in, at or under the cloud base)
//   per level: u16 height (m), i16 dx, dy (m, from the ground point: the vortex's lean), u16 funnel
//   radius (m; 0 clear air) with bit 15 set where the model's vortex reaches that high
export const TORNADO = 30;
const TOR_LEVEL = 8;
const u16 = x => Math.min(65535, Math.max(0, Math.floor(x + 0.5)));
const i16 = x => Math.min(32767, Math.max(-32767, Math.floor(x + 0.5)));

export function encodeTornado(run) {
  const t = run.torShape, m = run.model;
  if (!t) return null;
  const b = new DataView(new ArrayBuffer(TORNADO + TOR_LEVEL * t.levels.length));
  b.setUint8(0, (t.found ? 1 : 0) | (t.base > 0 ? 2 : 0));
  b.setUint8(1, t.ef == null ? 255 : u8(t.ef));
  b.setUint16(2, u16(t.mph), true);
  b.setUint16(4, u16(t.yards), true);
  b.setFloat32(6, t.x - (m.ox - t.ox) * m.dx, true);
  b.setFloat32(10, t.y - (m.oy - t.oy) * m.dx, true);
  b.setUint16(14, u16(t.R), true);
  b.setUint16(16, u16(t.drop), true);
  b.setUint16(18, u16(t.base), true);
  b.setUint16(20, u16(t.tip), true);
  b.setUint8(22, u8(t.gust));
  b.setUint8(23, u8(t.zeta / 0.005));
  b.setInt8(24, i8(t.dzeta / 0.005));
  b.setUint16(25, u16(t.modelDrop), true);
  b.setUint8(27, t.levels.length);
  b.setUint16(28, u16(t.coreBase ?? t.base), true);
  t.levels.forEach((l, q) => {
    const o = TORNADO + TOR_LEVEL * q;
    b.setUint16(o, u16(l.z), true);
    b.setInt16(o + 2, i16(l.dx), true);
    b.setInt16(o + 4, i16(l.dy), true);
    b.setUint16(o + 6, Math.min(32767, u16(l.funnel)) | (l.found ? 32768 : 0), true);
  });
  return new Uint8Array(b.buffer);
}

// The tornado block at offset o back to numbers, and its length.
export function decodeTornado(bytes, o) {
  const b = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = b.getUint8(o), n = b.getUint8(o + 27), levels = [];
  for (let q = 0; q < n; q++) {
    const p = o + TORNADO + TOR_LEVEL * q, r = b.getUint16(p + 6, true);
    levels.push({ z: b.getUint16(p, true), dx: b.getInt16(p + 2, true), dy: b.getInt16(p + 4, true), funnel: r & 32767, found: (r & 32768) !== 0 });
  }
  const ef = b.getUint8(o + 1);
  return { found: (flags & 1) !== 0, cloud: (flags & 2) !== 0, ef: ef === 255 ? null : ef, mph: b.getUint16(o + 2, true), yards: b.getUint16(o + 4, true),
    x: b.getFloat32(o + 6, true), y: b.getFloat32(o + 10, true), R: b.getUint16(o + 14, true), drop: b.getUint16(o + 16, true),
    base: b.getUint16(o + 18, true), tip: b.getUint16(o + 20, true), gust: b.getUint8(o + 22), zeta: b.getUint8(o + 23) * 0.005,
    dzeta: b.getInt8(o + 24) * 0.005, modelDrop: b.getUint16(o + 25, true), coreBase: b.getUint16(o + 28, true), levels, length: TORNADO + TOR_LEVEL * n };
}

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
  const torPart = encodeTornado(run);
  const { nx, ny, nz, SX, SXY } = m;
  const nb = nx * ny * BOX_FIELDS;
  const out = new Uint8Array(HEADER + nb + (nestPart ? nestPart.length : 0) + (torPart ? torPart.length : 0));
  const b = new DataView(out.buffer);
  const um = m.umove, vm = m.vmove;
  b.setUint8(0, VERSION);
  b.setUint8(1, (nestPart ? 1 : 0) + (run.ended ? 2 : 0) + (torPart ? 4 : 0));
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
  const qc = m.f('qc'), qsn = m.f('qsn'), th = m.f('th'), w = m.f('w'), u = m.f('u'), v = m.f('v');
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
        // cloud: droplets and the anvil's ice (qsn). Falling rain and hail are not cloud: outside the updraught
        // they fall through unsaturated air, and the views draw them as rain (until 2026-11-07 0.3 x qr + qh
        // counted, which filled the forward flank with cloud down to the ground, as StormStructure.js did)
        const c = qc[n] + qsn[n];
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
  if (nestPart) { out.set(nestPart, o); o += nestPart.length; }
  if (torPart) out.set(torPart, o);
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
  f.tornado = flags & 4 ? decodeTornado(bytes, tornadoOffset(bytes)) : null;
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
//   Then, with flags bit 3, the tornado block (TORNADO above), near and far frames alike.
//   Then, with flags bit 4, the drift block (DRIFT below), near and far alike.
//   Then, with flags bit 5, the updraught block (UPDRAUGHT below), near and far alike.
export const CLIENT_VERSION = 129;

// The drift block (full frames flags bit 3; js/storms/StormStructure.js writes it): how falling rain
// and hail drift on their way down - u8 levels, f32 hail fall speed (m/s), then per level u16
// height (m) and f32 Wx, Wy (m2/s, x east, y north: the storm-relative wind summed from the ground
// to that height). A shaft's point at height z is its ground point less W(z) / its fall speed.
export const DRIFT = 5, DRIFT_LEVEL = 10;
// The updraught block (full frames flags bit 4, client frames bit 5; js/storms/StormStructure.js
// writes it, display only): u8 its length (UPDRAUGHT), then f32 the updraught over the tornado at the
// wall cloud's base (or over the low-level mesocyclone without one; m/s), f32 the centre-line speed
// at the cloud base (m/s), f32 x, y of the core at 1 km and f32 x, y at 5 km (box m), f32 the core's
// radius (m). Older readers stop before it.
export const UPDRAUGHT = 29;
const driftLength = (bytes, o) => DRIFT + DRIFT_LEVEL * bytes[o];
export function decodeDrift(bytes, o) {
  const b = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = b.getUint8(o), levels = [];
  for (let q = 0; q < n; q++) { const p = o + DRIFT + DRIFT_LEVEL * q; levels.push([b.getUint16(p, true), b.getFloat32(p + 2, true), b.getFloat32(p + 6, true)]); }
  return { hailFallMs: b.getFloat32(o + 1, true), levels, length: driftLength(bytes, o) };
}

// Where a full frame's tornado block starts (after the box and the nest).
function tornadoOffset(full) {
  const src = new DataView(full.buffer, full.byteOffset, full.byteLength);
  const flags = src.getUint8(1), nx = src.getUint16(18, true), ny = src.getUint16(20, true);
  let o = HEADER + nx * ny * BOX_FIELDS;
  if (flags & 1) o += NEST_HEADER + src.getUint16(o, true) * src.getUint16(o + 2, true) * NEST_FIELDS;
  return o;
}
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
  let tor = null;
  if (flags & 4) { const at = tornadoOffset(full); tor = full.subarray(at, at + decodeTornado(full, at).length); }
  let drift = null;
  if (flags & 8) { const at = tornadoOffset(full) + (flags & 4 ? decodeTornado(full, tornadoOffset(full)).length : 0); drift = full.subarray(at, at + driftLength(full, at)); }
  let up = null;
  if (flags & 16) { const at = tornadoOffset(full) + (flags & 4 ? decodeTornado(full, tornadoOffset(full)).length : 0) + (flags & 8 ? driftLength(full, tornadoOffset(full) + (flags & 4 ? decodeTornado(full, tornadoOffset(full)).length : 0)) : 0); up = full.subarray(at, at + full[at]); }
  const out = new Uint8Array(HEADER + CLIENT_BOX.length * cn + (hasNest ? NEST_HEADER + CLIENT_NEST.length * nnx * nny : 0) + (tor ? tor.length : 0) + (drift ? drift.length : 0) + (up ? up.length : 0));
  const b = new DataView(out.buffer);
  out.set(full.subarray(0, HEADER), 0);
  b.setUint8(0, CLIENT_VERSION);
  b.setUint8(1, (hasNest ? 1 : 0) | (flags & 2) | (far ? 4 : 0) | (tor ? 8 : 0) | (drift ? 16 : 0) | (up ? 32 : 0));
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
  if (tor) { out.set(tor, o); o += tor.length; }
  if (drift) { out.set(drift, o); o += drift.length; }
  if (up) out.set(up, o);
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
  f.tornado = null;
  if (flags & 8) {
    let o = HEADER + CLIENT_BOX.length * n;
    if (flags & 1) o += NEST_HEADER + CLIENT_NEST.length * b.getUint16(o, true) * b.getUint16(o + 2, true);
    f.tornado = decodeTornado(bytes, o);
  }
  f.drift = null;
  if (flags & 16) {
    let o = HEADER + CLIENT_BOX.length * n;
    if (flags & 1) o += NEST_HEADER + CLIENT_NEST.length * b.getUint16(o, true) * b.getUint16(o + 2, true);
    if (flags & 8) o += decodeTornado(bytes, o).length;
    f.drift = decodeDrift(bytes, o);
  }
  f.updraught = null;
  if (flags & 32) {
    let o = HEADER + CLIENT_BOX.length * n;
    if (flags & 1) o += NEST_HEADER + CLIENT_NEST.length * b.getUint16(o, true) * b.getUint16(o + 2, true);
    if (flags & 8) o += decodeTornado(bytes, o).length;
    if (flags & 16) o += driftLength(bytes, o);
    const r = q => b.getFloat32(o + 1 + 4 * q, true);
    f.updraught = { wTor: r(0), wBase: r(1), x1: r(2), y1: r(3), x5: r(4), y5: r(5), coreM: r(6) };
  }
  return f;
}
