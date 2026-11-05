// Speed of the WebAssembly cloud model (js/cloudmodel), with the same checksum and nest lines as
// tools/cloudlab/worker/bench.luau, so the port can be checked against the Luau.
//   node tools/cloudlab/native/bench.mjs [scenario] [model minutes] [nest 0/1] [nest start min] [time from min]
import { readFileSync } from 'node:fs';
import { avoidBackgroundThrottling } from '../../../js/runtime/processPriority.node.js';
import { EngineRun, ENGINE_RUN, readScenarioText } from '../../../js/cloudmodel/EngineRun.js';
import { nestDiag } from '../../../js/cloudmodel/CloudModel.js';

avoidBackgroundThrottling();
const a = process.argv.slice(2);
const name = a[0] ?? 'SupercellB', minutes = Number(a[1] ?? 10), nest = a[2] === '1';
ENGINE_RUN.NEST_START = Number(a[3] ?? 30) * 60;
const run = EngineRun.fromScenario(readScenarioText(readFileSync(`roblox/src/stormlab/data/${name}.luau`, 'utf8')), { nest });
const m = run.model;
while (m.time < Number(a[4] ?? 0) * 60) run.replayStep();
const t0 = performance.now(), tstart = m.time;
let steps = 0;
while (m.time < minutes * 60) { run.replayStep(); steps++; }
const el = (performance.now() - t0) / 1000;
function sum(x) {
  let s = 0, z = 0;
  for (const f of ['u', 'v', 'w', 'th', 'qv', 'qc', 'qr', 'qh', 'qsn', 'p']) {
    const t = x.f(f);
    for (let i = 1; i <= x.N; i++) { s += t[i] * (1 + (i % 7)); if (f === 'qr' && t[i] === 0) z++; }
  }
  return [s, z / x.N];
}
const [s, z] = sum(m);
console.log(`${name} ${minutes} min, nest ${nest}: ${steps} steps in ${el.toFixed(1)} s -> ${((minutes * 60 - tstart) / el).toFixed(1)}x real time (${(1000 * el / steps).toFixed(0)} ms/step)`);
console.log(`box checksum ${s.toExponential(10)}, qr exactly zero in ${(100 * z).toFixed(0)}% of cells`);
if (run.nest) {
  const [s2, z2] = sum(run.nest);
  console.log(`nest checksum ${s2.toExponential(10)}, qr zero ${(100 * z2).toFixed(0)}%`);
  const d = nestDiag(run.nest);
  console.log(`nest: zeta ${d.zeta.toFixed(4)} /s, pressure drop ${d.pdrop.toFixed(0)} Pa, wind ${d.vmax.toFixed(1)} m/s, cloud base ${d.cloudBase.toFixed(0)} m; box UH ${m.uhMax.toFixed(0)}`);
}
