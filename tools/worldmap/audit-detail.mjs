// Detail behind the audit: flat-filled ground, noise amplitude, junction clusters, ramps, islands.
//   node audit-detail.mjs <map dir> <repo root> <out dir>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [dir, repo, outDir] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const sj = JSON.parse(readFileSync(path.join(dir, 'streets.json'), 'utf8'));
const n = meta.size, cellMi = meta.cellMiles, SPM = 600;
const buf = p => { const b = readFileSync(path.join(dir, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const elev = new Float32Array(buf('elevation.f32')), region = new Uint8Array(buf('region.u8'));
const pct = (v, q) => { const s = Float64Array.from(v).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// Flat-filled ground: cells whose 8 neighbours are all within 2 cm (the pit fill leaves 1 mm steps).
const flat = meta.regions.map(() => 0), count = meta.regions.map(() => 0);
for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
  const k = j * n + i; let d = 0;
  for (const o of [-1, 1, -n, n, -n - 1, -n + 1, n - 1, n + 1]) d = Math.max(d, Math.abs(elev[k + o] - elev[k]));
  count[region[k]]++; if (d < 0.02) flat[region[k]]++;
}
console.log('ground levelled dead flat by the pit fill (all 8 neighbours within 2 cm):');
meta.regions.forEach((r, k) => console.log(`  ${r.name.padEnd(17)} ${(100 * flat[k] / count[k]).toFixed(0)}%`));
console.log(`  whole map ${(100 * flat.reduce((a, b) => a + b) / count.reduce((a, b) => a + b)).toFixed(0)}%`);

// The noise the relief is made from: how big is fbm really?
const { makeNoise, fbm } = await import(pathToFileURL(path.join(repo, 'js/worldmap/noise.js')).href);
const relief = makeNoise(1, 'relief');
for (const oct of [3, 5]) { const v = []; for (let k = 0; k < 40000; k++) v.push(fbm(relief, (k % 200) * 0.173 + 3.1, Math.floor(k / 200) * 0.173 - 7.7, oct)); console.log(`fbm with ${oct} octaves: p5 ${pct(v, 0.05).toFixed(2)}, p50 ${pct(v, 0.5).toFixed(2)}, p95 ${pct(v, 0.95).toFixed(2)}, min ${Math.min(...v).toFixed(2)}, max ${Math.max(...v).toFixed(2)}, rms ${Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length).toFixed(2)}`); }

// Rebuild the starting surface (before erosion) for comparison: use the generator with erosion off.
const gen = await import(pathToFileURL(path.join(repo, 'js/worldmap/WorldMapGenerator.js')).href);
console.log('generator exports:', Object.keys(gen).join(', '));

// Roads.
const sb = readFileSync(path.join(dir, 'streets.bin'));
const N = sj.nodes, E = sj.edges; let off = 0;
const take = (Type, c) => { const bytes = Type.BYTES_PER_ELEMENT * c; const a = new Type(sb.buffer.slice(sb.byteOffset + off, sb.byteOffset + off + bytes)); off += bytes; return a; };
const xy = take(Float32Array, 2 * N), control = take(Uint8Array, N), end = take(Uint8Array, N), pairs = take(Uint32Array, 2 * E), kinds = take(Uint8Array, E), roadOf = take(Int32Array, E);
const KIND = sj.kinds, ki = Object.fromEntries(KIND.map((k, i) => [k, i]));
const nodeEdges = Array.from({ length: N }, () => []);
for (let e = 0; e < E; e++) { nodeEdges[pairs[2 * e]].push(e); nodeEdges[pairs[2 * e + 1]].push(e); }
const len = e => Math.hypot(xy[2 * pairs[2 * e]] - xy[2 * pairs[2 * e + 1]], xy[2 * pairs[2 * e] + 1] - xy[2 * pairs[2 * e + 1] + 1]);

function dump(title, cx, cy, r) {
  console.log(`\n--- ${title}: nodes within ${Math.round(r * SPM)} studs of (${cx}, ${cy}) ---`);
  const ids = []; for (let v = 0; v < N; v++) if (Math.hypot(xy[2 * v] - cx, xy[2 * v + 1] - cy) < r) ids.push(v);
  for (const v of ids.slice(0, 14)) console.log(`  node ${v} at (${xy[2 * v].toFixed(3)}, ${xy[2 * v + 1].toFixed(3)}) control ${sj.controls[control[v]]} end ${sj.ends[end[v]]}: ` + nodeEdges[v].map(e => { const o = pairs[2 * e] === v ? pairs[2 * e + 1] : pairs[2 * e]; return `${KIND[kinds[e]]}${roadOf[e] >= 0 ? '#' + roadOf[e] : ''}->${o}(${Math.round(len(e) * SPM)}st)`; }).join(', '));
  if (ids.length > 14) console.log(`  ... ${ids.length} nodes in all`);
}
dump('12-way junction', 272.02, 278, 0.08);
dump('highway beside the section line', 38, 20.01, 0.08);
dump('interstate meets collector', 171.5, 124, 0.03);
dump('interstate island', 406.38, 129, 0.05);

// Junction clusters: groups of junction nodes within 40 studs of each other (should be one junction).
{
  const C = 0.1, grid = new Map(); const junction = v => nodeEdges[v].length >= 3;
  for (let v = 0; v < N; v++) if (junction(v)) { const k = Math.floor(xy[2 * v] / C) * 8192 + Math.floor(xy[2 * v + 1] / C); (grid.get(k) ?? grid.set(k, []).get(k)).push(v); }
  let pairsClose = 0; const byKinds = {};
  for (let v = 0; v < N; v++) {
    if (!junction(v)) continue;
    const X = Math.floor(xy[2 * v] / C), Y = Math.floor(xy[2 * v + 1] / C);
    for (let a = X - 1; a <= X + 1; a++) for (let b = Y - 1; b <= Y + 1; b++) for (const o of grid.get(a * 8192 + b) ?? []) {
      if (o <= v) continue;
      const d = Math.hypot(xy[2 * v] - xy[2 * o], xy[2 * v + 1] - xy[2 * o + 1]) * SPM;
      if (d < 40) { pairsClose++; const top = w => KIND[Math.min(...nodeEdges[w].map(e => kinds[e]))]; const key = [top(v), top(o)].sort().join(' + '); byKinds[key] = (byKinds[key] ?? 0) + 1; }
    }
  }
  console.log(`\njunction nodes (3+ roads) closer than 40 studs to another junction node: ${pairsClose} pairs; by the biggest road at each:`);
  for (const [k, c] of Object.entries(byKinds).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(c).padStart(5)}  ${k}`);
}

// Islands: size and where, leaving out those on the map's edge.
{
  const comp = new Int32Array(N).fill(-1); const comps = [];
  for (let s = 0; s < N; s++) { if (comp[s] >= 0) continue; const c = { nodes: [], miles: 0 }; const stack = [s]; comp[s] = comps.length; while (stack.length) { const v = stack.pop(); c.nodes.push(v); for (const e of nodeEdges[v]) { const o = pairs[2 * e] === v ? pairs[2 * e + 1] : pairs[2 * e]; if (comp[o] < 0) { comp[o] = comps.length; stack.push(o); } } } comps.push(c); }
  for (let e = 0; e < E; e++) comps[comp[pairs[2 * e]]].miles += len(e);
  comps.sort((a, b) => b.nodes.length - a.nodes.length);
  const rows = {};
  for (const c of comps.slice(1)) {
    const e = nodeEdges[c.nodes[0]][0]; const kind = e === undefined ? 'lone' : KIND[kinds[e]];
    const edge = c.nodes.some(v => xy[2 * v] < 0.6 || xy[2 * v + 1] < 0.6 || xy[2 * v] > 499.4 || xy[2 * v + 1] > 499.4);
    const r = rows[kind] ??= { n: 0, onEdge: 0, miles: 0, at: [] }; r.n++; if (edge) r.onEdge++; r.miles += c.miles; if (!edge && r.at.length < 5) r.at.push(`(${xy[2 * c.nodes[0]].toFixed(2)}, ${xy[2 * c.nodes[0] + 1].toFixed(2)}; ${c.miles.toFixed(2)} mi)`);
  }
  console.log('\nroad pieces not joined to the main network:');
  for (const [k, r] of Object.entries(rows).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(10)} ${String(r.n).padStart(5)} pieces, ${r.miles.toFixed(0)} mi, ${r.onEdge} touch the map's edge; e.g. ${r.at.join(' ')}`);
  const total = Array.from({ length: E }, (_, e) => len(e)).reduce((a, b) => a + b, 0);
  console.log(`  whole graph ${total.toFixed(0)} mi; main network ${comps[0].miles.toFixed(0)} mi`);
  // Kinds present in the main network.
  const mainKinds = {}; const mainId = comp[comps[0].nodes[0]];
  for (let e = 0; e < E; e++) { const k = KIND[kinds[e]]; const m = mainKinds[k] ??= [0, 0]; m[comp[pairs[2 * e]] === mainId ? 0 : 1] += len(e); }
  console.log('  miles in / out of the main network by kind: ' + Object.entries(mainKinds).map(([k, m]) => `${k} ${m[0].toFixed(0)}/${m[1].toFixed(0)}`).join(', '));
}

// One interchange in full, as SVG, and a relief picture.
function svg(name, cx, cy, r) {
  const W = 900, s = W / (2 * r), col = { interstate: '#c22', expressway: '#e70', highway: '#b80', ramp: '#c0c', arterial: '#06c', county: '#555', collector: '#0a8', local: '#888', street: '#999', gravel: '#b96', dirt: '#963', frontage: '#48f' };
  const HALF = { interstate: 51, expressway: 39, highway: 18, ramp: 11, arterial: 29, county: 13, collector: 22, local: 13, street: 18, gravel: 10, dirt: 6.5, frontage: 13 };
  let body = '';
  for (let e = 0; e < E; e++) {
    const a = pairs[2 * e], b = pairs[2 * e + 1];
    if (Math.abs(xy[2 * a] - cx) > r * 1.2 && Math.abs(xy[2 * b] - cx) > r * 1.2) continue;
    if (Math.abs(xy[2 * a + 1] - cy) > r * 1.2 && Math.abs(xy[2 * b + 1] - cy) > r * 1.2) continue;
    const k = KIND[kinds[e]];
    body += `<line x1="${((xy[2 * a] - cx + r) * s).toFixed(1)}" y1="${((xy[2 * a + 1] - cy + r) * s).toFixed(1)}" x2="${((xy[2 * b] - cx + r) * s).toFixed(1)}" y2="${((xy[2 * b + 1] - cy + r) * s).toFixed(1)}" stroke="${col[k]}" stroke-opacity="0.55" stroke-width="${Math.max(1.5, 2 * HALF[k] / SPM * s).toFixed(1)}" stroke-linecap="butt"/>`;
  }
  for (let v = 0; v < N; v++) {
    if (Math.abs(xy[2 * v] - cx) > r || Math.abs(xy[2 * v + 1] - cy) > r) continue;
    const d = nodeEdges[v].length;
    body += `<circle cx="${((xy[2 * v] - cx + r) * s).toFixed(1)}" cy="${((xy[2 * v + 1] - cy + r) * s).toFixed(1)}" r="${d === 1 ? 4 : 2.5}" fill="${d === 1 ? '#f00' : d >= 3 ? '#000' : '#fff'}" stroke="#000" stroke-width="0.6"/>`;
  }
  const legend = Object.entries(col).map(([k, c], i) => `<rect x="8" y="${8 + i * 16}" width="18" height="10" fill="${c}"/><text x="30" y="${17 + i * 16}" font-size="12" font-family="sans-serif">${k}</text>`).join('');
  writeFileSync(path.join(outDir, name + '.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="${W}" height="${W}" fill="#e9e4d4"/>${body}${legend}<text x="8" y="${W - 10}" font-size="13" font-family="sans-serif">${name}: centre (${cx}, ${cy}) mi, ${Math.round(2 * r * SPM)} studs across; red dot = road end, black = junction, white = bend</text></svg>`);
}
svg('interchange-I70-I35', 395.25, 129.5, 0.6);
svg('junction-12way', 272.02, 278, 0.15);
svg('highway-off-grid', 38, 20.01, 0.15);
svg('town-interstate', 294.5, 260.5, 0.7);
svg('gravel-islands', 334, 3, 3);

// Relief picture: height with the west-east slope removed, +-40 m grey scale, plus hillshade.
{
  const colMean = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += elev[j * n + i]; colMean[i] = s / n; }
  const pgm = Buffer.alloc(n * n), shade = Buffer.alloc(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i; pgm[k] = Math.max(0, Math.min(255, 128 + (elev[k] - colMean[i]) * 255 / 120));
    const dx = (elev[j * n + Math.min(n - 1, i + 1)] - elev[j * n + Math.max(0, i - 1)]), dy = (elev[Math.min(n - 1, j + 1) * n + i] - elev[Math.max(0, j - 1) * n + i]);
    // Hillshade lit from the north-west, heights x10 (about what the game's squeeze does).
    const z = 10 / (2 * cellMi * 1609.344), nx = -dx * z, ny = -dy * z, l = Math.hypot(nx, ny, 1);
    shade[k] = Math.max(0, Math.min(255, 255 * ((-nx * 0.5 - ny * 0.5 + 0.707) / l) / 1.0 * 0.9));
  }
  writeFileSync(path.join(outDir, 'relief.pgm'), Buffer.concat([Buffer.from(`P5\n${n} ${n}\n255\n`), pgm]));
  writeFileSync(path.join(outDir, 'hillshade.pgm'), Buffer.concat([Buffer.from(`P5\n${n} ${n}\n255\n`), shade]));
}
