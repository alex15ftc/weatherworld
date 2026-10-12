// Where on the map the severe weather falls, and what each world's days are made of.
//   node scripts/spatial-report.mjs [days per seed] [--seeds 1,2,...] [key=value ...]
// key=value sets a regional-layer setting, qg.key=value one of the outer model's, steer.key=value
// one of the region steering's. A day is 12Z to 12Z. The map is shown as a 10 x 10 grid of
// 50-mile blocks, west on the left and north at the top.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 30);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const settings = args.filter(a => a.includes('='));
const KINDS = ['severe', 'tornado', 'hail', 'wind', 'storm'], BLOCKS = 10;

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { captureTruth } = await import('../js/verification/truth.js');
  const pairs = settings.map(a => { const [k, v] = a.split('='); return [k, Number(v)]; });
  const pick = prefix => Object.fromEntries(pairs.filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
  const regional = Object.fromEntries(pairs.filter(([k]) => !k.includes('.'))), outer = pick('qg.');
  let model = null;
  if (Object.keys(outer).length) { const { QuasiGeostrophicModel } = await import('../js/atmosphere/QuasiGeostrophicModel.js'); model = new QuasiGeostrophicModel({ seed, ...outer }); model.advance(45 * 86400); }
  const atmosphere = new AtmosphereWorld({ seed, regional, steering: pick('steer.'), ...(model ? { model } : {}) }), world = atmosphere.world, nx = world.width, ny = world.height, n = nx * ny;
  const block = k => Math.min(BLOCKS - 1, Math.floor(Math.floor(k / nx) * BLOCKS / ny)) * BLOCKS + Math.min(BLOCKS - 1, Math.floor((k % nx) * BLOCKS / nx));
  // Days on which each block had each thing happen in it.
  const blockDays = Object.fromEntries(KINDS.map(kind => [kind, new Float64Array(BLOCKS * BLOCKS)])), daily = [];
  // Afternoon air by column (10 bands west to east) and by row (north to south).
  const bands = { dewpointX: new Float64Array(BLOCKS), capeX: new Float64Array(BLOCKS), dewpointY: new Float64Array(BLOCKS), capeY: new Float64Array(BLOCKS), terrainX: new Float64Array(BLOCKS), count: 0 };
  for (let day = 0; day < days; day++) {
    const frames = [], seen = new Set(), initiations = [], before = world.stormEngine.totalTornadoes, plan = atmosphere.steering?.plan ?? null;
    const hit = Object.fromEntries(KINDS.map(kind => [kind, new Uint8Array(BLOCKS * BLOCKS)]));
    const record = { seed, day, storms: 0, tornadoes: 0, support: plan?.support ?? null, wanted: plan?.wanted ?? null, slideMs: plan?.slideMs ?? null };
    for (let step = 0; step < 48; step++) {
      atmosphere.advance(0.5);
      const frame = captureTruth(world, frames, seen, initiations);
      for (let k = 0; k < n; k++) {
        if (frame.storm[k]) hit.storm[block(k)] = 1;
        if (frame.tornado[k]) hit.tornado[block(k)] = 1;
        if (frame.hail[k]) hit.hail[block(k)] = 1;
        if (frame.wind[k]) hit.wind[block(k)] = 1;
      }
      frames.length = 0;   // only this frame is needed
      if (((world.validHourUtc % 24) + 24) % 24 === 22) {
        const moist = [], cape = [], shear = [], aloft = [], srh = [];
        world.forEachCell((cell, x, y) => {
          const bx = Math.min(BLOCKS - 1, Math.floor(x * BLOCKS / nx)), by = Math.min(BLOCKS - 1, Math.floor(y * BLOCKS / ny)), c = cell.derived.sounding?.mlcape ?? 0;
          const share = BLOCKS / n; bands.dewpointX[bx] += cell.surface.dewpoint * share; bands.capeX[bx] += c * share; bands.dewpointY[by] += cell.surface.dewpoint * share; bands.capeY[by] += c * share; bands.terrainX[bx] += cell.terrain.elevationM * share;
          if (cell.surface.dewpoint >= 58) { moist.push(1); cape.push(c); shear.push(cell.derived.bulkShear ?? 0); aloft.push(cell.levels[500].windSpeed ?? 0); srh.push(cell.derived.srh ?? 0); }
        });
        bands.count++;
        const med = v => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : 0);
        Object.assign(record, { moistShare: moist.length / n, cape: med(cape), shear: med(shear), aloft: med(aloft), srh: med(srh) });
      }
    }
    for (let b = 0; b < BLOCKS * BLOCKS; b++) { hit.severe[b] = hit.tornado[b] || hit.hail[b] || hit.wind[b] ? 1 : 0; for (const kind of KINDS) blockDays[kind][b] += hit[kind][b]; }
    record.storms = seen.size; record.tornadoes = world.stormEngine.totalTornadoes - before; record.severeBlocks = hit.severe.reduce((a, b) => a + b, 0);
    daily.push(record);
  }
  process.send({ seed, daily, blockDays: Object.fromEntries(KINDS.map(kind => [kind, [...blockDays[kind]]])), bands: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, typeof v === 'number' ? v : [...v]])) });
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3,4,5,6,7,8').split(',').map(Number), started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), ...settings]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })));
  const all = results.flatMap(r => r.daily), total = all.length;
  console.log(`=== Spatial report: ${days} days x seeds ${seeds.join(', ')} = ${total} days (${((Date.now() - started) / 1000).toFixed(0)} s), ${JSON.stringify(settings)} ===`);
  const sum = kind => { const out = new Float64Array(BLOCKS * BLOCKS); for (const r of results) r.blockDays[kind].forEach((v, b) => { out[b] += v; }); return out; };
  const show = (title, grid) => {
    console.log(`\n${title} (percent of days; west on the left, north at the top; each block 50 x 50 miles)`);
    for (let y = 0; y < BLOCKS; y++) console.log('  ' + Array.from({ length: BLOCKS }, (_, x) => String(Math.round(100 * grid[y * BLOCKS + x] / total)).padStart(4)).join(''));
    const column = x => Array.from({ length: BLOCKS }, (_, y) => grid[y * BLOCKS + x]).reduce((a, b) => a + b, 0) / BLOCKS / total, row = y => Array.from({ length: BLOCKS }, (_, x) => grid[y * BLOCKS + x]).reduce((a, b) => a + b, 0) / BLOCKS / total;
    const columns = Array.from({ length: BLOCKS }, (_, x) => column(x)), rows = Array.from({ length: BLOCKS }, (_, y) => row(y)), values = [...grid].map(v => v / total), mean = values.reduce((a, b) => a + b, 0) / values.length;
    const spread = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length) / (mean || 1);
    const half = (list, from, to) => list.slice(from, to).reduce((a, b) => a + b, 0) / (to - from);
    console.log(`  by column, west to east: ${columns.map(v => Math.round(100 * v)).join(' ')} | by row, north to south: ${rows.map(v => Math.round(100 * v)).join(' ')}`);
    console.log(`  mean ${(100 * mean).toFixed(1)}% | lowest block ${Math.round(100 * Math.min(...values))}%, highest ${Math.round(100 * Math.max(...values))}% | unevenness (spread / mean) ${spread.toFixed(2)} | west half ${(100 * half(columns, 0, 5)).toFixed(1)}% against east half ${(100 * half(columns, 5, 10)).toFixed(1)}% | north half ${(100 * half(rows, 0, 5)).toFixed(1)}% against south half ${(100 * half(rows, 5, 10)).toFixed(1)}%`);
  };
  show('1. Severe weather (a tornado, 1 in hail or 58 mph wind in the block)', sum('severe'));
  show('2. A tornado in the block', sum('tornado'));
  show('3. A storm in the block', sum('storm'));
  const band = key => Array.from({ length: BLOCKS }, (_, i) => results.reduce((a, r) => a + r.bands[key][i], 0) / results.reduce((a, r) => a + r.bands.count, 0));
  console.log(`\n4. The afternoon air across the map (22Z means)`);
  console.log(`  west to east:   terrain m ${band('terrainX').map(v => v.toFixed(0)).join(' ')}`);
  console.log(`                  dewpoint F ${band('dewpointX').map(v => v.toFixed(0)).join(' ')} | CAPE ${band('capeX').map(v => v.toFixed(0)).join(' ')}`);
  console.log(`  north to south: dewpoint F ${band('dewpointY').map(v => v.toFixed(0)).join(' ')} | CAPE ${band('capeY').map(v => v.toFixed(0)).join(' ')}`);
  console.log(`\n5. World by world (medians of the day's 22Z values in the moist air, dewpoint 58 F or more)`);
  console.log(`  ${'seed'.padEnd(6)}${'tornado days'.padStart(13)}${'tornadoes'.padStart(11)}${'storms'.padStart(8)}${'moist share'.padStart(13)}${'CAPE'.padStart(7)}${'shear kt'.padStart(10)}${'500 mb kt'.padStart(11)}${'helicity'.padStart(10)}${'support'.padStart(9)}${'wanted'.padStart(8)}${'slide m/s'.padStart(11)}${'blocks hit'.padStart(12)}`);
  const med = (rows, key) => { const v = rows.map(r => r[key]).filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };
  for (const r of [...results].sort((a, b) => a.seed - b.seed)) { const d = r.daily; console.log(`  ${String(r.seed).padEnd(6)}${`${Math.round(100 * d.filter(x => x.tornadoes > 0).length / d.length)}%`.padStart(13)}${String(med(d, 'tornadoes')).padStart(11)}${String(med(d, 'storms')).padStart(8)}${`${Math.round(100 * med(d, 'moistShare'))}%`.padStart(13)}${med(d, 'cape').toFixed(0).padStart(7)}${med(d, 'shear').toFixed(0).padStart(10)}${med(d, 'aloft').toFixed(0).padStart(11)}${med(d, 'srh').toFixed(0).padStart(10)}${med(d, 'support').toFixed(2).padStart(9)}${med(d, 'wanted').toFixed(2).padStart(8)}${med(d, 'slideMs').toFixed(0).padStart(11)}${String(med(d, 'severeBlocks')).padStart(12)}`); }
  console.log(`  all: tornado days ${Math.round(100 * all.filter(d => d.tornadoes > 0).length / total)}% | days with no severe weather ${Math.round(100 * all.filter(d => !d.severeBlocks).length / total)}%`);
}
