// How often each conditional intensity group (CIG1 to CIG3) comes on this world's days, and
// where the bars between the groups would have to stand for a wanted frequency. The world is
// run for some days; for each day and hazard every area inside every contour level is kept
// with its reports and how many of them reached each intensity tier, so the groups can then
// be worked out for any bars without running the world again.
//   node scripts/cig-climate.mjs [days per seed] [--seeds 1,2,...] [--json file]
//   node scripts/cig-climate.mjs --from file      re-read a saved run
// A day is 12Z to 12Z, judged on what happened (the practically perfect chances and the
// reports the outlooks are verified against).
import { fork } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { WORLD_RISK_ORDER, WORLD_HAZARDS, WORLD_CATEGORY_TABLES, PROBABILITY_LEVELS, CIG_BOUNDS, CIG_TIERS, highestCigAt } from '../js/forecast/worldRiskCategories.js';

avoidBackgroundThrottling();
const args = process.argv.slice(2), flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 15);
const rank = c => WORLD_RISK_ORDER.indexOf(c);
// The frequencies aimed at: the share of days with each group (or higher) drawn somewhere.
const WANTED_CIG = { tornado: [0.35, 0.12, 0.04], wind: [0.3, 0.1, 0.03], hail: [0.35, 0.1] };
const WANTED_MIX = { 'below SLGT': 5, SLGT: 30, ENH: 40, MDT: 20, HIGH: 5 };


async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { captureTruth, aggregateTruth } = await import('../js/verification/truth.js');
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world, { width, height } = world, n = width * height, daily = [];
  for (let day = 0; day < days; day++) {
    const frames = [], seen = new Set(), initiations = [];
    for (let step = 0; step < 48; step++) { atmosphere.advance(0.5); captureTruth(world, frames, seen, initiations); }
    const truth = aggregateTruth(frames, initiations, width, height, 25 / world.cellSizeMiles, world.cellSizeMiles);
    const areas = {};
    for (const h of WORLD_HAZARDS) {
      const chance = truth.chance[h], amount = truth[`${h}Exact`], tiers = CIG_TIERS[h].map(field => truth[`${field}Exact`]);
      const mark = new Int32Array(n), owner = new Int32Array(n).fill(-1), list = [];
      PROBABILITY_LEVELS[h].forEach((level, pass) => {
        for (let start = 0; start < n; start++) {
          if (mark[start] === pass + 1 || !(chance[start] >= level - 1e-9)) continue;
          const cells = [], stack = [start]; mark[start] = pass + 1;
          let total = 0; const reach = tiers.map(() => 0);
          while (stack.length) {
            const i = stack.pop(), x = i % width, y = (i - x) / width; cells.push(i); total += amount[i]; tiers.forEach((t, k) => { reach[k] += t[i]; });
            for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) if (j >= 0 && mark[j] !== pass + 1 && chance[j] >= level - 1e-9) { mark[j] = pass + 1; stack.push(j); }
          }
          const parent = owner[start]; for (const i of cells) owner[i] = list.length;
          list.push({ level, parent, total, reach });
        }
      });
      areas[h] = list;
    }
    daily.push({ seed, day, thunder: truth.storm.some(Boolean), areas });
  }
  process.send(daily);
}

// The highest group drawn on a day for a hazard, and the day's category, under some bars.
// tiered: group k needs the share of reports reaching tier k (EF2/EF3/EF4, 75/85/96 mph,
// 2/3.5 in) to be at least bar k; otherwise (as now) every group is judged on the first tier.
function judge(day, bounds, tiered) {
  const top = {}; let best = day.thunder ? 'TSTM' : 'NONE';
  for (const h of WORLD_HAZARDS) {
    const groups = [];
    top[h] = 0;
    day.areas[h].forEach((a, k) => {
      let g = 0;
      // Each group needs the ones below it as well (tiered: group k on tier k's share).
      if (a.total > 0) for (let t = 0; t < bounds[h].length; t++) { if ((tiered ? a.reach[t] : a.reach[0]) / a.total >= bounds[h][t]) g = t + 1; else break; }
      g = Math.max(g, a.parent >= 0 ? groups[a.parent] : 0); groups[k] = g;
      const drawn = Math.min(g, highestCigAt(h, a.level)); top[h] = Math.max(top[h], drawn);
      const row = WORLD_CATEGORY_TABLES[h][a.level];
      for (let d = drawn; d >= 0; d--) if (row[d]) { if (rank(row[d]) > rank(best)) best = row[d]; break; }
    });
  }
  return { top, category: best };
}

function summary(all, bounds, tiered) {
  const judged = all.map(day => judge(day, bounds, tiered)), share = test => judged.filter(test).length / judged.length;
  const cig = Object.fromEntries(WORLD_HAZARDS.map(h => [h, bounds[h].map((_, k) => share(j => j.top[h] >= k + 1))]));
  const mix = { 'below SLGT': 100 * share(j => rank(j.category) < rank('SLGT')), SLGT: 100 * share(j => j.category === 'SLGT'), ENH: 100 * share(j => j.category === 'ENH'), MDT: 100 * share(j => j.category === 'MDT'), HIGH: 100 * share(j => j.category === 'HIGH') };
  return { cig, mix };
}

const show = (label, { cig, mix }) => {
  console.log(`  ${label}`);
  for (const h of WORLD_HAZARDS) console.log(`    ${h.padEnd(8)}${cig[h].map((v, k) => `CIG${k + 1}+ ${Math.round(100 * v)}%`.padEnd(13)).join('')}(wanted ${WANTED_CIG[h].map(v => `${Math.round(100 * v)}%`).join(' / ')})`);
  console.log(`    days:   ${Object.entries(mix).map(([c, v]) => `${c} ${Math.round(v)}%`).join(', ')}   (wanted ${Object.entries(WANTED_MIX).map(([c, v]) => `${c} ${v}%`).join(', ')})`);
};

async function main() {
  const saved = flag('--from') ? JSON.parse(fs.readFileSync(flag('--from'), 'utf8')) : null;
  const seeds = saved ? saved.seeds : (flag('--seeds') ?? '1,2,3,4,5,6,7,8').split(',').map(Number), started = Date.now();
  const all = saved ? saved.daily : (await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed)]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })))).flat();
  if (flag('--json')) fs.writeFileSync(flag('--json'), JSON.stringify({ seeds, daily: all }));
  console.log(`=== Conditional intensity groups: ${all.length} days, seeds ${seeds.join(', ')}${saved ? '' : ` (${((Date.now() - started) / 1000).toFixed(0)} s)`} ===`);
  show('now (each group judged on its own tier)', summary(all, CIG_BOUNDS, true));
  // The bars for each group judged on its own tier, chosen hazard by hazard to come nearest
  // the wanted frequencies (each bar from 0.02 to 0.9).
  const grid = Array.from({ length: 45 }, (_, k) => 0.02 * (k + 1));
  const fitted = {};
  for (const h of WORLD_HAZARDS) fitted[h] = WANTED_CIG[h].map((want, k) => {
    let bestBar = grid.at(-1), bestErr = Infinity;
    for (const bar of grid) { const trial = { ...CIG_BOUNDS, [h]: CIG_BOUNDS[h].map((b, t) => (t === k ? bar : t < k ? (fitted[h]?.[t] ?? b) : 2)) }; const got = summary(all, trial, true).cig[h][k]; const err = Math.abs(got - want); if (err < bestErr - 1e-9) { bestErr = err; bestBar = bar; } }
    (fitted[h] ??= [])[k] = bestBar; return bestBar;
  });
  show(`each group judged on its own tier, fitted bars ${JSON.stringify(fitted)}`, summary(all, fitted, true));
}

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();
