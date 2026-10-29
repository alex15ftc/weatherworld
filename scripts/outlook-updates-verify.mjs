// How well the Day 1 outlook verifies at each issue the server makes in a day: 12Z, then the
// updates at 18Z and 00Z, each made as the server makes it (the runs from that moment, blended
// with the last issue by OUTLOOK.continuity, capped at one category above it until the day is
// under way) and set against what happened from its issue to the end of the day (12Z), as the
// Storm Prediction Center verifies its later outlooks. Hail and wind are reports (truth.js).
//   node scripts/outlook-updates-verify.mjs [days per seed] [--seeds 1,2,3] [--calibration-data]
// --calibration-data prints the update issues' (18Z and 00Z) raw chances binned against what then
// happened, as CALIBRATION_DATA under day1update, for scripts/fit-outlook-calibration.mjs.
// (The 12Z issue starts without the day before's Day 2 to blend with, as outlook-verify.mjs does.)
import { fork } from 'node:child_process';
import { RISK_RADIUS_MILES } from '../js/forecast/spcOutlookRules.js';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 3);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
const ISSUES = [0, 6, 12];   // hours after 12Z
const CAL_DATA = args.includes('--calibration-data');
const CAL_BINS = [0, 1, 2, 3.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50, 60, 75, 101];   // as outlook-verify.mjs

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function main() {
  const seeds = String(flag('--seeds') ?? '1,2,3,4,5,6').split(',').map(Number), started = Date.now(), all = [];
  await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), ...(CAL_DATA ? ['--calibration-data'] : [])], { serialization: 'advanced' });
    child.on('message', rows => all.push(...rows));
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`seed ${seed} failed (${code})`))));
  })));
  const share = (list, test) => `${Math.round(100 * list.filter(test).length / Math.max(1, list.length))}%`;
  const mean = list => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  if (CAL_DATA) {
    const data = { day1update: {} };
    for (const row of all) for (const [h, bins] of Object.entries(row.calibration ?? {})) bins.forEach((bin, k) => { const slot = (data.day1update[h] ??= CAL_BINS.slice(1).map(() => ({ cells: 0, hits: 0, raw: 0 })))[k]; slot.cells += bin.cells; slot.hits += bin.hits; slot.raw += bin.raw; });
    console.log('CALIBRATION_DATA ' + JSON.stringify(data));
  }
  console.log(`=== Day 1 outlook by issue: ${days} days x seeds ${seeds.join(', ')} (${Math.round((Date.now() - started) / 1000)} s) ===`);
  for (const after of ISSUES) {
    const rows = all.filter(r => r.after === after), utc = String((12 + after) % 24).padStart(2, '0');
    console.log(`\n${utc}Z issue (${rows.length} days), against what happened ${utc}Z-12Z:`);
    console.log(`  forecast  ${ORDER.slice(1).map(c => `${c} ${share(rows, r => ORDER[r.forecast] === c)}`).join(', ')}`);
    console.log(`  verified  ${ORDER.slice(1).map(c => `${c} ${share(rows, r => ORDER[r.verified] === c)}`).join(', ')}`);
    console.log(`  right: ${share(rows, r => r.forecast === r.verified)} | within one: ${share(rows, r => Math.abs(r.forecast - r.verified) <= 1)} | too high: ${share(rows, r => r.forecast > r.verified)}, too low: ${share(rows, r => r.forecast < r.verified)}`);
    console.log(`  place by place: right over ${Math.round(100 * mean(rows.map(r => r.sameCell)))}% of the map, within one over ${Math.round(100 * mean(rows.map(r => r.withinOne)))}%`);
  }
}

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { captureTruth, aggregateTruth } = await import('../js/verification/truth.js');
  const { OUTLOOK, runOutlookMemberDays, combineOutlook, stateFromBytes } = await import('../js/forecast/DayOneOutlook.js');
  const { WORLD_RISK_ORDER } = await import('../js/forecast/worldRiskCategories.js');
  const { placesFor } = await import('../server/CountyLayer.js');
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world, n = world.width * world.height, rows = [];
  atmosphere.advance(24);   // a day for the storms to get going
  const places = placesFor(world);
  for (let day = 0; day < days; day++) {
    const dayEnd = world.validHourUtc + 24, frames = [], seen = new Set(), initiations = [], issued = [];
    let last = null;
    for (let step = 0; step < 48; step++) {
      const after = step / 2;
      if (ISSUES.includes(after)) {
        // An issue as the server makes it: the runs to the day's end, blended with the last issue,
        // and at most one category above it until the day is under way.
        const now = world.validHourUtc, bytes = v8.serialize(atmosphere.saveState({ forecast: true }));
        const runs = Array.from({ length: OUTLOOK.members }, (_, m) => runOutlookMemberDays(stateFromBytes(bytes), m, dayEnd - now, { placesFor })[0]);
        const underWay = now >= dayEnd - 24 + OUTLOOK.nowcastAfterHours;
        const caps = [OUTLOOK.leadCaps?.day1, !underWay && last ? WORLD_RISK_ORDER[Math.min(WORLD_RISK_ORDER.length - 1, Math.max(WORLD_RISK_ORDER.indexOf('SLGT'), WORLD_RISK_ORDER.indexOf(last.highest) + 1))] : null].filter(Boolean);
        const maxCategory = caps.length ? caps.reduce((a, b) => (WORLD_RISK_ORDER.indexOf(a) <= WORLD_RISK_ORDER.indexOf(b) ? a : b)) : null;
        last = combineOutlook(runs, { day: 'day1', issuedHourUtc: now, validFromHourUtc: now, validToHourUtc: dayEnd, seed, maxCategory, previous: last, continuity: last ? OUTLOOK.continuity[underWay ? 'underWay' : 'before'] : 0 });
        issued.push({ after, outlook: last, from: frames.length });
      }
      atmosphere.advance(0.5);
      captureTruth(world, frames, seen, initiations, places);
    }
    // Each issue against what happened from its issue to the day's end.
    for (const { after, outlook, from } of issued) {
      const truth = aggregateTruth(frames.slice(from), initiations, world.width, world.height, RISK_RADIUS_MILES / world.cellSizeMiles, world.cellSizeMiles);
      const top = list => list.reduce((best, c) => Math.max(best, ORDER.indexOf(c)), 0);
      let same = 0, near = 0;
      for (let i = 0; i < n; i++) { const f = ORDER.indexOf(outlook.category[i]), v = ORDER.indexOf(truth.worldRisk[i]); if (f === v) same++; if (Math.abs(f - v) <= 1) near++; }
      // (For the update table: the raw chances of the issues after 12Z against what came within 25 miles.)
      let calibration = null;
      if (CAL_DATA && after > 0) {
        const hit = { tornado: truth.tornado, wind: truth.wind, hail: truth.hail };
        calibration = Object.fromEntries(outlook.hazards.map(h => [h, CAL_BINS.slice(1).map(() => ({ cells: 0, hits: 0, raw: 0 }))]));
        for (let i = 0; i < n; i++) for (const h of outlook.hazards) { const raw = outlook.rawChance[h][i], b = CAL_BINS.findIndex((edge, k) => raw >= edge && raw < CAL_BINS[k + 1]), slot = calibration[h][b]; slot.cells++; slot.raw += raw; if (hit[h][i]) slot.hits++; }
      }
      rows.push({ seed, day, after, forecast: top(outlook.category), verified: top(truth.worldRisk), sameCell: same / n, withinOne: near / n, calibration });
    }
  }
  process.send(rows);
}
