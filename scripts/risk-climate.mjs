// Risk categories for this world's own climate. The categories come from the chance of each
// hazard at its contour level and its intensity group, through the tables in
// js/forecast/worldRiskCategories.js. This script runs the world for many days, records which
// combinations of contour level and intensity group each day reached, and reports the mix of
// days the tables give against the mix wanted, so the tables can be set for this world.
//   node scripts/risk-climate.mjs [days per seed] [--seeds 1,2,3,4,5,6,7,8] [--json file]
//   node scripts/risk-climate.mjs --from file      re-read a saved run (after editing the tables)
// A day is 12Z to 12Z; the chances are the practically perfect ones outlooks are verified against.
import { fork } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { WORLD_RISK_ORDER, WORLD_HAZARDS, WORLD_CATEGORY_TABLES, PROBABILITY_LEVELS } from '../js/forecast/worldRiskCategories.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 40);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const WANTED = { 'below SLGT': 5, SLGT: 30, ENH: 40, MDT: 20, HIGH: 5 };
const rank = c => WORLD_RISK_ORDER.indexOf(c);

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { captureTruth, aggregateTruth } = await import('../js/verification/truth.js');
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world, n = world.width * world.height, daily = [];
  for (let day = 0; day < days; day++) {
    const frames = [], seen = new Set(), initiations = [], before = world.stormEngine.totalTornadoes;
    for (let step = 0; step < 48; step++) { atmosphere.advance(0.5); captureTruth(world, frames, seen, initiations); }
    const truth = aggregateTruth(frames, initiations, world.width, world.height, 25 / world.cellSizeMiles, world.cellSizeMiles);
    // For each hazard and contour level: the highest intensity group found inside it (-1: the level was not reached).
    const reached = Object.fromEntries(WORLD_HAZARDS.map(h => [h, PROBABILITY_LEVELS[h].map(() => -1)]));
    for (let i = 0; i < n; i++) for (const h of WORLD_HAZARDS) { const k = PROBABILITY_LEVELS[h].indexOf(truth.observedProbability[h][i]); if (k >= 0) reached[h][k] = Math.max(reached[h][k], truth.observedCig[h][i]); }
    daily.push({ seed, day, storms: seen.size, tornadoes: world.stormEngine.totalTornadoes - before, thunder: truth.storm.some(Boolean), reached, real: truth.risk.reduce((best, r) => Math.max(best, rank(r)), 0) });
  }
  process.send(daily);
}

// The category of a day under a set of tables: the highest any contour level and group gives.
function categoryOf(day, tables) {
  let best = day.thunder ? 'TSTM' : 'NONE';
  for (const h of WORLD_HAZARDS) PROBABILITY_LEVELS[h].forEach((level, k) => {
    if (day.reached[h][k] < 0) return;
    const row = tables[h][level];
    for (let g = Math.min(day.reached[h][k], row.length - 1); g >= 0; g--) if (row[g]) { if (rank(row[g]) > rank(best)) best = row[g]; break; }
  });
  return best;
}

async function main() {
  const saved = flag('--from') ? JSON.parse(fs.readFileSync(flag('--from'), 'utf8')) : null;
  const seeds = saved ? saved.seeds : (flag('--seeds') ?? '1,2,3,4,5,6,7,8').split(',').map(Number), started = Date.now();
  const all = saved ? saved.daily : (await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed)]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })))).flat();
  console.log(`=== Risk climate: ${all.length} days, seeds ${seeds.join(', ')}${saved ? ` (from ${flag('--from')})` : ` (${((Date.now() - started) / 1000).toFixed(0)} s)`} ===`);
  const pc = (rows, test) => `${Math.round(100 * rows.filter(test).length / Math.max(1, rows.length))}%`;
  console.log('\n1. How often each contour level is reached somewhere on the map, and with which intensity group at most (share of days)');
  for (const h of WORLD_HAZARDS) {
    console.log(`  ${h}`);
    PROBABILITY_LEVELS[h].forEach((level, k) => console.log(`    ${String(level).padStart(2)}%  reached ${pc(all, d => d.reached[h][k] >= 0).padStart(4)} | no group ${pc(all, d => d.reached[h][k] === 0).padStart(4)}${WORLD_CATEGORY_TABLES[h][level].slice(1).map((_, g) => ` | CIG${g + 1} ${pc(all, d => d.reached[h][k] === g + 1).padStart(4)}`).join('')}`));
  }
  const mix = (rows, tables) => { const counts = {}; for (const d of rows) { const c = categoryOf(d, tables); counts[c] = (counts[c] ?? 0) + 1; } const share = c => 100 * (counts[c] ?? 0) / rows.length; return { 'below SLGT': share('NONE') + share('TSTM') + share('MRGN'), SLGT: share('SLGT'), ENH: share('ENH'), MDT: share('MDT'), HIGH: share('HIGH') }; };
  const show = m => Object.entries(m).map(([name, value]) => `${name} ${Math.round(value)}%`).join(', ');
  console.log('\n2. The mix of days');
  console.log(`  wanted:                  ${show(WANTED)}`);
  console.log(`  this world's tables:     ${show(mix(all, WORLD_CATEGORY_TABLES))}`);
  const realNames = WORLD_RISK_ORDER, real = Object.fromEntries(['below SLGT', 'SLGT', 'ENH', 'MDT', 'HIGH'].map(name => [name, 100 * all.filter(d => (name === 'below SLGT' ? d.real < rank('SLGT') : realNames[d.real] === name)).length / all.length]));
  console.log(`  the real tables:         ${show(real)}`);
  const half = which => all.filter(d => seeds.indexOf(d.seed) % 2 === which);
  if (half(0).length && half(1).length) console.log(`  this world's tables on each half of the worlds: ${show(mix(half(0), WORLD_CATEGORY_TABLES))}  |  ${show(mix(half(1), WORLD_CATEGORY_TABLES))}`);
  console.log('\n3. A day in each category (medians)');
  for (const c of ['SLGT', 'ENH', 'MDT', 'HIGH']) { const rows = all.filter(d => categoryOf(d, WORLD_CATEGORY_TABLES) === c); if (!rows.length) continue; const med = key => rows.map(d => d[key]).sort((a, b) => a - b)[Math.floor(rows.length / 2)]; console.log(`  ${c.padEnd(5)} ${String(rows.length).padStart(4)} days | tornadoes ${String(med('tornadoes')).padStart(3)} | storms ${String(med('storms')).padStart(4)} | days with a tornado ${pc(rows, d => d.tornadoes > 0)}`); }
  const out = flag('--json');
  if (out) { fs.writeFileSync(out, JSON.stringify({ seeds, daily: all })); console.log(`\nwritten to ${out}`); }
}
