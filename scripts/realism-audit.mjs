// Realism audit: runs seeds through a simulated day and flags physically inconsistent
// states (unstable lapse rates, clamped/stuck values, runaway heating, storms that do not
// match their environment). Prints a per-seed summary and an aggregate issue table.
//   node scripts/realism-audit.mjs [hours] [seed ...]
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';

const hours = Number(process.argv[2] ?? 30);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [1, 7, 11, 23, 42, 99, 2011, 2013, 20240506, 20270503];
const fToC = f => (f - 32) * 5 / 9;
const aggregate = {};
const note = (key, value) => { (aggregate[key] ??= []).push(value); };

for (const seed of seeds) {
  const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config);
  const domainKm = world.width * world.cellSizeKm;
  const rows = [];
  const stormIds = new Set(), modes = {}, tornadoes = new Set();
  let mismatched = 0, stormSamples = 0, outside = 0;
  for (let t = 0; t <= hours; t += 3) {
    const initialFrame = t === 0;
    if (t > 0) advanceAtmosphere(world, 3);
    let n = 0, superadiabatic = 0, inversion = 0, tSum = 0, tdSum = 0, tMax = -99, tdMax = -99, capeMax = 0, stpMax = 0, srhMax = 0, shearMax = 0, warm = 0, warmCape = 0, slpMin = 9999, slpMax = 0;
    const t850Values = new Map();
    world.forEachCell(cell => {
      n++;
      const elev = cell.terrain.elevationM, ts = fToC(cell.surface.temperature), t850 = cell.levels[850].temperature, t700 = cell.levels[700].temperature;
      const dz = 1500 - elev;
      // Surface to 850 mb lapse steeper than dry adiabatic (+1 K/km margin) across >300 m.
      if (dz > 300 && (ts - t850) / (dz / 1000) > 10.8) superadiabatic++;
      if (t700 > t850 + 1) inversion++;
      const key = t850.toFixed(2); t850Values.set(key, (t850Values.get(key) ?? 0) + 1);
      tSum += cell.surface.temperature; tdSum += cell.surface.dewpoint;
      tMax = Math.max(tMax, cell.surface.temperature); tdMax = Math.max(tdMax, cell.surface.dewpoint);
      capeMax = Math.max(capeMax, cell.derived.cape ?? 0); stpMax = Math.max(stpMax, cell.derived.stp ?? 0);
      srhMax = Math.max(srhMax, cell.derived.srh ?? 0); shearMax = Math.max(shearMax, cell.derived.bulkShear ?? 0);
      slpMin = Math.min(slpMin, cell.surface.seaLevelPressure); slpMax = Math.max(slpMax, cell.surface.seaLevelPressure);
      if (cell.features?.warmSector) { warm++; warmCape += cell.derived.cape ?? 0; }
    });
    const [modeT850, modeCount] = [...t850Values].sort((a, b) => b[1] - a[1])[0];
    // Tornadoes from each storm's history (an hourly on-ground sample misses most of them).
    for (const storm of [...(world.storms ?? []), ...(world.stormArchive ?? [])]) {
      for (const t of storm.tornadoHistory ?? []) tornadoes.add(`${storm.id}|${t.cycle ?? t.startedHourUtc}`);
      if (storm.tornado?.onGround) tornadoes.add(`${storm.id}|${storm.tornado.cycleCount}`);
    }
    for (const storm of world.storms ?? []) {
      if (storm.active === false) continue;
      stormIds.add(storm.id);
      modes[storm.mode] = (modes[storm.mode] ?? 0) + 1;
      stormSamples++;
      const env = storm.environment ?? {};
      if (/supercell/.test(storm.mode) && ['mature', 'cyclic', 'organizing'].includes(storm.lifecycleState) && ((env.cape ?? 0) < 250 || (env.bulkShear ?? 0) < 25)) mismatched++;
      if (storm.positionKm.x < 0 || storm.positionKm.y < 0 || storm.positionKm.x > domainKm || storm.positionKm.y > domainKm) outside++;
    }
    rows.push({
      hour: world.validHourUtc, meanT: tSum / n, meanTd: tdSum / n, tMax, tdMax, capeMax, stpMax, srhMax, shearMax,
      warmFrac: warm / n, warmCapeMean: warm ? warmCape / warm : 0, slpMin, slpMax,
      // The initial frame reflects generator defaults; judge stuck/unstable states after evolution.
      superadiabatic: initialFrame ? 0 : superadiabatic / n, inversion: initialFrame ? 0 : inversion / n,
      stuckT850: { value: modeT850, share: initialFrame ? 0 : modeCount / n },
      storms: (world.storms ?? []).filter(s => s.active !== false).length
    });
  }
  const first = rows[0], peak = rows.reduce((a, b) => (b.capeMax > a.capeMax ? b : a));
  const sameHourNextDay = rows.find(r => Math.abs(r.hour - (first.hour + 24)) < 0.01);
  const summary = {
    seed, setup: world.setupForecast?.key ?? config.setupType ?? config.narrativeLabel,
    meanTDrift24h: sameHourNextDay ? +(sameHourNextDay.meanT - first.meanT).toFixed(1) : null,
    tMax: +Math.max(...rows.map(r => r.tMax)).toFixed(0), tdMax: +Math.max(...rows.map(r => r.tdMax)).toFixed(0),
    peakCape: Math.round(peak.capeMax), peakHour: peak.hour, peakStp: +Math.max(...rows.map(r => r.stpMax)).toFixed(1),
    peakSrh: Math.round(Math.max(...rows.map(r => r.srhMax))), peakShearKt: Math.round(Math.max(...rows.map(r => r.shearMax))),
    warmSectorMeanCape: Math.round(Math.max(...rows.map(r => r.warmCapeMean))),
    slpRange: [Math.round(Math.min(...rows.map(r => r.slpMin))), Math.round(Math.max(...rows.map(r => r.slpMax)))],
    maxSuperadiabaticFrac: +Math.max(...rows.map(r => r.superadiabatic)).toFixed(2),
    maxInversionFrac: +Math.max(...rows.map(r => r.inversion)).toFixed(2),
    stuckT850: rows.reduce((a, b) => (b.stuckT850.share > a.share ? b.stuckT850 : a), { share: 0 }),
    storms: stormIds.size, tornadoes: tornadoes.size, modes,
    supercellEnvMismatchFrac: stormSamples ? +(mismatched / stormSamples).toFixed(2) : 0,
    outsideDomainFrac: stormSamples ? +(outside / stormSamples).toFixed(2) : 0,
    stormsByHour: rows.map(r => `${r.hour % 24}Z:${r.storms}`).join(' ')
  };
  console.log(JSON.stringify(summary));
  for (const [k, v] of Object.entries(summary)) if (typeof v === 'number') note(k, v);
  note('stuckT850Share', summary.stuckT850.share);
}

console.log('\nAggregate (min / median / max):');
for (const [k, values] of Object.entries(aggregate)) {
  const s = [...values].sort((a, b) => a - b);
  console.log(`${k.padEnd(28)} ${s[0]} / ${s[Math.floor(s.length / 2)]} / ${s.at(-1)}`);
}
