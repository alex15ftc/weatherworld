// Audit of a built world map: elevation variety and road-graph consistency.
//   node audit-map.mjs <map dir> [out json]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2], outFile = process.argv[3];
const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const sj = JSON.parse(readFileSync(path.join(dir, 'streets.json'), 'utf8'));
const n = meta.size, cellMi = meta.cellMiles, SPM = 600, M_PER_STUD = 0.28, M_PER_MI = 1609.344;
const buf = p => { const b = readFileSync(path.join(dir, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const elev = new Float32Array(buf('elevation.f32')), region = new Uint8Array(buf('region.u8')), lake = new Uint8Array(buf('lake.u8')), cover = new Uint8Array(buf('cover.u8'));
const pct = (v, q) => { const s = Float64Array.from(v).sort(); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
const r1 = x => Math.round(x * 10) / 10;
const result = {};

// ---------- Elevation ----------
console.log('=== ELEVATION ===');
let lo = Infinity, hi = -Infinity; for (const h of elev) { if (h < lo) lo = h; if (h > hi) hi = h; }
console.log(`whole map: ${lo.toFixed(0)} to ${hi.toFixed(0)} m`);
// West-east column means (the engine slope) and what is left after removing it.
const colMean = new Float64Array(n);
for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += elev[j * n + i]; colMean[i] = s / n; }
console.log('column mean every 50 mi:', Array.from({ length: 11 }, (_, c) => colMean[Math.min(n - 1, c * 100)].toFixed(0)).join(' '));
// Local relief: max - min in a square window, sampled.
function relief(windowMi) {
  const w = Math.round(windowMi / cellMi), by = meta.regions.map(() => []);
  for (let j = 0; j + w < n; j += Math.max(1, w >> 1)) for (let i = 0; i + w < n; i += Math.max(1, w >> 1)) {
    let a = Infinity, b = -Infinity;
    for (let y = j; y <= j + w; y++) for (let x = i; x <= i + w; x++) { const h = elev[y * n + x]; if (h < a) a = h; if (h > b) b = h; }
    // Take out the regional slope across the window (plane through the corner means is overkill: use column means).
    const slopeDrop = Math.abs(colMean[i] - colMean[i + w]);
    by[region[(j + (w >> 1)) * n + i + (w >> 1)]].push(Math.max(0, b - a - slopeDrop));
  }
  return by;
}
const reliefRows = {};
for (const w of [1, 2, 5, 10]) {
  const by = relief(w);
  meta.regions.forEach((r, k) => { (reliefRows[r.key] ??= {})[w] = { p10: r1(pct(by[k], 0.1)), p50: r1(pct(by[k], 0.5)), p90: r1(pct(by[k], 0.9)), max: r1(pct(by[k], 0.999)) }; });
}
console.log('local relief with the west-east slope removed (m): window  p10 / p50 / p90 / max');
for (const r of meta.regions) console.log(`  ${r.name.padEnd(17)} set ${String(r.reliefM).padStart(3)} m @ ${String(r.wavelengthMi).padStart(2)} mi | ` + [1, 2, 5, 10].map(w => { const q = reliefRows[r.key][w]; return `${w}mi ${q.p10}/${q.p50}/${q.p90}/${q.max}`; }).join(' | '));
result.relief = reliefRows;
// Slopes between neighbouring cells (true %, and as built in studs if heights go at 0.28 m a stud).
const slopeBy = meta.regions.map(() => []);
for (let j = 0; j < n - 1; j += 2) for (let i = 0; i < n - 1; i += 2) {
  const k = j * n + i, gx = (elev[k + 1] - elev[k]) / (cellMi * M_PER_MI), gy = (elev[k + n] - elev[k]) / (cellMi * M_PER_MI);
  slopeBy[region[k]].push(Math.hypot(gx, gy) * 100);
}
const exag = (M_PER_MI / SPM) / M_PER_STUD;
console.log(`slope between half-mile cells, true % (x${exag.toFixed(2)} in game if heights are 0.28 m a stud):  p50 / p90 / p99 / max`);
result.slope = {};
meta.regions.forEach((r, k) => { const v = slopeBy[k], q = [0.5, 0.9, 0.99, 0.9999].map(x => pct(v, x)); result.slope[r.key] = q; console.log(`  ${r.name.padEnd(17)} ${q.map(x => x.toFixed(2)).join(' / ')}   in game ${q.map(x => (x * exag).toFixed(1)).join(' / ')}`); });
// How much of the map is "flat": 2-mile relief under 5 m.
{
  const by = relief(2); const all = by.flat();
  console.log(`2-mile windows with under 5 m of relief: ${(100 * all.filter(x => x < 5).length / all.length).toFixed(0)}% of the map; under 10 m: ${(100 * all.filter(x => x < 10).length / all.length).toFixed(0)}%; over 30 m: ${(100 * all.filter(x => x > 30).length / all.length).toFixed(1)}%`);
  result.flatShare = { under5: all.filter(x => x < 5).length / all.length, under10: all.filter(x => x < 10).length / all.length, over30: all.filter(x => x > 30).length / all.length };
}
// Spectrum by scale: std of (h - boxmean over W miles), to see which wavelengths carry the relief.
function highpassStd(windowMi) {
  const w = Math.round(windowMi / cellMi / 2), by = meta.regions.map(() => []);
  const integral = new Float64Array((n + 1) * (n + 1));
  for (let j = 0; j < n; j++) { let row = 0; for (let i = 0; i < n; i++) { row += elev[j * n + i]; integral[(j + 1) * (n + 1) + i + 1] = integral[j * (n + 1) + i + 1] + row; } }
  for (let j = w; j < n - w; j += 3) for (let i = w; i < n - w; i += 3) {
    const sum = integral[(j + w + 1) * (n + 1) + i + w + 1] - integral[(j - w) * (n + 1) + i + w + 1] - integral[(j + w + 1) * (n + 1) + i - w] + integral[(j - w) * (n + 1) + i - w];
    by[region[j * n + i]].push(elev[j * n + i] - sum / ((2 * w + 1) ** 2));
  }
  return by.map(v => Math.sqrt(v.reduce((a, b) => a + b * b, 0) / Math.max(1, v.length)));
}
console.log('height left after taking away the mean over a window (rms m): 2 mi / 5 mi / 10 mi / 20 mi');
const hp = [2, 5, 10, 20].map(highpassStd);
meta.regions.forEach((r, k) => console.log(`  ${r.name.padEnd(17)} ${hp.map(v => v[k].toFixed(1)).join(' / ')}`));
// River valleys: depth of valley below ground 2 miles to either side, along rivers.
{
  const depth = [];
  for (const river of meta.rivers) for (let k = 0; k < river.points.length; k += 8) {
    const i = Math.floor(river.points[k] / cellMi), j = Math.floor(river.points[k + 1] / cellMi), w = 4;
    if (i < w || j < w || i >= n - w || j >= n - w) continue;
    const here = elev[j * n + i], around = (elev[j * n + i - w] + elev[j * n + i + w] + elev[(j - w) * n + i] + elev[(j + w) * n + i]) / 4;
    depth.push(around - here);
  }
  console.log(`river valleys: river bed below the ground 2 mi to its sides: p50 ${pct(depth, 0.5).toFixed(1)} m, p90 ${pct(depth, 0.9).toFixed(1)} m, max ${pct(depth, 0.999).toFixed(0)} m (${depth.length} samples)`);
  result.valley = { p50: pct(depth, 0.5), p90: pct(depth, 0.9) };
}

// ---------- Roads ----------
console.log('\n=== ROAD GRAPH ===');
const sb = readFileSync(path.join(dir, 'streets.bin'));
const N = sj.nodes, E = sj.edges;
let off = 0; const take = (Type, count) => { const bytes = Type.BYTES_PER_ELEMENT * count; const a = new Type(sb.buffer.slice(sb.byteOffset + off, sb.byteOffset + off + bytes)); off += bytes; return a; };
const xy = take(Float32Array, 2 * N), control = take(Uint8Array, N), end = take(Uint8Array, N), pairs = take(Uint32Array, 2 * E), kinds = take(Uint8Array, E), roadOf = take(Int32Array, E);
// (Last, since the wide streets: one byte an edge, 1 for a wide street. Older files have none.)
const wide = off < sb.length ? take(Uint8Array, E) : new Uint8Array(E);
if (off !== sb.length) console.log(`!! streets.bin layout: read ${off} of ${sb.length} bytes`);
const KIND = sj.kinds, ki = Object.fromEntries(KIND.map((k, i) => [k, i]));
const HALF = { interstate: 51, expressway: 39, highway: 18, ramp: 11, arterial: 29, county: 13, collector: 22, local: 13, street: 18, gravel: 10, dirt: 6.5, frontage: 13 };
const WIDE_STREET = 26, studsOf = e => (wide[e] ? WIDE_STREET : HALF[KIND[kinds[e]]]), halfOf = e => studsOf(e) / SPM;
const nodeEdges = Array.from({ length: N }, () => []);
for (let e = 0; e < E; e++) { nodeEdges[pairs[2 * e]].push(e); nodeEdges[pairs[2 * e + 1]].push(e); }
const ex0 = e => xy[2 * pairs[2 * e]], ey0 = e => xy[2 * pairs[2 * e] + 1], ex1 = e => xy[2 * pairs[2 * e + 1]], ey1 = e => xy[2 * pairs[2 * e + 1] + 1];
const len = e => Math.hypot(ex1(e) - ex0(e), ey1(e) - ey0(e));
const tally = () => { const t = {}; return { add: (k, where) => { (t[k] ??= { n: 0, at: [] }).n++; if (t[k].at.length < 4) t[k].at.push(where.map(v => Math.round(v * 100) / 100)); }, t }; };
const show = (title, t, top = 14) => { const rows = Object.entries(t).sort((a, b) => b[1].n - a[1].n); console.log(`${title}: ${rows.reduce((a, r) => a + r[1].n, 0)} in all`); for (const [k, v] of rows.slice(0, top)) console.log(`  ${String(v.n).padStart(6)}  ${k.padEnd(28)} e.g. ${v.at.slice(0, 3).map(p => `(${p.join(', ')})`).join(' ')}`); return Object.fromEntries(rows.map(([k, v]) => [k, v])); };
const pair = (a, b) => (a <= b ? `${KIND[a]} / ${KIND[b]}` : `${KIND[b]} / ${KIND[a]}`);

// Spatial hash of edges.
const C = 0.25, grid = new Map();
for (let e = 0; e < E; e++) {
  const X0 = Math.floor(Math.min(ex0(e), ex1(e)) / C), X1 = Math.floor(Math.max(ex0(e), ex1(e)) / C), Y0 = Math.floor(Math.min(ey0(e), ey1(e)) / C), Y1 = Math.floor(Math.max(ey0(e), ey1(e)) / C);
  for (let X = X0; X <= X1; X++) for (let Y = Y0; Y <= Y1; Y++) { const k = X * 4096 + Y; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(e); }
}
const nearEdges = (x0, y0, x1, y1) => { const s = new Set(); for (let X = Math.floor(x0 / C); X <= Math.floor(x1 / C); X++) for (let Y = Math.floor(y0 / C); Y <= Math.floor(y1 / C); Y++) for (const e of grid.get(X * 4096 + Y) ?? []) s.add(e); return s; };
const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
function segInter(e, f) {
  const a = [ex0(e), ey0(e)], b = [ex1(e), ey1(e)], c = [ex0(f), ey0(f)], d = [ex1(f), ey1(f)];
  const d1 = cross(...a, ...b, ...c), d2 = cross(...a, ...b, ...d), d3 = cross(...c, ...d, ...a), d4 = cross(...c, ...d, ...b);
  if (d1 * d2 < 0 && d3 * d4 < 0) { const t = d3 / (d3 - d4); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  return null;
}
const distPtSeg = (px, py, e) => { const ax = ex0(e), ay = ey0(e), dx = ex1(e) - ax, dy = ey1(e) - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0; return Math.hypot(ax + dx * t - px, ay + dy * t - py); };
const shares = (e, f) => pairs[2 * e] === pairs[2 * f] || pairs[2 * e] === pairs[2 * f + 1] || pairs[2 * e + 1] === pairs[2 * f] || pairs[2 * e + 1] === pairs[2 * f + 1];

// 1. Edges that cross with no node between them.
const sep = new Set([ki.interstate, ki.ramp]);
const crossFlat = tally(), crossOver = tally();
// 2. Roads lying alongside one another with their widths overlapping (no shared node, near parallel).
// (A ramp beside the road it merges onto or leaves is expected: counted apart.)
const along = tally(), merging = tally(), joins = new Set([ki.interstate, ki.expressway, ki.highway]);
for (let e = 0; e < E; e++) {
  const pad = halfOf(e) + 51 / SPM;
  for (const f of nearEdges(Math.min(ex0(e), ex1(e)) - pad, Math.min(ey0(e), ey1(e)) - pad, Math.max(ex0(e), ex1(e)) + pad, Math.max(ey0(e), ey1(e)) + pad)) {
    if (f <= e || shares(e, f)) continue;
    const hit = segInter(e, f);
    if (hit) { (sep.has(kinds[e]) || sep.has(kinds[f]) ? crossOver : crossFlat).add(pair(kinds[e], kinds[f]), hit); continue; }
    const le = len(e), lf = len(f); if (le < 1e-6 || lf < 1e-6) continue;
    const cos = Math.abs(((ex1(e) - ex0(e)) * (ex1(f) - ex0(f)) + (ey1(e) - ey0(e)) * (ey1(f) - ey0(f))) / (le * lf));
    if (cos < 0.94) continue;
    // Overlap: midpoint of the shorter lies within the widths of the other.
    const [s, o] = le < lf ? [e, f] : [f, e];
    const mx = (ex0(s) + ex1(s)) / 2, my = (ey0(s) + ey1(s)) / 2, d = distPtSeg(mx, my, o);
    if (d < halfOf(e) + halfOf(f) && Math.min(le, lf) > 20 / SPM) {
      if (roadOf[e] >= 0 && roadOf[e] === roadOf[f]) continue;
      ((kinds[e] === ki.ramp && joins.has(kinds[f])) || (kinds[f] === ki.ramp && joins.has(kinds[e])) ? merging : along).add(pair(kinds[e], kinds[f]), [mx, my]);
    }
  }
}
result.crossFlat = show('roads crossing at grade with no junction node', crossFlat.t);
result.crossOver = show('grade-separated crossings (an interstate or ramp is one of the two)', crossOver.t);
result.along = show('road strips overlapping side by side (no shared node, within 20 degrees)', along.t);
result.merging = show('ramp pieces beside the road they join (expected)', merging.t);

// 3. What meets what at nodes: the owner's connection rules.
const meet = tally(), rule = tally();
const acute = tally(), degree = {};
for (let v = 0; v < N; v++) {
  const es = nodeEdges[v]; degree[es.length] = (degree[es.length] ?? 0) + 1;
  const ks = new Set(es.map(e => kinds[e])), where = [xy[2 * v], xy[2 * v + 1]];
  const has = k => ks.has(ki[k]);
  if (has('interstate') && [...ks].some(k => k !== ki.interstate && k !== ki.ramp)) rule.add(`interstate meets ${[...ks].filter(k => k !== ki.interstate && k !== ki.ramp).map(k => KIND[k]).join('+')} at grade`, where);
  if ((has('gravel') || has('dirt')) && (has('interstate') || has('expressway') || has('ramp'))) rule.add(`gravel/dirt touches ${['interstate', 'expressway', 'ramp'].filter(has).join('+')}`, where);
  if (has('ramp') && [...ks].some(k => [ki.street, ki.gravel, ki.dirt, ki.local, ki.collector].includes(k))) rule.add(`ramp meets ${[...ks].filter(k => [ki.street, ki.gravel, ki.dirt, ki.local, ki.collector].includes(k)).map(k => KIND[k]).join('+')}`, where);
  if (has('street') && (has('expressway'))) rule.add('street meets expressway', where);
  if (has('street') && has('highway')) rule.add('street meets highway (allowed in town when square)', where);
  if (es.length >= 5) rule.add(`${es.length}-way junction`, where);
  // Sharp angles between roads leaving a junction.
  if (es.length >= 2) {
    const dirs = es.map(e => { const other = pairs[2 * e] === v ? pairs[2 * e + 1] : pairs[2 * e]; return { e, a: Math.atan2(xy[2 * other + 1] - where[1], xy[2 * other] - where[0]), l: len(e) }; });
    for (let a = 0; a < dirs.length; a++) for (let b = a + 1; b < dirs.length; b++) {
      let d = Math.abs(dirs[a].a - dirs[b].a); if (d > Math.PI) d = 2 * Math.PI - d;
      const deg = d * 180 / Math.PI;
      if (deg < 25 && dirs[a].l > 30 / SPM && dirs[b].l > 30 / SPM) { const A = kinds[dirs[a].e], B = kinds[dirs[b].e]; if ((A === ki.ramp) || (B === ki.ramp)) continue; acute.add(pair(A, B), where); }
    }
  }
}
console.log('junction sizes (roads meeting at a node):', JSON.stringify(degree));
result.rule = show('connection rules at nodes', rule.t);
result.acute = show('roads leaving one junction under 25 degrees apart (ramps left out)', acute.t);

// 4. Ends: dead ends by kind, and dead ends that stop within reach of another road without joining it.
const deadBy = tally(), nearMiss = tally(), ENDS = sj.ends;
for (let v = 0; v < N; v++) {
  if (nodeEdges[v].length !== 1) continue;
  const e = nodeEdges[v][0], x = xy[2 * v], y = xy[2 * v + 1];
  deadBy.add(`${KIND[kinds[e]]} (${ENDS[end[v]]})`, [x, y]);
  if (x < 0.3 || y < 0.3 || x > 499.7 || y > 499.7) continue;
  let best = null;
  const reach = 60 / SPM;
  for (const f of nearEdges(x - reach, y - reach, x + reach, y + reach)) {
    if (f === e || shares(e, f)) continue;
    const d = distPtSeg(x, y, f);
    if (!best || d < best.d) best = { d, f };
  }
  if (best && best.d < halfOf(best.f) + 25 / SPM) nearMiss.add(`${KIND[kinds[e]]} (${ENDS[end[v]]}) stops ${best.d < halfOf(best.f) ? 'inside' : 'just short of'} a ${KIND[kinds[best.f]]}`, [x, y]);
}
result.dead = show('road ends', deadBy.t, 20);
result.nearMiss = show('ends that stop at another road without joining it (within its width + 25 studs)', nearMiss.t, 20);

// 5. Short edges and stubs (a piece of a curve, with a plain bend at each end, counted apart).
const short = tally();
for (let e = 0; e < E; e++) { const l = len(e) * SPM; if (l < 2 * studsOf(e)) { const a = pairs[2 * e], b = pairs[2 * e + 1], bend = v => nodeEdges[v].length === 2 && nodeEdges[v].every(o => kinds[o] === kinds[e]); short.add(`${KIND[kinds[e]]}${nodeEdges[a].length === 1 || nodeEdges[b].length === 1 ? ' stub (dead end)' : bend(a) && bend(b) ? ' curve piece' : ''} shorter than its own width`, [ex0(e), ey0(e)]); } }
result.short = show('very short pieces', short.t);

// 6. Roads and water.
const inLake = tally(), riverX = tally();
const riverSegs = []; for (const r of meta.rivers) for (let k = 2; k < r.points.length; k += 2) riverSegs.push([r.points[k - 2], r.points[k - 1], r.points[k], r.points[k + 1], r.widthsM[k / 2] ?? r.widthsM[r.widthsM.length - 1]]);
const rgrid = new Map();
riverSegs.forEach((s, idx) => { for (let X = Math.floor(Math.min(s[0], s[2]) / C); X <= Math.floor(Math.max(s[0], s[2]) / C); X++) for (let Y = Math.floor(Math.min(s[1], s[3]) / C); Y <= Math.floor(Math.max(s[1], s[3]) / C); Y++) { const k = X * 4096 + Y; let l = rgrid.get(k); if (!l) rgrid.set(k, l = []); l.push(idx); } });
let lakeMiles = 0;
for (let e = 0; e < E; e++) {
  const mx = (ex0(e) + ex1(e)) / 2, my = (ey0(e) + ey1(e)) / 2, ci = Math.floor(mx / cellMi), cj = Math.floor(my / cellMi);
  if (ci >= 0 && cj >= 0 && ci < n && cj < n && lake[cj * n + ci]) { inLake.add(KIND[kinds[e]], [mx, my]); lakeMiles += len(e); }
  const seen = new Set();
  for (let X = Math.floor(Math.min(ex0(e), ex1(e)) / C); X <= Math.floor(Math.max(ex0(e), ex1(e)) / C); X++) for (let Y = Math.floor(Math.min(ey0(e), ey1(e)) / C); Y <= Math.floor(Math.max(ey0(e), ey1(e)) / C); Y++) for (const idx of rgrid.get(X * 4096 + Y) ?? []) {
    if (seen.has(idx)) continue; seen.add(idx);
    const s = riverSegs[idx], a = [ex0(e), ey0(e)], b = [ex1(e), ey1(e)];
    const d1 = cross(...a, ...b, s[0], s[1]), d2 = cross(...a, ...b, s[2], s[3]), d3 = cross(s[0], s[1], s[2], s[3], ...a), d4 = cross(s[0], s[1], s[2], s[3], ...b);
    if (d1 * d2 < 0 && d3 * d4 < 0) riverX.add(`${KIND[kinds[e]]} over a ${s[4] >= 150 ? 'big river (150 m+)' : s[4] >= 60 ? 'river (60-150 m)' : 'creek (<60 m)'}`, [mx, my]);
  }
}
result.inLake = show(`road pieces whose middle is in the lake (${lakeMiles.toFixed(1)} mi)`, inLake.t);
result.riverX = show('bridges (road crossing a river line)', riverX.t, 30);

// 7. Grades along roads (height at the two ends, bilinear from the half-mile grid).
const hAt = (x, y) => { const fx = Math.min(n - 1.001, Math.max(0, x / cellMi - 0.5)), fy = Math.min(n - 1.001, Math.max(0, y / cellMi - 0.5)), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j; return elev[j * n + i] * (1 - u) * (1 - v) + elev[j * n + i + 1] * u * (1 - v) + elev[(j + 1) * n + i] * (1 - u) * v + elev[(j + 1) * n + i + 1] * u * v; };
console.log(`road grade from the map heights, in-game % (heights at 0.28 m a stud, ${SPM} studs a mile; true grade is 1/${exag.toFixed(1)} of this):  p50 / p90 / p99 / max`);
result.grade = {};
for (const k of KIND) {
  const g = []; for (let e = 0; e < E; e++) { if (KIND[kinds[e]] !== k) continue; const l = len(e); if (l < 0.02) continue; g.push(Math.abs(hAt(ex1(e), ey1(e)) - hAt(ex0(e), ey0(e))) / M_PER_STUD / (l * SPM) * 100); }
  if (!g.length) continue; const q = [0.5, 0.9, 0.99, 0.9999].map(x => pct(g, x)); result.grade[k] = q;
  console.log(`  ${k.padEnd(11)} ${q.map(x => x.toFixed(1)).join(' / ')}`);
}

// 8. Connectivity.
{
  const comp = new Int32Array(N).fill(-1); let comps = 0; const sizes = [];
  for (let s = 0; s < N; s++) { if (comp[s] >= 0) continue; let size = 0; const stack = [s]; comp[s] = comps; while (stack.length) { const v = stack.pop(); size++; for (const e of nodeEdges[v]) { const o = pairs[2 * e] === v ? pairs[2 * e + 1] : pairs[2 * e]; if (comp[o] < 0) { comp[o] = comps; stack.push(o); } } } sizes.push(size); comps++; }
  sizes.sort((a, b) => b - a);
  const cut = tally();
  const big = sizes[0]; const sizeOf = new Map(); for (let v = 0; v < N; v++) sizeOf.set(comp[v], (sizeOf.get(comp[v]) ?? 0) + 1);
  const seenComp = new Set();
  for (let v = 0; v < N; v++) { if (sizeOf.get(comp[v]) === big || seenComp.has(comp[v])) continue; seenComp.add(comp[v]); const e = nodeEdges[v][0]; cut.add(e === undefined ? 'lone node' : `island of ${KIND[kinds[e]]}`, [xy[2 * v], xy[2 * v + 1]]); }
  console.log(`connectivity: ${comps} separate networks; largest has ${(100 * big / N).toFixed(1)}% of nodes; next: ${sizes.slice(1, 8).join(', ')}`);
  result.islands = show('networks cut off from the main one', cut.t);
  result.components = { count: comps, largestShare: big / N };
}

// 9. The highway layer in meta.roads against the graph: do the map's named routes exist in the graph?
{
  const byKind = {}; for (const r of meta.roads) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  console.log('named routes in meta.json:', JSON.stringify(byKind), '| crossings:', JSON.stringify(meta.crossings.reduce((t, c) => { t[c.type] = (t[c.type] ?? 0) + 1; return t; }, {})));
}

// 10. Cleanliness for laying roads edge by edge: stacked edges, zero-length edges, nodes on one
// spot, junctions split into several nodes, sharp single-vertex turns, and how the ramps join.
{
  const seen = new Map(), dup = tally();
  let tiny = 0;
  for (let e = 0; e < E; e++) {
    const a = Math.min(pairs[2 * e], pairs[2 * e + 1]), b = Math.max(pairs[2 * e], pairs[2 * e + 1]), k = a * N + b;
    if (seen.has(k)) dup.add(KIND[kinds[e]], [ex0(e), ey0(e)]); else seen.set(k, e);
    if (len(e) * SPM < 1) tiny++;
  }
  result.duplicates = show('edges repeating another between the same two nodes', dup.t);
  const junction = v => nodeEdges[v].length >= 3, G = 0.1, spots = new Map(), jgrid = new Map();
  let stacked = 0;
  for (let v = 0; v < N; v++) {
    const k = `${Math.round(xy[2 * v] * 6000)},${Math.round(xy[2 * v + 1] * 6000)}`;   // a tenth of a stud
    if (spots.has(k)) stacked++; else spots.set(k, v);
    if (junction(v)) { const g = Math.floor(xy[2 * v] / G) * 8192 + Math.floor(xy[2 * v + 1] / G); let l = jgrid.get(g); if (!l) jgrid.set(g, l = []); l.push(v); }
  }
  const close = tally(), top = v => KIND[Math.min(...nodeEdges[v].map(e => kinds[e]))];
  for (let v = 0; v < N; v++) {
    if (!junction(v)) continue;
    const X = Math.floor(xy[2 * v] / G), Y = Math.floor(xy[2 * v + 1] / G);
    for (let a = X - 1; a <= X + 1; a++) for (let b = Y - 1; b <= Y + 1; b++) for (const o of jgrid.get(a * 8192 + b) ?? []) {
      if (o > v && Math.hypot(xy[2 * v] - xy[2 * o], xy[2 * v + 1] - xy[2 * o + 1]) * SPM < 40) close.add([top(v), top(o)].sort().join(' + '), [xy[2 * v], xy[2 * v + 1]]);
    }
  }
  console.log(`edges under 1 stud long: ${tiny}; nodes sharing a spot with another: ${stacked}`);
  result.tiny = tiny; result.stacked = stacked;
  result.closeJunctions = show('pairs of junction nodes (3+ roads) within 40 studs (by the biggest road at each)', close.t);
  // Turns at a plain bend of a map road (two edges, nothing else meeting), and the pieces' lengths.
  for (const k of ['interstate', 'expressway', 'highway']) {
    const turns = tally(), lens = [];
    for (let e = 0; e < E; e++) if (kinds[e] === ki[k]) lens.push(len(e) * SPM);
    for (let v = 0; v < N; v++) {
      const es = nodeEdges[v];
      if (es.length !== 2 || kinds[es[0]] !== ki[k] || kinds[es[1]] !== ki[k]) continue;
      const d = es.map(e => { const o = pairs[2 * e] === v ? pairs[2 * e + 1] : pairs[2 * e]; return Math.atan2(xy[2 * o + 1] - xy[2 * v + 1], xy[2 * o] - xy[2 * v]); });
      let t = Math.abs(Math.abs(d[0] - d[1]) - Math.PI) * 180 / Math.PI; if (t > 180) t = 360 - t;
      if (t > 12) turns.add(t > 40 ? 'over 40 degrees' : t > 20 ? '20-40 degrees' : '12-20 degrees', [xy[2 * v], xy[2 * v + 1]]);
    }
    console.log(`${k} pieces: median ${pct(lens, 0.5).toFixed(0)} studs, p10 ${pct(lens, 0.1).toFixed(0)}`);
    result[`${k}Turns`] = show(`${k} turning more than 12 degrees at a plain bend`, turns.t);
  }
  // Ramps: connected chains, and what each chain's two ends join.
  const rcomp = new Int32Array(N).fill(-1); let chains = 0; const joins = tally();
  for (let s = 0; s < N; s++) {
    if (rcomp[s] >= 0 || !nodeEdges[s].some(e => kinds[e] === ki.ramp)) continue;
    const stack = [s], touched = new Set(); rcomp[s] = chains; let loose = 0;
    while (stack.length) {
      const v = stack.pop();
      for (const e of nodeEdges[v]) if (kinds[e] !== ki.ramp) touched.add(KIND[kinds[e]]);
      if (nodeEdges[v].length === 1) loose++;
      for (const e of nodeEdges[v]) { if (kinds[e] !== ki.ramp) continue; const o = pairs[2 * e] === v ? pairs[2 * e + 1] : pairs[2 * e]; if (rcomp[o] < 0) { rcomp[o] = chains; stack.push(o); } }
    }
    joins.add(`${[...touched].sort().join(' + ') || 'nothing'}${loose ? ` (${loose} loose end${loose > 1 ? 's' : ''})` : ''}`, [xy[2 * s], xy[2 * s + 1]]); chains++;
  }
  result.ramps = show(`ramp chains (${chains}) by what they join`, joins.t, 20);
}
if (outFile) writeFileSync(outFile, JSON.stringify(result));
