// How often tornado emergencies go out (Warning.js), and how that changes with the population a
// town on a violent tornado's track needs to count as a population center.
//   node scripts/emergency-report.mjs [days] [--seeds 1,2,3] [--floors 0,500,1000,5000]
// Each seed's world is run in its own process with warnings at every 5-minute scan on the
// world map's counties (WORLD_MAP_SEED). Every town each violent tornado threatened is kept with
// its population, so one run answers every floor: the floor only decides which towns count, and
// nothing else in a warning's life depends on it.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 10);
const SCAN_HOURS = 1 / 12;

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { createWarningState, updateWarnings, WARNING } = await import('../js/forecast/Warning.js');
  const { countiesFor } = await import('../server/CountyLayer.js');
  const { radarSitesFor } = await import('../server/RadarSites.js');
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world;
  const state = createWarningState(countiesFor(world)), sites = radarSitesFor(world);
  // Each tornado (storm and touchdown hour): its peak wind once confirmed, and the largest town
  // a warning had on its track while it was violent.
  const tornadoes = new Map();
  let tornadoWarnings = 0;
  for (let scan = 0; scan < days * 24 / SCAN_HOURS; scan++) {
    // As the live server steps: the storms every scan, the atmosphere every half hour behind
    // them (advance() alone always takes a whole half-hour step).
    atmosphere.advanceStormLayer(SCAN_HOURS);
    if ((scan + 1) % Math.round(0.5 / SCAN_HOURS) === 0) atmosphere.advance(0.5, { advanceStorms: false });
    const hour = world.stormEngine?.validHourUtc ?? world.validHourUtc;
    const out = updateWarnings(state, world, sites);
    tornadoWarnings += out.issued.filter(w => w.type === 'tornado').length;
    for (const storm of world.storms ?? []) {
      const t = storm.tornado;
      if (!storm.active || !t?.onGround || t.groundTimeMinutes < WARNING.confirmMinutes) continue;
      const key = `${storm.id}|${t.startedHourUtc}`, rec = tornadoes.get(key) ?? { peakMph: 0, topPopulation: -1, towns: new Set() };
      rec.peakMph = Math.max(rec.peakMph, t.windSpeedMph);
      for (const w of state.warnings) {
        if (w.type !== 'tornado' || w.status !== 'in effect' || w.stormId !== storm.id) continue;
        const last = w.history.at(-1);
        if (!last || Math.abs(last.hourUtc - hour) > 1e-6) continue;
        for (const town of last.threatened ?? []) { rec.topPopulation = Math.max(rec.topPopulation, town.population); rec.towns.add(`${town.name} (${town.population})`); }
      }
      tornadoes.set(key, rec);
    }
  }
  process.send({ seed, days, tornadoWarnings, tornadoes: [...tornadoes.values()].map(r => ({ peakMph: r.peakMph, topPopulation: r.topPopulation, towns: [...r.towns] })) });
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3,4,5,6,7,8').split(',').map(Number);
  const floors = (flag('--floors') ?? '0,500,1000,5000').split(',').map(Number);
  const started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed)]);
    child.on('message', resolve); child.on('error', reject);
    child.on('exit', code => code && reject(new Error(`seed ${seed} exited ${code}`)));
  })));
  const all = results.flatMap(r => r.tornadoes), worldDays = seeds.length * days;
  const violent = all.filter(t => t.peakMph >= 136), threatened = violent.filter(t => t.topPopulation >= 0);
  console.log(`${seeds.length} seeds x ${days} days (${worldDays} world days) in ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(`tornado warnings issued: ${results.reduce((a, r) => a + r.tornadoWarnings, 0)}; confirmed tornadoes: ${all.length}; violent (EF3+, 136 mph): ${violent.length}; violent with a town on the track: ${threatened.length}`);
  for (const floor of floors) {
    const hits = violent.filter(t => t.topPopulation >= floor);
    console.log(`floor ${String(floor).padStart(5)}: ${String(hits.length).padStart(3)} tornado emergencies, ${(hits.length / worldDays).toFixed(2)} a world day, ${violent.length ? Math.round(100 * hits.length / violent.length) : 0}% of EF3+ tornadoes`);
  }
  console.log('\nviolent tornadoes and the towns on their tracks:');
  for (const t of threatened) console.log(`  ${Math.round(t.peakMph)} mph: ${t.towns.join(', ')}`);
}
