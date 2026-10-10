// Severe coverage audit: how much of the domain the simulation itself covers with storms and
// severe reports per convective day, and the observed (practically perfect) categories.
//   node scripts/coverage-audit.mjs [hours] [seed ...]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

if (isMainThread) await main(); else parentPort.postMessage(await run(workerData));

async function main() {
  const hours = Number(process.argv[2] ?? 24);
  const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [1, 11, 23, 42, 99, 2011, 2013, 20240506];
  const started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { seed, hours } });
    worker.once('message', resolve); worker.once('error', reject);
  })));
  const pc = v => `${Math.round(100 * v)}%`.padStart(4);
  console.log(`=== Severe coverage: ${seeds.length} seeds × ${hours} h (${((Date.now() - started) / 1000).toFixed(0)} s) ===`);
  console.log('seed narrative            storms peak life(h) tor sup% lin% | storm-samples: hail1 hail2 gust58 gust75 | within 25 mi: thunder severe hail sigHail wind sigWind tor | category area: MRGN+ SLGT+ ENH+ MDT+ HIGH | max');
  for (const r of results) {
    console.log(`${String(r.seed).padEnd(8)} ${r.narrative.padEnd(20)} ${String(r.storms).padStart(4)} ${String(r.peak).padStart(4)} ${r.life.toFixed(1).padStart(6)} ${String(r.tornadoes).padStart(4)} ${pc(r.sample.supercell)} ${pc(r.sample.linear)} | ${pc(r.sample.hail1)} ${pc(r.sample.hail2)} ${pc(r.sample.gust58)} ${pc(r.sample.gust75)} | ${pc(r.near.storm)} ${pc(r.near.severe)} ${pc(r.near.hail)} ${pc(r.near.hailSig)} ${pc(r.near.wind)} ${pc(r.near.windSig)} ${pc(r.near.tornado)} | ${r.area.map(pc).join(' ')} | ${r.maxRisk}`);
  }
}

async function run({ seed, hours }) {
  const { Atmosphere } = await import('../js/atmosphere.js');
  const { generateScenario } = await import('../js/scenarios/scenarioGenerator.js');
  const { initializeEvolution, advanceAtmosphere } = await import('../js/evolution.js');
  const { SIMULATION_CONFIG } = await import('../js/simulationConfig.js');
  const { captureTruth, aggregateTruth } = await import('../js/verification/truth.js');
  const { RISK_ORDER } = await import('../js/forecast/spcOutlookRules.js');
  const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config, { profile: { name: 'gameplay', outlookIssuance: 'off' } });
  const frames = [], seen = new Set(), initiations = [], firstSeen = new Map(), lastSeen = new Map();
  const sample = { n: 0, hail1: 0, hail2: 0, gust58: 0, gust75: 0, supercell: 0, linear: 0 };
  const LINEAR = ['broken line', 'linear segment', 'QLCS with embedded supercells', 'QLCS', 'MCS'];
  let peak = 0;
  for (let t = 0; t < hours - 1e-9; t += 0.5) {
    advanceAtmosphere(world, 0.5);
    const frame = captureTruth(world, frames, seen, initiations);
    peak = Math.max(peak, frame.activeStorms);
    for (const s of world.storms ?? []) {
      if (!s.active) continue;
      if (!firstSeen.has(s.id)) firstSeen.set(s.id, s.createdHourUtc ?? world.validHourUtc);
      lastSeen.set(s.id, world.validHourUtc);
      const hail = Number(s.currentHailSizeInches ?? s.hazards?.hailSizeInches ?? 0), gust = Number(s.surfaceWind?.gustMph ?? 0);
      sample.n++; if (s.mode.includes('supercell')) sample.supercell++; if (LINEAR.includes(s.mode)) sample.linear++; if (hail >= 1) sample.hail1++; if (hail >= 2) sample.hail2++; if (gust >= 58) sample.gust58++; if (gust >= 75) sample.gust75++;
    }
  }
  const truth = aggregateTruth(frames, initiations, world.width, world.height, 25 / world.cellSizeMiles, world.cellSizeMiles);
  const n = world.width * world.height;
  const share = a => a.reduce((x, y) => x + y, 0) / n;
  const lives = [...firstSeen].map(([id, t0]) => lastSeen.get(id) - t0).sort((a, b) => a - b);
  const order = truth.risk.map(r => RISK_ORDER.indexOf(r));
  return {
    seed, narrative: config.narrative, storms: seen.size, peak, life: lives[Math.floor(lives.length / 2)] ?? 0, tornadoes: world.stormEngine?.totalTornadoes ?? 0,
    sample: Object.fromEntries(['hail1', 'hail2', 'gust58', 'gust75', 'supercell', 'linear'].map(k => [k, sample[k] / Math.max(1, sample.n)])),
    near: { ...Object.fromEntries(['storm', 'hail', 'hailSig', 'wind', 'windSig', 'tornado'].map(k => [k, share(truth[k])])), severe: share(truth.hail.map((v, i) => v || truth.wind[i] || truth.tornado[i] ? 1 : 0)) },
    area: ['MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'].map(level => order.filter(o => o >= RISK_ORDER.indexOf(level)).length / n),
    maxRisk: RISK_ORDER[Math.max(...order)]
  };
}
