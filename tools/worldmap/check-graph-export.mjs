// Check of the road graph export (scripts/export-world-roblox.mjs, Graph/G<ti>_<tj>_<k>.luau): reads
// Meta.luau's graph field and every Graph module back, generates the same map again and compares.
//   node tools/worldmap/check-graph-export.mjs [WorldData dir]
// Checks: the modules Meta lists are there and no others; each source is under 150,000
// characters; record sizes divide evenly; the distinct edges over all tiles (by kind and place)
// are the graph's alive edges after cutting at 1200 studs, with the same node flags; every edge
// is in each tile its box touches; no edge is longer than 1200 studs; miles of road by kind are
// within 0.5% of the graph's; the blocks are those of planBlocks, with x0 < x1 and z0 < z1.
import { readFileSync, readdirSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import path from 'node:path';
import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';
import { generateWorldMap } from '../../js/worldmap/WorldMapGenerator.js';
import { planBlocks } from '../../js/worldmap/blocks.js';

avoidBackgroundThrottling();
const dir = process.argv[2] ?? path.join('roblox', 'Server', 'WorldData');
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`); };

const metaText = readFileSync(path.join(dir, 'Meta.luau'), 'utf8');
const num = key => Number(new RegExp(`\\b${key} = (-?[\\d.]+)`).exec(metaText)[1]);
const seed = num('seed'), SPM = num('studsPerMile'), miles = num('miles');
const gm = /graph = \{ tileMiles = (\d+), tiles = (\d+), unit = ([\d.]+), kinds = \{ ([^}]*) \}, parts = \{ ([^}]*) \} \}/.exec(metaText);
if (!gm) { console.log('FAIL  Meta.luau has no graph field'); process.exit(1); }
const tileMiles = Number(gm[1]), GT = Number(gm[2]), UNIT = Number(gm[3]), kinds = gm[4].split(', ').map(s => JSON.parse(s)), parts = gm[5].split(', ').map(Number);
check('Meta graph field', tileMiles === 25 && GT * tileMiles === miles && UNIT === 0.5 && kinds.length === 12 && parts.length === GT * GT && parts.every(p => p >= 1), `${GT} x ${GT} tiles of ${tileMiles} mi, unit ${UNIT}, ${kinds.length} kinds, ${parts.reduce((a, b) => a + b, 0)} modules`);

// Read every module back.
const EDGE = 11, BLOCK = 12, MAX_STUDS = 1200, half = miles / 2;
const centre = t => Math.round(((t + 0.5) * tileMiles - half) * SPM / UNIT), tileSteps = tileMiles * SPM / UNIT, west = -half * SPM / UNIT;
const unpack = s => (s === '' ? Buffer.alloc(0) : zstdDecompressSync(Buffer.from(s, 'base64')));
const expectedFiles = new Set(), edgeTiles = new Map(), blockTiles = new Map(), edgeFlags = new Map();
let largest = 0, uneven = 0, badFormat = 0, records = 0, blockRecords = 0, longest = 0, badRect = 0, chars = 0;
for (let tj = 0; tj < GT; tj++) for (let ti = 0; ti < GT; ti++) for (let k = 1; k <= parts[tj * GT + ti]; k++) {
  const name = `G${ti}_${tj}_${k}.luau`, t = tj * GT + ti;
  expectedFiles.add(name);
  let text;
  try { text = readFileSync(path.join(dir, 'Graph', name), 'utf8'); } catch { badFormat++; continue; }
  largest = Math.max(largest, text.length); chars += text.length;
  const m = /^-- Generated [^\n]*; do not edit\.\nreturn \{ edges = "([A-Za-z0-9+/=]*)", blocks = "([A-Za-z0-9+/=]*)" \}\n$/.exec(text);
  if (!m) { badFormat++; continue; }
  const eb = unpack(m[1]), bb = unpack(m[2]), cx = centre(ti), cz = centre(tj);
  if (eb.length % EDGE || bb.length % BLOCK) { uneven++; continue; }
  for (let o = 0; o < eb.length; o += EDGE) {
    const ax = eb.readInt16LE(o + 3) + cx, az = eb.readInt16LE(o + 5) + cz, bx = eb.readInt16LE(o + 7) + cx, bz = eb.readInt16LE(o + 9) + cz;
    const key = `${eb[o]},${ax},${az},${bx},${bz}`;
    records++; longest = Math.max(longest, Math.hypot(bx - ax, bz - az) * UNIT);
    if (!edgeTiles.has(key)) edgeTiles.set(key, new Set());
    edgeTiles.get(key).add(t); edgeFlags.set(key, eb[o + 1] * 256 + eb[o + 2]);
  }
  for (let o = 0; o < bb.length; o += BLOCK) {
    const x0 = bb.readInt16LE(o) + cx, z0 = bb.readInt16LE(o + 2) + cz, x1 = bb.readInt16LE(o + 4) + cx, z1 = bb.readInt16LE(o + 6) + cz;
    const key = `${x0},${z0},${x1},${z1},${bb[o + 8]},${bb[o + 9]},${bb[o + 10]},${bb[o + 11]}`;
    blockRecords++; if (!(x0 < x1 && z0 < z1)) badRect++;
    if (!blockTiles.has(key)) blockTiles.set(key, new Set());
    blockTiles.get(key).add(t);
  }
}
const onDisk = readdirSync(path.join(dir, 'Graph')).filter(f => /^G.*\.luau$/.test(f));
check('modules on disk are the ones Meta lists', badFormat === 0 && onDisk.length === expectedFiles.size && onDisk.every(f => expectedFiles.has(f)), `${onDisk.length} files, ${badFormat} missing or malformed, ${(chars / 1e6).toFixed(1)} MB`);
check('module sources under 150,000 characters', largest < 150000, `largest ${largest}`);
check('record sizes divide evenly', uneven === 0, `${records} edge records, ${blockRecords} block records`);

// What the generator's graph gives.
const map = generateWorldMap({ seed });
const q = mi => Math.round((mi - half) * SPM / UNIT);
const flags = node => (node.end ?? 0) | ((node.control ?? 0) << 2) | (Math.min(node.edges.length, 15) << 4);
const want = new Map(), graphMiles = {};
for (const e of map.streets.graph.edges) {
  if (!e.alive) continue;
  graphMiles[e.kind] = (graphMiles[e.kind] ?? 0) + Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
  const kind = kinds.indexOf(e.kind), ax = q(e.a.x), az = q(e.a.y), bx = q(e.b.x), bz = q(e.b.y);
  const studs = Math.hypot(bx - ax, bz - az) * UNIT, pieces = studs > MAX_STUDS ? Math.ceil(studs / (MAX_STUDS - 1)) : 1;
  const pts = [[ax, az, flags(e.a)]];
  for (let s = 1; s < pieces; s++) pts.push([Math.round(ax + (bx - ax) * s / pieces), Math.round(az + (bz - az) * s / pieces), 32]);
  pts.push([bx, bz, flags(e.b)]);
  for (let s = 1; s < pts.length; s++) {
    const [x0, z0, f0] = pts[s - 1], [x1, z1, f1] = pts[s];
    if (x0 === x1 && z0 === z1) continue;
    want.set(`${kind},${x0},${z0},${x1},${z1}`, f0 * 256 + f1);
  }
}
let missing = 0, extra = 0, flagDiffs = 0;
for (const [key, f] of want) { if (!edgeTiles.has(key)) missing++; else if (edgeFlags.get(key) !== f) flagDiffs++; }
for (const key of edgeTiles.keys()) if (!want.has(key)) extra++;
check('distinct edges match the graph after cutting', missing === 0 && extra === 0, `${edgeTiles.size} exported, ${want.size} expected, ${missing} missing, ${extra} extra`);
check('node flags match', flagDiffs === 0, `${flagDiffs} differ`);
check('no edge longer than 1200 studs', longest <= MAX_STUDS, `longest ${longest.toFixed(1)}`);

// Each record in every tile its box touches, and in no other.
const tilesOf = (x0, z0, x1, z1) => {
  const lo = v => Math.max(0, Math.ceil((v - west) / tileSteps) - 1), hi = v => Math.min(GT - 1, Math.floor((v - west) / tileSteps)), out = [];
  for (let tj = lo(z0); tj <= hi(z1); tj++) for (let ti = lo(x0); ti <= hi(x1); ti++) out.push(tj * GT + ti);
  return out;
};
let wrongTiles = 0;
for (const [key, set] of edgeTiles) { const [, ax, az, bx, bz] = key.split(',').map(Number), t = tilesOf(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)); if (t.length !== set.size || !t.every(v => set.has(v))) wrongTiles++; }
for (const [key, set] of blockTiles) { const [x0, z0, x1, z1] = key.split(',').map(Number), t = tilesOf(x0, z0, x1, z1); if (t.length !== set.size || !t.every(v => set.has(v))) wrongTiles++; }
check('records are in every tile their box touches', wrongTiles === 0, `${wrongTiles} wrong; ${records - edgeTiles.size} edge and ${blockRecords - blockTiles.size} block records are second copies`);

// Miles of road by kind.
const outMiles = {};
for (const key of edgeTiles.keys()) { const [kind, ax, az, bx, bz] = key.split(',').map(Number); outMiles[kinds[kind]] = (outMiles[kinds[kind]] ?? 0) + Math.hypot(bx - ax, bz - az) * UNIT / SPM; }
let worst = 0;
const rows = Object.keys(graphMiles).sort((a, b) => kinds.indexOf(a) - kinds.indexOf(b)).map(k => { const d = Math.abs((outMiles[k] ?? 0) - graphMiles[k]) / graphMiles[k]; worst = Math.max(worst, d); return `${k} ${graphMiles[k].toFixed(0)}/${(outMiles[k] ?? 0).toFixed(0)}`; });
check('miles by kind within 0.5%', worst <= 0.005 && Object.keys(outMiles).every(k => k in graphMiles), `worst ${(worst * 100).toFixed(3)}% (graph/export: ${rows.join(', ')})`);

// Blocks.
const wantBlocks = new Set();
for (const b of planBlocks(map)) {
  const x0 = q(b.x0), z0 = q(b.y0), x1 = q(b.x1), z1 = q(b.y1);
  if (x0 < x1 && z0 < z1) wantBlocks.add(`${x0},${z0},${x1},${z1},${b.sides.map(k => (k === null ? 0 : kinds.indexOf(k) + 1)).join(',')}`);
}
let blockMissing = 0;
for (const key of wantBlocks) if (!blockTiles.has(key)) blockMissing++;
check('block rectangles have x0 < x1 and z0 < z1', badRect === 0, `${badRect} bad`);
check('blocks match planBlocks', blockMissing === 0 && blockTiles.size === wantBlocks.size, `${blockTiles.size} exported, ${wantBlocks.size} expected, ${blockMissing} missing`);

const failed = results.filter(ok => !ok).length;
console.log(failed ? `FAILED: ${failed} of ${results.length} checks` : `PASSED: all ${results.length} checks (seed ${seed})`);
process.exit(failed ? 1 : 0);
