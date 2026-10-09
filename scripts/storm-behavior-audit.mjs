// Storm behaviour audit: spacing, motion, where and when storms form, and mode mix.
//   node scripts/storm-behavior-audit.mjs [hours] [seed ...]
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';

const hours = Number(process.argv[2] ?? 36);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [1, 7, 23, 42, 99, 2011];
const pct = (a, p) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(p * (v.length - 1))] : NaN; };
const circ = dirs => { let s = 0, c = 0; for (const d of dirs) { s += Math.sin(d * Math.PI / 180); c += Math.cos(d * Math.PI / 180); } const r = Math.hypot(s, c) / Math.max(1, dirs.length); return { mean: ((Math.atan2(s, c) * 180 / Math.PI) + 360) % 360, spread: Math.sqrt(-2 * Math.log(Math.max(1e-9, r))) * 180 / Math.PI }; };
const all = { nn: [], seedMeans: [], spreads: [], initHours: new Array(24).fill(0), capped: 0, created: 0, modes: {} };

for (const seed of seeds) {
  const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config);
  const seen = new Set(), dirs = [];
  for (let h = 0; h < hours; h++) {
    advanceAtmosphere(world, 1);
    const active = world.storms.filter(s => s.active !== false);
    for (const s of active) {
      if (!seen.has(s.id)) {
        seen.add(s.id); all.created++;
        all.initHours[Math.floor(((s.createdHourUtc % 24) + 24) % 24)]++;
        // A storm forming where the parcel cannot break the cap with the forcing present.
        const lift = Number(s.sourceCell?.liftEnergy), cin = Number(s.sourceCell?.cin);
        if (Number.isFinite(lift) && Number.isFinite(cin) ? cin > lift : (s.environment?.cin ?? 0) > 150) all.capped++;
      }
      const d = active.filter(o => o !== s).map(o => Math.hypot(o.positionKm.x - s.positionKm.x, o.positionKm.y - s.positionKm.y));
      if (d.length) all.nn.push(Math.min(...d));
      dirs.push(((Math.atan2(s.velocityKph.east, s.velocityKph.north) * 180 / Math.PI) + 360) % 360);
      all.modes[s.mode] = (all.modes[s.mode] ?? 0) + 1;
    }
  }
  const m = circ(dirs);
  all.seedMeans.push(m.mean); all.spreads.push(m.spread);
  console.log(`seed ${seed} (${config.narrative}/${config.flowRegime}): ${seen.size} storms, motion toward ${m.mean.toFixed(0)}° ± ${m.spread.toFixed(0)}°`);
}
const nn = all.nn, hist = {};
for (const d of nn) { const b = Math.min(150, Math.floor(d / 10) * 10); hist[b] = (hist[b] ?? 0) + 1; }
console.log(`\nnearest-neighbour km p10/p25/p50/p75/p90: ${[.1, .25, .5, .75, .9].map(p => Math.round(pct(nn, p))).join(' / ')} | share < 30 km: ${(100 * nn.filter(d => d < 30).length / Math.max(1, nn.length)).toFixed(0)}%`);
console.log(`NN histogram (10 km bins): ${Object.entries(hist).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
console.log(`motion: seed means ${all.seedMeans.map(v => v.toFixed(0)).join(', ')} | within-seed spread median ${pct(all.spreads, .5).toFixed(0)}°`);
console.log(`storms formed in air the forcing could not lift through the cap: ${all.capped}/${all.created}`);
console.log(`initiation by UTC hour: ${all.initHours.map((n, h) => `${h}:${n}`).join(' ')}`);
const total = Object.values(all.modes).reduce((a, b) => a + b, 0);
console.log(`mode storm-hours: ${Object.entries(all.modes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / total).toFixed(0)}%`).join(', ')}`);
