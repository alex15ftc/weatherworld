// Outlook audit: runs seeds, keeps every issued Day 1-3 probability grid, and verifies it
// against simulated storm truth (event within 25 mi, as SPC defines outlook probabilities).
// Reports reliability, area bias, Brier skill, misses, displacement and categorical skill.
//   node scripts/outlook-audit.mjs [hours] [seed ...] > report.txt
// Refit calibration: OUTLOOK_CALIBRATION=off OUTLOOK_AUDIT_JSON=rel.json node scripts/outlook-audit.mjs
//                    then node scripts/fit-outlook-calibration.mjs rel.json
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';
import { captureTruth, aggregateTruth } from '../js/verification/ForecastVerificationEngine.js';

const hours = Number(process.argv[2] ?? 72);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [1, 11, 23, 42, 99, 2011, 2013, 20240506];
const HAZARDS = ['tornado', 'hail', 'wind'];
const LEVELS = { tornado: [2, 5, 10, 15, 30, 45, 60], hail: [5, 15, 30, 45, 60], wind: [5, 15, 30, 45, 60, 75, 90] };
const RISKS = ['TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
const RADIUS_MILES = 25;

// reliability[day][hazard][level] = { cells, hits }
const reliability = {};
const rows = [];

for (const seed of seeds) {
  const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  const config = generateScenario(world, seed);
  config.seed = seed; world.seed = seed; world.config = config;
  initializeEvolution(world, config, { profile: 'calibration' });
  if (world.stormObservationLayer) { world.stormObservationLayer.nextReportHourUtc = 1e9; world.stormObservationLayer.lastReportHourUtc = 1e9; }
  const issued = new Map(), frames = [], seen = new Set(), initiations = [], records = new Map();
  const capture = () => {
    for (const p of Object.values(world.outlookCycle?.products ?? {})) {
      if (issued.has(p.cycleId)) continue;
      issued.set(p.cycleId, {
        key: p.key, cycleId: p.cycleId, issuedHourUtc: p.issuedHourUtc, validStartHour: p.validStartHour, validEndHour: p.validEndHour, overallRisk: p.overallRisk,
        prob: Object.fromEntries(HAZARDS.map(h => [h, Float32Array.from(p.grid, c => (Number(c[`${h}Probability`]) || 0) / 100)])),
        risk: p.grid.map(c => c.risk)
      });
    }
  };
  capture();
  captureTruth(world, frames, seen, initiations, records);
  for (let t = 0; t < hours - 1e-9; t += 0.5) {
    advanceAtmosphere(world, 0.5);
    capture();
    captureTruth(world, frames, seen, initiations, records);
  }
  const radius = RADIUS_MILES / world.cellSizeMiles, w = world.width, h = world.height, n = w * h;
  for (const product of issued.values()) {
    if (product.validEndHour > world.validHourUtc + 1e-6 || product.validStartHour < SIMULATION_CONFIG.startHourUtc - 1e-6) continue;
    const valid = frames.filter(f => f.hourUtc + 1e-6 >= product.validStartHour && f.hourUtc < product.validEndHour - 1e-6);
    const inits = initiations.filter(r => r.hourUtc + 1e-6 >= product.validStartHour && r.hourUtc < product.validEndHour - 1e-6);
    const truth = aggregateTruth(valid, inits, w, h, radius, world.cellSizeMiles);
    const row = { seed, key: product.key, issued: product.issuedHourUtc, valid: [product.validStartHour, product.validEndHour], forecastRisk: product.overallRisk, observedRisk: truth.risk.reduce((a, b) => (RISKS.indexOf(b) > RISKS.indexOf(a) ? b : a), 'TSTM'), hazards: {} };
    for (const hazard of HAZARDS) {
      const p = product.prob[hazard], o = truth[hazard], low = LEVELS[hazard][0] / 100;
      let brier = 0, base = 0, fcArea = 0, obsArea = 0, hit = 0, missedObs = 0, fx = 0, fy = 0, fw = 0, ox = 0, oy = 0, ow = 0, maxP = 0;
      for (let i = 0; i < n; i++) {
        brier += (p[i] - o[i]) ** 2; base += o[i]; maxP = Math.max(maxP, p[i]);
        if (p[i] >= low) { fcArea++; fx += (i % w) * p[i]; fy += Math.floor(i / w) * p[i]; fw += p[i]; if (o[i]) hit++; }
        if (o[i]) { obsArea++; ox += i % w; oy += Math.floor(i / w); ow++; if (p[i] < low) missedObs++; }
        const level = [...LEVELS[hazard]].reverse().find(l => p[i] >= l / 100 - 1e-6);
        if (level) {
          const bucket = ((reliability[product.key] ??= {})[hazard] ??= {})[level] ??= { cells: 0, hits: 0 };
          bucket.cells++; bucket.hits += o[i];
        }
      }
      const centroidErrorMiles = fw && ow ? Math.hypot(fx / fw - ox / ow, fy / fw - oy / ow) * world.cellSizeMiles : null;
      row.hazards[hazard] = { brier: brier / n, baseRate: base / n, maxProb: maxP, forecastAreaCells: fcArea, observedAreaCells: obsArea, hitCells: hit, missedObservedFraction: obsArea ? missedObs / obsArea : null, areaBias: obsArea ? fcArea / obsArea : (fcArea ? Infinity : 1), centroidErrorMiles };
    }
    rows.push(row);
  }
  process.stderr.write(`seed ${seed}: ${[...issued.values()].length} products issued, ${rows.filter(r => r.seed === seed).length} verified, ${seen.size} storms\n`);
}

// --- Report ------------------------------------------------------------------
const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '  -  ' : v.toFixed(d));
console.log('\n=== Reliability: forecast probability level vs observed frequency (within 25 mi) ===');
for (const day of ['day1', 'day2', 'day3']) for (const hazard of HAZARDS) {
  const b = reliability[day]?.[hazard];
  if (!b) continue;
  console.log(`${day} ${hazard.padEnd(7)} ` + Object.entries(b).map(([lvl, { cells, hits }]) => `${lvl}%: obs ${(100 * hits / cells).toFixed(0)}% (n=${cells})`).join(' | '));
}

console.log('\n=== Per day / hazard summary (mean over verified products) ===');
for (const day of ['day1', 'day2', 'day3']) {
  const set = rows.filter(r => r.key === day);
  if (!set.length) continue;
  for (const hazard of HAZARDS) {
    const hs = set.map(r => r.hazards[hazard]);
    const clim = hs.reduce((a, x) => a + x.baseRate, 0) / hs.length;
    const brier = hs.reduce((a, x) => a + x.brier, 0) / hs.length;
    const brierRef = hs.reduce((a, x) => a + (clim * (1 - x.baseRate) ** 2 + (1 - clim) * x.baseRate ** 2 >= 0 ? x.baseRate * (1 - clim) ** 2 + (1 - x.baseRate) * clim ** 2 : 0), 0) / hs.length;
    const withObs = hs.filter(x => x.observedAreaCells > 0);
    const withFc = hs.filter(x => x.forecastAreaCells > 0);
    const bias = withObs.length ? withObs.reduce((a, x) => a + Math.min(x.areaBias, 20), 0) / withObs.length : null;
    const missed = withObs.length ? withObs.reduce((a, x) => a + x.missedObservedFraction, 0) / withObs.length : null;
    const cent = hs.filter(x => x.centroidErrorMiles != null).map(x => x.centroidErrorMiles);
    const falseAlarmProducts = hs.filter(x => x.forecastAreaCells > 0 && x.observedAreaCells === 0).length;
    const missedProducts = hs.filter(x => x.forecastAreaCells === 0 && x.observedAreaCells > 0).length;
    console.log(`${day} ${hazard.padEnd(7)} n=${hs.length} BSS ${fmt(1 - brier / brierRef)} | area bias ${fmt(bias)} | obs missed by lowest contour ${fmt(missed)} | centroid err ${cent.length ? Math.round(cent.reduce((a, b) => a + b, 0) / cent.length) + ' mi' : '-'} | products w/ forecast but no event ${falseAlarmProducts}/${withFc.length} | events with no forecast ${missedProducts}/${withObs.length}`);
  }
}

console.log('\n=== Categorical: forecast overall risk vs observed (counts) ===');
for (const day of ['day1', 'day2', 'day3']) {
  const set = rows.filter(r => r.key === day);
  if (!set.length) continue;
  let over = 0, under = 0, exact = 0, within1 = 0;
  const matrix = {};
  for (const r of set) {
    const d = RISKS.indexOf(r.forecastRisk) - RISKS.indexOf(r.observedRisk);
    if (d > 0) over++; else if (d < 0) under++; else exact++;
    if (Math.abs(d) <= 1) within1++;
    const k = `${r.forecastRisk}->${r.observedRisk}`; matrix[k] = (matrix[k] ?? 0) + 1;
  }
  console.log(`${day} n=${set.length} exact ${exact} within-one ${within1} over ${over} under ${under} | ${Object.entries(matrix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
}

// OUTLOOK_AUDIT_JSON=path writes the reliability tables for scripts/fit-outlook-calibration.mjs.
if (process.env.OUTLOOK_AUDIT_JSON) {
  const { writeFileSync } = await import('node:fs');
    const categories = {};
  for (const r of rows) ((categories[r.key] ??= {})[r.forecastRisk] ??= []).push(r.observedRisk);
  writeFileSync(process.env.OUTLOOK_AUDIT_JSON, JSON.stringify({ seeds, hours, calibration: process.env.OUTLOOK_CALIBRATION ?? 'on', categoryCalibration: process.env.OUTLOOK_CATEGORY_CALIBRATION ?? 'on', reliability, categories }, null, 2));
}

console.log('\n=== Products ===');
for (const r of rows) console.log(`${r.seed} ${r.key} issued ${r.issued}Z valid ${r.valid.join('-')} fc ${r.forecastRisk} obs ${r.observedRisk} | ` + HAZARDS.map(h => { const x = r.hazards[h]; return `${h[0].toUpperCase()} max ${Math.round(x.maxProb * 100)}% fc ${x.forecastAreaCells} obs ${x.observedAreaCells} hit ${x.hitCells} ce ${x.centroidErrorMiles == null ? '-' : Math.round(x.centroidErrorMiles)}`; }).join(' | '));
