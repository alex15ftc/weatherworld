// How well the Day 1, 2 and 3 outlooks verify. Each morning (12Z) the three outlooks are
// made from the world as it is, as the server makes them (the same runs, the same number of
// them for each day); then the day is run, and what happened is set against the Day 1
// outlook made that morning, the Day 2 outlook made the morning before and the Day 3 outlook
// made the morning before that.
//   node scripts/outlook-verify.mjs [days per seed] [--seeds 1,2,3,4,5,6] [--members 8]
// Reports, for each outlook: the mix of forecast categories against the mix that verified,
// how often the forecast category was right, and whether the contours mean what they say (of
// the places inside a 30% contour, about 30% or more should have had it within 25 miles).
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 7);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const memberCount = Number(flag('--members') ?? 8);
// OLD=1: the outlooks as before agenda step 11 (no errors in the air over the map, no agreement rule), to compare.
const OLD = process.env.OLD === '1';
// NOCAL=1: without the calibration of the chances. --calibration-data: print, as JSON, the runs'
// raw chances binned against whether the hazard came within 25 miles (for fit-outlook-calibration.mjs).
const NOCAL = process.env.NOCAL === '1' || OLD, CAL_DATA = args.includes('--calibration-data');
const CAL_BINS = [0, 1, 2, 3.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50, 60, 75, 101];
const ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
// The contour levels of each hazard: places are grouped by the contour they are inside.
const LEVELS = { tornado: [0, 2, 5, 10, 15, 30, 45, 60], wind: [0, 5, 15, 30, 45, 60, 75, 90], hail: [0, 5, 15, 30, 45, 60], severe: [0, 5, 15, 30, 45, 60] };
const TIER_NAMES = { tornado: ['EF2+', 'EF3+', 'EF4+'], wind: ['75 mph', '85 mph', '96 mph'], hail: ['2 in', '3.5 in'], severe: ['significant', 'intense'] };

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { captureTruth, aggregateTruth, practicallyPerfectChance } = await import('../js/verification/truth.js');
  const { OUTLOOK, runOutlookMemberDays, combineOutlook, stateFromBytes, membersFor } = await import('../js/forecast/DayOneOutlook.js');
  const { CIG_TIERS, contourCig, worldCategory, probabilityLevel } = await import('../js/forecast/worldRiskCategories.js');
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world, n = world.width * world.height, out = [], issued = [];
  atmosphere.advance(24);   // a day for the storms to get going
  for (let day = 0; day < days; day++) {
    // The morning's outlooks: each run goes as far as the last day it is one of the runs for.
    const bytes = v8.serialize(atmosphere.saveState()), now = world.validHourUtc, runs = [];
    for (let m = 0; m < memberCount; m++) runs.push(runOutlookMemberDays(stateFromBytes(bytes), m, 24 * OUTLOOK.days.filter(name => m < membersFor(name, memberCount)).length, OLD ? { mesoscale: 0 } : {}));
    issued[day] = OUTLOOK.days.map((name, index) => combineOutlook(runs.slice(0, membersFor(name, memberCount)).map(run => run[index]), { day: name, issuedHourUtc: now, validFromHourUtc: now + 24 * index, validToHourUtc: now + 24 * (index + 1), seed, ...(OLD ? { agreement: [0, 0], groupAgreement: [0, 0] } : {}), ...(NOCAL ? { calibration: {} } : {}) }));
    // What then happened.
    const frames = [], seen = new Set(), initiations = [], before = world.stormEngine.totalTornadoes;
    for (let step = 0; step < 48; step++) { atmosphere.advance(0.5); captureTruth(world, frames, seen, initiations); }
    const truth = aggregateTruth(frames, initiations, world.width, world.height, 25 / world.cellSizeMiles, world.cellSizeMiles);
    // The same day as a Day 3 outlook would give it: one chance, of any severe weather.
    const any = (...fields) => Uint8Array.from({ length: n }, (_, i) => (fields.some(field => truth[field][i]) ? 1 : 0));
    const exact = { severe: any('tornadoExact', 'windExact', 'hailExact'), severeSig: any('tornadoSigExact', 'windSigExact', 'hailSigExact'), severeExtreme: any('tornadoExtremeExact', 'windExtremeExact', 'hailExtremeExact') };
    const severeChance = practicallyPerfectChance(exact.severe, world.width, world.height, world.cellSizeKm), severeCig = contourCig('severe', severeChance, exact.severe, [exact.severeSig, exact.severeExtreme], world.width, world.height);
    const near = { tornado: truth.tornado, wind: truth.wind, hail: truth.hail, severe: any('tornado', 'wind', 'hail'), tornadoSig: truth.tornadoSig, tornadoExtreme: truth.tornadoExtreme, tornadoViolent: truth.tornadoViolent, windSig: truth.windSig, windExtreme: truth.windExtreme, windViolent: truth.windViolent, hailSig: truth.hailSig, hailExtreme: truth.hailExtreme, severeSig: any('tornadoSig', 'windSig', 'hailSig'), severeExtreme: any('tornadoExtreme', 'windExtreme', 'hailExtreme') };
    const verifiedAs = { full: truth.worldRisk, severe: Array.from({ length: n }, (_, i) => worldCategory({ severe: { percent: probabilityLevel('severe', severeChance[i]), cig: severeCig[i] } }, { thunder: Boolean(truth.storm[i]) })) };
    const top = list => list.reduce((best, c) => Math.max(best, ORDER.indexOf(c)), 0);
    for (let lead = 1; lead <= 3; lead++) {
      const outlook = issued[day - (lead - 1)]?.[lead - 1];
      if (!outlook) continue;
      const verified = outlook.hazards.includes('severe') ? verifiedAs.severe : verifiedAs.full;
      const reliability = Object.fromEntries(outlook.hazards.map(h => [h, LEVELS[h].map(() => ({ cells: 0, hits: 0 }))]));
      const groups = Object.fromEntries(outlook.hazards.map(h => [h, [0, 1, 2, 3].map(() => ({ cells: 0, hits: 0, tier1: 0, tier2: 0, tier3: 0 }))]));
      // Calibration data: the raw chance's bin, the cells in it and how many had the hazard near.
      const calibration = Object.fromEntries(outlook.hazards.map(h => [h, CAL_BINS.slice(1).map(() => ({ cells: 0, hits: 0, raw: 0 }))]));
      if (CAL_DATA) for (let i = 0; i < n; i++) for (const h of outlook.hazards) { const raw = outlook.rawChance[h][i], b = CAL_BINS.findIndex((edge, k) => raw >= edge && raw < CAL_BINS[k + 1]), slot = calibration[h][b]; slot.cells++; slot.raw += raw; if (near[h][i]) slot.hits++; }
      let sameCell = 0, withinOne = 0;
      for (let i = 0; i < n; i++) {
        for (const h of outlook.hazards) {
          // Reliability: cells by forecast contour, and whether the hazard came within 25 miles.
          const slot = reliability[h][LEVELS[h].indexOf(outlook.level[h][i])]; slot.cells++; if (near[h][i]) slot.hits++;
          // Inside each intensity group, at the places the hazard came within 25 miles: how often each tier did.
          if (outlook.level[h][i] > 0) { const g = groups[h][outlook.cig[h][i]]; g.cells++; if (near[h][i]) { g.hits++; CIG_TIERS[h].forEach((field, k) => { if (near[field][i]) g[`tier${k + 1}`]++; }); } }
        }
        const f = ORDER.indexOf(outlook.category[i]), t = ORDER.indexOf(verified[i]);
        if (f === t) sameCell++; if (Math.abs(f - t) <= 1) withinOne++;
      }
      out.push({
        seed, day, lead, forecast: top(outlook.category),
        // The highest intensity group drawn for each hazard, and the highest the day verified with.
        drawnCig: Object.fromEntries(outlook.hazards.map(h => [h, Math.max(0, ...outlook.cig[h])])), verifiedCig: Object.fromEntries(outlook.hazards.map(h => [h, Math.max(0, ...(h === 'severe' ? severeCig : truth.observedCig[h]))])), verified: top(verified), calibration, sameCell: sameCell / n, withinOne: withinOne / n, reliability, groups,
        forecastTornadoes: outlook.expected.tornadoes, tornadoes: world.stormEngine.totalTornadoes - before,
        forecastArea: Object.fromEntries(ORDER.map((c, k) => [c, outlook.category.filter(v => ORDER.indexOf(v) >= k).length / n])), verifiedArea: Object.fromEntries(ORDER.map((c, k) => [c, verified.filter(v => ORDER.indexOf(v) >= k).length / n]))
      });
    }
  }
  process.send(out);
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3,4,5,6').split(',').map(Number), started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), '--members', String(memberCount), ...(CAL_DATA ? ['--calibration-data'] : [])]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })));
  if (CAL_DATA) {
    const data = {};
    for (const row of results.flat()) {
      const day = `day${row.lead}`;
      for (const [h, bins] of Object.entries(row.calibration)) bins.forEach((bin, k) => { const slot = (((data[day] ??= {})[h] ??= CAL_BINS.slice(1).map(() => ({ cells: 0, hits: 0, raw: 0 }))))[k]; slot.cells += bin.cells; slot.hits += bin.hits; slot.raw += bin.raw; });
    }
    console.log('CALIBRATION_DATA ' + JSON.stringify(data));
  }
  const everything = results.flat(), share = (rows, test) => `${Math.round(100 * rows.filter(test).length / Math.max(1, rows.length))}%`, mean = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  console.log(`=== Outlook verification: ${days} mornings x seeds ${seeds.join(', ')}, ${memberCount} runs (${((Date.now() - started) / 1000).toFixed(0)} s) ===`);
  for (const lead of [1, 2, 3]) {
    const all = everything.filter(d => d.lead === lead), hazards = Object.keys(all[0]?.reliability ?? {});
    if (!all.length) continue;
    console.log(`\n--- Day ${lead} outlooks: ${all.length} ---`);
    console.log('1. The highest category of the day');
    console.log(`  ${'forecast'.padEnd(10)}${ORDER.slice(1).map(c => `${c} ${share(all, d => ORDER[d.forecast] === c)}`).join(', ')}`);
    console.log(`  ${'verified'.padEnd(10)}${ORDER.slice(1).map(c => `${c} ${share(all, d => ORDER[d.verified] === c)}`).join(', ')}`);
    console.log(`  forecast right: ${share(all, d => d.forecast === d.verified)} | within one category: ${share(all, d => Math.abs(d.forecast - d.verified) <= 1)} | forecast too high: ${share(all, d => d.forecast > d.verified)}, too low: ${share(all, d => d.forecast < d.verified)}`);
    console.log(`  place by place: the category was right over ${Math.round(100 * mean(all.map(d => d.sameCell)))}% of the map, within one category over ${Math.round(100 * mean(all.map(d => d.withinOne)))}%`);
    console.log(`  share of the map at Enhanced or more: forecast ${Math.round(100 * mean(all.map(d => d.forecastArea.ENH)))}%, verified ${Math.round(100 * mean(all.map(d => d.verifiedArea.ENH)))}% | at Moderate or more: forecast ${Math.round(100 * mean(all.map(d => d.forecastArea.MDT)))}%, verified ${Math.round(100 * mean(all.map(d => d.verifiedArea.MDT)))}%`);
    console.log('2. Do the contours mean what they say? (places inside each contour level, up to the next; share of them where it happened within 25 miles)');
    for (const h of hazards) {
      const row = LEVELS[h].map((edge, k) => { const cells = all.reduce((a, d) => a + d.reliability[h][k].cells, 0), hits = all.reduce((a, d) => a + d.reliability[h][k].hits, 0); return `${edge ? edge + '%' : 'below'}: ${cells >= 200 ? Math.round(100 * hits / cells) + '%' : '-'}`; });
      console.log(`  ${h.padEnd(9)}${row.join('  ')}`);
    }
    console.log('   Intensity groups (places inside a contour by the group drawn there; of those where the hazard came within 25 miles, the share where each tier did)');
    for (const h of hazards) for (let g = 0; g <= TIER_NAMES[h].length; g++) {
      const cells = all.reduce((a, d) => a + d.groups[h][g].cells, 0); if (cells < 100) continue;
      console.log(`  ${h.padEnd(9)}${(g ? 'CIG' + g : 'no group').padEnd(10)}${TIER_NAMES[h].map((name, k) => `${name} ${Math.round(100 * all.reduce((a, d) => a + d.groups[h][g][`tier${k + 1}`], 0) / Math.max(1, all.reduce((a, d) => a + d.groups[h][g].hits, 0)))}%`).join('  ')}  (${Math.round(100 * cells / all.reduce((a, d) => a + [0, 1, 2, 3].reduce((b, q) => b + d.groups[h][q].cells, 0), 0))}% of the area inside a contour)`);
    }
    console.log('   How often each intensity group is the highest drawn somewhere on the outlook, and the highest the day verified with (share of outlooks)');
    for (const h of hazards) console.log(`  ${h.padEnd(9)}${[0, 1, 2, 3].slice(0, TIER_NAMES[h].length + 1).map(g => `${g ? 'CIG' + g : 'none'} ${share(all, d => d.drawnCig[h] === g)} / ${share(all, d => d.verifiedCig[h] === g)}`).join('  |  ')}   (drawn / verified)`);
    console.log(`3. Tornadoes: the day's count fell inside the range of the runs on ${share(all, d => d.tornadoes >= d.forecastTornadoes.low && d.tornadoes <= d.forecastTornadoes.high)} of days`);
    console.log('  (range of the runs / what happened): ' + all.map(d => `${d.forecastTornadoes.low}-${d.forecastTornadoes.high}/${d.tornadoes}`).join('  '));
  }
}
