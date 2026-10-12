// Stage 3 of the atmosphere redesign: finds fronts and drylines from the fields of the regional
// layer and checks that they behave like real ones (see docs/ATMOSPHERE-REDESIGN.md).
//   node scripts/boundary-prototype.mjs [days] [--seed n] [--png dir] [key=value ...]
// key=value sets an analysis setting (see BOUNDARY_DEFAULTS).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { QuasiGeostrophicModel } from '../js/atmosphere/QuasiGeostrophicModel.js';
import { RegionalAtmosphere } from '../js/atmosphere/RegionalAtmosphere.js';
import { analyseBoundaries } from '../js/atmosphere/BoundaryAnalysis.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 12);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const pngDir = flag('--png'), seed = Number(flag('--seed') ?? 1);
const pairs = args.filter(a => a.includes('=')).map(a => { const [k, v] = a.split('='); return [k, Number(v)]; });
// key=value sets an analysis setting, regional.key=value one of the regional layer's.
const overrides = Object.fromEntries(pairs.filter(([k]) => !k.startsWith('regional.'))), regionalOverrides = Object.fromEntries(pairs.filter(([k]) => k.startsWith('regional.')).map(([k, v]) => [k.slice(9), v]));
const pct = (a, q) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(q * (v.length - 1))] : NaN; };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '-');

const model = new QuasiGeostrophicModel({ seed });
model.advance(45 * 86400);
// The analysis does not need soundings, so they are left out here for speed.
const regional = new RegionalAtmosphere(model, { diagnostics: false, ...regionalOverrides });
const world = regional.world, nx = world.width, ny = world.height, cellKm = world.cellSizeKm;
const surface = (xKm, yKm) => world.cells[Math.max(0, Math.min(ny - 1, Math.floor(yKm / cellKm)))][Math.max(0, Math.min(nx - 1, Math.floor(xKm / cellKm)))].surface;

const analyses = [], maxGradient = [], drylineColumn = { 21: [], 9: [] }, crossFront = [], crossDryline = [], moved = [];
let previous = null;
for (let step = 0; step < days * 48; step++) {
  regional.step();
  const utc = regional.hourUtc % 24;
  if (step < 48 || utc % 3 !== 0) continue;
  const analysis = analyseBoundaries(world, overrides), fronts = analysis.boundaries.filter(b => b.type !== 'dryline'), drylines = analysis.boundaries.filter(b => b.type === 'dryline');
  analyses.push({ utc, fronts, drylines });
  maxGradient.push(Math.max(...analysis.fields.thermalGradient));
  if (drylineColumn[utc] && drylines.length) drylineColumn[utc].push(mean(drylines.flatMap(b => b.pointsKm.map(q => q.x / cellKm))));
  // What an observer would see crossing each line: 30 miles either side of it.
  for (const boundary of analysis.boundaries) for (let i = 1; i < boundary.pointsKm.length - 1; i += 3) {
    const a = boundary.pointsKm[i - 1], b = boundary.pointsKm[i + 1], q = boundary.pointsKm[i], length = Math.hypot(b.x - a.x, b.y - a.y) || 1, nxn = (b.y - a.y) / length, nyn = -(b.x - a.x) / length, reach = 48;
    const one = surface(q.x + nxn * reach, q.y + nyn * reach), other = surface(q.x - nxn * reach, q.y - nyn * reach);
    const turn = Math.abs(((one.wind.direction - other.wind.direction + 540) % 360) - 180);
    if (boundary.type === 'dryline') crossDryline.push({ dewpoint: Math.abs(one.dewpoint - other.dewpoint), turn });
    else crossFront.push({ type: boundary.type, temperature: Math.abs(one.temperature - other.temperature), dewpoint: Math.abs(one.dewpoint - other.dewpoint), turn });
  }
  // Continuity: how far each front is from the nearest front of the analysis 3 hours earlier,
  // against how far the wind behind it would have carried it.
  if (previous) for (const front of fronts) {
    const earlier = previous.flatMap(b => b.pointsKm);
    if (!earlier.length) continue;
    const distance = pct(front.pointsKm.map(q => Math.min(...earlier.map(e => Math.hypot(e.x - q.x, e.y - q.y)))), 0.5);
    moved.push({ distance, expected: Math.abs(front.advanceMs) * 3 * 3.6 });
  }
  previous = fronts;
  if (pngDir && (utc === 0 || utc === 12)) writeMap(analysis, `boundaries-day-${String(Math.floor((regional.hourUtc - 12) / 24)).padStart(2, '0')}-${String(utc).padStart(2, '0')}Z.png`);
}

const count = type => analyses.map(a => a.fronts.filter(b => b.type === type).length);
const all = analyses.flatMap(a => a.fronts), dry = analyses.flatMap(a => a.drylines);
const of = type => crossFront.filter(c => c.type === type);
console.log(`=== Fronts and drylines from the fields: ${days} days, seed ${seed}, ${analyses.length} analyses (every 3 h), ${JSON.stringify(overrides)} ===`);
console.log(`\n1. Is there anything to find?`);
console.log(`  sharpest air-mass temperature contrast on the map: median ${fmt(pct(maxGradient, 0.5), 1)} K per 100 km, 90th ${fmt(pct(maxGradient, 0.9), 1)}, largest ${fmt(Math.max(...maxGradient), 1)}  [real fronts 5-15]`);
console.log(`  analyses with at least one front: ${fmt(100 * analyses.filter(a => a.fronts.length).length / analyses.length)}% | with a dryline: ${fmt(100 * analyses.filter(a => a.drylines.length).length / analyses.length)}% (at 21Z: ${fmt(100 * analyses.filter(a => a.utc === 21 && a.drylines.length).length / Math.max(1, analyses.filter(a => a.utc === 21).length))}%)`);
console.log(`  fronts per analysis: cold ${fmt(mean(count('cold')), 2)}, warm ${fmt(mean(count('warm')), 2)}, stationary ${fmt(mean(count('stationary')), 2)} | drylines ${fmt(mean(analyses.map(a => a.drylines.length)), 2)}`);
console.log(`\n2. What they look like`);
console.log(`  front length: median ${fmt(pct(all.map(b => b.lengthKm), 0.5))} km (90th ${fmt(pct(all.map(b => b.lengthKm), 0.9))}) | contrast ${fmt(pct(all.map(b => b.contrast), 0.5), 1)} K per 100 km`);
console.log(`  cold air advancing at: cold fronts ${fmt(pct(all.filter(b => b.type === 'cold').map(b => b.advanceMs * 2.237), 0.5))} mph [15-35], warm fronts retreating at ${fmt(pct(all.filter(b => b.type === 'warm').map(b => -b.advanceMs * 2.237), 0.5))} mph [10-20]`);
for (const type of ['cold', 'warm', 'stationary']) console.log(`  across a ${type} front (60 miles): temperature ${fmt(pct(of(type).map(c => c.temperature), 0.5), 1)} F [10-25], dewpoint ${fmt(pct(of(type).map(c => c.dewpoint), 0.5), 1)} F, wind turns ${fmt(pct(of(type).map(c => c.turn), 0.5))} degrees [45-120]  (${of(type).length} samples)`);
console.log(`  dryline: length median ${fmt(pct(dry.map(b => b.lengthKm), 0.5))} km | across it (60 miles): dewpoint ${fmt(pct(crossDryline.map(c => c.dewpoint), 0.5), 1)} F [20-40], wind turns ${fmt(pct(crossDryline.map(c => c.turn), 0.5))} degrees [45-120]`);
console.log(`  dryline position (column of ${nx}, west = 0): ${fmt(mean(drylineColumn[21]), 1)} at 21Z, ${fmt(mean(drylineColumn[9]), 1)} at 09Z  [further east by day]`);
console.log(`\n3. Do they move like fronts?`);
console.log(`  distance from each front to the nearest front 3 h earlier: median ${fmt(pct(moved.map(m => m.distance), 0.5))} km (90th ${fmt(pct(moved.map(m => m.distance), 0.9))}) | carried by the wind behind it: ${fmt(pct(moved.map(m => m.expected), 0.5))} km  [similar; a large 90th means fronts appear and vanish]`);

// --- Map: air-mass temperature (blue to red), dewpoint as green tint, the lines on top.
function writeMap(analysis, name) {
  fs.mkdirSync(pngDir, { recursive: true });
  const scale = 8, w = nx * scale, h = ny * scale, pixels = Buffer.alloc(w * h * 3);
  const t = analysis.fields.temperature, lo = Math.min(...t), hi = Math.max(...t);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = Math.floor(y / scale) * nx + Math.floor(x / scale), a = (t[k] - lo) / Math.max(1, hi - lo), o = (y * w + x) * 3, moist = Math.max(0, Math.min(1, (analysis.fields.moisture[k] - 6) / 8));
    pixels[o] = Math.round(120 + 110 * a); pixels[o + 1] = Math.round(150 + 60 * moist - 30 * a); pixels[o + 2] = Math.round(230 - 130 * a - 40 * moist);
  }
  const colours = { cold: [0, 0, 200], warm: [210, 0, 0], stationary: [130, 0, 150], dryline: [120, 70, 0] };
  const dot = (px, py, [r, g, b], size) => { for (let dy = -size; dy <= size; dy++) for (let dx = -size; dx <= size; dx++) { const X = Math.round(px + dx), Y = Math.round(py + dy); if (X >= 0 && Y >= 0 && X < w && Y < h) { const o = (Y * w + X) * 3; pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b; } } };
  for (const boundary of analysis.boundaries) for (let i = 1; i < boundary.pointsKm.length; i++) {
    const a = boundary.pointsKm[i - 1], b = boundary.pointsKm[i];
    for (let s = 0; s <= 1; s += 0.05) dot((a.x + (b.x - a.x) * s) / cellKm * scale, (a.y + (b.y - a.y) * s) / cellKm * scale, colours[boundary.type], 1);
  }
  // Surface wind ticks every 5 cells (the dot marks where the wind is blowing to).
  for (let cy = 2; cy < ny; cy += 5) for (let cx = 2; cx < nx; cx += 5) {
    const wind = world.cells[cy][cx].surface.wind, d = wind.direction * Math.PI / 180, length = Math.min(18, wind.speed);
    for (let s = 0; s <= 1; s += 0.1) dot((cx + 0.5) * scale - Math.sin(d) * length * s, (cy + 0.5) * scale + Math.cos(d) * length * s, [255, 255, 255], 0);
    dot((cx + 0.5) * scale - Math.sin(d) * length, (cy + 0.5) * scale + Math.cos(d) * length, [0, 0, 0], 1);
  }
  fs.writeFileSync(path.join(pngDir, name), png(w, h, pixels));
}
function png(width, height, rgb) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buffer => { let c = 0xffffffff; for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
