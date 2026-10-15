// A small particle system for the mesh preview page that behaves as Roblox's ParticleEmitter
// does, so what is designed here (js/meshes/tornadoParticles.js) looks the same in the game:
// camera-facing puffs from a 4x4 flipbook (a random frame each), Rate a second, a Lifetime
// range, Size and Transparency sequences over the life, Speed, Acceleration, and LockedToPart:
// the puffs keep their place on their emitter, which turns (spin) and may circle (orbit).
// Drawn as one instanced batch per texture, sorted back to front.
import * as THREE from 'three';

const MAX = 6000;
const vertexShader = `
  attribute vec3 iPos; attribute float iSize; attribute float iAlpha; attribute float iFrame; attribute float iRot; attribute vec3 iColor;
  varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
  void main() {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float c = cos(iRot), s = sin(iRot);
    vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
    vec3 world = iPos + (right * corner.x + up * corner.y) * iSize;
    float col = mod(iFrame, 4.0), row = floor(iFrame / 4.0);
    vUv = (vec2(col, 3.0 - row) + uv) / 4.0;
    vAlpha = iAlpha; vColor = iColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;
const fragmentShader = `
  uniform sampler2D map; uniform float light;
  varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
  void main() {
    vec4 t = texture2D(map, vUv);
    gl_FragColor = vec4(t.rgb * vColor * light, t.a * vAlpha);
    if (gl_FragColor.a < 0.004) discard;
  }`;

const sample = (sequence, t) => {
  if (t <= sequence[0][0]) return sequence[0][1];
  for (let i = 1; i < sequence.length; i++) if (t <= sequence[i][0]) { const [t0, v0] = sequence[i - 1], [t1, v1] = sequence[i]; return v0 + (v1 - v0) * (t - t0) / (t1 - t0 || 1); }
  return sequence[sequence.length - 1][1];
};
const between = ([a, b]) => a + Math.random() * (b - a);

export class ParticleSystem {
  constructor(scene, textureUrl) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.batches = new Map();
    this.emitters = new Map();
    this.particles = [];
    this.textureUrl = textureUrl;
    this.light = 1;
  }
  batch(texture) {
    if (this.batches.has(texture)) return this.batches.get(texture);
    const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    const attrs = { iPos: 3, iSize: 1, iAlpha: 1, iFrame: 1, iRot: 1, iColor: 3 };
    for (const [name, n] of Object.entries(attrs)) geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n).setUsage(THREE.DynamicDrawUsage));
    const map = new THREE.TextureLoader().load(this.textureUrl(texture));
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.ShaderMaterial({ uniforms: { map: { value: map }, light: { value: 1 } }, vertexShader, fragmentShader, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const b = { geometry, material, mesh };
    this.batches.set(texture, b);
    return b;
  }
  // The emitters now (a list from tornadoParticles.js), placed at origin [x, y, z]. Emitters are
  // matched by name, so their turning and their puffs carry on from one call to the next.
  setEmitters(list, origin) {
    const seen = new Set();
    for (const spec of list) {
      seen.add(spec.name);
      const e = this.emitters.get(spec.name) ?? { angle: Math.random() * Math.PI * 2, orbitAngle: spec.orbit?.phase ?? 0, owed: 0 };
      e.spec = spec; e.origin = origin;
      this.emitters.set(spec.name, e);
    }
    for (const [name, e] of this.emitters) if (!seen.has(name)) { e.spec = { ...e.spec, rate: 0 }; e.retired = true; }
  }
  emitterPosition(e) {
    const p = e.spec.position, o = e.origin, orbit = e.spec.orbit;
    const ox = orbit ? Math.cos(e.orbitAngle) * orbit.radius : 0, oz = orbit ? Math.sin(e.orbitAngle) * orbit.radius : 0;
    return [o[0] + p[0] + ox, o[1] + p[1], o[2] + p[2] + oz];
  }
  spawn(e) {
    const s = e.spec, a = Math.random() * Math.PI * 2;
    let local;
    if (s.shape === 'disc') { const r = s.radius * Math.sqrt(Math.random()); local = [Math.cos(a) * r, 0, Math.sin(a) * r]; }
    else if (s.shape === 'column') local = [Math.cos(a) * s.radius, Math.random() * (s.height ?? 0), Math.sin(a) * s.radius];
    else local = [Math.cos(a) * s.radius, (Math.random() - 0.5) * 0.1 * s.size[0][1], Math.sin(a) * s.radius];
    const speed = between(s.speed ?? [0, 0]);
    const dir = s.direction === 'out' ? [Math.cos(a), 0.15, Math.sin(a)] : [0, 1, 0];
    this.particles.push({ e, local, vel: dir.map(d => d * speed), age: 0, life: between(s.lifetime), frame: Math.floor(Math.random() * 16), rot: Math.random() * Math.PI * 2, rotSpeed: (Math.random() - 0.5) * 0.6 });
  }
  update(dt, camera) {
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
    this.particles = alive.slice(-MAX * 2);
    // Place, sort far to near, and fill each texture's batch.
    const cam = camera.position, placed = [];
    for (const p of this.particles) {
      const e = p.e, base = this.emitterPosition(e), c = Math.cos(e.angle), s = Math.sin(e.angle);
      const x = base[0] + c * p.local[0] - s * p.local[2], y = base[1] + p.local[1], z = base[2] + s * p.local[0] + c * p.local[2];
      const t = p.age / p.life;
      placed.push({ p, x, y, z, d: (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2, size: sample(e.spec.size, t), alpha: 1 - sample(e.spec.transparency, t) });
    }
    placed.sort((a, b) => b.d - a.d);
    const counts = new Map();
    for (const q of placed) {
      const b = this.batch(q.p.e.spec.texture), i = counts.get(b) ?? 0;
      if (i >= MAX) continue;
      const g = b.geometry.attributes, col = q.p.e.spec.color ?? [255, 255, 255];
      g.iPos.setXYZ(i, q.x, q.y, q.z); g.iSize.setX(i, q.size); g.iAlpha.setX(i, q.alpha); g.iFrame.setX(i, q.p.frame); g.iRot.setX(i, q.p.rot);
      g.iColor.setXYZ(i, col[0] / 255, col[1] / 255, col[2] / 255);
      counts.set(b, i + 1);
    }
    for (const b of this.batches.values()) {
      const n = counts.get(b) ?? 0;
      b.geometry.instanceCount = n;
      b.material.uniforms.light.value = this.light;
      for (const a of Object.values(b.geometry.attributes)) if (a.isInstancedBufferAttribute) a.needsUpdate = true;
    }
    return placed.length;
  }
  clear() { this.particles = []; this.emitters.clear(); }
}
