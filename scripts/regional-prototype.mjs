// Stage 2 of the atmosphere redesign: runs the regional layer on top of the quasi-geostrophic
// model and checks it against basic meteorology (see docs/ATMOSPHERE-REDESIGN.md).
//   node scripts/regional-prototype.mjs [days] [--png dir] [--seed n] [--section] [key=value ...] [qg.key=value ...]
// --section adds the time-mean west-to-east cross-section of the map in the afternoon and at night.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { QuasiGeostrophicModel } from '../js/atmosphere/QuasiGeostrophicModel.js';
import { RegionalAtmosphere } from '../js/atmosphere/RegionalAtmosphere.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 6);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const pngDir = flag('--png'), seed = Number(flag('--seed') ?? 1);
// key=value sets a regional parameter, qg.key=value one of the outer model's.
const pairs = args.filter(a => a.includes('=')).map(a => { const [k, v] = a.split('='); return [k, Number(v)]; });
const overrides = Object.fromEntries(pairs.filter(([k]) => !k.startsWith('qg.'))), outerOverrides = Object.fromEntries(pairs.filter(([k]) => k.startsWith('qg.')).map(([k, v]) => [k.slice(3), v]));
const DEG = Math.PI / 180;
const pct = (a, q) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(q * (v.length - 1))] : NaN; };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const uv = (speed, dir) => ({ u: -Math.sin(dir * DEG) * speed, v: -Math.cos(dir * DEG) * speed });
const turning = (a, b) => -Math.atan2(a.u * b.v - a.v * b.u, a.u * b.u + a.v * b.v) / DEG;   // + = veering (clockwise) with height

// --- Outer model: spin up.
const started = performance.now();
const model = new QuasiGeostrophicModel({ seed, ...outerOverrides });
model.advance(45 * 86400);
const regional = new RegionalAtmosphere(model, overrides);
const world = regional.world, nx = world.width, ny = world.height;
const spinSeconds = (performance.now() - started) / 1000;

const hourly = new Map();      // UTC hour -> samples
const afternoon = [], dailySupport = [];
const SECTION_COLUMNS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 49].filter(x => x < nx), sections = new Map();   // UTC hour -> name -> per-column sums
const sectionRows = {
  'terrain m': c => c.terrain.elevationM, 'pressure hPa': c => c.surface.seaLevelPressure, 'temperature F': c => c.surface.temperature, 'dewpoint F': c => c.surface.dewpoint,
  'mixed layer m': c => c.features.mixedLayerDepthM, 'surface west wind kt': c => uv(c.surface.wind.speed, c.surface.wind.direction).u, 'surface south wind kt': c => uv(c.surface.wind.speed, c.surface.wind.direction).v,
  '850 west wind kt': c => uv(c.levels[850].windSpeed, c.levels[850].windDirection).u, '850 south wind kt': c => uv(c.levels[850].windSpeed, c.levels[850].windDirection).v, '500 wind kt': c => c.levels[500].windSpeed,
  '850 temperature C': c => c.levels[850].temperature, '700 temperature C': c => c.levels[700].temperature, 'cap air share': c => c.features.emlInfluence,
  'CAPE': c => c.derived.sounding?.mlcape ?? 0, 'inhibition': c => Math.min(300, Math.abs(c.derived.sounding?.mlcin ?? 0)), 'cloud base m': c => c.derived.lclAgl, 'helicity': c => c.derived.srh, 'shear kt': c => c.derived.bulkShear
};
const runStarted = performance.now();
for (let step = 0; step < days * 48; step++) {
  regional.step();
  const utc = ((Math.round(regional.hourUtc * 2) / 2 % 24) + 24) % 24;
  if (utc % 1 !== 0) continue;
  const moist = [], all = [];
  world.forEachCell((cell, x, y) => { all.push(cell); if (cell.surface.dewpoint >= 58 && x > 2 && y > 2 && x < nx - 3 && y < ny - 3) moist.push(cell); });
  const record = hourly.get(utc) ?? hourly.set(utc, { t: [], td: [], cape: [], cin: [], llj: [], srh: [], depthEast: [], depthWest: [], moistShare: [] }).get(utc);
  record.srh.push(mean(moist.map(c => c.derived.srh)));
  record.t.push(mean(moist.map(c => c.surface.temperature))); record.td.push(mean(moist.map(c => c.surface.dewpoint)));
  record.cape.push(mean(moist.map(c => c.derived.sounding?.mlcape ?? 0))); record.cin.push(mean(moist.map(c => Math.abs(c.derived.sounding?.mlcin ?? 0))));
  record.llj.push(mean(moist.map(c => c.levels[850].windSpeed))); record.moistShare.push(moist.length / all.length);
  record.depthEast.push(mean(all.filter(c => c.x > nx * 0.7).map(c => c.features.mixedLayerDepthM))); record.depthWest.push(mean(all.filter(c => c.x < nx * 0.25).map(c => c.features.mixedLayerDepthM)));
  if (args.includes('--section') && (utc === 22 || utc === 8)) {
    const table = sections.get(utc) ?? sections.set(utc, { count: 0, rows: Object.fromEntries(Object.keys(sectionRows).map(name => [name, SECTION_COLUMNS.map(() => 0)])) }).get(utc);
    table.count++;
    for (const [name, read] of Object.entries(sectionRows)) SECTION_COLUMNS.forEach((x, n) => { let sum = 0; for (let y = 10; y < ny - 10; y++) sum += read(world.cells[y][x]); table.rows[name][n] += sum / (ny - 20); });
  }
  if (utc === 22) {
    const veerLow = [], veerMid = [], s500 = [], s850 = [], shear = [], cape = [], cin = [], lcl = [], srh = [], cap = [];
    for (const c of moist) {
      const sfc = uv(c.surface.wind.speed, c.surface.wind.direction), w850 = uv(c.levels[850].windSpeed, c.levels[850].windDirection), w500 = uv(c.levels[500].windSpeed, c.levels[500].windDirection);
      if (c.surface.wind.speed > 3) { veerLow.push(turning(sfc, w850)); veerMid.push(turning(w850, w500)); }
      s500.push(c.levels[500].windSpeed); s850.push(c.levels[850].windSpeed); shear.push(Math.hypot(w500.u - sfc.u, w500.v - sfc.v));
      cape.push(c.derived.sounding?.mlcape ?? 0); cin.push(Math.abs(c.derived.sounding?.mlcin ?? 0)); lcl.push(c.derived.lclAgl); srh.push(c.derived.srh); cap.push(c.levels[700].temperature);
    }
    // Dryline: the sharpest west-east dewpoint change along each row.
    const jumps = [], columns = [];
    for (let y = 5; y < ny - 5; y += 3) { let best = 0, at = 0; for (let x = 2; x < nx - 2; x++) { const d = world.cells[y][x + 1].surface.dewpoint - world.cells[y][x - 1].surface.dewpoint; if (d > best) { best = d; at = x; } } jumps.push(best); columns.push(at); }
    const supportive = all.filter(c => (c.derived.sounding?.mlcape ?? 0) >= 1500 && c.derived.bulkShear >= 30).length / all.length;
    const breakable = all.filter(c => (c.derived.sounding?.mlcape ?? 0) >= 1500 && c.derived.bulkShear >= 30 && Math.abs(c.derived.sounding?.mlcin ?? 0) <= 50).length / all.length;
    afternoon.push({ veerLow: pct(veerLow, 0.5), veerMid: pct(veerMid, 0.5), s500: pct(s500, 0.5), s850: pct(s850, 0.5), shear: pct(shear, 0.5), shear90: pct(shear, 0.9), cape: pct(cape, 0.5), cape90: pct(cape, 0.9), srh90: pct(srh, 0.9), s85090: pct(s850, 0.9), cin: pct(cin, 0.5), lcl: pct(lcl, 0.5), srh: pct(srh, 0.5), cap: pct(cap, 0.5),
      drylineJump: pct(jumps, 0.5), drylineColumn: pct(columns, 0.5), moistShare: moist.length / all.length, tMax: pct(all.map(c => c.surface.temperature), 0.98), tdMax: pct(all.map(c => c.surface.dewpoint), 0.98), tdMin: pct(all.map(c => c.surface.dewpoint), 0.02) });
    const unstable = all.filter(c => (c.derived.sounding?.mlcape ?? 0) >= 1500);
    dailySupport.push({ supportive, breakable, heightChange: pct(all.map(c => c.levels[500].heightTendencyDm12h), 0.5), moist: moist.length / all.length, unstable: unstable.length / all.length,
      shear: pct((unstable.length ? unstable : all).map(c => c.derived.bulkShear), 0.5), wind500: pct(all.map(c => c.levels[500].windSpeed), 0.5), direction500: pct(all.map(c => c.levels[500].windDirection), 0.5) });
    if (pngDir) writeMap(Math.round((regional.hourUtc - 12) / 24));
  }
}
const runSeconds = (performance.now() - runStarted) / 1000;

const hours = [...hourly.keys()].sort((a, b) => a - b);
const cycle = key => hours.map(h => ({ h, v: mean(hourly.get(h)[key]) })), top = key => cycle(key).reduce((a, b) => (b.v > a.v ? b : a)), bottom = key => cycle(key).reduce((a, b) => (b.v < a.v ? b : a));
const med = key => pct(afternoon.map(r => r[key]), 0.5);
console.log(`=== Regional layer: ${days} days, seed ${seed}, ${JSON.stringify({ ...overrides, ...Object.fromEntries(Object.entries(outerOverrides).map(([k, v]) => ['qg.' + k, v])) })} ===`);
console.log(`speed: outer spin-up ${spinSeconds.toFixed(0)} s; ${(runSeconds / days).toFixed(1)} s per simulated day with soundings`);
console.log(`\n1. Daily cycle in the moist air (local time = UTC - 6)`);
console.log(`  temperature: max ${fmt(top('t').v, 1)}F at ${top('t').h}Z [21-23Z], min ${fmt(bottom('t').v, 1)}F at ${bottom('t').h}Z [11-12Z], range ${fmt(top('t').v - bottom('t').v, 1)}F [18-28]`);
console.log(`  dewpoint ${fmt(bottom('td').v, 1)}-${fmt(top('td').v, 1)}F | CAPE max ${fmt(top('cape').v)} at ${top('cape').h}Z [21-00Z], min ${fmt(bottom('cape').v)} at ${bottom('cape').h}Z | inhibition min ${fmt(bottom('cin').v)} at ${bottom('cin').h}Z [late afternoon], max ${fmt(top('cin').v)} at ${top('cin').h}Z`);
console.log(`  850 mb wind: max ${fmt(top('llj').v)} kt at ${top('llj').h}Z [06-09Z], min ${fmt(bottom('llj').v)} kt at ${bottom('llj').h}Z [21-00Z] | low-level helicity by hour: ${[18, 21, 0, 3, 6, 9].map(h => `${h}Z ${fmt(mean(hourly.get(h)?.srh ?? []))}`).join(', ')}`);
console.log(`  mixed layer depth at its deepest: east ${fmt(top('depthEast').v)} m [1,000-2,000], west ${fmt(top('depthWest').v)} m [2,500-4,000]`);
console.log(`\n2. Afternoon (22Z) in the moist air, median over ${afternoon.length} days`);
console.log(`  wind turning with height: surface to 850 mb ${fmt(med('veerLow'))}° [20-50], 850 to 500 mb ${fmt(med('veerMid'))}° [20-50]`);
console.log(`  wind speed kt: 500 mb ${fmt(med('s500'))} [35-55], 850 mb ${fmt(med('s850'))} (90th ${fmt(med('s85090'))}) [20-40] | surface-500 mb shear ${fmt(med('shear'))} (90th ${fmt(med('shear90'))}) [35-60]`);
console.log(`  instability: CAPE ${fmt(med('cape'))} (90th ${fmt(med('cape90'))}) [1,500-3,500] | inhibition ${fmt(med('cin'))} [25-100] | cloud base ${fmt(med('lcl'))} m [800-1,500] | low-level helicity ${fmt(med('srh'))} (90th ${fmt(med('srh90'))}; best day ${fmt(Math.max(...afternoon.map(r => r.srh90)))}) [100-300 on storm days] | 700 mb ${fmt(med('cap'), 1)}C [8-12 capped]`);
console.log(`  map: hottest ${fmt(med('tMax'))}F, dewpoints ${fmt(med('tdMin'))}F (dry side) to ${fmt(med('tdMax'))}F (moist side); moist air covers ${fmt(100 * med('moistShare'))}% of the map`);
console.log(`  dryline: dewpoint changes ${fmt(med('drylineJump'), 1)}F across 20 miles [15-30] at column ${fmt(med('drylineColumn'))} of ${nx} (west = 0)`);
console.log(`\n3. Day by day at 22Z: share of the map with CAPE >= 1,500 and shear >= 30 kt | also inhibition <= 50 | 500 mb height change (dam/12 h) | moist air | CAPE >= 1,500 | shear there (kt) | 500 mb wind (kt, from)`);
console.log('  ' + dailySupport.map((d, i) => `day ${String(i + 1).padStart(2)}: ${fmt(100 * d.supportive).padStart(3)}% | ${fmt(100 * d.breakable).padStart(3)}% | ${fmt(d.heightChange, 1).padStart(5)} | ${fmt(100 * d.moist).padStart(3)}% | ${fmt(100 * d.unstable).padStart(3)}% | ${fmt(d.shear).padStart(3)} | ${fmt(d.wind500).padStart(3)} from ${fmt(d.direction500)}`).join('\n  '));
console.log(`  days with under 5% of the map supportive: ${dailySupport.filter(d => d.supportive < 0.05).length} of ${dailySupport.length}`);

for (const [utc, table] of [...sections].sort((a, b) => b[0] - a[0])) {
  console.log(`
${utc === 22 ? 'Afternoon (22Z)' : 'Night (08Z)'} cross-section, west to east, mean of ${table.count} days over the middle rows`);
  console.log('  ' + 'column'.padEnd(22) + SECTION_COLUMNS.map(x => String(x).padStart(6)).join(''));
  for (const [name, sums] of Object.entries(table.rows)) console.log('  ' + name.padEnd(22) + sums.map(v => { const m = v / table.count; return (Math.abs(m) < 10 && name !== 'terrain m' ? m.toFixed(1) : m.toFixed(0)).padStart(6); }).join(''));
}

function writeMap(day) {
  fs.mkdirSync(pngDir, { recursive: true });
  const scale = 8, w = nx * scale, h = ny * scale, pixels = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = world.cells[Math.floor(y / scale)][Math.floor(x / scale)], o = (y * w + x) * 3;
    // Dewpoint: brown (dry) to green (moist); CAPE >= 1,500 outlined by brighter shading.
    const m = Math.max(0, Math.min(1, (c.surface.dewpoint - 30) / 42)), strong = (c.derived.sounding?.mlcape ?? 0) >= 1500 ? 1 : 0.8;
    pixels[o] = Math.round((170 - 150 * m) * strong); pixels[o + 1] = Math.round((120 + 110 * m) * strong); pixels[o + 2] = Math.round((70 - 40 * m) * strong);
    // Surface wind ticks every 5 cells.
    const cx = Math.floor(x / scale), cy = Math.floor(y / scale);
    if (cx % 5 === 2 && cy % 5 === 2) { const wv = uv(c.surface.wind.speed, c.surface.wind.direction), t = ((x % scale) - 4) * wv.u - ((y % scale) - 4) * wv.v, across = ((x % scale) - 4) * wv.v + ((y % scale) - 4) * wv.u; if (Math.abs(across) < Math.hypot(wv.u, wv.v) * 0.8 && t >= 0) { pixels[o] = pixels[o + 1] = pixels[o + 2] = 255; } }
  }
  fs.writeFileSync(path.join(pngDir, `regional-day-${String(day).padStart(2, '0')}-22Z.png`), png(w, h, pixels));
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
