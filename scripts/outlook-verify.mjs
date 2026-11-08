// How well the Day 1, 2 and 3 outlooks verify. Each morning (12Z) the three outlooks are
// made from the world as it is, as the server makes them (the same runs, the same number of
// them for each day); then the day is run, and what happened is set against the Day 1
// outlook made that morning, the Day 2 outlook made the morning before and the Day 3 outlook
// made the morning before that.
//   node scripts/outlook-verify.mjs [days per seed] [--seeds 1,2,3,4,5,6] [--members 8] [--cheap 3] [--save dir | --from dir]
// --save dir keeps each morning's runs and what then happened (one file a morning, seed-S-day-D.bin.gz);
// --from dir scores those again without running anything: only what makes the outlooks from the runs
// (calibration, agreement, intensity groups, categories) can have changed, and it takes a minute or two
// in place of an hour. Runs saved by older code that the outlooks now read differently need saving again.
// Reports, for each outlook: the mix of forecast categories against the mix that verified,
// how often the forecast category was right, and whether the contours mean what they say (of
// the places inside a 30% contour, about 30% or more should have had it within 25 miles).
import { fork } from 'node:child_process';
import { RISK_RADIUS_MILES } from '../js/forecast/spcOutlookRules.js';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 7);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const memberCount = Number(flag('--members') ?? 8);
// --cheap N: cheap runs each member carries (default OUTLOOK.cheapPerMember, as the server; 0 for the full runs alone).
const CHEAP_FLAG = flag('--cheap');
const SAVE = flag('--save'), FROM = flag('--from');
// --outlooks N: make only the first N of Day 1, 2 and 3 (the runs stop with the last; to save time when Day 3 is not wanted).
const OUTLOOKS = Number(flag('--outlooks') ?? 3);
// --jobs N: at most N seeds' workers at once (default 6; each is a process).
const JOBS = Math.max(1, Number(flag('--jobs') ?? 6));
// OUTLOOK_ENSEMBLE='{"expected":true,"method":"nmep","sigmaKm":{"day1":40,"day2":60}}': combine the runs another way than
// OUTLOOK.ensemble (DayOneOutlook.js), to compare from one archive (--from) without changing the code.
const ENSEMBLE = process.env.OUTLOOK_ENSEMBLE ? JSON.parse(process.env.OUTLOOK_ENSEMBLE) : null;
// OUTLOOK_CALIBRATION=file: the chances' table from that file (fit-outlook-calibration.mjs's output, its CALIBRATION line) in
// place of the one installed, to score a fit on other mornings without installing it.
const CALIBRATION_FILE = process.env.OUTLOOK_CALIBRATION ? JSON.parse(fs.readFileSync(process.env.OUTLOOK_CALIBRATION, 'utf8').match(/^export const CALIBRATION = Object\.freeze\((.*)\);$/m)[1]) : null;
// OUTLOOK_CUTOFFS='{"day1":{"hail":{"5":6,...}}}' or a file holding that JSON: the category cutoffs (OUTLOOK.categoryCutoffs) to use.
// --category-data: print, as JSON, each outlook's verified category and, for each hazard and wanted intensity group, its
// highest chance (for scripts/fit-category-cutoffs.mjs).
const CUTOFFS = process.env.OUTLOOK_CUTOFFS ? JSON.parse(fs.existsSync(process.env.OUTLOOK_CUTOFFS) ? fs.readFileSync(process.env.OUTLOOK_CUTOFFS, 'utf8') : process.env.OUTLOOK_CUTOFFS) : null;
const CATEGORY_DATA = args.includes('--category-data');
// --lead-caps: hold Days 2 and 3 to OUTLOOK.leadCaps as the server does (server/OutlookRuntime.js; without it they are scored uncapped).
const LEAD_CAPS = args.includes('--lead-caps');
const saved = (dir, seed, day) => path.join(dir, `seed-${seed}-day-${day}.bin.gz`);
// OLD=1: the outlooks as before agenda step 11 (no errors in the air over the map, no agreement rule), to compare.
const OLD = process.env.OLD === '1';
// NOCAL=1: without the calibration of the chances. --calibration-data: print, as JSON, the runs'
// raw chances binned against whether the hazard came within 25 miles (for fit-outlook-calibration.mjs).
const NOCAL = process.env.NOCAL === '1' || OLD, CAL_DATA = args.includes('--calibration-data'), CIG_DATA = args.includes('--cig-data');
// --cig-data: for each contour area (Day 3 too since 2026-11-07), the share of the runs reaching each intensity group
// against the group the area's reports then reached (for fit-cig-calibration.mjs).
const CAL_BINS = [0, 1, 2, 3.5, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50, 60, 75, 101];
const ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
// The contour levels of each hazard: places are grouped by the contour they are inside.
const LEVELS = { tornado: [0, 2, 5, 10, 15, 30, 45, 60], wind: [0, 5, 15, 30, 45, 60, 75, 90], hail: [0, 5, 15, 30, 45, 60], severe: [0, 5, 15, 30, 45, 60] };
const TIER_NAMES = { tornado: ['EF2+', 'EF3+', 'EF4+'], wind: ['75 mph', '85 mph', '96 mph'], hail: ['2 in', '3.5 in'], severe: ['significant', 'intense'] };

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { captureTruth, aggregateTruth, practicallyPerfectChance } = await import('../js/verification/truth.js');
  const { OUTLOOK, runOutlookMemberSet, combineOutlook, stateFromBytes, membersFor, stormDaysFor } = await import('../js/forecast/DayOneOutlook.js');
  const { CIG_TIERS, CIG_BOUNDS, contourCig, conditionalCig, worldCategory, probabilityLevel } = await import('../js/forecast/worldRiskCategories.js');
  // Hail and wind as reports, in the runs and in what happened (truth.js captureTruth).
  const { placesFor } = await import('../server/CountyLayer.js');
  const CHEAP = CHEAP_FLAG === null ? OUTLOOK.cheapPerMember : Number(CHEAP_FLAG);
  const atmosphere = FROM ? null : new AtmosphereWorld({ seed }), world = atmosphere?.world, out = [], issued = [];
  let n = world ? world.width * world.height : 0;
  atmosphere?.advanceLikeServer(24);   // a day for the storms to get going (stepped as the server steps, as the day itself is)
  if (SAVE) fs.mkdirSync(SAVE, { recursive: true });
  for (let day = 0; day < days; day++) {
    // A saved morning, when scoring again.
    let kept = null;
    if (FROM) { const file = saved(FROM, seed, day); if (!fs.existsSync(file)) break; kept = v8.deserialize(zlib.gunzipSync(fs.readFileSync(file))); n = kept.map.width * kept.map.height; }
    const map = kept ? kept.map : { width: world.width, height: world.height, cellSizeKm: world.cellSizeKm, cellSizeMiles: world.cellSizeMiles };
    // The morning's outlooks: each run goes as far as the last day it is one of the runs for.
    const now = kept ? kept.now : world.validHourUtc, runs = kept ? kept.runs : [];
    if (!kept) { const bytes = v8.serialize(atmosphere.saveState()); for (let m = 0; m < memberCount; m++) runs.push(runOutlookMemberSet(stateFromBytes(bytes), m, 24 * OUTLOOK.days.slice(0, OUTLOOKS).filter(name => m < membersFor(name, memberCount)).length, { placesFor, stormDays: stormDaysFor(m, memberCount), cheapRuns: CHEAP, ...(OLD ? { mesoscale: 0 } : {}) })); }
    // (only the days the runs reach: an archive saved with --outlooks 2 has no Day 3)
    const made = Math.min(OUTLOOKS, Math.max(...runs.map(run => (Array.isArray(run) ? run : run.days).length)));
    issued[day] = OUTLOOK.days.slice(0, made).map((name, index) => combineOutlook(runs.slice(0, membersFor(name, memberCount)).flatMap(run => (Array.isArray(run) ? [run[index]] : [run.days[index], ...run.cheap.map(days => days[index]).filter(Boolean)])), { day: name, issuedHourUtc: now, validFromHourUtc: now + 24 * index, validToHourUtc: now + 24 * (index + 1), seed, ...(OLD ? { agreement: [0, 0], groupAgreement: [0, 0] } : {}), ...(NOCAL ? { calibration: {} } : CALIBRATION_FILE ? { calibration: CALIBRATION_FILE } : {}), ...(ENSEMBLE ? { ensemble: ENSEMBLE } : {}), ...(CUTOFFS ? { categoryCutoffs: CUTOFFS } : {}), ...(LEAD_CAPS ? { maxCategory: OUTLOOK.leadCaps[name] ?? null } : {}) }));
    // What then happened.
    let truth, happened, truthTornadoes;
    if (kept) ({ truth, happened, truthTornadoes = happened } = kept);
    else {
      const frames = [], seen = new Set(), initiations = [], before = world.stormEngine.totalTornadoes;
      const places = placesFor(world);
      // (stepped as the server steps the live world: the storms in 5-minute ticks, then the atmosphere;
      // until 2026-10-28 advance(0.5), whose storms made fewer tornadoes than the live world's)
      for (let step = 0; step < 48; step++) { atmosphere.advanceLikeServer(0.5); captureTruth(world, frames, seen, initiations, places); }
      truth = aggregateTruth(frames, initiations, world.width, world.height, RISK_RADIUS_MILES / world.cellSizeMiles, world.cellSizeMiles);
      happened = world.stormEngine.totalTornadoes - before;
      // Every tornado on the ground in the day, those already down at 12Z too, as a run counts its own (I7 counts).
      truthTornadoes = new Set(frames.flatMap(frame => (frame.tornadoTrackPoints ?? []).map(point => point.tornado))).size;
      if (SAVE) fs.writeFileSync(saved(SAVE, seed, day), zlib.gzipSync(v8.serialize({ now, runs, truth, happened, truthTornadoes, map })));
    }
    // The same day as a Day 3 outlook would give it: one chance, of any severe weather.
    const any = (...fields) => Uint8Array.from({ length: n }, (_, i) => (fields.some(field => truth[field][i]) ? 1 : 0));
    const exact = { severe: any('tornadoExact', 'windExact', 'hailExact'), severeSig: any('tornadoSigExact', 'windSigExact', 'hailSigExact'), severeExtreme: any('tornadoExtremeExact', 'windExtremeExact', 'hailExtremeExact') };
    const severeChance = practicallyPerfectChance(exact.severe, map.width, map.height, map.cellSizeKm), severeCig = contourCig('severe', severeChance, exact.severe, [exact.severeSig, exact.severeExtreme], map.width, map.height);
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
      // (pp: the practically perfect chance the day then had there, summed, for fit-outlook-calibration.mjs --target pp)
      if (CAL_DATA) for (let i = 0; i < n; i++) for (const h of outlook.hazards) { const raw = outlook.rawChance[h][i], b = CAL_BINS.findIndex((edge, k) => raw >= edge && raw < CAL_BINS[k + 1]), slot = calibration[h][b]; slot.cells++; slot.raw += raw; slot.pp = (slot.pp ?? 0) + (h === 'severe' ? severeChance[i] : truth.chance[h][i]); if (near[h][i]) slot.hits++; }
      // Intensity-group calibration data: each contour area's run shares, and the group its reports reached.
      const cigData = [];
      const exactOf = field => (field.startsWith("severe") ? exact[field] : truth[`${field}Exact`]);   // (Day 3: any severe, from the exact reports of any kind)
      if (CIG_DATA) for (const h of outlook.hazards) for (const area of outlook.cigAreas?.[h] ?? []) {
        if (!area.shares) continue;
        let total = 0; const reach = CIG_TIERS[h].map(() => 0);
        for (const i of area.cells) { total += exactOf(h)[i]; CIG_TIERS[h].forEach((field, t) => { reach[t] += exactOf(field)[i]; }); }
        if (total > 0) cigData.push({ h, shares: area.shares, env: area.env, envMax: area.envMax, verified: conditionalCig(total, reach, CIG_BOUNDS[h]) });
      }
      // I7 scores (2026-11-05), summed over the cells and pooled over the outlooks in main(): the Brier score of the
      // runs' raw chance, of the calibrated chance and of the contour level issued (each as a probability of the
      // hazard within RISK_RADIUS_MILES); a reliability table of the calibrated chance; and for each contour level
      // and each category, hits, misses and false alarms against the practically perfect forecast's areas.
      const skill = Object.fromEntries(outlook.hazards.map(h => [h, { cells: 0, events: 0, raw: 0, calibrated: 0, issued: 0, bins: CAL_BINS.slice(1).map(() => ({ cells: 0, chance: 0, hits: 0 })), rawBins: CAL_BINS.slice(1).map(() => ({ cells: 0, hits: 0 })), levels: LEVELS[h].slice(1).map(() => ({ hits: 0, misses: 0, falseAlarms: 0 })) }]));
      const categoryAreas = ORDER.slice(2).map(() => ({ hits: 0, misses: 0, falseAlarms: 0 }));
      const ppLevel = (h, i) => (h === 'severe' ? probabilityLevel('severe', severeChance[i]) : truth.observedProbability[h][i]);
      const tally = (slot, forecast, observed) => { if (forecast && observed) slot.hits++; else if (observed) slot.misses++; else if (forecast) slot.falseAlarms++; };
      let sameCell = 0, withinOne = 0;
      for (let i = 0; i < n; i++) {
        for (const h of outlook.hazards) {
          const s = skill[h], o = near[h][i] ? 1 : 0, raw = outlook.rawChance[h][i] / 100, cal = outlook.chance[h][i] / 100, issued = outlook.level[h][i] / 100;
          s.cells++; s.events += o; s.raw += (raw - o) ** 2; s.calibrated += (cal - o) ** 2; s.issued += (issued - o) ** 2;
          const bin = s.bins[Math.max(0, CAL_BINS.findIndex((edge, k) => 100 * cal >= edge && 100 * cal < CAL_BINS[k + 1]))]; bin.cells++; bin.chance += cal; bin.hits += o;
          const rawBin = s.rawBins[Math.max(0, CAL_BINS.findIndex((edge, k) => 100 * raw >= edge && 100 * raw < CAL_BINS[k + 1]))]; rawBin.cells++; rawBin.hits += o;
          const pp = ppLevel(h, i);
          LEVELS[h].slice(1).forEach((edge, k) => tally(s.levels[k], outlook.level[h][i] >= edge, pp >= edge));
        }
        { const f = ORDER.indexOf(outlook.category[i]), t = ORDER.indexOf(verified[i]); categoryAreas.forEach((slot, k) => tally(slot, f >= k + 2, t >= k + 2)); }
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
        seed, day, lead, forecast: top(outlook.category), cigData,
        // (--category-data: each hazard's highest chance among the places wanting each intensity group, and whether storms are forecast anywhere)
        ...(CATEGORY_DATA ? { categoryData: { thunder: outlook.category.some(c => c !== 'NONE'), max: Object.fromEntries(outlook.hazards.map(h => { const best = [0, 0, 0, 0]; for (let i = 0; i < n; i++) { const w = Math.min(3, outlook.intensity[h][i] | 0); if (outlook.chance[h][i] > best[w]) best[w] = outlook.chance[h][i]; } return [h, best]; })) } } : {}),
        // The highest intensity group drawn for each hazard, and the highest the day verified with.
        drawnCig: Object.fromEntries(outlook.hazards.map(h => [h, Math.max(0, ...outlook.cig[h])])), verifiedCig: Object.fromEntries(outlook.hazards.map(h => [h, Math.max(0, ...(h === 'severe' ? severeCig : truth.observedCig[h]))])), verified: top(verified), calibration, sameCell: sameCell / n, withinOne: withinOne / n, reliability, groups,
        forecastTornadoes: outlook.expected.tornadoes, tornadoes: happened, skill, categoryAreas,
        // What the Day 1 runs made against what happened (tornadoes on the ground in the day, counted alike; cells with reports).
        ...(lead === 1 ? { made: madeByRuns(runs, truth, truthTornadoes) } : {}),
        forecastArea: Object.fromEntries(ORDER.map((c, k) => [c, outlook.category.filter(v => ORDER.indexOf(v) >= k).length / n])), verifiedArea: Object.fromEntries(ORDER.map((c, k) => [c, verified.filter(v => ORDER.indexOf(v) >= k).length / n]))
      });
    }
  }
  process.send(out);
}

// The Day 1 runs' tornadoes and report cells (full runs and cheap runs apart, each the mean of a run), and the day's own.
function madeByRuns(runs, truth, truthTornadoes) {
  const count = grid => grid ? grid.reduce((a, v) => a + (v ? 1 : 0), 0) : 0;
  const of = day => ({ tornadoes: day.tornadoes ?? 0, expectedTornadoes: day.expectedTornadoes ?? 0, tornadoCells: count(day.reports?.tornado), hailCells: count(day.reports?.hail), windCells: count(day.reports?.wind) });
  const mean = list => (list.length ? Object.fromEntries(Object.keys(list[0]).map(key => [key, list.reduce((a, v) => a + v[key], 0) / list.length])) : null);
  const full = runs.map(run => (Array.isArray(run) ? run[0] : run.days[0])).filter(Boolean).map(of);
  const cheap = runs.flatMap(run => (Array.isArray(run) ? [] : run.cheap.map(days => days[0]).filter(Boolean))).map(of);
  return { full: mean(full), cheap: mean(cheap), truth: { tornadoes: truthTornadoes, expectedTornadoes: null, tornadoCells: count(truth.tornadoExact), hailCells: count(truth.hailExact), windCells: count(truth.windExact) } };
}

// I7: Brier skill against the sample's own climatology, reliability, and CSI / POD / FAR against the practically perfect areas.
function printSkill(all, hazards) {
  const pc = v => (Number.isFinite(v) ? `${Math.round(100 * v)}%` : '-'), f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '-');
  const sum = (h, pick) => all.reduce((a, d) => a + pick(d.skill[h]), 0);
  console.log('4. Skill (I7). Brier skill score against the sample climatology (the share of places that had it within the radius), of the runs\' raw chance, the calibrated chance, and the contour levels as issued');
  if (!all[0].skill) return;
  for (const h of hazards) {
    const cells = sum(h, s => s.cells), events = sum(h, s => s.events), base = events / cells, ref = base * (1 - base);
    const bss = key => 1 - sum(h, s => s[key]) / cells / ref;
    // The raw chance as well calibrated as its own bins allow (each bin forecast at the share that had it, in sample):
    // its resolution, the skill any calibration of it could reach (2026-11-05, to compare ways of combining before a refit).
    const resolution = all[0].skill[h].rawBins ? CAL_BINS.slice(1).reduce((a, _, k) => { const c = sum(h, s => s.rawBins[k].cells), o = c ? sum(h, s => s.rawBins[k].hits) / c : 0; return a + c * (o - base) ** 2; }, 0) / cells / ref : NaN;
    console.log(`  ${h.padEnd(9)}raw ${pc(bss('raw')).padStart(5)}  calibrated ${pc(bss('calibrated')).padStart(5)}  issued ${pc(bss('issued')).padStart(5)}  raw recalibrated in sample ${pc(resolution).padStart(5)}   (base rate ${(100 * base).toFixed(1)}%)`);
  }
  console.log('   Reliability of the calibrated chance (bins with 200+ places: mean chance -> share that had it, places)');
  for (const h of hazards) {
    const row = CAL_BINS.slice(1).map((edge, k) => { const cells = sum(h, s => s.bins[k].cells); if (cells < 200) return null; return `${(100 * sum(h, s => s.bins[k].chance) / cells).toFixed(0)}->${(100 * sum(h, s => s.bins[k].hits) / cells).toFixed(0)} (${cells})`; }).filter(Boolean);
    console.log(`  ${h.padEnd(9)}${row.join('  ')}`);
  }
  console.log('   CSI / POD / FAR of each contour level against the practically perfect forecast\'s level');
  for (const h of hazards) {
    const row = LEVELS[h].slice(1).map((edge, k) => { const hits = sum(h, s => s.levels[k].hits), misses = sum(h, s => s.levels[k].misses), fa = sum(h, s => s.levels[k].falseAlarms); return hits + misses + fa ? `${edge}%: ${f2(hits / (hits + misses + fa))}/${f2(hits / (hits + misses))}/${f2(fa / (hits + fa))}` : null; }).filter(Boolean);
    console.log(`  ${h.padEnd(9)}${row.join('  ')}`);
  }
  const cat = ORDER.slice(2).map((c, k) => { const hits = all.reduce((a, d) => a + d.categoryAreas[k].hits, 0), misses = all.reduce((a, d) => a + d.categoryAreas[k].misses, 0), fa = all.reduce((a, d) => a + d.categoryAreas[k].falseAlarms, 0); return hits + misses + fa ? `${c}+ ${f2(hits / (hits + misses + fa))}/${f2(hits / (hits + misses))}/${f2(fa / (hits + fa))}` : null; }).filter(Boolean);
  console.log(`  categories (CSI/POD/FAR, place by place): ${cat.join('  ')}`);
  const made = all.map(d => d.made).filter(m => m?.full);
  if (made.length) {
    const mean = (pick) => made.reduce((a, m) => a + (pick(m) ?? 0), 0) / made.length;
    const line = key => `${key.replace('Cells', ' cells')}: full runs ${mean(m => m.full[key]).toFixed(1)}, cheap runs ${made.some(m => m.cheap) ? mean(m => m.cheap?.[key]).toFixed(1) : '-'}, the day ${made.every(m => m.truth[key] != null) ? mean(m => m.truth[key]).toFixed(1) : '-'}`;
    console.log(`5. What the runs made, a day on average (${made.length} days): ${['tornadoes', 'expectedTornadoes', 'tornadoCells', 'hailCells', 'windCells'].map(line).join(' | ')}`);
  }
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3,4,5,6').split(',').map(Number), started = Date.now();
  const runSeed = seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), '--members', String(memberCount), ...(CAL_DATA ? ['--calibration-data'] : []), ...(CIG_DATA ? ['--cig-data'] : []), ...(CATEGORY_DATA ? ['--category-data'] : []), ...(LEAD_CAPS ? ['--lead-caps'] : []), ...(CHEAP_FLAG !== null ? ['--cheap', CHEAP_FLAG] : []), '--outlooks', String(OUTLOOKS), ...(SAVE ? ['--save', SAVE] : []), ...(FROM ? ['--from', FROM] : [])]);
    // (resolved when the process has exited, so that no more than JOBS are ever alive)
    let got = null; child.once('message', m => { got = m; }); child.once('error', reject); child.once('exit', code => (code ? reject(new Error(`seed ${seed} exited with ${code}`)) : resolve(got)));
  });
  // At most JOBS workers at once, each taking the next seed as one finishes.
  const results = new Array(seeds.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(JOBS, seeds.length) }, async () => { while (next < seeds.length) { const k = next++; results[k] = await runSeed(seeds[k]); } }));
  if (CIG_DATA) {
    // For each day, hazard and group: areas binned by the share of runs reaching the group (eighths),
    // with how many of them verified the group or more.
    const data = {};
    for (const row of results.flat()) for (const { h, shares, verified } of row.cigData ?? []) shares.forEach((share, g) => {
      const bins = ((data[`day${row.lead}`] ??= {})[h] ??= [])[g] ??= Array.from({ length: 9 }, () => ({ areas: 0, hits: 0 }));
      const b = bins[Math.round(share * 8)]; b.areas++; if (verified >= g + 1) b.hits++;
    });
    console.log('CIG_DATA ' + JSON.stringify(data));
    // (each area as it is, with the environment's signal there, for scripts/fit-cig-environment.mjs)
    console.log('CIG_ROWS ' + JSON.stringify(results.flat().flatMap(row => (row.cigData ?? []).map(({ h, shares, env, envMax, verified }) => ({ day: `day${row.lead}`, h, shares, env, envMax, verified })))));
  }
  if (CATEGORY_DATA) console.log('CATEGORY_DATA ' + JSON.stringify(results.flat().filter(row => row.categoryData).map(({ seed, day, lead, forecast, verified, categoryData }) => ({ seed, day, lead, forecast, verified, ...categoryData }))));
  if (CAL_DATA) {
    const data = {};
    for (const row of results.flat()) {
      const day = `day${row.lead}`;
      for (const [h, bins] of Object.entries(row.calibration)) bins.forEach((bin, k) => { const slot = (((data[day] ??= {})[h] ??= CAL_BINS.slice(1).map(() => ({ cells: 0, hits: 0, raw: 0 }))))[k]; slot.cells += bin.cells; slot.hits += bin.hits; slot.raw += bin.raw; slot.pp = (slot.pp ?? 0) + (bin.pp ?? 0); });
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
    printSkill(all, hazards);
  }
}
