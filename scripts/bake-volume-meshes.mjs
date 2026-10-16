// Bakes the storm-volume shell meshes (roblox/Client/Modules/Weather/Volumes.luau) as .glb, for
// upload as ordinary mesh assets where the game cannot make them itself (EditableMesh refused or
// over budget). Each kind (cloud, rain, band) x variant x shell is one mesh: the same grid,
// UV layout, seeds and noise as Volumes.luau builds, so the textures it lights there fit.
//   node scripts/bake-volume-meshes.mjs [--out roblox/Textures/build]
// Writes volumes/<kind>-<variant>-<shell>.glb and adds `volumes` to manifest.json.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glb } from '../js/bake/glb.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const OUT = path.resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'roblox/Textures/build');

// As Volumes.luau.
const KINDS = ['cloud', 'rain', 'band'];
const VARIANTS = 3, SHELLS = 3, U = 32, V = 16, NOISE = 32;

const hash32 = i => {
  let h = Math.imul((i + 1789) >>> 0, 0x9E3779B1) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x85EBCA77) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
};
const lattice = new Float32Array(NOISE ** 3).map((_, i) => hash32(i) / 4294967296);
const wrap = v => ((v % NOISE) + NOISE) % NOISE;
const at = (x, y, z) => lattice[(wrap(z) * NOISE + wrap(y)) * NOISE + wrap(x)];
function noise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const c000 = at(ix, iy, iz), c100 = at(ix + 1, iy, iz), c010 = at(ix, iy + 1, iz), c110 = at(ix + 1, iy + 1, iz);
  const c001 = at(ix, iy, iz + 1), c101 = at(ix + 1, iy, iz + 1), c011 = at(ix, iy + 1, iz + 1), c111 = at(ix + 1, iy + 1, iz + 1);
  const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx, x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

// As surfacePoint in Volumes.luau.
function surfacePoint(kind, i, j, seed) {
  const a = i / U * Math.PI * 2;
  if (kind === 'band') {
    const b = j / V * Math.PI * 2;
    const tube = 0.22 * (0.85 + 0.3 * noise(Math.cos(a) * 4 + seed, Math.sin(b) * 2, Math.sin(a) * 4));
    const radial = 0.78 + tube * Math.cos(b);
    return [Math.cos(a) * radial, tube * Math.sin(b) / 0.22 * 0.5, Math.sin(a) * radial];
  }
  const polar = j / V * Math.PI;
  const dir = [Math.sin(polar) * Math.cos(a), Math.cos(polar), Math.sin(polar) * Math.sin(a)];
  const bump = kind === 'rain'
    ? 0.82 + 0.3 * noise(dir[0] * 5 + seed, dir[1] * 0.7, dir[2] * 5)
    : 0.72 + 0.35 * noise(dir[0] * 2.4 + seed, dir[1] * 2.4, dir[2] * 2.4) + 0.12 * noise(dir[0] * 6, dir[1] * 6 + seed, dir[2] * 6);
  return dir.map(c => c * bump);
}

function mesh(kind, seed) {
  const positions = [], normals = [], uvs = [], indices = [];
  const id = (i, j) => j * (U + 1) + i;
  for (let j = 0; j <= V; j++) {
    for (let i = 0; i <= U; i++) {
      const p = surfacePoint(kind, i % U, j, seed);
      positions.push(...p);
      uvs.push(i / U, j / V);
      // Outward: from the centre (a band: from its ring).
      let n = p;
      if (kind === 'band') { const r = Math.hypot(p[0], p[2]) || 1; n = [p[0] - p[0] / r * 0.78, p[1], p[2] - p[2] / r * 0.78]; }
      const l = Math.hypot(...n) || 1;
      normals.push(n[0] / l, n[1] / l, n[2] / l);
    }
  }
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < U; i++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, normals, uvs, indices };
}

mkdirSync(path.join(OUT, 'volumes'), { recursive: true });
const volumes = {};
for (const kind of KINDS) {
  volumes[kind] = [];
  for (let variant = 1; variant <= VARIANTS; variant++) {
    const files = [];
    for (let shell = 1; shell <= SHELLS; shell++) {
      const seed = variant * 7.31 + shell * 0.37;
      const name = `${kind}-${variant}-${shell}`;
      writeFileSync(path.join(OUT, 'volumes', `${name}.glb`), glb(mesh(kind, seed), name));
      files.push(`volumes/${name}.glb`);
    }
    volumes[kind].push(files);
  }
}
const manifestFile = path.join(OUT, 'manifest.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
manifest.volumes = volumes;
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log(`${KINDS.length * VARIANTS * SHELLS} volume meshes -> ${path.relative(ROOT, path.join(OUT, 'volumes'))}`);
