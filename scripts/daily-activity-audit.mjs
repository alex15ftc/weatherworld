// Per-day severe-weather activity over a 3-day system: storms initiated, tornadoes, peak
// simultaneous storms, mode mix (storm-hours), peak CAPE and warm-sector coverage for each 12Z-12Z day.
//   node scripts/daily-activity-audit.mjs [seed ...]
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';

const seeds = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 7, 23, 42, 99, 2011];
const totals = [0, 1, 2].map(() => ({ storms: 0, tornadoes: 0, quietSeeds: 0 }));
for (const seed of seeds) {
  const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config);
  const days = [0, 1, 2].map(() => ({ created: new Set(), tornadoes: new Set(), peakActive: 0, modes: {}, peakCape: 0, warmFracMax: 0 }));
  for (let t = 0; t < 72; t += 1) {
    advanceAtmosphere(world, 1);
    const d = days[Math.min(2, Math.floor((world.validHourUtc - 12 - 1e-6) / 24))];
    let active = 0, warm = 0, n = 0;
    for (const s of world.storms ?? []) {
      if (s.active === false) continue;
      active++;
      if (!d.created.has(s.id) && s.createdHourUtc >= world.validHourUtc - 1.0001) d.created.add(s.id);
      d.modes[s.mode] = (d.modes[s.mode] ?? 0) + 1; // storm-hours, so later upscale growth into lines counts
      for (const tor of s.tornadoHistory ?? []) if (tor.startedHourUtc >= world.validHourUtc - 1.0001) d.tornadoes.add(`${s.id}|${tor.cycle}`);
      if (s.tornado?.onGround) d.tornadoes.add(`${s.id}|${s.tornado.cycleCount}`);
    }
    world.forEachCell(c => { n++; if (c.features?.warmSector) warm++; d.peakCape = Math.max(d.peakCape, c.derived?.cape ?? 0); });
    d.peakActive = Math.max(d.peakActive, active);
    d.warmFracMax = Math.max(d.warmFracMax, warm / n);
  }
  const events = (config.synopticPattern.dynamics?.events ?? []).map(e => `${e.type} +${Math.round(e.hour)}h`).join(', ');
  console.log(`seed ${seed} (${config.narrative} / ${config.setupType} / ${config.flowRegime} flow) synoptic events: ${events || 'none'}`);
  days.forEach((d, i) => {
    totals[i].storms += d.created.size; totals[i].tornadoes += d.tornadoes.size; if (d.created.size < 3) totals[i].quietSeeds++;
    const modes = Object.entries(d.modes).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(', ');
    console.log(`  Day ${i + 1}: storms ${String(d.created.size).padStart(3)} | tornadoes ${String(d.tornadoes.size).padStart(3)} | peak active ${String(d.peakActive).padStart(2)} | peak CAPE ${String(Math.round(d.peakCape)).padStart(4)} | warm sector ${(100 * d.warmFracMax).toFixed(0)}% | ${modes}`);
  });
}
console.log('\nTotals per day across seeds:');
totals.forEach((t, i) => console.log(`  Day ${i + 1}: storms ${t.storms}, tornadoes ${t.tornadoes}, seeds with <3 storms: ${t.quietSeeds}/${seeds.length}`));
