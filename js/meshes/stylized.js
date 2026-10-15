// Stylized (low-poly, flat-shaded) meshes for the storms in Roblox. Each is made from a seed and
// a few shape settings, so any number of variants come from one design. The preview page
// (meshes.html) builds them live; scripts/export-meshes.mjs writes the approved ones as .obj for
// upload. The tornado funnel is not uploaded: Roblox builds it every frame with EditableMesh
// from the engine's funnel profile, by the same steps as funnelMesh() here.
//
// A mesh is { positions: number[] } of whole triangles (x, y, z per corner, three corners per
// triangle, counter-clockwise seen from outside), so every face is flat. Static meshes fit the
// unit cube centred on the origin (-0.5..0.5 each way): in Roblox a MeshPart's Size is then its
// size in studs. Axes: x across, y up, z along (forward / downwind).

// --- Randomness and noise -------------------------------------------------------------------

export function rng(seed) {
  let a = (Number(seed) * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// Smooth value noise in 0-1.
export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const s = t => t * t * (3 - 2 * t), u = s(fx), v = s(fy), w = s(fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
           l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

// --- Building blocks ------------------------------------------------------------------------

// An icosphere: { vertices: [[x,y,z]], faces: [[a,b,c]] }, `detail` times subdivided.
function icosphere(detail) {
  const t = (1 + Math.sqrt(5)) / 2;
  let vertices = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map(v => { const n = Math.hypot(...v); return v.map(c => c / n); });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const cache = new Map(), next = [];
    const mid = (a, b) => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!cache.has(key)) { const m = vertices[a].map((c, i) => c + vertices[b][i]); const n = Math.hypot(...m); vertices.push(m.map(c => c / n)); cache.set(key, vertices.length - 1); }
      return cache.get(key);
    };
    for (const [a, b, c] of faces) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    faces = next;
  }
  return { vertices, faces };
}

// Triangles from shared vertices (flat faces: corners are written per triangle).
function triangles(vertices, faces) {
  const positions = [];
  for (const [a, b, c] of faces) positions.push(...vertices[a], ...vertices[b], ...vertices[c]);
  return { positions };
}

// Scales and centres a mesh into the unit cube (keeping proportions unless `stretch`).
function fitUnit(mesh, stretch = true) {
  const p = mesh.positions, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { lo[i % 3] = Math.min(lo[i % 3], p[i]); hi[i % 3] = Math.max(hi[i % 3], p[i]); }
  const size = hi.map((h, i) => h - lo[i] || 1), largest = Math.max(...size);
  for (let i = 0; i < p.length; i++) { const k = i % 3; p[i] = (p[i] - (lo[k] + hi[k]) / 2) / (stretch ? size[k] : largest); }
  return mesh;
}

// A ring of points round the y axis at height y: radius r, `sides` corners, each pushed in or
// out by up to `jag` of the radius and turned by `turn` radians.
function ring(sides, r, y, jag, random, turn = 0) {
  return Array.from({ length: sides }, (_, i) => {
    const a = turn + (i + (random() - 0.5) * 0.35) / sides * Math.PI * 2, rr = r * (1 + (random() - 0.5) * 2 * jag);
    return [Math.cos(a) * rr, y, Math.sin(a) * rr];
  });
}
// The band of triangles joining two rings of the same length (lower, upper).
function band(out, lower, upper) {
  const n = lower.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push(...lower[i], ...upper[i], ...upper[j], ...lower[i], ...upper[j], ...lower[j]);
  }
}
// A cap closing a ring at a point (up: facing up).
function cap(out, ringPoints, centre, up) {
  const n = ringPoints.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (up) out.push(...ringPoints[i], ...centre, ...ringPoints[j]); else out.push(...ringPoints[i], ...ringPoints[j], ...centre);
  }
}

// --- The cloud meshes -----------------------------------------------------------------------

// A cumulus puff: a few big rounded lobes over a flat base, with chunky facets.
//   detail     subdivisions (1 chunky, 2 smoother)
//   lobes      how many lobes bulge out of it
//   lobeSize   how far they bulge
//   flatBase   where the flat underside is cut (share of the height from the bottom)
//   lumps      small irregularity
export const PUFF = { detail: 2, lobes: 5, lobeSize: 0.45, flatBase: 0.3, lumps: 0.12 };
export function puffMesh(seed = 1, o = {}) {
  const P = { ...PUFF, ...o }, random = rng(seed), { vertices, faces } = icosphere(P.detail);
  const lobes = Array.from({ length: P.lobes }, () => {
    const a = random() * Math.PI * 2, up = 0.15 + 0.8 * random(); // mostly on the upper side
    const d = [Math.cos(a) * Math.sqrt(1 - up * up), up, Math.sin(a) * Math.sqrt(1 - up * up)];
    return { d, size: P.lobeSize * (0.5 + random()) };
  });
  const cut = -1 + 2 * P.flatBase;
  const shaped = vertices.map(v => {
    let r = 1;
    for (const lobe of lobes) r += lobe.size * Math.max(0, v[0] * lobe.d[0] + v[1] * lobe.d[1] + v[2] * lobe.d[2] - 0.35) ** 2 * 2.4;
    r += P.lumps * (noise3(v[0] * 2.2 + 9, v[1] * 2.2, v[2] * 2.2, seed) - 0.5) * 2;
    const p = v.map(c => c * r);
    if (p[1] < cut) p[1] = cut + (p[1] - cut) * 0.08; // flat underside
    return p;
  });
  return fitUnit(triangles(shaped, faces));
}

// An anvil: flat on top, spreading and thinning downwind (+z), ragged at the edge, a shallow
// bulge underneath.
export const ANVIL = { sides: 16, spread: 0.55, edge: 0.18, sag: 0.35 };
export function anvilMesh(seed = 1, o = {}) {
  const P = { ...ANVIL, ...o }, random = rng(seed), out = [];
  const outline = Array.from({ length: P.sides }, (_, i) => {
    const a = i / P.sides * Math.PI * 2, z = Math.sin(a) * 0.5;
    const half = 0.5 * ((1 - P.spread) + P.spread * (z + 0.5)); // wider downwind
    const r = 1 + (random() - 0.5) * 2 * P.edge;
    return [Math.cos(a) * half * r, z * r];
  });
  const top = outline.map(([x, z]) => [x, 0.5, z]);
  const rim = outline.map(([x, z], i) => [x * 0.92, 0.5 - 0.35 * (0.6 + 0.4 * random()), z * 0.92]);
  const under = outline.map(([x, z]) => [x * 0.55, 0.5 - 0.35 - P.sag * (0.7 + 0.3 * random()) * (0.5 - z * 0.6), z * 0.55]);
  cap(out, top, [0, 0.5, 0], true);
  band(out, rim, top);
  band(out, under, rim);
  cap(out, under, [0, 0.5 - 0.35 - P.sag, -0.05], false);
  return fitUnit({ positions: out });
}

// A shelf cloud segment along x, facing +z: a smooth sloping top, a steep leading face and a
// ragged, stepped underside. Laid end to end (and in tiers) along a gust front.
export const SHELF = { slices: 6, slope: 0.55, steps: 2, rag: 0.12 };
export function shelfMesh(seed = 1, o = {}) {
  const P = { ...SHELF, ...o }, random = rng(seed), out = [];
  // Cross-section in (z, y), from the back along the top, down the front, back along the bottom.
  const section = () => {
    const pts = [[-0.5, 0.5], [0.2, 0.5 - 0.25 * P.slope], [0.5, 0.05]];
    for (let s = 1; s <= P.steps; s++) pts.push([0.5 - 0.18 * s, 0.05 - 0.3 * s / P.steps + (random() - 0.5) * P.rag], [0.5 - 0.18 * s - 0.08, 0.05 - 0.3 * s / P.steps]);
    pts.push([-0.5, -0.1]);
    return pts.map(([z, y]) => [z + (random() - 0.5) * P.rag * 0.6, y + (random() - 0.5) * P.rag]);
  };
  const slices = Array.from({ length: P.slices + 1 }, (_, i) => section().map(([z, y]) => [-0.5 + i / P.slices, y, z]));
  for (let i = 0; i < P.slices; i++) {
    const a = slices[i], b = slices[i + 1], n = a.length;
    for (let k = 0; k < n; k++) { const m = (k + 1) % n; out.push(...a[k], ...b[m], ...b[k], ...a[k], ...a[m], ...b[m]); }
  }
  // Close the ends.
  const end = (s, flip) => { for (let k = 1; k < s.length - 1; k++) out.push(...s[0], ...(flip ? s[k + 1] : s[k]), ...(flip ? s[k] : s[k + 1])); };
  end(slices[0], true); end(slices[P.slices], false);
  return fitUnit({ positions: out });
}

// A wall cloud: a squat lowering, ragged underneath. (Its turning is the MeshPart turning.)
export const WALL = { sides: 12, taper: 0.8, rag: 0.15 };
export function wallCloudMesh(seed = 1, o = {}) {
  const P = { ...WALL, ...o }, random = rng(seed), out = [];
  const top = ring(P.sides, 0.5, 0.5, 0.04, random);
  const mid = ring(P.sides, 0.5 * (1 + P.taper) / 2 + 0.05, 0, P.rag, random, 0.1);
  const low = ring(P.sides, 0.5 * P.taper, -0.45, P.rag, random, 0.2).map(p => [p[0], p[1] + (random() - 0.5) * P.rag, p[2]]);
  cap(out, top, [0, 0.5, 0], true); band(out, mid, top); band(out, low, mid); cap(out, low, [0, -0.5, 0], false);
  return fitUnit({ positions: out });
}

// Scud: a small torn fragment.
export function scudMesh(seed = 1) {
  const m = puffMesh(seed, { detail: 1, lobes: 3, lobeSize: 0.6, flatBase: 0.05, lumps: 0.3 });
  return fitUnit(m);
}

// Mammatus: rounded pouches hanging from a flat top.
export const MAMMA = { pouches: 7, detail: 1 };
export function mammatusMesh(seed = 1, o = {}) {
  const P = { ...MAMMA, ...o }, random = rng(seed), out = [];
  const { vertices, faces } = icosphere(P.detail);
  for (let k = 0; k < P.pouches; k++) {
    const cx = (random() - 0.5) * 1.6, cz = (random() - 0.5) * 1.6, r = 0.35 + 0.25 * random();
    for (const [a, b, c] of faces) {
      const tri = [vertices[a], vertices[b], vertices[c]];
      if (tri.every(v => v[1] > 0.05)) continue; // keep the lower half
      for (const v of tri) out.push(cx + v[0] * r, Math.min(0, v[1]) * r * 1.3, cz + v[2] * r);
    }
  }
  return fitUnit({ positions: out });
}

// A rain or hail curtain: a tall, slightly flared column with fluted sides.
export const CURTAIN = { sides: 10, flare: 0.25, flutes: 0.12 };
export function curtainMesh(seed = 1, o = {}) {
  const P = { ...CURTAIN, ...o }, random = rng(seed), out = [];
  const rings = [0, 0.35, 0.7, 1].map((f, i) => ring(P.sides, 0.5 * (1 - P.flare * (1 - f)) , -0.5 + f, P.flutes, random, i * 0.12));
  for (let i = 0; i < rings.length - 1; i++) band(out, rings[i], rings[i + 1]);
  cap(out, rings[rings.length - 1], [0, 0.5, 0], true);
  return fitUnit({ positions: out });
}

// A piece of debris: an irregular shard.
export function debrisMesh(seed = 1) {
  const random = rng(seed), { vertices, faces } = icosphere(0);
  return fitUnit(triangles(vertices.map(v => v.map(c => c * (0.55 + 0.9 * random()))), faces));
}

// --- The tornado funnel (built live in Roblox) -----------------------------------------------

// The funnel from the engine's profile (StormAppearance: funnelRadiusM at evenly spaced heights
// from the ground to the cloud base, 0 where uncondensed). In studs, as Roblox draws it:
//   radiiStuds   the profile's radii already scaled across (TORNADO_STUDS_PER_METRE)
//   heightStuds  ground to cloud base (SKY_STUDS_PER_METRE)
//   leanX/leanZ  where the top sits relative to the ground point (studs)
//   lowest       share of the height below which nothing is drawn (touching down: 1 - touch)
//   wobble       the decaying funnel's twist (contortion, 0-1)
//   spin         radians the facets have turned (they turn with the wind)
//   sides, rings facets round and up
// The funnel's tip, where the condensation stops, closes to a point.
export const FUNNEL = { sides: 9, rings: 14, jag: 0.12 };
export function funnelMesh({ radiiStuds, heightStuds, leanX = 0, leanZ = 0, lowest = 0, wobble = 0, spin = 0, seed = 1, sides = FUNNEL.sides, rings = FUNNEL.rings, jag = FUNNEL.jag }) {
  const out = [], n = radiiStuds.length;
  const radiusAt = f => {
    const x = Math.min(Math.max(f, 0), 1) * (n - 1), i = Math.min(Math.floor(x), n - 2), a = radiiStuds[i], b = radiiStuds[i + 1];
    return a <= 0 || b <= 0 ? (x - i < 0.5 ? a : b) : a + (b - a) * (x - i);
  };
  // The lowest share of the height with cloud.
  let bottom = 1;
  for (let k = 0; k <= 200; k++) { const f = k / 200; if (radiusAt(f) > 0) { bottom = f; break; } }
  bottom = Math.max(bottom, lowest);
  if (bottom >= 0.999) return { positions: out };
  const random = rng(seed);
  const jitter = Array.from({ length: (rings + 1) * sides }, () => random());
  const axis = f => {
    const side = Math.hypot(leanX, leanZ) > 1e-6 ? [-leanZ / Math.hypot(leanX, leanZ), leanX / Math.hypot(leanX, leanZ)] : [1, 0];
    const w = wobble * 0.12 * heightStuds * Math.sin(f * Math.PI * 2.5 + seed) * Math.sin(f * Math.PI);
    return [leanX * f + side[0] * w, f * heightStuds, leanZ * f + side[1] * w];
  };
  const rows = [];
  for (let r = 0; r <= rings; r++) {
    // Rings closer together near the tip, where the shape changes fastest.
    const f = bottom + (1 - bottom) * (r / rings) ** 1.4, c = axis(f), radius = Math.max(r === 0 ? 0 : 1, radiusAt(f));
    rows.push(Array.from({ length: sides }, (_, i) => {
      const a = spin * (1 - 0.5 * f) + (i + (jitter[r * sides + i] - 0.5) * 0.3) / sides * Math.PI * 2;
      const rr = radius * (1 + (jitter[r * sides + i] - 0.5) * 2 * jag);
      return [c[0] + Math.cos(a) * rr, c[1], c[2] + Math.sin(a) * rr];
    }));
  }
  for (let r = 0; r < rings; r++) band(out, rows[r], rows[r + 1]);
  return { positions: out };
}

// Every static mesh by name, with its default settings (for the page and the exporter).
export const MESHES = {
  puff: { make: puffMesh, settings: PUFF, colour: '#e2e2e6', note: 'Updraught towers, line clouds, anvil root' },
  anvil: { make: anvilMesh, settings: ANVIL, colour: '#d6d8de', note: 'The anvil, spreading downwind (+z)' },
  shelf: { make: shelfMesh, settings: SHELF, colour: '#4e5662', note: 'Shelf cloud segment along x, facing +z' },
  wallCloud: { make: wallCloudMesh, settings: WALL, colour: '#34373e', note: 'Wall cloud; turned in game' },
  scud: { make: scudMesh, settings: {}, colour: '#60646c', note: 'Scud round the wall cloud, tail cloud pieces' },
  mammatus: { make: mammatusMesh, settings: MAMMA, colour: '#c8cad2', note: 'Under a mature anvil' },
  curtain: { make: curtainMesh, settings: CURTAIN, colour: '#5c6674', note: 'Rain and hail shafts (drawn see-through)' },
  debris: { make: debrisMesh, settings: {}, colour: '#463e36', note: 'Debris thrown round a tornado' },
};

export const triangleCount = mesh => mesh.positions.length / 9;

// The mesh as Wavefront OBJ text, with a normal per face.
export function toObj(mesh, name = 'mesh') {
  const p = mesh.positions, lines = [`# ${name}: ${triangleCount(mesh)} triangles (js/meshes/stylized.js)`, `o ${name}`];
  for (let i = 0; i < p.length; i += 3) lines.push(`v ${p[i].toFixed(5)} ${p[i + 1].toFixed(5)} ${p[i + 2].toFixed(5)}`);
  for (let t = 0; t < p.length / 9; t++) {
    const a = p.slice(t * 9, t * 9 + 3), b = p.slice(t * 9 + 3, t * 9 + 6), c = p.slice(t * 9 + 6, t * 9 + 9);
    const u = b.map((x, i) => x - a[i]), v = c.map((x, i) => x - a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], len = Math.hypot(...n) || 1;
    lines.push(`vn ${(n[0] / len).toFixed(4)} ${(n[1] / len).toFixed(4)} ${(n[2] / len).toFixed(4)}`);
  }
  for (let t = 0; t < p.length / 9; t++) lines.push(`f ${3 * t + 1}//${t + 1} ${3 * t + 2}//${t + 1} ${3 * t + 3}//${t + 1}`);
  return lines.join('\n') + '\n';
}
