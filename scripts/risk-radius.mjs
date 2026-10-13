// What the Storm Prediction Center's own category table gives in this world when the chance is
// taken within different distances of a point (the real outlooks use 25 miles).
//   node scripts/risk-radius.mjs [days per seed] [--seeds 1,2,...] [--radii 10,15,25] [--json file]
//   node scripts/risk-radius.mjs --from file
// For each day and radius it records which contour levels are reached and with which
// intensity group, then prints the mix of days by the real table. A day is 12Z to 12Z.
// The intensity group is taken two ways: the strongest report anywhere in the contour, and
// conditionally (the share of the reports inside the contour that reach each tier).
import { fork } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { PROBABILITY_LEVELS, RISK_ORDER, categoryFromHazard, probabilityLevel } from '../js/forecast/spcOutlookRules.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 40);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const HAZARDS = ['tornado', 'wind', 'hail'], rank = c => RISK_ORDER.indexOf(c);
const WANTED = 'below SLGT 5%, SLGT 30%, ENH 40%, MDT 20%, HIGH 5%';
const TIERS = { tornado: ['tornadoSig', 'tornadoExtreme', 'tornadoViolent'], wind: ['windSig', 'windExtreme', 'windViolent'], hail: ['hailSig', 'hailExtreme'] };

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { captureTruth, aggregateTruth, neighbourhoodChance } = await import('../js/verification/truth.js');
  const radii = (flag('--radii') ?? '10,15,25').split(',').map(Number);
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world, n = world.width * world.height, daily = [];
  for (let day = 0; day < days; day++) {
    const frames = [], seen = new Set(), initiations = [], before = world.stormEngine.totalTornadoes;
    for (let step = 0; step < 48; step++) { atmosphere.advance(0.5); captureTruth(world, frames, seen, initiations); }
    const truth = aggregateTruth(frames, initiations, world.width, world.height, 25 / world.cellSizeMiles, world.cellSizeMiles);
    const record = { seed, day, storms: seen.size, tornadoes: world.stormEngine.totalTornadoes - before, thunder: truth.storm.some(Boolean), reached: {}, peak: {}, area: {}, counts: {} };
    for (const radius of radii) {
      // For each hazard and contour level: the highest intensity group found inside it (-1: not reached).
      record.reached[radius] = Object.fromEntries(HAZARDS.map(h => [h, PROBABILITY_LEVELS[h].map(() => -1)])); record.peak[radius] = {}; record.area[radius] = {}; record.counts[radius] = {};
      for (const h of HAZARDS) {
        const chance = neighbourhoodChance(truth[`${h}Exact`], world.width, world.height, world.cellSizeKm, radius);
        let peak = 0, covered = 0;
        for (let i = 0; i < n; i++) { peak = Math.max(peak, chance[i]); const k = PROBABILITY_LEVELS[h].indexOf(probabilityLevel(h, chance[i])); if (k >= 0) { covered++; record.reached[radius][h][k] = Math.max(record.reached[radius][h][k], truth.observedCig[h][i]); } }
        record.peak[radius][h] = peak; record.area[radius][h] = covered / n;
        // Inside each contour (everything at or above the level): the cells with a report, and those reaching each tier.
        record.counts[radius][h] = PROBABILITY_LEVELS[h].map(level => { const c = [0, ...TIERS[h].map(() => 0)]; for (let i = 0; i < n; i++) if (chance[i] >= level && truth[`${h}Exact`][i]) { c[0]++; TIERS[h].forEach((field, t) => { if (truth[`${field}Exact`][i]) c[t + 1]++; }); } return c; });
      }
    }
    daily.push(record);
  }
  process.send(daily);
}

// The category of a day by the real table at one radius. With `share`, the intensity group of
// a contour is the highest tier that at least that share of the reports inside it reach.
function categoryOf(day, radius, share = null, hazards = HAZARDS) {
  let best = day.thunder ? 'TSTM' : 'NONE';
  for (const h of hazards) PROBABILITY_LEVELS[h].forEach((level, k) => {
    let cig = day.reached[radius][h][k];
    if (share !== null) { const c = day.counts[radius][h][k]; if (!c[0]) return; cig = 0; for (let t = 1; t < c.length; t++) if (c[t] / c[0] >= share) cig = t; }
    else if (cig < 0) return;
    const category = categoryFromHazard(h, level, cig); if (rank(category) > rank(best)) best = category;
  });
  return best;
}

async function main() {
  const saved = flag('--from') ? JSON.parse(fs.readFileSync(flag('--from'), 'utf8')) : null;
  const seeds = saved ? saved.seeds : (flag('--seeds') ?? '1,2,3,4,5,6,7,8').split(',').map(Number), started = Date.now();
  const all = saved ? saved.daily : (await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), ...(flag('--radii') ? ['--radii', flag('--radii')] : [])]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })))).flat();
  const radii = Object.keys(all[0].reached).map(Number).sort((a, b) => a - b);
  console.log(`=== The real category table at different radii: ${all.length} days, seeds ${seeds.join(', ')}${saved ? '' : ` (${((Date.now() - started) / 1000).toFixed(0)} s)`} ===`);
  const quantile = (values, q) => { const v = [...values].sort((a, b) => a - b); return v[Math.floor(q * (v.length - 1))]; };
  console.log(`\nwanted: ${WANTED}`);
  console.log('\n1. The mix of days by the Storm Prediction Center\'s table');
  for (const radius of radii) {
    const counts = {}; for (const d of all) { const c = categoryOf(d, radius); counts[c] = (counts[c] ?? 0) + 1; }
    const s = c => Math.round(100 * (counts[c] ?? 0) / all.length);
    console.log(`  within ${String(radius).padStart(2)} miles: below SLGT ${s('NONE') + s('TSTM') + s('MRGN')}% (none ${s('NONE') + s('TSTM')}, MRGL ${s('MRGN')}), SLGT ${s('SLGT')}%, ENH ${s('ENH')}%, MDT ${s('MDT')}%, HIGH ${s('HIGH')}%`);
  }
  if (all[0].counts) {
    const line = (radius, share, hazards) => { const counts = {}; for (const d of all) { const c = categoryOf(d, radius, share, hazards); counts[c] = (counts[c] ?? 0) + 1; } const s = c => Math.round(100 * (counts[c] ?? 0) / all.length); return `below SLGT ${s('NONE') + s('TSTM') + s('MRGN')}%, SLGT ${s('SLGT')}%, ENH ${s('ENH')}%, MDT ${s('MDT')}%, HIGH ${s('HIGH')}%`; };
    console.log('\n1b. The same with conditional intensity groups: a group needs this share of the reports inside the contour to reach its tier');
    for (const radius of radii) for (const share of [0.05, 0.1, 0.2, 0.3]) console.log(`  within ${String(radius).padStart(2)} miles, ${String(Math.round(share * 100)).padStart(2)}% of reports: ${line(radius, share, HAZARDS)}`);
    console.log('\n1c. Each hazard on its own (conditional groups at 10% of reports)');
    for (const radius of radii) for (const h of HAZARDS) console.log(`  within ${String(radius).padStart(2)} miles, ${h.padEnd(7)}: ${line(radius, 0.1, [h])}`);
    console.log('\n1d. Of the reports of each hazard on the whole map in a day, the share reaching each tier (median / 90th percentile of days with reports)');
    const lowest = h => 0;
    for (const h of HAZARDS) { const days = all.map(d => d.counts[radii.at(-1)][h][lowest(h)]).filter(c => c[0] > 0); console.log(`  ${h.padEnd(7)}: ${TIERS[h].map((field, t) => `${field} ${Math.round(100 * quantile(days.map(c => c[t + 1] / c[0]), 0.5))}% / ${Math.round(100 * quantile(days.map(c => c[t + 1] / c[0]), 0.9))}%`).join('   ')}`); }
  }
  console.log('\n2. The highest chance on the map in a day (percent; 50th / 90th / highest), and the share of the map inside the lowest contour (median)');
  for (const radius of radii) console.log(`  within ${String(radius).padStart(2)} miles: ${HAZARDS.map(h => `${h} ${quantile(all.map(d => d.peak[radius][h]), 0.5).toFixed(0)} / ${quantile(all.map(d => d.peak[radius][h]), 0.9).toFixed(0)} / ${quantile(all.map(d => d.peak[radius][h]), 1).toFixed(0)}, area ${Math.round(100 * quantile(all.map(d => d.area[radius][h]), 0.5))}%`).join(' | ')}`);
  console.log('\n3. How often each tornado contour is reached (share of days)');
  for (const radius of radii) console.log(`  within ${String(radius).padStart(2)} miles: ${PROBABILITY_LEVELS.tornado.map((level, k) => `${level}%: ${Math.round(100 * all.filter(d => d.reached[radius].tornado[k] >= 0).length / all.length)}%`).join('  ')}`);
  console.log('\n4. High days by seed (day N is the Nth day of a fresh world)');
  for (const radius of radii) console.log(`  within ${String(radius).padStart(2)} miles: ${seeds.map(seed => `seed ${seed}: ${all.filter(d => d.seed === seed && categoryOf(d, radius) === 'HIGH').map(d => d.day + 1).join(', ') || '-'}`).join(' | ')}`);
  const out = flag('--json');
  if (out) { fs.writeFileSync(out, JSON.stringify({ seeds, daily: all })); console.log(`\nwritten to ${out}`); }
}
