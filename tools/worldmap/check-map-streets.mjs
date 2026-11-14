// Check of the players' map streets (scripts/export-world-roblox.mjs, MapData/MapVector.luau's
// streets field): reads the field back, generates the same map again and compares.
//   node tools/worldmap/check-map-streets.mjs [MapVector.luau] [--seed 1]
// Checks: the field is at most 300,000 characters; the header, row index and cell list agree
// (rows rise to N, cells in order of column within a row, segments counted up to M, no empty
// cell); every segment has a class 0-3, some length, and lies inside the map; miles of street by
// class (0 street, 1 wide street, 2 collector, 3 local or frontage) are within 1% of the graph's
// alive edges of those kinds; every such edge's middle is within 0.01 mi of a segment of its class.
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import path from 'node:path';
import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';
import { generateWorldMap } from '../../js/worldmap/WorldMapGenerator.js';

avoidBackgroundThrottling();
const args = process.argv.slice(2);
const seedAt = args.indexOf('--seed'), seed = seedAt >= 0 ? Number(args[seedAt + 1]) : 1;
const file = args.find((a, i) => !a.startsWith('--') && i !== seedAt + 1) ?? path.join('roblox', 'Shared', 'MapData', 'MapVector.luau');
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`); };

const text = readFileSync(file, 'utf8');
const field = /\bstreets = "([^"]*)"/.exec(text);
if (!field) { console.log('FAIL  MapVector.luau has no streets field'); process.exit(1); }
const miles = Number(/\bmiles = ([\d.]+)/.exec(text)[1]);
check('field size', field[1].length <= 300000, `${field[1].length} characters of ${text.length} in the file`);

const buf = zstdDecompressSync(Buffer.from(field[1], 'base64'));
const size = buf.readUInt16LE(0), UNIT = buf.readUInt16LE(2), N = buf.readUInt32LE(4), M = buf.readUInt32LE(8);
const HEAD = 12, CELL = 6, SEG = 5, cellsAt = HEAD + (size + 1) * 4, segsAt = cellsAt + (N + 1) * CELL;
check('header', size === Math.round(miles) && UNIT === 255 && buf.length === segsAt + M * SEG, `${size} cells a side, unit ${UNIT}, ${N} cells, ${M} segments, ${buf.length} bytes unpacked`);

// The index, then every segment through it.
const rowAt = j => buf.readUInt32LE(HEAD + j * 4), cellI = c => buf.readUInt16LE(cellsAt + c * CELL), cellFirst = c => buf.readUInt32LE(cellsAt + c * CELL + 2);
let badRows = rowAt(0) !== 0 || rowAt(size) !== N ? 1 : 0, badCells = 0, badSegments = 0, outside = 0, seen = 0, most = 0;
const closing = cellI(N) === 65535 && cellFirst(N) === M;
const lengths = [0, 0, 0, 0], counts = [0, 0, 0, 0];
const GRID = 0.05, near = new Map();   // segments by class in squares of GRID miles, for the coverage check
const put = (cls, s) => {
  const x0 = Math.floor(Math.min(s[0], s[2]) / GRID), x1 = Math.floor(Math.max(s[0], s[2]) / GRID), y0 = Math.floor(Math.min(s[1], s[3]) / GRID), y1 = Math.floor(Math.max(s[1], s[3]) / GRID);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = `${cls}:${x}:${y}`; if (!near.has(k)) near.set(k, []); near.get(k).push(s); }
};
for (let j = 0; j < size; j++) {
  const c0 = rowAt(j), c1 = rowAt(j + 1);
  if (c1 < c0 || c1 > N) { badRows++; continue; }
  for (let c = c0; c < c1; c++) {
    const i = cellI(c), s0 = cellFirst(c), s1 = cellFirst(c + 1);
    if (i >= size || (c > c0 && cellI(c - 1) >= i) || s0 !== seen || s1 <= s0 || s1 > M) { badCells++; continue; }
    most = Math.max(most, s1 - s0);
    for (let s = s0; s < s1; s++) {
      const o = segsAt + s * SEG, cls = buf[o], ax = i + buf[o + 1] / UNIT, ay = j + buf[o + 2] / UNIT, bx = i + buf[o + 3] / UNIT, by = j + buf[o + 4] / UNIT;
      seen++;
      if (cls > 3 || (ax === bx && ay === by)) { badSegments++; continue; }
      if (Math.min(ax, ay, bx, by) < 0 || Math.max(ax, ay, bx, by) > miles) outside++;
      lengths[cls] += Math.hypot(bx - ax, by - ay); counts[cls]++;
      put(cls, [ax, ay, bx, by]);
    }
  }
}
check('index', badRows === 0 && badCells === 0 && closing && seen === M, `${badRows} bad rows, ${badCells} bad cells, closing entry ${closing ? 'ok' : 'wrong'}, ${seen} of ${M} segments reached, most in a cell ${most}`);
check('segments', badSegments === 0 && outside === 0, `${badSegments} with a bad class or no length, ${outside} outside the map`);

// The graph's own, from the map generated again.
const map = generateWorldMap({ seed });
const classOf = e => (e.kind === 'street' ? (e.wide ? 1 : 0) : e.kind === 'collector' ? 2 : e.kind === 'local' || e.kind === 'frontage' ? 3 : -1);
const graph = [0, 0, 0, 0], edges = [0, 0, 0, 0];
let far = 0, worst = 0;
const toSegment = (x, y, s) => {
  const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy, t = l2 > 0 ? Math.min(1, Math.max(0, ((x - s[0]) * dx + (y - s[1]) * dy) / l2)) : 0;
  return Math.hypot(x - s[0] - t * dx, y - s[1] - t * dy);
};
for (const e of map.streets.graph.edges) {
  const cls = e.alive ? classOf(e) : -1;
  if (cls < 0) continue;
  graph[cls] += Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y); edges[cls]++;
  const x = (e.a.x + e.b.x) / 2, y = (e.a.y + e.b.y) / 2, gx = Math.floor(x / GRID), gy = Math.floor(y / GRID);
  let d = Infinity;
  for (let b = gy - 1; b <= gy + 1; b++) for (let a = gx - 1; a <= gx + 1; a++) for (const s of near.get(`${cls}:${a}:${b}`) ?? []) d = Math.min(d, toSegment(x, y, s));
  if (d > 0.01) far++;
  if (d < Infinity) worst = Math.max(worst, d);
}
const NAMES = ['street', 'wide street', 'collector', 'local or frontage'];
NAMES.forEach((name, c) => {
  const off = graph[c] > 0 ? Math.abs(lengths[c] - graph[c]) / graph[c] : (lengths[c] > 0 ? 1 : 0);
  check(`miles of ${name}`, off <= 0.01, `${lengths[c].toFixed(1)} mi in ${counts[c]} segments, the graph ${graph[c].toFixed(1)} mi in ${edges[c]} edges (${(off * 100).toFixed(2)}% off)`);
});
check('every edge drawn', far === 0, `${far} edges with no segment of their class within 0.01 mi of their middle (the farthest found ${worst.toFixed(4)} mi)`);

console.log(results.every(Boolean) ? `all ${results.length} checks pass (seed ${seed}, the map generated again)` : `${results.filter(v => !v).length} of ${results.length} checks FAIL`);
process.exit(results.every(Boolean) ? 0 : 1);
