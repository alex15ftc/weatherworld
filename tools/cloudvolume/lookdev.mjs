// Look-development for roblox/src/client/CloudVolume.luau: the same density and lighting, rendered
// in Node to a PNG from a replay frame and a camera, so the look can be tuned in seconds instead of
// a Studio playtest. Keep the maths in step with the Luau.
//
//   node tools/cloudvolume/lookdev.mjs [--frame 13] [--out <png>] [--w 480] [--h 300] [--set key=value ...]
//
// The camera defaults to the Studio test view (StartMiles 162.6,7.8 looking at the seed 8181
// tornado). The ground is taken flat at the camera's foot.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);

// The tunables (Config.VOLUME_CLOUDS).
export const VOL = { steps: 48, sigma: 0.004, lightStep: 500, noise: 0.45, sunLight: 1.0, skyLight: 0.8 };
for (let i = 0; i < args.length; i++) if (args[i] === '--set') { const [k, v] = args[i + 1].split('='); VOL[k] = Number(v); }

const KM = 1000 / 1.609344, SKY = 1, HALF = 250 * 1000;
const at = (x, y, h) => [x * KM - HALF, h, y * KM - HALF];
const heading = d => { const r = d * Math.PI / 180; return [Math.sin(r), 0, -Math.cos(r)]; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => mul(a, 1 / Math.hypot(...a));

// Perlin noise, near Roblox's math.noise (same lattice idea; values about -0.5..0.5 typical).
const P = new Uint8Array(512); { const p = [...Array(256).keys()]; let s = 1; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
const fade = t => t * t * t * (t * (t * 6 - 15) + 10), lerp = (t, a, b) => a + t * (b - a);
const grad = (h, x, y, z) => { const u = (h & 15) < 8 ? x : y, v = (h & 15) < 4 ? y : (h & 15) === 12 || (h & 15) === 14 ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
export function noise(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  return 0.7 * lerp(w, lerp(v, lerp(u, grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z)), lerp(u, grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z))),
    lerp(v, lerp(u, grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1)), lerp(u, grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1))));
}

export function specOf(s, ground) {
  const up = s.updraft, baseY = ground + up.baseM * SKY, topY = ground + up.topM * SKY, R = up.radiusKm * KM;
  const centre = at(up.xKm, up.yKm, baseY), downwind = heading(s.anvil.bearingDeg), axis = heading(s.line.axisBearingDeg);
  const count = s.line.share > 0.3 ? Math.min(8, Math.max(2, Math.floor(2 * s.line.halfLengthKm / 12))) : 1;
  const towers = [];
  for (let k = 1; k <= count; k++) { const along = count > 1 ? ((k - 0.5) / count - 0.5) * 2 * s.line.halfLengthKm * KM : 0; towers.push({ foot: add(centre, mul(axis, along)), scale: count > 1 ? 0.75 + 0.25 * Math.sin(k * 2.3) : 1 }); }
  // The flat base is the bottom of the updraught: as wide as the tower's foot (the appearance's
  // wider rain-free base reads as a lit pancake when it has no cloud above it).
  const baseR = 0.92 * R, anvilTop = ground + s.anvil.topM * SKY, length = s.anvil.lengthKm * KM, width = s.anvil.widthKm * KM;
  const sp = {
    ground, baseY, height: topY - baseY, towers, R, downwind, axis, centre, baseR,
    baseHalfLen: count > 1 ? s.line.halfLengthKm * KM : 0, baseTh: 120 * SKY + 0.04 * baseR,
    anvilC: add([centre[0], anvilTop - 700 * SKY, centre[2]], mul(downwind, length * 0.45)), anvilFwd: downwind, anvilSide: [-downwind[2], 0, downwind[0]],
    anvilHalf: [width / 2, 700 * SKY, length / 2], rootC: [centre[0], anvilTop - 900 * SKY, centre[2]], rootR: R * 1.3,
    domeC: up.overshootM > 50 ? add([centre[0], topY, centre[2]], mul(downwind, 0.25 * (topY - baseY))) : null, domeR: Math.max(1, up.overshootM * SKY),
    wallTop: null, wallR: 0, wallLower: 0, wallStrength: 0,
  };
  const wall = s.wallCloud;
  if (wall.strength > 0.03) { sp.wallTop = at(wall.xKm, wall.yKm, baseY); sp.wallR = wall.radiusKm * KM; sp.wallLower = Math.max(30, wall.loweringM * SKY); sp.wallStrength = Math.min(1, wall.strength * 2.2); }
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const grow = (p, r) => { for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i] - r[i]); hi[i] = Math.max(hi[i], p[i] + r[i]); } };
  for (const t of towers) grow(add(add(t.foot, [0, sp.height / 2, 0]), mul(downwind, 0.12 * sp.height)), [R * 1.3 + 0.15 * sp.height, sp.height / 2 + 200, R * 1.3 + 0.15 * sp.height]);
  grow(centre, [baseR + sp.baseHalfLen, sp.baseTh * 2, baseR + sp.baseHalfLen]);
  const ext = Math.max(width, length) / 2 + 200; grow(sp.anvilC, [ext, sp.anvilHalf[1] * 1.6, ext]);
  if (sp.wallTop) grow(sub(sp.wallTop, [0, sp.wallLower / 2, 0]), [sp.wallR * 1.2, sp.wallLower, sp.wallR * 1.2]);
  sp.min = [lo[0], Math.max(lo[1], ground), lo[2]]; sp.max = hi;
  return sp;
}

// Returns how far inside (1 core, 0 edge, <0 outside) and which part wins: 1 tower, 2 base, 3 anvil, 4 wall.
let KIND = 0;
export function field(sp, x, y, z) {
  let best = -1; KIND = 0; const h = sp.height, f = (y - sp.baseY) / h;
  if (f > -0.05 && f < 1.08) {
    const lean = f * f * 0.25 * h;
    for (const t of sp.towers) {
      const cx = t.foot[0] + sp.downwind[0] * lean, cz = t.foot[2] + sp.downwind[2] * lean, r = sp.R * t.scale * (0.95 - 0.35 * f * f);
      const v = (1 - Math.hypot(x - cx, z - cz) / r) * smooth(1.08, 0.9, f); if (v > best) { best = v; KIND = 1; }
    }
  }
  const dx = x - sp.centre[0], dz = z - sp.centre[2], along = dx * sp.axis[0] + dz * sp.axis[2], excess = Math.max(0, Math.abs(along) - sp.baseHalfLen);
  const ax = dx - sp.axis[0] * along, az = dz - sp.axis[2] * along, horiz = Math.sqrt(ax * ax + az * az + excess * excess) / sp.baseR;
  // A flat underside at the base, rising into the tower: thicker toward the middle.
  const th = sp.baseTh * (1 + 4 * Math.max(0, 1 - horiz));
  const vert = y < sp.baseY ? (sp.baseY - y) / 60 : (y - sp.baseY) / th;
  let v = Math.min(1 - horiz, 1 - vert) ; if (v > best) { best = v; KIND = 2; }
  const ox = x - sp.anvilC[0], oy = y - sp.anvilC[1], oz = z - sp.anvilC[2];
  const u = (ox * sp.anvilSide[0] + oz * sp.anvilSide[2]) / sp.anvilHalf[0], w = (ox * sp.anvilFwd[0] + oz * sp.anvilFwd[2]) / sp.anvilHalf[2];
  v = 1 - Math.sqrt(u * u + (oy / sp.anvilHalf[1]) ** 2 + w * w); if (v > best) { best = v; KIND = 3; }
  const rx = x - sp.rootC[0], ry = y - sp.rootC[1], rz = z - sp.rootC[2];
  v = 1 - Math.sqrt((rx * rx + rz * rz) / (sp.rootR * sp.rootR) + (ry / (900 * SKY)) ** 2); if (v > best) { best = v; KIND = 3; }
  if (sp.domeC) { v = 1 - Math.sqrt(((x - sp.domeC[0]) ** 2 + (z - sp.domeC[2]) ** 2) / (sp.R * 0.45) ** 2 + ((y - sp.domeC[1]) / sp.domeR) ** 2); if (v > best) { best = v; KIND = 1; } }
  if (sp.wallTop && y < sp.baseY && y > sp.baseY - sp.wallLower) {
    const frac = (sp.baseY - y) / sp.wallLower, r = sp.wallR * (1 - 0.45 * frac);
    v = (1 - Math.hypot(x - sp.wallTop[0], z - sp.wallTop[2]) / r) * sp.wallStrength * (1 - 0.5 * frac); if (v > best) { best = v; KIND = 4; }
  }
  return best;
}

export function density(sp, x, y, z, t) {
  const fv = field(sp, x, y, z);
  if (fv < -0.45) return 0;
  const kind = KIND;
  if (kind === 3) {
    // The anvil: smooth, fibrous, spread by the wind aloft (noise long across, short up).
    const a1 = 1 / 2600, a2 = 1 / 900;
    const n = 0.65 * noise(x * a1 + t * 0.004, y / 500, z * a1) + 0.35 * noise(x * a2, y / 160 + t * 0.01, z * a2 + 3.1);
    return smooth(0, 0.35, fv + 0.25 * n);
  }
  const s1 = 1 / 900, s2 = 1 / 330, s3 = 1 / 120;
  const n = 0.55 * noise(x * s1 + t * 0.01, y * s1 - t * 0.025, z * s1) + 0.30 * noise(x * s2 - t * 0.02, y * s2 - t * 0.05, z * s2 + 7.1) + 0.15 * noise(x * s3, y * s3 - t * 0.09, z * s3 - 3.3);
  const amp = kind === 2 ? 0.5 : kind === 4 ? 0.7 : 1;
  return smooth(0, 0.3, fv + VOL.noise * amp * n);
}

// One ray: premultiplied rgb and alpha.
const LIGHT = [0.4, 1.2, 2.8, 6];
export function march(sp, cam, dir, sd, sunI, ambI, t, jitter) {
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const o = cam[i], d = dir[i];
    if (Math.abs(d) < 1e-6) { if (o < sp.min[i] || o > sp.max[i]) t0 = Infinity; continue; }
    let a = (sp.min[i] - o) / d, b = (sp.max[i] - o) / d; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  if (dir[1] < 0) t1 = Math.min(t1, (sp.ground - cam[1]) / dir[1]);
  if (t0 >= t1) return [0, 0, 0, 0];
  const steps = VOL.steps, sigma = VOL.sigma, ls = VOL.lightStep, step = (t1 - t0) / steps;
  let tt = t0 + step * jitter, trans = 1, r = 0, g = 0, b = 0;
  const phase = 0.75 + 1.4 * Math.max(0, dot(dir, sd)) ** 6;
  for (let k = 0; k < steps; k++) {
    const q = add(cam, mul(dir, tt));
    const dens = density(sp, q[0], q[1], q[2], t);
    if (dens > 0.01) {
      let tau = 0;
      // Toward the sun at growing steps (0.4, 1.2, 2.8, 6 x lightStep): far enough to cross the tower.
      if (sunI > 0) { let prev = 0; for (const m of LIGHT) { const lq = add(q, mul(sd, ls * m)); tau += smooth(0, 0.3, field(sp, lq[0], lq[1], lq[2])) * ls * (m - prev) * sigma * 0.6; prev = m; } }
      const hf = Math.min(1, Math.max(0, (q[1] - sp.baseY) / sp.height));
      // Sky light, less low in the cloud and where much cloud lies toward the sun (overhead).
      // Sun light: single scattering plus two weaker, wider octaves standing in for light scattered
      // many times inside the cloud (shadow sides stay grey, not black).
      const sun = Math.exp(-tau) * phase + 0.35 * Math.exp(-0.25 * tau) + 0.15 * Math.exp(-0.06 * tau);
      const light = sunI * sun + ambI * (0.45 + 0.55 * hf) * (0.55 + 0.45 * Math.exp(-0.3 * tau));
      const a = 1 - Math.exp(-sigma * dens * step), c = trans * a * light;
      // A soft tone curve: bright cloud keeps its shading instead of clipping to flat white.
      const tl = 1 - Math.exp(-1.6 * light) ;
      const c2 = trans * a * tl;
      r += c2 * 0.94; g += c2 * 0.95; b += c2 * 0.98; trans *= 1 - a;
      if (trans < 0.02) break;
    }
    tt += step;
  }
  return [r, g, b, 1 - trans];
}

export function blur3(src, W, H) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const wgt = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1); sum += src[(yy * W + xx) * 4 + c] * wgt; n += wgt; }
    out[(y * W + x) * 4 + c] = sum / n;
  }
  return out;
}

function png(w, h, rgb) {
  const crc = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return b => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = rgb[y * w * 3 + x]; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const frameNo = Number(flag('--frame', 13)), W = Number(flag('--w', 480)), H = Number(flag('--h', 300));
  const out = flag('--out', path.join(process.env.CLAUDE_JOB_DIR || '.', 'tmp', 'cloudvolume.png'));
  const text = fs.readFileSync(path.join(ROOT, 'roblox/src/worlddata/StormReplay', `F${String(frameNo).padStart(3, '0')}.luau`), 'utf8');
  const frame = JSON.parse(text.slice(text.indexOf('[==[') + 4, text.lastIndexOf(']==]')));
  const ground = 590;
  // --from "east,south" km offset from the tornadic storm's updraught (default: the Studio test spot);
  // the camera then looks at the storm's middle height.
  let cam = [-87400, 596, -242188], look = unit([0.1406, 0.0236, -0.9898]);
  let best = null, bd = Infinity;
  for (const s of frame.storms) { const c = at(s.xKm, s.yKm, 0), d = Math.hypot(c[0] - cam[0], c[2] - cam[2]) * (s.tornado ? 0.5 : 1); if (d < bd) { bd = d; best = s; } }
  const from = flag('--from', null);
  if (from) {
    const [e, n] = from.split(',').map(Number);
    cam = at(best.updraft.xKm + e, best.updraft.yKm + n, ground + 6);
    const target = at(best.updraft.xKm, best.updraft.yKm, ground + Number(flag('--aim', 3000)));
    look = unit(sub(target, cam));
  }
  const right = unit([-look[2], 0, look[0]]), upv = unit([right[1] * look[2] - right[2] * look[1], right[2] * look[0] - right[0] * look[2], right[0] * look[1] - right[1] * look[0]]);
  bd = Math.hypot(...sub(at(best.xKm, best.yKm, 0), [cam[0], 0, cam[2]]));
  const sp = specOf(best, ground);
  const sd = unit(flag('--sun', '-0.35,0.85,0.4').split(',').map(Number));
  const sunI = VOL.sunLight, ambI = VOL.skyLight * 0.6;
  const tanY = Math.tan(35 * Math.PI / 180), tanX = tanY * W / H;
  const img = new Uint8Array(W * H * 3);
  const acc = new Float32Array(W * H * 4), bgs = new Float32Array(W * H * 3);
  const t0 = Date.now();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = ((x + 0.5) / W * 2 - 1) * tanX, v = (1 - (y + 0.5) / H * 2) * tanY;
    const dir = unit(add(add(look, mul(right, u)), mul(upv, v)));
    // Background: a grey storm sky above the horizon, dark green ground below.
    const bg = dir[1] > 0 ? [0.42 + 0.1 * (1 - dir[1]), 0.46 + 0.1 * (1 - dir[1]), 0.54 + 0.08 * (1 - dir[1])] : [0.16, 0.2, 0.14];
    const res = march(sp, cam, dir, sd, sunI, ambI, 0, (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1);
    acc.set(res, (y * W + x) * 4); bgs.set(bg, (y * W + x) * 3);
  }
  // A 3x3 blur of the premultiplied picture (as CloudVolume does before showing it): hides the dither.
  const bl = blur3(acc, W, H);
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) img[i * 3 + c] = Math.min(255, (bl[i * 4 + c] + bgs[i * 3 + c] * (1 - bl[i * 4 + 3])) * 255);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png(W, H, img));
  console.log(`storm ${best.id} (${(bd / 1000).toFixed(1)}k studs), ${W}x${H} in ${Date.now() - t0} ms -> ${out}`);
}
