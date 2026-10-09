// Field integrity scan: runs seeds and checks every numeric per-cell field the forecast
// engines consume (forecast, derived, dynamics, mesoscaleFields, features) for NaN/Infinity,
// out-of-range values, fields frozen across the whole run, and abrupt grid-wide jumps.
//   node scripts/field-integrity-scan.mjs [hours] [seed ...]
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';

const hours = Number(process.argv[2] ?? 24);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [1, 23, 42, 99];
const GROUPS = ['forecast', 'derived', 'dynamics', 'mesoscaleFields', 'features'];
// Fields whose names say they are probabilities/fractions must stay within [0, 1].
const UNIT_INTERVAL = /(Probability|Fraction|Coverage|Support|Confidence|Potential|Readiness|Erosion|Influence|Suitability|Efficiency|Focus|Corridor)$/i;
const NON_NEGATIVE = /^(cape|mlcape|sbcape|mucape|srh|bulkShear|lcl|lclAgl|dcape|stp|scp|vtp)$/;
const stats = new Map();
const stat = key => { let s = stats.get(key); if (!s) stats.set(key, s = { nonFinite: 0, outOfRange: 0, min: Infinity, max: -Infinity, samples: 0, changed: false, first: undefined, maxMeanJump: 0, jumpHour: null, examples: [] }); return s; };

for (const seed of seeds) {
  const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  initializeEvolution(world, generateScenario(world, seed));
  let previousMeans = new Map();
  for (let t = 0; t <= hours; t += 1) {
    if (t > 0) advanceAtmosphere(world, 1);
    const sums = new Map();
    world.forEachCell((cell, x, y) => {
      for (const group of GROUPS) {
        const obj = cell[group];
        if (!obj || typeof obj !== 'object') continue;
        for (const [name, value] of Object.entries(obj)) {
          if (typeof value !== 'number') continue;
          const key = `${group}.${name}`, s = stat(key);
          s.samples++;
          if (!Number.isFinite(value)) { s.nonFinite++; if (s.examples.length < 3) s.examples.push({ seed, hour: world.validHourUtc, x, y, value: String(value) }); continue; }
          if (s.first === undefined) s.first = value; else if (value !== s.first) s.changed = true;
          s.min = Math.min(s.min, value); s.max = Math.max(s.max, value);
          const out = (UNIT_INTERVAL.test(name) && (value < -1e-6 || value > 1 + 1e-6)) || (NON_NEGATIVE.test(name) && value < -1e-6);
          if (out) { s.outOfRange++; if (s.examples.length < 3) s.examples.push({ seed, hour: world.validHourUtc, x, y, value: +value.toFixed(3) }); }
          const sum = sums.get(key) ?? { total: 0, n: 0 }; sum.total += value; sum.n++; sums.set(key, sum);
        }
      }
    });
    for (const [key, { total, n }] of sums) {
      const mean = total / n, prev = previousMeans.get(key), s = stat(key);
      // Raw jumps are normalized by the field's full-run range after all seeds finish.
      if (prev !== undefined) (s.jumps ??= []).push({ delta: Math.abs(mean - prev), at: `${seed}@${world.validHourUtc}` });
      previousMeans.set(key, mean);
    }
  }
  process.stderr.write(`seed ${seed} scanned\n`);
}

for (const s of stats.values()) {
  const scale = Math.max(1e-6, s.max - s.min);
  for (const j of s.jumps ?? []) if (j.delta / scale > s.maxMeanJump) { s.maxMeanJump = j.delta / scale; s.jumpHour = j.at; }
}
const rows = [...stats.entries()];
const section = (title, filter, fmt) => {
  const hits = rows.filter(([, s]) => filter(s));
  console.log(`\n=== ${title} (${hits.length}) ===`);
  for (const [k, s] of hits.sort((a, b) => a[0].localeCompare(b[0]))) console.log(fmt(k, s));
};
section('Non-finite values', s => s.nonFinite > 0, (k, s) => `${k}: ${s.nonFinite}/${s.samples} e.g. ${JSON.stringify(s.examples)}`);
section('Out of range', s => s.outOfRange > 0, (k, s) => `${k}: ${s.outOfRange}/${s.samples} range [${s.min.toFixed(3)}, ${s.max.toFixed(3)}] e.g. ${JSON.stringify(s.examples)}`);
section('Frozen (never changes in any seed)', s => !s.changed && s.samples > 0, (k, s) => `${k} = ${s.first}`);
section('Abrupt domain-mean jumps (>35% of field range in 1 h)', s => s.maxMeanJump > 0.35, (k, s) => `${k}: ${(100 * s.maxMeanJump).toFixed(0)}% at seed@hour ${s.jumpHour} range [${s.min.toFixed(2)}, ${s.max.toFixed(2)}]`);
