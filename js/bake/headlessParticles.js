// Roblox-style particle emitters (js/meshes/tornadoParticles.js), simulated and drawn without a
// GPU, for baking tornado images (scripts/bake-tornadoes.mjs). It behaves as the browser preview
// did (js/pages/particleSim.js, in history) and as Roblox's ParticleEmitter does: Rate a second,
// a Lifetime range, Size and Transparency sequences over the life, Speed, Acceleration, and
// LockedToPart (puffs keep their place on their emitter, which turns and may circle). Seeded, so
// a bake comes out the same every time.

const sample = (sequence, t) => {
  if (t <= sequence[0][0]) return sequence[0][1];
  for (let i = 1; i < sequence.length; i++) {
    if (t <= sequence[i][0]) {
      const [t0, v0] = sequence[i - 1], [t1, v1] = sequence[i];
      return v0 + (v1 - v0) * (t - t0) / (t1 - t0 || 1);
    }
  }
  return sequence[sequence.length - 1][1];
};

export function seededRandom(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (Math.imul(a ^ (a >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    return a / 4294967296;
  };
}

export class HeadlessParticles {
  constructor(seed = 1) {
    this.random = seededRandom(seed);
    this.emitters = new Map();
    this.particles = [];
  }

  between([a, b]) {
    return a + this.random() * (b - a);
  }

  // The emitters now (a list from tornadoParticles.js), at origin [x, y, z]. Matched by name, so
  // their turning and their puffs carry on from one call to the next.
  setEmitters(list, origin = [0, 0, 0]) {
    const seen = new Set();
    for (const spec of list) {
      seen.add(spec.name);
      const e = this.emitters.get(spec.name) ?? { angle: this.random() * Math.PI * 2, orbitAngle: spec.orbit?.phase ?? 0, owed: 0 };
      e.spec = spec;
      e.origin = origin;
      e.retired = false;
      this.emitters.set(spec.name, e);
    }
    for (const [, e] of this.emitters) if (!seen.has(e.spec.name)) { e.spec = { ...e.spec, rate: 0 }; e.retired = true; }
  }

  emitterPosition(e) {
    const p = e.spec.position, o = e.origin, orbit = e.spec.orbit;
    const ox = orbit ? Math.cos(e.orbitAngle) * orbit.radius : 0, oz = orbit ? Math.sin(e.orbitAngle) * orbit.radius : 0;
    return [o[0] + p[0] + ox, o[1] + p[1], o[2] + p[2] + oz];
  }

  spawn(e) {
    const s = e.spec, a = this.random() * Math.PI * 2;
    let local;
    if (s.shape === 'disc') { const r = s.radius * Math.sqrt(this.random()); local = [Math.cos(a) * r, 0, Math.sin(a) * r]; }
    else if (s.shape === 'column') local = [Math.cos(a) * s.radius, this.random() * (s.height ?? 0), Math.sin(a) * s.radius];
    else local = [Math.cos(a) * s.radius, (this.random() - 0.5) * 0.1 * s.size[0][1], Math.sin(a) * s.radius];
    const speed = this.between(s.speed ?? [0, 0]);
    const dir = s.direction === 'out' ? [Math.cos(a), 0.15, Math.sin(a)] : [0, 1, 0];
    this.particles.push({
      e, local, vel: dir.map(d => d * speed), age: 0, life: this.between(s.lifetime),
      frame: Math.floor(this.random() * 16), rot: this.random() * Math.PI * 2, rotSpeed: (this.random() - 0.5) * 0.6,
    });
  }

  step(dt) {
    for (const [name, e] of this.emitters) {
      const s = e.spec;
      e.angle += (s.spin ?? 0) * dt;
      if (s.orbit) e.orbitAngle += s.orbit.rate * dt;
      e.owed += (s.rate ?? 0) * dt;
      while (e.owed >= 1) { e.owed -= 1; this.spawn(e); }
      if (e.retired && !this.particles.some(p => p.e === e)) this.emitters.delete(name);
    }
    const alive = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const acc = p.e.spec.acceleration ?? [0, 0, 0];
      for (let k = 0; k < 3; k++) { p.vel[k] += acc[k] * dt; p.local[k] += p.vel[k] * dt; }
      p.rot += p.rotSpeed * dt;
      alive.push(p);
    }
    this.particles = alive;
  }

  run(seconds, dt = 1 / 30) {
    for (let t = 0; t < seconds; t += dt) this.step(dt);
  }

  // Every live puff in world space: position, size, opacity, colour, texture, frame, rotation.
  placed() {
    const out = [];
    for (const p of this.particles) {
      const e = p.e, base = this.emitterPosition(e), c = Math.cos(e.angle), s = Math.sin(e.angle);
      const t = p.age / p.life;
      out.push({
        x: base[0] + c * p.local[0] - s * p.local[2], y: base[1] + p.local[1], z: base[2] + s * p.local[0] + c * p.local[2],
        size: sample(e.spec.size, t), alpha: 1 - sample(e.spec.transparency, t),
        color: e.spec.color ?? [255, 255, 255], texture: e.spec.texture, frame: p.frame, rot: p.rot,
      });
    }
    return out;
  }
}

// Sheets of sprites, as Roblox flipbooks: { size, grid, pixels } (straight-alpha RGBA).
// Draws `puffs` as camera-facing sprites into a size x size straight-alpha RGBA image, seen
// orthographically from the horizontal direction `bearing` (degrees clockwise from north; the
// camera stands that way from the subject and looks back at it). The image spans `box` studs
// across and up, its bottom edge at height 0 and centred on x = z = 0.
// look: { sizeGain, alphaGain, tint } adjust every puff (bakes draw small and want them fuller).
export function renderPuffs(puffs, sheets, bearing, box, size, look = {}) {
  const sizeGain = look.sizeGain ?? 1, alphaGain = look.alphaGain ?? 1, shade = look.tint ?? 1;
  const b = bearing * Math.PI / 180;
  const toCamera = [Math.sin(b), 0, -Math.cos(b)]; // x east, z south (Roblox)
  const forward = [-toCamera[0], 0, -toCamera[2]];
  const right = [-forward[2], 0, forward[0]]; // forward x up
  const scale = size / box;
  const order = puffs.map(p => ({ p, depth: p.x * forward[0] + p.z * forward[2] }));
  order.sort((a, c) => c.depth - a.depth); // far first
  const acc = new Float32Array(size * size * 4); // premultiplied
  for (const { p } of order) {
    const sheet = sheets[p.texture];
    const alpha = Math.min(1, p.alpha * alphaGain);
    if (!sheet || alpha <= 0.003) continue;
    const cx = (p.x * right[0] + p.z * right[2]) * scale + size / 2;
    const cy = size - p.y * scale;
    // Darker toward the ground, as the funnel is in its own shadow and dust.
    const low = Math.min(1, Math.max(0, p.y / (box * 0.6)));
    const half = p.size * sizeGain * scale / 2;
    if (half < 0.35) continue;
    const reach = half * 1.42;
    const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(size - 1, Math.ceil(cx + reach));
    const y0 = Math.max(0, Math.floor(cy - reach)), y1 = Math.min(size - 1, Math.ceil(cy + reach));
    if (x0 > x1 || y0 > y1) continue;
    const cell = sheet.size / sheet.grid, fx = (p.frame % sheet.grid) * cell, fy = Math.floor(p.frame / sheet.grid) * cell;
    const cos = Math.cos(p.rot), sin = Math.sin(p.rot);
    const k = shade * (0.78 + 0.22 * low);
    const tint = [p.color[0] / 255 * k, p.color[1] / 255 * k, p.color[2] / 255 * k];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / half, dy = (y + 0.5 - cy) / half;
        const u = cos * dx + sin * dy, v = -sin * dx + cos * dy; // -1..1 in the sprite
        if (u <= -1 || u >= 1 || v <= -1 || v >= 1) continue;
        // Bilinear sample of the sprite cell.
        const sx = (u * 0.5 + 0.5) * (cell - 1), sy = (v * 0.5 + 0.5) * (cell - 1);
        const ix = Math.floor(sx), iy = Math.floor(sy), tx = sx - ix, ty = sy - iy;
        const ix1 = Math.min(cell - 1, ix + 1), iy1 = Math.min(cell - 1, iy + 1);
        const w = sheet.size, px = sheet.pixels;
        const i00 = ((fy + iy) * w + fx + ix) * 4, i10 = ((fy + iy) * w + fx + ix1) * 4;
        const i01 = ((fy + iy1) * w + fx + ix) * 4, i11 = ((fy + iy1) * w + fx + ix1) * 4;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const ta = (px[i00 + 3] * w00 + px[i10 + 3] * w10 + px[i01 + 3] * w01 + px[i11 + 3] * w11) / 255;
        const a = ta * alpha;
        if (a <= 0.001) continue;
        const o = (y * size + x) * 4, keep = 1 - a;
        for (let c = 0; c < 3; c++) {
          const tc = (px[i00 + c] * w00 + px[i10 + c] * w10 + px[i01 + c] * w01 + px[i11 + c] * w11) / 255;
          acc[o + c] = tc * tint[c] * a + acc[o + c] * keep;
        }
        acc[o + 3] = a + acc[o + 3] * keep;
      }
    }
  }
  return acc;
}

// Premultiplied float RGBA (size x size) halved to straight-alpha bytes (size/2 x size/2).
export function downsampleHalf(acc, size) {
  const half = size / 2, out = new Uint8ClampedArray(half * half * 4);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      let r = 0, g = 0, bl = 0, a = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((y * 2 + dy) * size + x * 2 + dx) * 4;
        r += acc[i]; g += acc[i + 1]; bl += acc[i + 2]; a += acc[i + 3];
      }
      const o = (y * half + x) * 4;
      a /= 4;
      if (a > 0.0001) {
        out[o] = Math.round(255 * Math.min(1, r / 4 / a));
        out[o + 1] = Math.round(255 * Math.min(1, g / 4 / a));
        out[o + 2] = Math.round(255 * Math.min(1, bl / 4 / a));
      }
      out[o + 3] = Math.round(255 * Math.min(1, a));
    }
  }
  return out;
}
