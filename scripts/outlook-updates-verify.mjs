// How well the Day 1 outlook verifies at each issue the server makes in a day, each made as the server makes it (the runs
// from that moment, blended with the last issue by OUTLOOK.continuity, capped at one category above it until the day is
// under way) and set against what happened from its issue to the end of the day (12Z), as the Storm Prediction Center
// verifies its later outlooks. Hail and wind are reports (truth.js).
//   node scripts/outlook-updates-verify.mjs [days per seed] [--seeds 1,2,3] [--source perturbed|srm|both] [--srm-cheap 7] [--calibration-data]
// The issues (2026-11-14) are the server's: 12Z standing for its 06Z, then the updates at 13Z, 16:30Z, 20Z and 01Z, each from
// OUTLOOK.members runs carrying OUTLOOK.cheapPerMember cheap runs (OutlookRuntime), and they are scored as the live scoreboard
// scores them (js/verification/outlookScore.js: Brier skill of the contour levels, category CSI) as well as by category.
// --source srm (or both, paired on the same days): the updates made the short-range model's way instead, one run of the live
// air with no forecast errors (as ShortRangeModel.js) carrying --srm-cheap cheap runs, each with its own storm dice from the
// issue on (none shared with the live world); its own chain of issues from the morning one, blended with its last.
// --calibration-data prints the updates' raw chances (of the last source named) binned against what then happened, as
// CALIBRATION_DATA under day1update, for scripts/fit-outlook-calibration.mjs.
// (The 12Z issue starts without the day before's Day 2 to blend with, as outlook-verify.mjs does.)
import { fork } from 'node:child_process';
import fs from 'node:fs';
import { RISK_RADIUS_MILES } from '../js/forecast/spcOutlookRules.js';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 3);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
const ISSUES = [0, 1, 4.5, 8, 13];   // hours after 12Z: the morning issue, then the server's 13Z, 16:30Z, 20Z and 01Z updates
// --table <file>: the updates are also issued from the same perturbed runs read through that file's day1update table (its
// CALIBRATION line, as fit-outlook-calibration.mjs prints it), as source 'table', so a refitted table is scored on the same
// days at no extra cost. --rows <file>: each seed's rows are written there as it finishes (JSON lines); --summarize <file>
// prints the report from such a file (all seeds finished so far) without running anything.
const TABLE_FILE = flag('--table'), ROWS_FILE = flag('--rows'), SUMMARIZE = flag('--summarize');
const SOURCE = flag('--source') ?? 'perturbed', SOURCES = [...(SOURCE === 'both' ? ['perturbed', 'srm'] : [SOURCE]), ...(TABLE_FILE ? ['table'] : [])];
const SRM_CHEAP = Number(flag('--srm-cheap') ?? 7);
const CAL_DATA = args.includes('--calibration-data');
const CAL_BINS = [0, 1, 2, 3.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50, 60, 75, 101];   // as outlook-verify.mjs
const utcName = after => { const z = (12 + after) % 24; return `${String(Math.floor(z)).padStart(2, '0')}${z % 1 ? '30' : '00'}Z`; };

if (flag('--worker') !== null) await worker(Number(flag('--worker')));
else if (SUMMARIZE) { const all = fs.readFileSync(SUMMARIZE, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)); await report(all, [...new Set(all.map(r => r.seed))], null, [...new Set(all.map(r => r.source))]); }
else await main();

async function main() {
  const seeds = String(flag('--seeds') ?? '1,2,3,4,5,6').split(',').map(Number), started = Date.now(), all = [];
  if (ROWS_FILE) fs.writeFileSync(ROWS_FILE, '');
  await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), '--source', SOURCE, '--srm-cheap', String(SRM_CHEAP), ...(TABLE_FILE ? ['--table', TABLE_FILE] : []), ...(CAL_DATA ? ['--calibration-data'] : [])], { serialization: 'advanced' });
    child.on('message', rows => { all.push(...rows); if (ROWS_FILE) fs.appendFileSync(ROWS_FILE, rows.map(row => JSON.stringify(row) + '\n').join('')); });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`seed ${seed} failed (${code})`))));
  })));
  await report(all, seeds, started, SOURCES);
}

async function report(all, seeds, started, sources) {
  const { summarizeScores } = await import('../js/verification/outlookScore.js');
  const SOURCES = sources;
  const share = (list, test) => `${Math.round(100 * list.filter(test).length / Math.max(1, list.length))}%`;
  const mean = list => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  if (CAL_DATA) {
    const data = { day1update: {} };
    for (const row of all.filter(r => r.source === SOURCES.at(-1))) for (const [h, bins] of Object.entries(row.calibration ?? {})) bins.forEach((bin, k) => { const slot = (data.day1update[h] ??= CAL_BINS.slice(1).map(() => ({ cells: 0, hits: 0, raw: 0 })))[k]; slot.cells += bin.cells; slot.hits += bin.hits; slot.raw += bin.raw; });
    console.log('CALIBRATION_DATA ' + JSON.stringify(data));
  }
  console.log(`=== Day 1 outlook by issue: seeds ${seeds.join(', ')}, updates from ${SOURCES.filter(s => s !== 'morning').join(' and ')}${started ? ` (${Math.round((Date.now() - started) / 1000)} s)` : ''} ===`);
  for (const after of ISSUES) for (const source of after === 0 ? ['perturbed'] : SOURCES.filter(s => s !== 'morning')) {
    const rows = all.filter(r => r.after === after && r.source === source), [summary] = summarizeScores(rows.map(r => r.score));
    console.log(`\n${utcName(after)} issue, ${after === 0 ? 'morning' : source} (${rows.length} days), against what happened ${utcName(after)}-1200Z:`);
    console.log(`  forecast  ${ORDER.slice(1).map(c => `${c} ${share(rows, r => ORDER[r.forecast] === c)}`).join(', ')}`);
    console.log(`  verified  ${ORDER.slice(1).map(c => `${c} ${share(rows, r => ORDER[r.verified] === c)}`).join(', ')}`);
    console.log(`  right: ${share(rows, r => r.forecast === r.verified)} | within one: ${share(rows, r => Math.abs(r.forecast - r.verified) <= 1)} | too high: ${share(rows, r => r.forecast > r.verified)}, too low: ${share(rows, r => r.forecast < r.verified)}`);
    console.log(`  place by place: right over ${Math.round(100 * mean(rows.map(r => r.sameCell)))}% of the map, within one over ${Math.round(100 * mean(rows.map(r => r.withinOne)))}%`);
    if (summary) {
      console.log(`  Brier skill of the issued levels: ${Object.entries(summary.hazards).map(([h, v]) => `${h} ${v.brierSkillIssued == null ? '-' : Math.round(100 * v.brierSkillIssued)}`).join(', ')}`);
      console.log(`  CSI: ${Object.entries(summary.csi).map(([c, v]) => `${c}+ ${v == null ? '-' : v.toFixed(2)}`).join(' ')}`);
    }
  }
}

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { captureTruth, aggregateTruth } = await import('../js/verification/truth.js');
  const { OUTLOOK, runOutlookMemberSet, combineOutlook, stateFromBytes } = await import('../js/forecast/DayOneOutlook.js');
  const { WORLD_RISK_ORDER } = await import('../js/forecast/worldRiskCategories.js');
  const { scoreOutlook } = await import('../js/verification/outlookScore.js');
  const { placesFor } = await import('../server/CountyLayer.js');
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world, n = world.width * world.height, rows = [];
  const map = { width: world.width, height: world.height, cellSizeKm: world.cellSizeKm };
  atmosphere.advanceLikeServer(24);   // a day for the storms to get going (stepped as the server steps; 2026-11-05)
  const places = placesFor(world);
  // The members of one issue: each run's day and its cheap runs' days.
  const { CALIBRATION } = await import('../js/forecast/outlookCalibration.js');
  const tableOf = text => { const key = 'export const CALIBRATION = Object.freeze(', a = text.indexOf(key) + key.length; return JSON.parse(text.slice(a, text.indexOf(');', a))); };
  const TABLE = TABLE_FILE ? { ...CALIBRATION, day1update: tableOf(fs.readFileSync(TABLE_FILE, 'utf8')).day1update } : null;
  const flat = set => [set.days[0], ...set.cheap.map(days => days[0])].filter(Boolean);
  const membersOf = (source, bytes, hours) => (source === 'srm'
    ? flat(runOutlookMemberSet(stateFromBytes(bytes), 0, hours, { placesFor, timingSpreadMs: 0, upstreamShare: 0, mesoscale: 0, cheapRuns: SRM_CHEAP }))
    : Array.from({ length: OUTLOOK.members }, (_, m) => flat(runOutlookMemberSet(stateFromBytes(bytes), m, hours, { placesFor, cheapRuns: OUTLOOK.cheapPerMember }))).flat());
  for (let day = 0; day < days; day++) {
    const dayEnd = world.validHourUtc + 24, frames = [], seen = new Set(), initiations = [], issued = [];
    const last = {};
    for (let step = 0; step < 48; step++) {
      const after = step / 2;
      if (ISSUES.includes(after)) {
        // An issue as the server makes it: the runs to the day's end, blended with the last issue of its chain,
        // and at most one category above it until the day is under way.
        const now = world.validHourUtc, bytes = v8.serialize(atmosphere.saveState({ forecast: true }));
        const underWay = now >= dayEnd - 24 + OUTLOOK.nowcastAfterHours;
        // Each kind of runs made once an issue ('table' reads the perturbed runs again); each chain blends with its own last
        // issue, or the morning one for its first update, never with another chain's issue of the same moment (fixed 2026-11-15).
        const made = {}, before = { ...last };
        for (const source of after === 0 ? ['perturbed'] : SOURCES) {
          const runsFrom = source === 'table' ? 'perturbed' : source;
          const members = (made[runsFrom] ??= membersOf(runsFrom, bytes, dayEnd - now));
          const previous = before[source] ?? before.perturbed ?? null;
          const caps = [OUTLOOK.leadCaps?.day1, !underWay && previous ? WORLD_RISK_ORDER[Math.min(WORLD_RISK_ORDER.length - 1, Math.max(WORLD_RISK_ORDER.indexOf('SLGT'), WORLD_RISK_ORDER.indexOf(previous.highest) + 1))] : null].filter(Boolean);
          const maxCategory = caps.length ? caps.reduce((a, b) => (WORLD_RISK_ORDER.indexOf(a) <= WORLD_RISK_ORDER.indexOf(b) ? a : b)) : null;
          const outlook = combineOutlook(members, { ...(source === 'table' ? { calibration: TABLE } : {}), day: 'day1', issuedHourUtc: now, validFromHourUtc: now, validToHourUtc: dayEnd, seed, maxCategory, previous, continuity: previous ? OUTLOOK.continuity[underWay ? 'underWay' : 'before'] : 0 });
          last[source] = outlook;
          issued.push({ after, source, outlook, from: frames.length });
        }
      }
      atmosphere.advanceLikeServer(0.5);   // (5-minute storm ticks, as the live world; until 2026-11-05 30-minute jumps)
      captureTruth(world, frames, seen, initiations, places);
    }
    // Each issue against what happened from its issue to the day's end.
    for (const { after, source, outlook, from } of issued) {
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
      const score = scoreOutlook(outlook, truth, map);
      rows.push({ seed, day, after, source, forecast: top(outlook.category), verified: top(truth.worldRisk), sameCell: same / n, withinOne: near / n, calibration, score });
    }
  }
  process.send(rows);
}
