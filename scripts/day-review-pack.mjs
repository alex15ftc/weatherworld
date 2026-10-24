// A day package for a meteorologist's review: as each convective day (12Z to 12Z) finishes,
// the charts and numbers a forecaster would look at to name the setup and find real-world
// analog days. Unlike the game's map, it shows the whole large-scale model (the 10,000 x 5,000 km
// channel the 500-mile region sits in), so troughs, ridges, jets and lows upstream and
// downstream of the region can be seen, not only what crosses the region.
//   node scripts/day-review-pack.mjs [--seeds 1000,2112] [--days 3] [--out dir] [--no-png] [--no-outlook]
// The world is stepped as the live server steps it (storms every 5 minutes, the atmosphere
// every half hour); the packages are made by server/DayReviewRecorder.js, as the live server
// makes them for its own world (data/day-reviews/live). Charts are drawn as SVG and turned into
// PNG by a headless Chrome or Edge (CHROME=path to choose one); --no-png keeps only the SVG.
// One folder per seed and day:
//   <out>/seed-<s>/day-<d>/  day.md (numbers, soundings, storms), full-HHZ.png (large-scale
//   model), region-HHZ.png (mesoanalysis), storms.png (the day's tracks and reports),
//   outlook.png and outlook.md (the Day 1 outlook issued at the day's 12Z start, made as the
//   server makes it from 8 runs; --no-outlook leaves it out)
// and <out>/README.md describing the charts.
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const DAYS = Number(flag('--days') ?? 3);
const SEEDS = String(flag('--seeds') ?? '1000').split(',').map(Number).filter(Number.isFinite);
const OUT = path.resolve(flag('--out') ?? 'data/day-reviews');
const PNG = !args.includes('--no-png'), OUTLOOKS = !args.includes('--no-outlook');

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function main() {
  const started = Date.now();
  await Promise.all(SEEDS.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [...args, '--worker', String(seed)], { stdio: 'inherit' });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`seed ${seed} failed (${code})`))));
  })));
  console.log(`day packages for seeds ${SEEDS.join(', ')} (${DAYS} days each) in ${OUT}, ${Math.round((Date.now() - started) / 1000)} s`);
}

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { logStormTick } = await import('../js/reports/stormLog.js');
  const { placesFor } = await import('../server/CountyLayer.js');
  const { createDayRecorder } = await import('../server/DayReviewRecorder.js');
  const { OUTLOOK, runOutlookMemberDays, combineOutlook, stateFromBytes } = await import('../js/forecast/DayOneOutlook.js');

  const engine = new AtmosphereWorld({ seed }), world = engine.world, places = placesFor(world);
  // The Day 1 outlook issued as the day starts: the server's runs from a copy of the world.
  const outlookFor = OUTLOOKS ? (from, to) => {
    const bytes = v8.serialize(engine.saveState({ forecast: true }));
    const runs = Array.from({ length: OUTLOOK.members }, (_, m) => runOutlookMemberDays(stateFromBytes(bytes), m, to - from, { placesFor })[0]);
    return combineOutlook(runs, { day: 'day1', issuedHourUtc: from, validFromHourUtc: from, validToHourUtc: to, seed });
  } : null;
  const recorder = createDayRecorder({ engine, seed, outDir: OUT, places, outlookFor, png: PNG });
  engine.onStormTick = () => { logStormTick(world, places); recorder.stormTick(); };
  const stormTicksTo = hourUtc => {
    for (let guard = 0; guard < 64; guard++) {
      const left = hourUtc - (world.stormEngine?.validHourUtc ?? world.validHourUtc);
      if (left <= 1e-3) { if (left > 0 && world.stormEngine) world.stormEngine.validHourUtc = hourUtc; return; }
      engine.advanceStormLayer(Math.min(1 / 12, left));
    }
  };
  for (let step = 1; step <= DAYS * 48; step++) {
    stormTicksTo(world.validHourUtc + 0.5);
    engine.advance(0.5, { advanceStorms: false });
    recorder.afterStep();
  }
  await recorder.flush();
  console.log(`seed ${seed}: ${DAYS} days packaged`);
}
