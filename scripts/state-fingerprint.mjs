// Prints SHA-256 fingerprints of a seeded simulation so performance changes can prove
// they leave meteorological output unchanged. Compare the output before and after.
//   node scripts/state-fingerprint.mjs [seed] [hours] [stepHours]
import { createHash } from 'node:crypto';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';

const seed = Number(process.argv[2] ?? 63869760);
const hours = Number(process.argv[3] ?? 6);
const stepHours = Number(process.argv[4] ?? 0.5);

function stableJson(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, v) => {
    if (typeof v === 'function') return undefined;
    if (ArrayBuffer.isView(v)) return Array.from(v);
    if (v instanceof Map) return [...v.entries()];
    if (v instanceof Set) return [...v.values()];
    if (v && typeof v === 'object') {
      if (seen.has(v)) return '[cycle]';
      seen.add(v);
    }
    // Wall-clock timings legitimately differ between runs.
    if (/(^|[a-z])Ms$/.test(key) || key === 'performance') return undefined;
    return v;
  });
}
const hash = value => createHash('sha256').update(stableJson(value) ?? 'undefined').digest('hex').slice(0, 16);

const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
const config = generateScenario(world, seed);
config.seed = seed;
world.seed = seed;
world.config = config;
initializeEvolution(world, config, { profile: 'calibration' });

const timeline = [];
for (let t = 0; t < hours - 1e-9; t += stepHours) {
  advanceAtmosphere(world, Math.min(stepHours, hours - t));
  timeline.push(`${world.validHourUtc.toFixed(2)}:${hash(world.outlookCycle?.products)}:${hash(world.storms)}`);
}

const sections = {
  cells: world.cells,
  storms: world.storms,
  outlookProducts: world.outlookCycle?.products,
  outlookArchive: world.outlookCycle?.archive,
  mesoscale: world.mesoscale,
  synopticObjects: world.synopticObjects,
  timeline
};
for (const [name, value] of Object.entries(sections)) console.log(`${name.padEnd(16)} ${hash(value)}`);
console.log(`${'combined'.padEnd(16)} ${hash(sections)}`);
