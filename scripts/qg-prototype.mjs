// Stage 1 of the atmosphere redesign: runs the two-layer quasi-geostrophic model on its own
// and reports whether it behaves like the large-scale weather we need (see
// docs/ATMOSPHERE-REDESIGN.md for the acceptance checks).
//   node scripts/qg-prototype.mjs [days] [--png dir] [key=value ...]
// e.g. node scripts/qg-prototype.mjs 60 dragDays=3 seed=2
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { QuasiGeostrophicModel } from '../js/atmosphere/QuasiGeostrophicModel.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 60);
const pngDir = args.includes('--png') ? args[args.indexOf('--png') + 1] : null;
const overrides = Object.fromEntries(args.filter(a => a.includes('=')).map(a => { const [k, v] = a.split('='); return [k, Number(v)]; }));
const model = new QuasiGeostrophicModel(overrides);
const p = model.params, KT = 1.943844, RHO = 1.2, MILES = 1609.344;
const spinUpDays = Math.min(25, days / 2);
const WEAK_FLOW_KT = 25;   // a day with less mid-level wind than this has too little shear for organised storms

// The map window: the middle of the domain (the weather is statistically the same everywhere).
const window = { i: Math.floor(model.nx / 2), j: Math.floor(model.ny / 2) };
const upstream = { i: window.i - 6, j: window.j };   // 6 cells west, for the speed of the systems
const series = [];
const zonalUpper = new Float64Array(model.ny), zonalLower = new Float64Array(model.ny); let zonalSamples = 0;
const pct = (a, q) => { const v = [...a].sort((x, y) => x - y); return v[Math.floor(q * (v.length - 1))]; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

const started = performance.now();
const stepsPerSample = Math.round(3 * 3600 / p.timeStepSeconds);
for (let sample = 0; sample < days * 8; sample++) {
  for (let s = 0; s < stepsPerSample; s++) model.step();
  if (!Number.isFinite(model.psi1[0])) { console.log(`model became unstable on day ${(model.time / 86400).toFixed(1)}`); process.exit(1); }
  const day = model.time / 86400;
  if (day < spinUpDays) continue;
  if (sample % 8 === 0) { for (let j = 0; j < model.ny; j++) { let u1 = 0, u2 = 0; for (let i = 0; i < model.nx; i += 4) { const f = model.fieldsAt(i, j); u1 += f.upperWind.u; u2 += f.lowerWind.u; } zonalUpper[j] += u1 / (model.nx / 4); zonalLower[j] += u2 / (model.nx / 4); } zonalSamples++; }
  const here = model.fieldsAt(window.i, window.j), west = model.fieldsAt(upstream.i, upstream.j);
  series.push({
    day, speed500: Math.hypot(here.midWind.u, here.midWind.v) * KT, speedUpper: Math.hypot(here.upperWind.u, here.upperWind.v) * KT,
    speedLower: Math.hypot(here.lowerWind.u, here.lowerWind.v) * KT, shear: Math.hypot(here.upperWind.u - here.lowerWind.u, here.upperWind.v - here.lowerWind.v) * KT,
    surfaceU: here.surfaceWind.u, surfaceSpeed: Math.hypot(here.surfaceWind.u, here.surfaceWind.v) * KT,
    v500: here.midWind.v, v500West: west.midWind.v, surfacePressure: RHO * p.f0 * here.surfaceStreamfunction / 100, temperature: here.layerTemperatureK
  });
  if (pngDir && sample % 8 === 0 && day >= spinUpDays && day < spinUpDays + 6) writeMaps(Math.round(day));
}
const seconds = (performance.now() - started) / 1000;

// Trough passages: the mid-level wind turning from southerly (ahead of a trough) to northerly.
const passages = [];
for (let k = 1; k < series.length; k++) if (series[k - 1].v500 > 0 && series[k].v500 <= 0) passages.push(series[k].day);
const intervals = passages.slice(1).map((d, k) => d - passages[k]);
// Speed of the systems from the lag that best lines up the upstream point with the window.
let bestLag = 0, bestScore = -Infinity;
for (let lag = 0; lag <= 24; lag++) {
  let score = 0; for (let k = lag; k < series.length; k++) score += series[k].v500 * series[k - lag].v500West;
  if (score > bestScore) { bestScore = score; bestLag = lag; }
}
const distanceKm = (window.i - upstream.i) * p.gridKm, speedKmDay = bestLag ? distanceKm / (bestLag * 3 / 24) : NaN;
const surfaceU = series.map(s => s.surfaceU);
const pressure = series.map(s => s.surfacePressure), anomaly = pressure.map(v => v - mean(pressure));

console.log(`=== Quasi-geostrophic prototype: ${days} days (${spinUpDays} spin-up), grid ${model.nx}x${model.ny} at ${p.gridKm} km, ${JSON.stringify(overrides)} ===`);
console.log(`speed: ${(seconds / days).toFixed(2)} s per simulated day  [well under 1 s]`);
console.log(`trough passages at the window: ${passages.length} in ${(days - spinUpDays).toFixed(0)} days; interval median ${intervals.length ? pct(intervals, 0.5).toFixed(1) : '-'} days, range ${intervals.length ? `${Math.min(...intervals).toFixed(1)}-${Math.max(...intervals).toFixed(1)}` : '-'}  [aim 1.5-2, real 3-6]`);
console.log(`system speed: ${Number.isFinite(speedKmDay) ? `${Math.round(speedKmDay)} km/day (${Math.round(speedKmDay * 1000 / MILES)} mi/day)` : 'not resolved'}  [500-1,000 mi/day]`);
console.log(`surface pressure swing: ${(pct(anomaly, 0.95) - pct(anomaly, 0.05)).toFixed(1)} hPa between the 5th and 95th percentile, extremes ${Math.min(...anomaly).toFixed(1)} to ${Math.max(...anomaly).toFixed(1)}  [10-25]`);
console.log(`winds at the window (kt, mean / 90th): mid-level ${mean(series.map(s => s.speed500)).toFixed(0)} / ${pct(series.map(s => s.speed500), 0.9).toFixed(0)} [35-60 mean], upper ${mean(series.map(s => s.speedUpper)).toFixed(0)} / ${pct(series.map(s => s.speedUpper), 0.9).toFixed(0)}, lower ${mean(series.map(s => s.speedLower)).toFixed(0)} / ${pct(series.map(s => s.speedLower), 0.9).toFixed(0)}`);
console.log(`balanced wind at the ground (before the regional layer's mountain blocking): mean west-east component ${(mean(surfaceU) * KT).toFixed(0)} kt, mean speed ${mean(series.map(s => s.surfaceSpeed)).toFixed(0)} kt [10-20]`);
console.log(`upper-minus-lower shear: mean ${mean(series.map(s => s.shear)).toFixed(0)} kt, 90th ${pct(series.map(s => s.shear), 0.9).toFixed(0)} | layer temperature swing ${(pct(series.map(s => s.temperature), 0.95) - pct(series.map(s => s.temperature), 0.05)).toFixed(1)} K`);
// Day by day: how weak the flow gets, and for how long at a stretch.
const byDay = new Map(); for (const sample of series) { const d = Math.floor(sample.day); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(sample); }
const dailyMid = [...byDay.values()].map(rows => mean(rows.map(r => r.speed500))), dailyLower = [...byDay.values()].map(rows => mean(rows.map(r => r.speedLower)));
let spell = 0, longest = 0; for (const v of dailyMid) { spell = v < WEAK_FLOW_KT ? spell + 1 : 0; longest = Math.max(longest, spell); }
console.log(`weakest tenth of days: mid-level ${pct(dailyMid, 0.1).toFixed(0)} kt, lower layer ${pct(dailyLower, 0.1).toFixed(0)} kt | days with mid-level wind under ${WEAK_FLOW_KT} kt: ${Math.round(100 * dailyMid.filter(v => v < WEAK_FLOW_KT).length / dailyMid.length)}%, longest spell ${longest} days  [few, and short]`);
console.log(`southerly mid-level flow (ahead of a trough) ${Math.round(100 * series.filter(s => s.v500 > 0).length / series.length)}% of the time`);

const rows = []; for (let j = model.ny - 1; j >= 0; j -= Math.ceil(model.ny / 12)) rows.push(`${String(Math.round(model.y(j) / 1000)).padStart(5)} km${j === window.j || Math.abs(j - window.j) < Math.ceil(model.ny / 24) ? ' *' : '  '} upper ${String(Math.round(zonalUpper[j] / zonalSamples * KT)).padStart(4)} kt, lower ${String(Math.round(zonalLower[j] / zonalSamples * KT)).padStart(4)} kt`);
console.log(['time-mean west-east wind by latitude (north at top, * = window):', ...rows].join('\n  '));

// --- Maps: surface pressure anomaly (colour) for visual inspection.
function writeMaps(day) {
  fs.mkdirSync(pngDir, { recursive: true });
  const scale = 6, w = model.nx * scale, h = model.ny * scale, pixels = Buffer.alloc(w * h * 3);
  const field = (i, j) => { const f = model.fieldsAt(i, j); return { p: RHO * p.f0 * f.surfaceStreamfunction / 100, t: f.layerTemperatureK }; };
  const values = []; for (let j = 0; j < model.ny; j++) for (let i = 0; i < model.nx; i++) values.push(field(i, j));
  // Remove the zonal mean so the weather systems stand out.
  const zonal = Array.from({ length: model.ny }, (_, j) => mean(values.slice(j * model.nx, (j + 1) * model.nx).map(v => v.p)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = Math.floor(x / scale), j = model.ny - 1 - Math.floor(y / scale);   // north at the top
    const v = values[j * model.nx + i], a = Math.max(-1, Math.min(1, (v.p - zonal[j]) / 15)), o = (y * w + x) * 3;
    // Lows blue, highs red; temperature contours as dark lines every 4 K.
    let r = a > 0 ? 255 : Math.round(255 * (1 + a)), g = Math.round(255 * (1 - Math.abs(a))), b = a < 0 ? 255 : Math.round(255 * (1 - a));
    const east = values[j * model.nx + ((i + 1) % model.nx)].t, north = values[Math.min(model.ny - 1, j + 1) * model.nx + i].t;
    if ((x % scale === scale - 1 && Math.floor(v.t / 4) !== Math.floor(east / 4)) || (y % scale === 0 && Math.floor(v.t / 4) !== Math.floor(north / 4))) { r = g = b = 40; }
    if (i === window.i && j === window.j) { r = 0; g = 160; b = 0; }
    pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b;
  }
  fs.writeFileSync(path.join(pngDir, `qg-day-${String(day).padStart(3, '0')}.png`), png(w, h, pixels));
}

function png(width, height, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
