// Times the authoritative simulation (outlook ensembles excluded).
//   node scripts/benchmark-seed.mjs [seed] [hours] [runs]
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';

const seed = Number(process.argv[2] ?? 63869760);
const hours = Number(process.argv[3] ?? 6);
const runs = Math.max(1, Number(process.argv[4] ?? 3));
const results = [];
for (let i = 0; i < runs; i++) {
  const started = performance.now();
  const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  initializeEvolution(world, generateScenario(world, seed), { profile: { name: 'gameplay', outlookIssuance: 'off' } });
  const initMs = performance.now() - started;
  advanceAtmosphere(world, hours);
  const totalMs = performance.now() - started;
  results.push(totalMs);
  const phases = Object.entries(world.evolution.performance.phaseMs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${Math.round(v)}`).join(' | ');
  console.log(`Run ${i + 1}: ${(totalMs / 1000).toFixed(2)}s (init ${(initMs / 1000).toFixed(2)}s, ${(hours / ((totalMs - initMs) / 1000)).toFixed(2)} simulated hr/s) ${phases}`);
}
const sorted = [...results].sort((a, b) => a - b);
console.log(JSON.stringify({ seed, hours, runs, meanMs: sorted.reduce((a, b) => a + b, 0) / runs, medianMs: sorted[Math.floor(runs / 2)], fastestMs: sorted[0], slowestMs: sorted.at(-1) }, null, 2));
