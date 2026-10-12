// Climate tuning, step 1 (docs/ATMOSPHERE-REDESIGN.md): the atmosphere's own soundings against
// what real warm-season Plains soundings look like. No storms run here.
//   node scripts/environment-report.mjs [days] [--seeds 1,2,3] [key=value ...]
// key=value sets a regional-layer setting, qg.key=value one of the outer model's.
//
// The reference ranges are approximate. They are the values usually quoted from the proximity
// sounding studies (Rasmussen and Blanchard 1998; Thompson et al. 2003; Craven and Brooks
// 2004) and from station climatologies, written down from memory of those studies and not
// checked against the papers' tables.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 20);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const settings = args.filter(a => a.includes('='));

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

// One seed: a list of afternoon and evening samples from the moist air, and per-day summaries.
async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const pairs = settings.map(a => { const [k, v] = a.split('='); return [k, Number(v)]; });
  const regional = Object.fromEntries(pairs.filter(([k]) => !k.startsWith('qg.'))), outer = Object.fromEntries(pairs.filter(([k]) => k.startsWith('qg.')).map(([k, v]) => [k.slice(3), v]));
  let model = null;
  if (Object.keys(outer).length) { const { QuasiGeostrophicModel } = await import('../js/atmosphere/QuasiGeostrophicModel.js'); model = new QuasiGeostrophicModel({ seed, ...outer }); model.advance(45 * 86400); }
  const atmosphere = new AtmosphereWorld({ seed, regional, storms: false, ...(model ? { model } : {}) });
  const world = atmosphere.world, samples = [], daily = [];
  for (let day = 0; day < days; day++) {
    const record = { maxStp: 0, maxCape: 0, moistShare: 0, supportive: 0, tornadic: 0, fronts: 0, drylines: 0 };
    for (let step = 0; step < 48; step++) {
      atmosphere.advance(0.5);
      const utc = ((world.validHourUtc % 24) + 24) % 24;
      if (utc !== 21 && utc !== 0) continue;
      let moist = 0, supportive = 0, tornadic = 0, cells = 0;
      for (let y = 3; y < world.height - 3; y += 2) for (let x = 3; x < world.width - 3; x += 2) {
        const cell = world.cells[y][x], s = cell.derived.sounding;
        cells++;
        record.maxStp = Math.max(record.maxStp, cell.derived.stp ?? 0); record.maxCape = Math.max(record.maxCape, s.mlcape);
        if (s.mlcape >= 1000 && s.shear06 >= 35) supportive++;
        if ((cell.derived.stp ?? 0) >= 1) tornadic++;
        // The moist air: where a surface observer would call it the warm sector.
        if (cell.surface.dewpoint < 58) continue;
        moist++;
        samples.push([utc, s.mlcape, Math.abs(s.mlcin), cell.derived.lclAgl, s.lapseRate700500, s.lapseRate03km, cell.levels[700].temperature, cell.levels[500].temperature, cell.surface.temperature, cell.surface.dewpoint,
          s.shear06, s.shear01, s.srh01, s.srh03, cell.derived.stp ?? 0, cell.derived.scp ?? 0, cell.levels[850].windSpeed, cell.levels[500].windSpeed, s.sbcape, s.mucape].map(v => Math.round(v * 10) / 10));
      }
      if (utc === 21) { record.moistShare = moist / cells; record.supportive = supportive / cells; record.tornadic = tornadic / cells; record.fronts = atmosphere.boundaries.filter(b => b.type === 'cold' || b.type === 'warm' || b.type === 'stationary').length; record.drylines = atmosphere.boundaries.filter(b => b.type === 'dryline').length; }
    }
    daily.push(record);
  }
  process.send({ seed, samples, daily });
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3').split(',').map(Number), started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), ...settings]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })));
  const names = ['utc', 'mlcape', 'mlcin', 'lcl', 'lapse', 'lapse03', 't700', 't500', 't', 'td', 'shear06', 'shear01', 'srh01', 'srh03', 'stp', 'scp', 'wind850', 'wind500', 'sbcape', 'mucape'];
  const all = results.flatMap(r => r.samples.map(row => Object.fromEntries(row.map((v, i) => [names[i], v])))), daily = results.flatMap(r => r.daily);
  const pct = (a, q) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(q * (v.length - 1))] : NaN; };
  const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '-');
  const row = (label, rows, key, d, reference) => console.log(`  ${label.padEnd(34)} ${[0.1, 0.5, 0.9, 0.99].map(q => fmt(pct(rows.map(r => r[key]), q), d).padStart(7)).join('')}   ${reference}`);
  const unstable = all.filter(r => r.mlcape >= 250);
  // Supercell environments: what the proximity studies sampled.
  const supercell = all.filter(r => r.mlcape >= 1000 && r.shear06 >= 35 && r.mlcin <= 100), tornadic = supercell.filter(r => r.stp >= 1);

  console.log(`=== Environment report: ${days} days x seeds ${seeds.join(', ')} (${((Date.now() - started) / 1000).toFixed(0)} s), ${JSON.stringify(settings)} ===`);
  console.log(`Samples at 21Z and 00Z in the moist air (dewpoint 58 F or more): ${all.length}; with CAPE of 250 or more: ${unstable.length}`);
  console.log(`\n1. The moist, unstable air on all days                 10th   50th   90th   99th   real warm season (approximate)`);
  row('CAPE, mixed layer (J/kg)', unstable, 'mlcape', 0, 'median 1,000-2,000; 90th 3,000-3,500; 99th 4,500-5,500');
  row('inhibition (J/kg)', unstable, 'mlcin', 0, 'median 25-75; 90th 150-250');
  row('cloud base above ground (m)', unstable, 'lcl', 0, 'median 1,000-1,500; 10th 600-800');
  row('lapse rate 700-500 mb (C/km)', unstable, 'lapse', 1, 'median 7.0-7.5; 90th 8.0-8.5; 10th 6.0-6.5');
  row('lapse rate lowest 3 km (C/km)', unstable, 'lapse03', 1, 'afternoon median 7.5-8.5');
  row('700 mb temperature (C)', unstable, 't700', 1, 'median 8-10; 90th 12-14');
  row('500 mb temperature (C)', unstable, 't500', 1, 'median -10 to -12; 10th -15');
  row('surface temperature (F)', unstable, 't', 0, 'median 80-86; 90th 90-94');
  row('surface dewpoint (F)', unstable, 'td', 0, 'median 62-66; 90th 70-72');
  row('shear, surface to 6 km (kt)', unstable, 'shear06', 0, 'median 30-35; 90th 50-55');
  row('shear, surface to 1 km (kt)', unstable, 'shear01', 0, 'median 8-12; 90th 20-25');
  row('helicity, lowest 1 km', unstable, 'srh01', 0, 'median 40-70; 90th 150-200');
  row('helicity, lowest 3 km', unstable, 'srh03', 0, 'median 80-130; 90th 250-350');
  row('850 mb wind (kt)', unstable, 'wind850', 0, 'median 15-25; 90th 35-40');
  row('500 mb wind (kt)', unstable, 'wind500', 0, 'median 30-35; 90th 50-60');
  row('significant tornado parameter', unstable, 'stp', 1, 'median near 0; 90th 0.5-1; 99th 3-5');
  row('supercell composite', unstable, 'scp', 1, 'median 0-2; 90th 6-10');
  console.log(`  share of these samples with CAPE over 4,500: ${fmt(100 * unstable.filter(r => r.mlcape > 4500).length / unstable.length, 1)}%  [about 1%] | with lapse rate under 6.5: ${fmt(100 * unstable.filter(r => r.lapse < 6.5).length / unstable.length)}%  [about 15%]`);

  console.log(`\n2. Supercell environments (CAPE 1,000+, shear 35 kt+, inhibition 100 or less): ${supercell.length} samples, ${fmt(100 * supercell.length / all.length)}% of the moist air`);
  console.log(`                                                        10th   50th   90th   99th   real supercell soundings (approximate)`);
  row('CAPE, mixed layer (J/kg)', supercell, 'mlcape', 0, 'median 1,500-2,300');
  row('shear, surface to 6 km (kt)', supercell, 'shear06', 0, 'median 40-50');
  row('helicity, lowest 1 km', supercell, 'srh01', 0, 'median 70-80 without tornadoes, 150-200 with significant ones');
  row('shear, surface to 1 km (kt)', supercell, 'shear01', 0, 'median 10 without tornadoes, 20 with significant ones');
  row('cloud base above ground (m)', supercell, 'lcl', 0, 'median 1,300-1,400 without tornadoes, 900-1,100 with');
  row('lapse rate 700-500 mb (C/km)', supercell, 'lapse', 1, 'median 7.0-7.8');
  row('significant tornado parameter', supercell, 'stp', 1, 'median 0.5 without tornadoes, 2 with significant ones');
  console.log(`  of these, with a significant tornado parameter of 1 or more: ${fmt(100 * tornadic.length / Math.max(1, supercell.length))}%  [roughly a quarter to a third]`);

  console.log(`\n3. Day by day (${daily.length} days)`);
  const share = test => `${fmt(100 * daily.filter(test).length / daily.length)}%`;
  console.log(`  highest CAPE on the map: median ${fmt(pct(daily.map(d => d.maxCape), 0.5))}, 90th ${fmt(pct(daily.map(d => d.maxCape), 0.9))}, highest ${fmt(pct(daily.map(d => d.maxCape), 1))}  [median 2,500-3,500; 90th 4,500; record near 6,000-7,000]`);
  console.log(`  highest tornado parameter on the map: median ${fmt(pct(daily.map(d => d.maxStp), 0.5), 1)}, 90th ${fmt(pct(daily.map(d => d.maxStp), 0.9), 1)}, highest ${fmt(pct(daily.map(d => d.maxStp), 1), 1)}  [median 0.5-1.5; 90th 4-6; highest 10-12]`);
  console.log(`  days with a supercell environment over 5% of the map or more: ${share(d => d.supportive >= 0.05)} | with a tornado parameter of 1+ somewhere: ${share(d => d.maxStp >= 1)}, of 4+: ${share(d => d.maxStp >= 4)}`);
  console.log(`  moist air's share of the map at 21Z: median ${fmt(100 * pct(daily.map(d => d.moistShare), 0.5))}% (10th ${fmt(100 * pct(daily.map(d => d.moistShare), 0.1))}%, 90th ${fmt(100 * pct(daily.map(d => d.moistShare), 0.9))}%)`);
  console.log(`  lines analysed at 21Z: fronts median ${fmt(pct(daily.map(d => d.fronts), 0.5))} (90th ${fmt(pct(daily.map(d => d.fronts), 0.9))}, most ${fmt(pct(daily.map(d => d.fronts), 1))})  [0-2] | drylines median ${fmt(pct(daily.map(d => d.drylines), 0.5))} (most ${fmt(pct(daily.map(d => d.drylines), 1))})  [0-1]`);
}
