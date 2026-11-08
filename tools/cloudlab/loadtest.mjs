// Load test of the cloud model workers (js/game/StormWorkers.js): a world advanced until it has
// at least MIN_STORMS storms, a player beside every one (so every model runs its nest, the worst
// case), and the storm ticks at the game's pace (every 37.5 s real at 8x) for SECONDS. Reports,
// every 30 s: the machine's CPU use, and for each worker its model time, how far behind the clock
// it is, its step time and whether it is warming up; and which storms got no worker (more storms
// than WORKERS). Real worker processes; nothing is saved.
//   node tools/cloudlab/loadtest.mjs [seconds=240] [workers=6] [minStorms=8] [seed=2]
import os from 'node:os';
import { WeatherAuthorityRuntime } from '../../server/WeatherAuthorityRuntime.js';
import { StormWorkers } from '../../js/game/StormWorkers.js';
import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();
const [SECONDS = 240, WORKERS = 6, MIN_STORMS = 8, SEED = 2] = process.argv.slice(2).map(Number);
const wait = ms => new Promise(r => setTimeout(r, ms));
const cpuTimes = () => os.cpus().reduce((a, c) => { const t = c.times; a.busy += t.user + t.nice + t.sys + t.irq; a.all += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, { busy: 0, all: 0 });

const runtime = new WeatherAuthorityRuntime({ seed: SEED, spinUpDays: 6 });
runtime.saveState = () => {};
const world = runtime.atmosphere;
const active = () => (world.storms ?? []).filter(s => s.active !== false);
for (let i = 0; i < 72 && active().length < MIN_STORMS; i++) runtime.advance(0.5);
console.log(`seed ${SEED}: ${active().length} storms at hour ${world.validHourUtc.toFixed(1)}; ${os.availableParallelism()} threads, ${WORKERS} workers allowed`);

const workers = new StormWorkers({ max: WORKERS, clockRate: 8 });
runtime.stormWorkers = workers;
const report = () => {
  // one fake server per storm, its player 5 km east of it
  active().forEach((s, k) => workers.reportPlayers(`load${k}`, [[s.positionKm.x + 5, s.positionKm.y]]));
};
report();
runtime.engine.advanceStormLayer(1 / 12);
const t0 = Date.now();
let nextTick = t0 + 37500, nextReport = t0 + 30000, last = cpuTimes();
const worst = { behind: 0, step: 0 };
try {
  while (Date.now() - t0 < SECONDS * 1000) {
    await wait(1000);
    report();
    if (Date.now() >= nextTick) { runtime.engine.advanceStormLayer(1 / 12); nextTick += 37500; }
    if (Date.now() >= nextReport) {
      nextReport += 30000;
      const c = cpuTimes(), cpu = 100 * (c.busy - last.busy) / Math.max(1, c.all - last.all); last = c;
      const st = workers.status();
      const shown = new Set(st.workers.map(w => String(w.id)));
      const none = active().filter(s => !shown.has(String(s.id))).length;
      console.log(`+${Math.round((Date.now() - t0) / 1000)} s  CPU ${cpu.toFixed(0)}%  workers ${st.workers.length}, storms without one ${none}`);
      for (const w of st.workers) {
        console.log(`   ${w.id}: model ${w.modelMinutes} min, behind ${(w.behindS ?? 0).toFixed(0)} s, step ${(w.stepMs ?? 0).toFixed(0)} ms${w.nest ? ', nest' : ''}${w.warming ? ', warming' : ''}${w.ended ? ', ended' : ''}, frames ${w.frames}`);
        if (!w.warming && (Date.now() - t0) > 90000) { worst.behind = Math.max(worst.behind, w.behindS ?? 0); worst.step = Math.max(worst.step, w.stepMs ?? 0); }
      }
    }
  }
  console.log(`after warm-up: worst behind ${worst.behind.toFixed(0)} model s, worst step ${worst.step.toFixed(0)} ms (the clock needs a 6 s step every ${(6000 / 8).toFixed(0)} ms)`);
} finally {
  workers.close();
}
setTimeout(() => process.exit(0), 1500);
