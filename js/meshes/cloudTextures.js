// Realistic cloud textures for the storms in Roblox, made offline (scripts/cloud-textures.mjs)
// and previewed before any is uploaded. Each image is RGBA bytes, straight (not premultiplied)
// alpha, as Roblox particle and mesh textures take them.
//
// Cloud sprites are rendered, not drawn: a ray through each pixel steps through a 3D density
// (a lumpy ball shaped by billowing noise), and at each step the light reaching that point is
// the sunlight left after passing through the cloud above it (Beer-Lambert), plus skylight that
// grows with height. So tops come out bright and billowed, undersides darker and soft, and thin
// edges see-through, as a real cumulus. Roblox then tints them with its own lighting.
//
// Funnel surfaces are tiles that wrap round the funnel without a seam (noise sampled on a
// cylinder): laminar (smooth streaks winding up the funnel, a young or weak vortex) or turbulent
// (rough, broken and billowed, a strong one).

// --- Gradient noise ---------------------------------------------------------------------------

function permutation(seed) {
  const p = new Uint8Array(512), base = Array.from({ length: 256 }, (_, i) => i);
  let s = (seed * 2654435761) >>> 0 || 1;
  for (let i = 255; i > 0; i--) { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0; const j = s % (i + 1); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function grad(h, x, y, z) { const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); }
// Perlin noise, about -1..1.
export function makeNoise(seed) {
  const p = permutation(seed);
  return (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lerp(lerp(lerp(grad(p[AA] & 15, x, y, z), grad(p[BA] & 15, x - 1, y, z), u), lerp(grad(p[AB] & 15, x, y - 1, z), grad(p[BB] & 15, x - 1, y - 1, z), u), v),
      lerp(lerp(grad(p[AA + 1] & 15, x, y, z - 1), grad(p[BA + 1] & 15, x - 1, y, z - 1), u), lerp(grad(p[AB + 1] & 15, x, y - 1, z - 1), grad(p[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w);
  };
}
// Billowing fractal noise (0..~1): rounded bulges at every scale, as cumulus.
function billow(noise, x, y, z, octaves) {
  let sum = 0, amp = 0.5, f = 1;
  for (let o = 0; o < octaves; o++) { sum += amp * (1 - Math.abs(noise(x * f, y * f, z * f))); f *= 2.03; amp *= 0.5; }
  return sum;
}
function fbm(noise, x, y, z, octaves) {
  let sum = 0, amp = 0.5, f = 1;
  for (let o = 0; o < octaves; o++) { sum += amp * noise(x * f, y * f, z * f); f *= 2.03; amp *= 0.5; }
  return sum;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// --- Cloud sprites ------------------------------------------------------------------------

// Kinds of sprite. A sprite's cloud is a cluster of overlapping round lobes (a cumulus is a heap
// of bubbles), eaten into by billowing noise so the outline breaks into cauliflower bulges and
// torn edges; fibres are noise stretched along one direction.
//   puff   a billowed cumulus heap, flat underneath (towers, line clouds, the base's edge)
//   wisp   thin fibres stretched sideways (anvil edges, sheared tops, the anvil's underside)
//   scud   a small torn fragment (round the wall cloud, under the shelf, rising into the base)
//   mist   a soft veil (rain-wrap haze, the inside of a rain shaft, the base seen from below)
//   smoke  a soft puff with faint sideways streaks: the tornado's condensation funnel, built of
//          many of these turning round its axis (as Severity's funnel is)
//   dust   a rougher, denser puff: the dust and debris cloud at a tornado's base (tinted brown)
//   lobes [count, smallest and largest radius]; erode: how deep the noise eats in; scale:
//   noise size; fibre: noise squeezed across (1 none); density: how thick; flat: flat base
export const SPRITES = {
  puff: { lobes: [9, 0.22, 0.42], spread: [0.55, 0.42, 0.45], lift: 0.12, erode: 0.5, scale: 3.2, fibre: [1, 1, 1], density: 14, flat: -0.38, sky: 0.45 },
  wisp: { lobes: [9, 0.16, 0.3], spread: [0.6, 0.12, 0.25], lift: 0, erode: 0.55, scale: 2.6, fibre: [0.25, 2.6, 1.6], density: 5, flat: null, sky: 0.6 },
  scud: { lobes: [7, 0.18, 0.32], spread: [0.38, 0.22, 0.3], lift: 0, erode: 0.6, scale: 3.6, fibre: [0.7, 1.3, 1], density: 10, flat: null, sky: 0.3 },
  mist: { lobes: [4, 0.35, 0.55], spread: [0.35, 0.3, 0.3], lift: 0, erode: 0.45, scale: 1.6, fibre: [1, 1, 1], density: 2.2, flat: null, sky: 0.65, soft: 0.7 },
  smoke: { lobes: [6, 0.4, 0.58], spread: [0.22, 0.2, 0.22], lift: 0, erode: 0.42, scale: 2.2, fibre: [0.5, 1.7, 1.2], density: 3.2, flat: null, sky: 0.6, soft: 0.7 },
  dust: { lobes: [6, 0.38, 0.55], spread: [0.25, 0.2, 0.25], lift: 0, erode: 0.6, scale: 3.2, fibre: [1, 1, 1], density: 5, flat: null, sky: 0.45, soft: 0.5 },
};

function lobesFor(S, seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  const r = () => { a = (Math.imul(a ^ (a >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return a / 4294967296; };
  return Array.from({ length: S.lobes[0] }, (_, k) => {
    const radius = S.lobes[1] + (S.lobes[2] - S.lobes[1]) * r();
    // Bigger lobes near the middle, and (for a heap) higher toward the middle too.
    const c = [(r() * 2 - 1) * S.spread[0], (r() * 2 - 1) * S.spread[1], (r() * 2 - 1) * S.spread[2]];
    c[1] += S.lift * (1 - Math.abs(c[0]) / Math.max(0.01, S.spread[0]));
    const edge = Math.max(Math.abs(c[0]), Math.abs(c[1]), Math.abs(c[2])) + radius;
    const k2 = edge > 0.92 ? 0.92 / edge : 1; // keep it inside the frame
    return { c: c.map(v => v * k2), radius: radius * k2 };
  });
}

// One sprite, size x size. Light comes from above (a little toward the viewer and left).
export function cloudSprite(kind, seed, size = 256) {
  const S = SPRITES[kind], noise = makeNoise(seed), out = new Uint8ClampedArray(size * size * 4);
  const light = norm([-0.35, 0.85, -0.4]), steps = 56, dz = 2 / steps, lobes = lobesFor(S, seed);
  const offset = [seed * 7.13 % 50, seed * 3.71 % 50, seed * 5.37 % 50];
  const density = (x, y, z) => {
    let shape = -1;
    for (const l of lobes) { const d = 1 - Math.hypot(x - l.c[0], y - l.c[1], z - l.c[2]) / l.radius; if (d > shape) shape = d; }
    if (shape < -S.erode) return 0;
    if (S.flat !== null && y < S.flat + 0.08) shape -= (S.flat + 0.08 - y) * 6; // a flat base
    const n = billow(noise, x * S.scale * S.fibre[0] + offset[0], y * S.scale * S.fibre[1] + offset[1], z * S.scale * S.fibre[2] + offset[2], 5);
    // soft: how gradually the cloud thins at its edge (0.18 crisp cumulus, 0.7 soft smoke).
    return smooth(0, S.soft ?? 0.18, shape - S.erode * (1 - n) + 0.12);
  };
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i + 0.5) / size * 2 - 1, y = 1 - (j + 0.5) / size * 2;
    // A different start along each ray, so the steps do not show as rings.
    const jitter = ((Math.imul(i * 73856093 ^ j * 19349663, 2654435761) >>> 0) / 4294967296) * dz;
    let T = 1, lit = 0;
    for (let k = 0; k < steps && T > 0.005; k++) {
      const z = -1 + k * dz + jitter, d = density(x, y, z);
      if (d <= 0.001) continue;
      let toSun = 0;
      for (let s = 1; s <= 5; s++) toSun += density(x + light[0] * s * 0.09, y + light[1] * s * 0.09, z + light[2] * s * 0.09);
      const sunlit = Math.exp(-S.density * 0.55 * toSun * 0.09) * 0.8 + 0.2 * Math.exp(-S.density * toSun * 0.02);
      const skylit = S.sky * (0.45 + 0.55 * (y * 0.5 + 0.5));
      const a = 1 - Math.exp(-S.density * d * dz);
      lit += T * a * (sunlit + skylit);
      T *= 1 - a;
    }
    const alpha = 1 - T, o = (j * size + i) * 4;
    const shade = alpha > 0.001 ? Math.min(1, lit / alpha / (0.8 + S.sky)) : 0;
    const v = 255 * Math.pow(shade, 0.85);
    // Shadowed cloud is a little blue-grey.
    out[o] = Math.round(v * 0.97 + 4); out[o + 1] = Math.round(v * 0.98 + 6); out[o + 2] = Math.round(Math.min(255, v + 16 * (1 - shade) + 6)); out[o + 3] = Math.round(255 * alpha);
  }
  return out;
}

// A flipbook sheet: grid x grid different sprites of one kind (a particle picks one at random,
// so one texture gives many shapes).
export function spriteSheet(kind, seed, frame = 256, grid = 4) {
  const size = frame * grid, sheet = new Uint8ClampedArray(size * size * 4);
  for (let f = 0; f < grid * grid; f++) {
    const sprite = cloudSprite(kind, seed * 100 + f, frame), fx = (f % grid) * frame, fy = Math.floor(f / grid) * frame;
    for (let j = 0; j < frame; j++) sheet.set(sprite.subarray(j * frame * 4, (j + 1) * frame * 4), ((fy + j) * size + fx) * 4);
  }
  return { size, pixels: sheet };
}

// --- Funnel surfaces --------------------------------------------------------------------------

// A tile wrapping round the funnel (u round, v up). twist: how far the streaks wind round per
// tile height. Grey with brighter and darker streaks; opaque (the mesh's own transparency and
// colour do the rest).
export function funnelSurface(kind, seed, size = 512) {
  const noise = makeNoise(seed), out = new Uint8ClampedArray(size * size * 4);
  const turbulent = kind === 'turbulent', twist = turbulent ? 0.6 : 1.4, R = turbulent ? 2.2 : 1.1;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const v = j / size, a = (i / size + v * twist) * Math.PI * 2;
    const cx = Math.cos(a) * R, cz = Math.sin(a) * R, cy = v * (turbulent ? 6 : 2.5);
    let n;
    if (turbulent) {
      n = 0.55 * billow(noise, cx * 1.3, cy * 1.3, cz * 1.3, 5) + 0.35 * (0.5 + 0.5 * fbm(noise, cx * 3, cy * 0.8, cz * 3, 4));
    } else {
      // Long streaks: noise stretched along the winding direction, with fine banding across.
      n = 0.5 + 0.45 * fbm(noise, cx * 2.2, cy * 0.35, cz * 2.2, 4) + 0.08 * Math.sin(a * 24 + 3 * fbm(noise, cx, cy, cz, 2));
    }
    const value = Math.round(255 * Math.min(1, Math.max(0, turbulent ? 0.25 + 0.75 * n : 0.3 + 0.6 * n)));
    const o = (j * size + i) * 4;
    out[o] = value; out[o + 1] = value; out[o + 2] = value; out[o + 3] = 255;
  }
  return out;
}

// Rain: fine streaks, see-through, for curtains and the rain round the camera.
export function rainStreaks(seed, size = 256, density = 0.5) {
  const noise = makeNoise(seed), out = new Uint8ClampedArray(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size;
    const column = noise(u * 90, 0.5, seed) * 0.5 + 0.5, along = noise(u * 90, v * 3, seed + 1) * 0.5 + 0.5;
    const streak = smooth(0.62 - 0.2 * density, 0.8, column) * smooth(0.3, 0.7, along);
    const haze = 0.12 * density * (0.5 + 0.5 * noise(u * 4, v * 4, seed + 2));
    const o = (j * size + i) * 4;
    out[o] = 215; out[o + 1] = 222; out[o + 2] = 232; out[o + 3] = Math.round(255 * Math.min(1, streak * 1.4 + haze));
  }
  return out;
}

function norm(v) { const l = Math.hypot(...v); return v.map(c => c / l); }
