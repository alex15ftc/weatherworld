// Outlook audit: runs seeds (one worker thread each) with the outlook ensemble issued in-step,
// keeps every Day 1-3 product and verifies it against the authoritative run's own severe
// reports (event within 25 mi, as SPC verifies outlook probabilities). Periods beyond the
// audited system (the next system's) are not issued here.
//   node scripts/outlook-audit.mjs [hours] [seed ...]
// Environment:
//   OUTLOOK_MEMBERS (default 12), AUDIT_THREADS
//   OUTLOOK_CALIBRATION=off       verify uncalibrated products
//   OUTLOOK_AUDIT_INITIAL_ONLY=1  verify only the system-start issuance (minutes instead of hours)
//   OUTLOOK_AUDIT_AMPLITUDE=x     scale the member perturbations (next-system outlooks use 1.1-2.1)
//   OUTLOOK_AUDIT_JSON=path       write reliability histograms (scripts/fit-outlook-calibration.mjs)
//   OUTLOOK_AUDIT_MEMBERS_DIR=dir save member events and truth per issuance so products can be
//                                 rebuilt and re-verified offline (scripts/outlook-tune.mjs)
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { summarizeVerification, mergeHistograms } from '../js/verification/outlookVerification.js';

if (isMainThread) await main(); else parentPort.postMessage(await auditSeed(workerData));

async function main() {
  const hours = Number(process.argv[2] ?? 72);
  const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [1, 11, 23, 42, 99, 2011, 2013, 20240506];
  const threads = Math.max(1, Math.min(seeds.length, Number(process.env.AUDIT_THREADS) || os.cpus().length - 2));
  const started = Date.now();
  const results = [];
  const queue = [...seeds];
  await Promise.all(Array.from({ length: threads }, async () => {
    while (queue.length) {
      const seed = queue.shift();
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: { seed, hours }, resourceLimits: { maxOldGenerationSizeMb: 6144 } });
        worker.once('message', resolve);
        worker.once('error', reject);
      });
      process.stderr.write(`seed ${seed}: ${result.rows.length} products verified, ${result.storms} storms, ${result.tornadoes} tornadoes (${((Date.now() - started) / 60000).toFixed(1)} min)\n`);
      results.push(result);
    }
  }));
  const rows = results.flatMap(r => r.rows);
  console.log(`\n=== Outlook audit: ${seeds.length} seeds × ${hours} h, ${rows.length} products, calibration ${process.env.OUTLOOK_CALIBRATION ?? 'on'} ===`);
  for (const r of results.sort((a, b) => a.seed - b.seed)) console.log(`  seed ${r.seed} (${r.narrative}): ${r.storms} storms, ${r.tornadoes} tornadoes`);
  summarizeVerification(rows);
  if (process.env.OUTLOOK_AUDIT_JSON) {
    const histograms = results.reduce((all, r) => mergeHistograms(all, r.histograms), {});
    fs.writeFileSync(process.env.OUTLOOK_AUDIT_JSON, JSON.stringify({ seeds, hours, calibration: process.env.OUTLOOK_CALIBRATION ?? 'on', histograms }));
  }
  console.log('\n=== Products ===');
  for (const r of rows) console.log(`${r.seed} ${r.key} issued ${r.issued}Z valid ${r.valid.join('-')} fc ${r.forecastRisk} obs ${r.observedRisk} | members tor ${r.members?.tornadoesPerMember?.median ?? '-'} (${r.members?.membersWithTornadoes ?? '-'} w/) | ` + Object.entries(r.hazards).filter(([h]) => h !== 'thunder').map(([h, x]) => `${h[0].toUpperCase()} max ${Math.round(x.maxProb * 100)}% fc ${x.forecastAreaCells} obs ${x.observedAreaCells} hit ${x.hitCells}`).join(' | '));
}

async function auditSeed({ seed, hours }) {
  const { Atmosphere } = await import('../js/atmosphere.js');
  const { generateScenario } = await import('../js/scenarios/scenarioGenerator.js');
  const { initializeEvolution, advanceAtmosphere } = await import('../js/evolution.js');
  const { SIMULATION_CONFIG } = await import('../js/simulationConfig.js');
  const { captureTruth, aggregateTruth, TRUTH_FIELDS } = await import('../js/verification/truth.js');
  const { verifyProduct } = await import('../js/verification/outlookVerification.js');
  const membersDir = process.env.OUTLOOK_AUDIT_MEMBERS_DIR;
  const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config, { profile: { name: 'gameplay', outlookIssuance: 'sync', outlookMembers: Number(process.env.OUTLOOK_MEMBERS) || 12, keepMemberResults: Boolean(membersDir), outlookInitialOnly: process.env.OUTLOOK_AUDIT_INITIAL_ONLY === '1', outlookNextSystem: false, outlookAmplitude: Number(process.env.OUTLOOK_AUDIT_AMPLITUDE) || 1 } });
  const issued = new Map(), frames = [], seen = new Set(), initiations = [], memberRuns = [];
  const capture = () => {
    for (const p of Object.values(world.outlookCycle?.products ?? {})) if (p.status === 'issued' && !issued.has(p.cycleId)) issued.set(p.cycleId, p);
    for (const { request, results } of world.outlookCycle?.memberLog?.splice(0) ?? []) memberRuns.push({ request, results: results.map(compactMember) });
  };
  capture();
  captureTruth(world, frames, seen, initiations);
  for (let t = 0; t < hours - 1e-9; t += 0.5) {
    advanceAtmosphere(world, 0.5);
    capture();
    captureTruth(world, frames, seen, initiations);
  }
  const dims = { width: world.width, height: world.height, cellSizeMiles: world.cellSizeMiles };
  const radius = 25 / world.cellSizeMiles;
  const truthFor = (start, end) => aggregateTruth(frames.filter(f => f.hourUtc > start + 1e-6 && f.hourUtc <= end + 1e-6), initiations.filter(r => r.hourUtc >= start && r.hourUtc < end), world.width, world.height, radius, world.cellSizeMiles);
  const rows = [], histograms = {};
  for (const product of issued.values()) {
    if (product.validEndHour > world.validHourUtc + 1e-6) continue;
    rows.push({ seed, ...verifyProduct(product, truthFor(product.validStartHour, product.validEndHour), dims, histograms) });
  }
  if (membersDir) {
    // Exact report cells per verified window, for offline re-verification.
    const truth = {};
    for (const run of memberRuns) for (const w of run.request.windows) {
      const key = `${w.start}-${w.end}`;
      if (truth[key] || w.end > world.validHourUtc + 1e-6) continue;
      const frameSet = frames.filter(f => f.hourUtc > w.start + 1e-6 && f.hourUtc <= w.end + 1e-6);
      truth[key] = Object.fromEntries(TRUTH_FIELDS.map(field => [field, indices(frameSet, field)]));
    }
    fs.mkdirSync(membersDir, { recursive: true });
    fs.writeFileSync(path.join(membersDir, `seed-${seed}.json`), JSON.stringify({ seed, narrative: config.narrative, width: world.width, height: world.height, cellSizeKm: world.cellSizeKm, cellSizeMiles: world.cellSizeMiles, finalHour: world.validHourUtc, runs: memberRuns, truth }));
  }
  return { seed, narrative: config.narrative, rows, histograms, storms: seen.size, tornadoes: world.stormEngine?.totalTornadoes ?? 0 };

  function indices(frameSet, field) {
    const out = new Set();
    for (const f of frameSet) { const a = f[field]; for (let i = 0; i < a.length; i++) if (a[i]) out.add(i); }
    return [...out];
  }
  function compactMember(m) {
    return { index: m.index, windows: m.windows.map(w => ({ key: w.key, start: w.start, end: w.end, storms: w.storms, tornadoes: w.tornadoes, masks: Object.fromEntries(Object.entries(w.masks).map(([field, mask]) => [field, mask.reduce((list, v, i) => (v ? (list.push(i), list) : list), [])])) })) };
  }
}
