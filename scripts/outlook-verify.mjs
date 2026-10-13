// How well the Day 1 outlook verifies: each morning an outlook is made from the world as it
// is, then the day is run and what happened is set against it.
//   node scripts/outlook-verify.mjs [days per seed] [--seeds 1,2,3,4] [--members 6]
// Reports the mix of forecast categories against the mix that verified, how often the
// forecast category was right, and whether the chances mean what they say (of the places
// given a 30% chance of a tornado within 25 miles, about 30% should have had one).
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 6);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const memberCount = Number(flag('--members') ?? 6);
const ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'], HAZARDS = ['tornado', 'wind', 'hail'];
// The contour levels of each hazard: places are grouped by the contour they are inside.
const LEVELS = { tornado: [0, 2, 5, 10, 15, 30, 45, 60], wind: [0, 5, 15, 30, 45, 60, 75, 90], hail: [0, 5, 15, 30, 45, 60] };

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { captureTruth, aggregateTruth } = await import('../js/verification/truth.js');
  const { runOutlookMember, combineOutlook, stateFromBytes } = await import('../js/forecast/DayOneOutlook.js');
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world, n = world.width * world.height, out = [];
  atmosphere.advance(24);   // a day for the storms to get going
  for (let day = 0; day < days; day++) {
    const bytes = v8.serialize(atmosphere.saveState());
    const members = []; for (let m = 0; m < memberCount; m++) members.push(runOutlookMember(stateFromBytes(bytes), m, 24));
    const outlook = combineOutlook(members, { issuedHourUtc: world.validHourUtc, validToHourUtc: world.validHourUtc + 24, seed });
    const frames = [], seen = new Set(), initiations = [], before = world.stormEngine.totalTornadoes;
    for (let step = 0; step < 48; step++) { atmosphere.advance(0.5); captureTruth(world, frames, seen, initiations); }
    const truth = aggregateTruth(frames, initiations, world.width, world.height, 25 / world.cellSizeMiles, world.cellSizeMiles);
    const top = list => list.reduce((best, c) => Math.max(best, ORDER.indexOf(c)), 0);
    // Reliability: cells by forecast chance, and whether the hazard came within 25 miles (truth[hazard] is that neighbourhood).
    const reliability = Object.fromEntries(HAZARDS.map(h => [h, LEVELS[h].map(() => ({ cells: 0, hits: 0 }))]));
    const groups = Object.fromEntries(HAZARDS.map(h => [h, [0, 1, 2, 3].map(() => ({ cells: 0, tier1: 0, tier2: 0, tier3: 0 }))]));
    const tiers = { tornado: ['tornadoSig', 'tornadoExtreme', 'tornadoViolent'], wind: ['windSig', 'windExtreme', 'windViolent'], hail: ['hailSig', 'hailExtreme'] };
    let sameCell = 0, withinOne = 0;
    for (let i = 0; i < n; i++) {
      for (const h of HAZARDS) {
        const slot = reliability[h][LEVELS[h].indexOf(outlook.level[h][i])]; slot.cells++; if (truth[h][i]) slot.hits++;
        // Inside each intensity group (where the hazard came at all): how often each tier came within 25 miles.
        if (outlook.level[h][i] > 0) { const g = groups[h][outlook.cig[h][i]]; g.cells++; tiers[h].forEach((field, k) => { if (truth[field][i]) g[`tier${k + 1}`]++; }); }
      }
      const f = ORDER.indexOf(outlook.category[i]), t = ORDER.indexOf(truth.worldRisk[i]);
      if (f === t) sameCell++; if (Math.abs(f - t) <= 1) withinOne++;
    }
    out.push({
      seed, day, forecast: top(outlook.category), verified: top(truth.worldRisk), sameCell: sameCell / n, withinOne: withinOne / n, reliability, groups,
      forecastTornadoes: outlook.expected.tornadoes, tornadoes: world.stormEngine.totalTornadoes - before,
      forecastArea: Object.fromEntries(ORDER.map((c, k) => [c, outlook.category.filter(v => ORDER.indexOf(v) >= k).length / n])), verifiedArea: Object.fromEntries(ORDER.map((c, k) => [c, truth.worldRisk.filter(v => ORDER.indexOf(v) >= k).length / n])),
      hatched: { tornado: outlook.cig.tornado.some(Boolean), sigTornado: truth.tornadoSigExact.some(Boolean) }
    });
  }
  process.send(out);
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3,4').split(',').map(Number), started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), '--members', String(memberCount)]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })));
  const all = results.flat(), share = (rows, test) => `${Math.round(100 * rows.filter(test).length / Math.max(1, rows.length))}%`, mean = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  console.log(`=== Day 1 outlook verification: ${days} days x seeds ${seeds.join(', ')} = ${all.length} outlooks of ${memberCount} runs each (${((Date.now() - started) / 1000).toFixed(0)} s) ===`);
  console.log('\n1. The highest category of the day');
  console.log(`  ${'forecast'.padEnd(10)}${ORDER.slice(1).map(c => `${c} ${share(all, d => ORDER[d.forecast] === c)}`).join(', ')}`);
  console.log(`  ${'verified'.padEnd(10)}${ORDER.slice(1).map(c => `${c} ${share(all, d => ORDER[d.verified] === c)}`).join(', ')}`);
  console.log(`  forecast right: ${share(all, d => d.forecast === d.verified)} | within one category: ${share(all, d => Math.abs(d.forecast - d.verified) <= 1)} | forecast too high: ${share(all, d => d.forecast > d.verified)}, too low: ${share(all, d => d.forecast < d.verified)}`);
  console.log(`  place by place: the category was right over ${Math.round(100 * mean(all.map(d => d.sameCell)))}% of the map, within one category over ${Math.round(100 * mean(all.map(d => d.withinOne)))}%`);
  console.log(`  share of the map at Enhanced or more: forecast ${Math.round(100 * mean(all.map(d => d.forecastArea.ENH)))}%, verified ${Math.round(100 * mean(all.map(d => d.verifiedArea.ENH)))}% | at Moderate or more: forecast ${Math.round(100 * mean(all.map(d => d.forecastArea.MDT)))}%, verified ${Math.round(100 * mean(all.map(d => d.verifiedArea.MDT)))}%`);
  console.log('\n2. Do the contours mean what they say? (places inside each contour level, up to the next; share of them where it happened within 25 miles)');
  for (const h of HAZARDS) {
    const row = LEVELS[h].map((edge, k) => { const cells = all.reduce((a, d) => a + d.reliability[h][k].cells, 0), hits = all.reduce((a, d) => a + d.reliability[h][k].hits, 0); return `${edge ? edge + '%' : 'below'}: ${cells >= 200 ? Math.round(100 * hits / cells) + '%' : '-'}`; });
    console.log(`  ${h.padEnd(9)}${row.join('  ')}`);
  }
  console.log('\n   Intensity groups (places inside a contour, by the group drawn there; share where each tier came within 25 miles)');
  const tierNames = { tornado: ['EF2+', 'EF3+', 'EF4+'], wind: ['75 mph', '85 mph', '96 mph'], hail: ['2 in', '3.5 in'] };
  for (const h of HAZARDS) for (let g = 0; g <= tierNames[h].length; g++) {
    const cells = all.reduce((a, d) => a + d.groups[h][g].cells, 0); if (cells < 200) continue;
    console.log(`  ${h.padEnd(9)}${(g ? 'CIG' + g : 'no group').padEnd(10)}${tierNames[h].map((name, k) => `${name} ${Math.round(100 * all.reduce((a, d) => a + d.groups[h][g][`tier${k + 1}`], 0) / cells)}%`).join('  ')}  (${Math.round(100 * cells / all.reduce((a, d) => a + [0, 1, 2, 3].reduce((b, q) => b + d.groups[h][q].cells, 0), 0))}% of the area inside a contour)`);
  }
  console.log('\n3. Tornadoes');
  const inRange = all.filter(d => d.tornadoes >= d.forecastTornadoes.low && d.tornadoes <= d.forecastTornadoes.high);
  console.log(`  the day's count fell inside the forecast range on ${share(all, d => inRange.includes(d))} of days | days forecast with no tornado in most runs that had one: ${all.filter(d => d.forecastTornadoes.middle === 0 && d.tornadoes > 0).length} | a tornado intensity group drawn on ${share(all, d => d.hatched.tornado)} of days, an EF2+ tornado on ${share(all, d => d.hatched.sigTornado)}; of the hatched days ${share(all.filter(d => d.hatched.tornado), d => d.hatched.sigTornado)} had one`);
  console.log('  day by day (forecast range / what happened): ' + all.map(d => `${d.forecastTornadoes.low}-${d.forecastTornadoes.high}/${d.tornadoes}`).join('  '));
}
