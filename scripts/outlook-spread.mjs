// How sure of themselves the Day 1, 2 and 3 outlooks are, with and without the forecast runs'
// doubts about the atmosphere (js/forecast/ensemblePerturbation.js).
//   node scripts/outlook-spread.mjs [--seeds 3,5,7] [--spreads 0:0,1.2:0.5] [--members 8] [--day 6]
// A spread is the timing spread (m/s) and the upstream share, as timing:upstream.
// For each world it makes one set of outlooks at 12Z of the given day and prints, for each
// outlook day: the highest contour of each hazard, the share of the map inside the 30% wind
// contour and the 15% tornado contour, how far apart the runs are in where their severe
// weather is, and the highest category.
import { fork } from 'node:child_process';
import v8 from 'node:v8';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();
const args = process.argv.slice(2), flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

if (args.includes('--worker')) await worker(); else await main();

async function worker() {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { OUTLOOK, runOutlookMemberDays, combineOutlook, stateFromBytes } = await import('../js/forecast/DayOneOutlook.js');
  const seed = Number(flag('--seed')), spread = flag('--spread'), [timingSpreadMs, upstreamShare] = spread.split(':').map(Number), members = Number(flag('--members', 8)), day = Number(flag('--day', 6));
  const atmosphere = new AtmosphereWorld({ seed }); atmosphere.advance(24 * day);
  const bytes = v8.serialize(atmosphere.saveState()), issued = atmosphere.world.validHourUtc;
  const runs = Array.from({ length: members }, (_, k) => runOutlookMemberDays(stateFromBytes(bytes), k, 72, { timingSpreadMs, upstreamShare }));
  const rows = OUTLOOK.days.map((name, index) => {
    const of = runs.map(run => run[index]), o = combineOutlook(of, { day: name, issuedHourUtc: issued, validFromHourUtc: issued + 24 * index, validToHourUtc: issued + 24 * (index + 1), seed });
    const n = o.width * o.height, mean = field => { const out = new Float32Array(n); for (const m of of) for (let i = 0; i < n; i++) out[i] += m.chance[field][i] / of.length; return out; };
    const wind = mean('wind'), tornado = mean('tornado'), severe = mean('severe');
    // Where each run's severe weather is centred (cells), and how far the runs are from their average.
    const centres = of.map(m => { let sx = 0, sy = 0, s = 0; for (let i = 0; i < n; i++) { const w = m.chance.severe[i]; sx += w * (i % o.width); sy += w * Math.floor(i / o.width); s += w; } return s ? [sx / s, sy / s] : null; }).filter(Boolean);
    const cx = centres.reduce((a, c) => a + c[0], 0) / (centres.length || 1), cy = centres.reduce((a, c) => a + c[1], 0) / (centres.length || 1);
    return {
      day: name, highest: o.highest, top: Object.fromEntries(Object.entries(o.top).map(([h, t]) => [h, `${t.level}${t.cig ? `/CIG${t.cig}` : ''}`])),
      peak: { tornado: Math.max(...tornado), wind: Math.max(...wind), severe: Math.max(...severe) },
      wind30: wind.filter(v => v >= 30).length / n, tornado15: tornado.filter(v => v >= 15).length / n, tornado2: tornado.filter(v => v >= 2).length / n,
      apartMiles: centres.length ? o.cellMiles * Math.sqrt(centres.reduce((a, c) => a + (c[0] - cx) ** 2 + (c[1] - cy) ** 2, 0) / centres.length) : 0,
      tornadoes: of.map(m => m.tornadoes)
    };
  });
  process.send({ seed, spread, rows });
}

async function main() {
  const seeds = flag('--seeds', '3,5,7').split(',').map(Number), spreads = flag('--spreads', '0:0,1.2:0.5').split(','), started = Date.now();
  const jobs = seeds.flatMap(seed => spreads.map(spread => ({ seed, spread })));
  const results = await Promise.all(jobs.map(job => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--worker', '--seed', String(job.seed), '--spread', String(job.spread), '--members', flag('--members', '8'), '--day', flag('--day', '6')]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${job.seed} exited with ${code}`)); });
  })));
  console.log(`=== Outlook spread: seeds ${seeds.join(', ')}, spreads (timing m/s : upstream share) ${spreads.join(', ')} (${((Date.now() - started) / 1000).toFixed(0)} s) ===`);
  const pc = v => `${Math.round(100 * v)}%`.padStart(4);
  for (const seed of seeds) for (const spread of spreads) {
    const { rows } = results.find(r => r.seed === seed && r.spread === spread);
    console.log(`\nseed ${seed}, spread ${spread}`);
    for (const r of rows) console.log(`  ${r.day}: ${r.highest.padEnd(4)} | top ${Object.entries(r.top).map(([h, t]) => `${h} ${t}`).join(', ').padEnd(44)} | peak tor ${r.peak.tornado.toFixed(0).padStart(2)} wind ${r.peak.wind.toFixed(0).padStart(3)} any ${r.peak.severe.toFixed(0).padStart(3)} | in 2% tor ${pc(r.tornado2)} 15% tor ${pc(r.tornado15)} 30% wind ${pc(r.wind30)} | runs ${r.apartMiles.toFixed(0).padStart(3)} mi apart | tornadoes ${r.tornadoes.join(' ')}`);
  }
  console.log('\nAverages over the worlds');
  for (const spread of spreads) for (const index of [0, 1, 2]) {
    const rows = results.filter(r => r.spread === spread).map(r => r.rows[index]), avg = pick => rows.reduce((a, r) => a + pick(r), 0) / rows.length;
    console.log(`  spread ${String(spread).padEnd(8)} ${rows[0].day}: peak tornado ${avg(r => r.peak.tornado).toFixed(0).padStart(2)}, wind ${avg(r => r.peak.wind).toFixed(0).padStart(3)}, any ${avg(r => r.peak.severe).toFixed(0).padStart(3)} | in 2% tor ${pc(avg(r => r.tornado2))}, 15% tor ${pc(avg(r => r.tornado15))}, 30% wind ${pc(avg(r => r.wind30))} | runs ${avg(r => r.apartMiles).toFixed(0).padStart(3)} mi apart`);
  }
}
