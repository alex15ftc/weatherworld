// How often each look turns up (js/storms/StormAppearance.js): tornado shapes, vortex counts and
// how far funnels reach down, the supercell spectrum and the cloud features, over the time
// storms spend in each. Each seed's world runs in its own process, stepped as the live server
// steps it (storms every 5 minutes, the atmosphere every half hour).
//   node scripts/appearance-report.mjs [days] [--seeds 1,2,3,4]
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 3);
const TICK_HOURS = 1 / 12;

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { buildStormAppearance } = await import('../js/storms/StormAppearance.js');
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world;
  const ticks = { shape: {}, vortices: {}, condensed: { full: 0, partial: 0, uncondensed: 0 }, wrapped: 0, tornado: 0, supercell: {}, mode: {}, shelf: 0, tail: 0, bands: 0, clearSlot: 0, storm: 0 };
  const peaks = new Map();
  const add = (table, key) => { table[key] = (table[key] ?? 0) + 1; };
  for (let tick = 0; tick < days * 24 / TICK_HOURS; tick++) {
    atmosphere.advanceStormLayer(TICK_HOURS);
    if ((tick + 1) % Math.round(0.5 / TICK_HOURS) === 0) atmosphere.advance(0.5, { advanceStorms: false });
    for (const storm of world.storms ?? []) {
      if (storm.active === false) continue;
      const a = buildStormAppearance(storm);
      if (!a) continue;
      ticks.storm++; add(ticks.mode, a.mode);
      if (a.supercellType) add(ticks.supercell, a.supercellType);
      if (a.shelf.strength > 0.3) ticks.shelf++;
      if (a.wallCloud.tail > 0.3) ticks.tail++;
      if (a.inflowBands.count > 0) ticks.bands++;
      if (a.rearFlank.clearSlot > 0.3) ticks.clearSlot++;
      const t = a.tornado;
      if (!t) continue;
      ticks.tornado++; add(ticks.shape, t.shape); add(ticks.vortices, t.vortices);
      ticks.condensed[t.condensedShare >= 0.95 ? 'full' : t.condensedShare >= 0.35 ? 'partial' : 'uncondensed']++;
      if (t.rainWrap >= 0.55) ticks.wrapped++;
      const peak = peaks.get(t.id) ?? { windMph: 0, shapes: {}, maxVortices: 1, ef: null };
      peak.windMph = Math.max(peak.windMph, t.windMph); add(peak.shapes, t.shape); peak.maxVortices = Math.max(peak.maxVortices, t.vortices); peak.ef = t.ef;
      peaks.set(t.id, peak);
    }
  }
  process.send({ seed, ticks, tornadoes: [...peaks.values()] });
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3,4').split(',').map(Number);
  const started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed)]);
    child.on('message', resolve); child.on('error', reject);
    child.on('exit', code => code && reject(new Error(`seed ${seed} exited ${code}`)));
  })));
  const sum = key => { const out = {}; for (const r of results) for (const [k, v] of Object.entries(r.ticks[key])) out[k] = (out[k] ?? 0) + v; return out; };
  const total = key => results.reduce((a, r) => a + r.ticks[key], 0);
  const share = (table, n) => Object.entries(table).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(100 * v / Math.max(1, n))}%`).join(', ');
  const tornadoTicks = total('tornado'), stormTicks = total('storm');
  const all = results.flatMap(r => r.tornadoes);
  console.log(`${seeds.length} seeds x ${days} days in ${Math.round((Date.now() - started) / 1000)} s: ${all.length} tornadoes, ${tornadoTicks} tornado ticks, ${stormTicks} storm ticks`);
  console.log(`\ntornado time by shape: ${share(sum('shape'), tornadoTicks)}`);
  console.log(`tornado time by vortex count: ${share(sum('vortices'), tornadoTicks)}`);
  console.log(`funnel reaches the ground: ${share(sum('condensed'), tornadoTicks)}`);
  console.log(`rain-wrapped: ${Math.round(100 * total('wrapped') / Math.max(1, tornadoTicks))}% of tornado time`);
  const bands = [[0, 86], [86, 111], [111, 136], [136, 999]];
  for (const [lo, hi] of bands) {
    const set = all.filter(t => t.windMph >= lo && t.windMph < hi), shapes = {};
    for (const t of set) { const top = Object.entries(t.shapes).sort((a, b) => b[1] - a[1])[0][0]; shapes[top] = (shapes[top] ?? 0) + 1; }
    console.log(`  peak ${lo}-${hi === 999 ? '' : hi} mph (${set.length}): mostly ${share(shapes, set.length)}; multi-vortex at some point ${Math.round(100 * set.filter(t => t.maxVortices > 1).length / Math.max(1, set.length))}%`);
  }
  console.log(`\nsupercell time by type: ${share(sum('supercell'), Object.values(sum('supercell')).reduce((a, b) => a + b, 0))}`);
  console.log(`storm time by mode: ${share(sum('mode'), stormTicks)}`);
  console.log(`storm time with a shelf cloud ${Math.round(100 * total('shelf') / stormTicks)}%, tail cloud ${Math.round(100 * total('tail') / stormTicks)}%, inflow bands ${Math.round(100 * total('bands') / stormTicks)}%, clear slot ${Math.round(100 * total('clearSlot') / stormTicks)}%`);
}
