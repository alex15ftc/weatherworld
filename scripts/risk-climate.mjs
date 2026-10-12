// Risk categories for this world's own climate. Runs the world for many days, records how high
// the chance of each hazard gets on each day, and finds the thresholds that give the wanted
// mix of days (docs/STATUS.md): the same way real categories are tied to the real climate.
//   node scripts/risk-climate.mjs [days per seed] [--seeds 1,2,3,4,5,6,7,8] [--json file]
// The chance is the practically perfect one used to verify outlooks: reports on an 80 km grid
// smoothed over 120 km, read as the chance of the hazard within 25 miles of a point. A day
// is 12Z to 12Z.
import { fork } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 40);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
// The hazards a category can rest on. A significant one is an EF2+ rated tornado, 2 in hail, 75 mph wind.
const FIELDS = ['tornado', 'tornadoSig', 'hail', 'hailSig', 'wind', 'windSig'];
const CATEGORIES = ['MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
// Share of days that should reach each category or higher.
const WANTED = { MRGN: 0.98, SLGT: 0.95, ENH: 0.65, MDT: 0.25, HIGH: 0.05 };
// As in the real outlooks, hail alone does not make a High risk day.
const TOP = { tornado: 'HIGH', tornadoSig: 'HIGH', wind: 'HIGH', windSig: 'HIGH', hail: 'MDT', hailSig: 'MDT' };
const PP_GRID_KM = 80, PP_SIGMA_KM = 120;

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

// Highest practically perfect chance (percent) anywhere on the map, and the share of the map at 2% or more.
function peakChance(exact, width, height, cellKm) {
  const box = Math.max(1, Math.round(PP_GRID_KM / cellKm)), boxes = new Map();
  for (let i = 0; i < exact.length; i++) if (exact[i]) { const bx = Math.floor((i % width) / box), by = Math.floor(Math.floor(i / width) / box); boxes.set(`${bx},${by}`, { x: (bx + 0.5) * box * cellKm, y: (by + 0.5) * box * cellKm }); }
  if (!boxes.size) return { peak: 0, area: 0 };
  const weight = (PP_GRID_KM * PP_GRID_KM) / (2 * Math.PI * PP_SIGMA_KM * PP_SIGMA_KM), centres = [...boxes.values()];
  let peak = 0, covered = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = (x + 0.5) * cellKm, py = (y + 0.5) * cellKm;
    let p = 0; for (const c of centres) p += weight * Math.exp(-((px - c.x) ** 2 + (py - c.y) ** 2) / (2 * PP_SIGMA_KM * PP_SIGMA_KM));
    const percent = 100 * Math.min(1, p);
    if (percent > peak) peak = percent; if (percent >= 2) covered++;
  }
  return { peak, area: covered / (width * height) };
}

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { captureTruth, aggregateTruth } = await import('../js/verification/truth.js');
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world, daily = [];
  for (let day = 0; day < days; day++) {
    const frames = [], seen = new Set(), initiations = [], before = world.stormEngine.totalTornadoes;
    for (let step = 0; step < 48; step++) { atmosphere.advance(0.5); captureTruth(world, frames, seen, initiations); }
    const truth = aggregateTruth(frames, initiations, world.width, world.height, 25 / world.cellSizeMiles, world.cellSizeMiles);
    const record = { seed, day, storms: seen.size, tornadoes: world.stormEngine.totalTornadoes - before, real: truth.risk.reduce((best, r) => Math.max(best, ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'].indexOf(r)), 0), thunder: truth.storm.some(Boolean) };
    for (const field of FIELDS) { const { peak, area } = peakChance(truth[`${field}Exact`], world.width, world.height, world.cellSizeKm); record[field] = peak; record[`${field}Area`] = area; }
    daily.push(record);
  }
  process.send(daily);
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3,4,5,6,7,8').split(',').map(Number), started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed)]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })));
  const all = results.flat();
  console.log(`=== Risk climate: ${days} days x seeds ${seeds.join(', ')} = ${all.length} days (${((Date.now() - started) / 1000).toFixed(0)} s) ===`);
  const quantile = (values, q) => { const v = [...values].sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.max(0, Math.floor(q * (v.length - 1))))]; };
  console.log('\n1. How high the chance of each hazard gets in a day (highest anywhere on the map, percent)');
  console.log(`  ${'hazard'.padEnd(12)}${'days with any'.padStart(15)}${['10th', '25th', '50th', '75th', '90th', '95th', '99th', 'most'].map(h => h.padStart(7)).join('')}`);
  for (const field of FIELDS) console.log(`  ${field.padEnd(12)}${`${Math.round(100 * all.filter(d => d[field] > 0).length / all.length)}%`.padStart(15)}${[0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1].map(q => quantile(all.map(d => d[field]), q).toFixed(0).padStart(7)).join('')}`);

  // Each category's thresholds sit at one level of every hazard's own climate: "a chance of
  // this hazard that only so many days exceed". That level is found so that the share of
  // days reaching the category on any hazard is the share wanted.
  const fit = rows => {
    const thresholds = {}, levels = {};
    const reached = (day, category, level) => FIELDS.some(f => CATEGORIES.indexOf(TOP[f]) >= CATEGORIES.indexOf(category) && day[f] > 0 && day[f] >= quantile(rows.map(d => d[f]), level));
    for (const category of CATEGORIES) {
      let low = 0, high = 1;
      for (let i = 0; i < 30; i++) { const mid = (low + high) / 2; if (rows.filter(d => reached(d, category, mid)).length / rows.length > WANTED[category]) low = mid; else high = mid; }
      levels[category] = high;
      thresholds[category] = Object.fromEntries(FIELDS.map(f => [f, CATEGORIES.indexOf(TOP[f]) >= CATEGORIES.indexOf(category) ? Math.max(0.5, quantile(rows.map(d => d[f]), high)) : null]));
    }
    // A higher category never has a lower threshold than the one below it.
    for (const f of FIELDS) for (let i = 1; i < CATEGORIES.length; i++) { const here = thresholds[CATEGORIES[i]], below = thresholds[CATEGORIES[i - 1]]; if (here[f] !== null && below[f] !== null) here[f] = Math.max(here[f], below[f]); }
    return { thresholds, levels };
  };
  const categoryOf = (day, thresholds) => { let best = day.thunder ? 'TSTM' : 'NONE'; for (const category of CATEGORIES) if (FIELDS.some(f => thresholds[category][f] !== null && day[f] >= thresholds[category][f])) best = category; return best; };
  const mix = (rows, thresholds) => { const counts = {}; for (const d of rows) { const c = categoryOf(d, thresholds); counts[c] = (counts[c] ?? 0) + 1; } return ['NONE', 'TSTM', ...CATEGORIES].map(c => `${c} ${Math.round(100 * (counts[c] ?? 0) / rows.length)}%`).join(', '); };
  const { thresholds, levels } = fit(all);
  console.log('\n2. Thresholds for this world: the chance (percent, within 25 miles of a point) at which each hazard reaches each category');
  console.log(`  ${'category'.padEnd(10)}${FIELDS.map(f => f.padStart(12)).join('')}   exceeded on this share of days, per hazard`);
  for (const category of CATEGORIES) console.log(`  ${category.padEnd(10)}${FIELDS.map(f => (thresholds[category][f] === null ? '-' : thresholds[category][f].toFixed(thresholds[category][f] < 10 ? 1 : 0)).padStart(12)).join('')}   ${(100 * (1 - levels[category])).toFixed(0)}%`);
  console.log('\n3. The mix of days this gives');
  const realNames = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'], realMix = realNames.map((name, k) => `${name} ${Math.round(100 * all.filter(d => d.real === k).length / all.length)}%`).join(', ');
  console.log(`  wanted:                    below SLGT 5%, SLGT 30%, ENH 40%, MDT 20%, HIGH 5%`);
  console.log(`  real-world categories:     ${realMix}`);
  console.log(`  this world's categories:   ${mix(all, thresholds)}`);
  // Does it hold on days it was not fitted to? Fit on half the seeds, apply to the other half.
  const first = all.filter(d => seeds.indexOf(d.seed) % 2 === 0), second = all.filter(d => seeds.indexOf(d.seed) % 2 === 1);
  if (first.length && second.length) console.log(`  fitted on half the seeds, applied to the other half: ${mix(second, fit(first).thresholds)}  |  and the reverse: ${mix(first, fit(second).thresholds)}`);
  console.log('\n4. What a day in each of this world\'s categories is like (medians)');
  console.log(`  ${'category'.padEnd(10)}${'days'.padStart(6)}${'tornadoes'.padStart(11)}${'storms'.padStart(8)}${'tornado %'.padStart(11)}${'sig tor %'.padStart(11)}${'wind %'.padStart(8)}${'sig wind %'.padStart(12)}${'hail %'.padStart(8)}${'sig hail %'.padStart(12)}${'days with a tornado'.padStart(21)}`);
  for (const category of ['NONE', 'TSTM', ...CATEGORIES]) { const rows = all.filter(d => categoryOf(d, thresholds) === category); if (!rows.length) continue; const m = key => quantile(rows.map(d => d[key]), 0.5); console.log(`  ${category.padEnd(10)}${String(rows.length).padStart(6)}${String(m('tornadoes')).padStart(11)}${String(m('storms')).padStart(8)}${m('tornado').toFixed(0).padStart(11)}${m('tornadoSig').toFixed(0).padStart(11)}${m('wind').toFixed(0).padStart(8)}${m('windSig').toFixed(0).padStart(12)}${m('hail').toFixed(0).padStart(8)}${m('hailSig').toFixed(0).padStart(12)}${`${Math.round(100 * rows.filter(d => d.tornadoes > 0).length / rows.length)}%`.padStart(21)}`); }
  const out = flag('--json');
  if (out) { fs.writeFileSync(out, JSON.stringify({ days: all.length, seeds, wanted: WANTED, thresholds, daily: all }, null, 1)); console.log(`\nwritten to ${out}`); }
}
