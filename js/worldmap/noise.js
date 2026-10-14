// Seeded 2D gradient noise for the world map generator: the same seed always gives the same map.

export function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}

// Uniform numbers in [0, 1) from a 32-bit seed (mulberry32).
export function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gradient noise in about [-1, 1], zero on integer lattice points; one independent field per name.
export function makeNoise(seed, name) {
  const random = makeRandom(hashText(`${seed}|${name}`));
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512), gx = new Float64Array(16), gy = new Float64Array(16);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let k = 0; k < 16; k++) { gx[k] = Math.cos(2 * Math.PI * k / 16); gy[k] = Math.sin(2 * Math.PI * k / 16); }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const g = (i, j, dx, dy) => { const h = perm[perm[X + i] + Y + j] & 15; return gx[h] * dx + gy[h] * dy; };
    const u = fade(xf), v = fade(yf);
    const a = g(0, 0, xf, yf) + u * (g(1, 0, xf - 1, yf) - g(0, 0, xf, yf));
    const b = g(0, 1, xf, yf - 1) + u * (g(1, 1, xf - 1, yf - 1) - g(0, 1, xf, yf - 1));
    return 1.4 * (a + v * (b - a));
  };
}

// Fractal sum of octaves, normalised to about [-1, 1].
export function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * noise(x * freq + o * 17.31, y * freq - o * 9.77); norm += amp; amp *= gain; freq *= lacunarity; }
  return sum / norm;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (lo, hi, v) => { const t = clamp((v - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); };
