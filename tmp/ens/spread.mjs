// Where does run-to-run spread come from? Truth = an unperturbed run with its own storm dice.
// "dice": unperturbed runs, other storm dice. "perturbed": today's members (dice + errors).
import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../../js/world/AtmosphereWorld.js';
import { runOutlookMemberDays } from '../../js/forecast/DayOneOutlook.js';
avoidBackgroundThrottling();
const seed = Number(process.argv[2] ?? 1000), hours = 12;
const w = new AtmosphereWorld({ seed }); w.advance(4); // 16Z
const state = w.saveState();
const none = { timingSpreadMs: 0, upstreamShare: 0, mesoscale: 0 };
const run = (member, opts) => runOutlookMemberDays(structuredClone(state), member, hours, opts)[0];
const truth = run(100, none);
const W = truth.width, H = truth.height, R = 2; // within 2 cells (~32 km / 20 mi)
const near = (a, b) => { // share of a's report cells with a b report within R
  let n = 0, hit = 0;
  for (let i = 0; i < W * H; i++) { if (!a[i]) continue; n++; const x = i % W, y = (i / W) | 0; let ok = false;
    for (let dy = -R; dy <= R && !ok; dy++) for (let dx = -R; dx <= R && !ok; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && b[yy * W + xx]) ok = true; } if (ok) hit++; }
  return n ? hit / n : NaN; };
const sum = a => a.reduce((s, v) => s + (v ? 1 : 0), 0);
const show = (label, m) => {
  const pod = near(truth.reports.severe, m.reports.severe), sr = near(m.reports.severe, truth.reports.severe);
  const tp = near(truth.reports.tornado, m.reports.tornado);
  console.log(`${label.padEnd(12)} severe cells ${String(sum(m.reports.severe)).padStart(3)}  truth found ${(100*pod).toFixed(0)}%  run's reports near truth ${(100*sr).toFixed(0)}%  tornado cells ${sum(m.reports.tornado)} (truth's found ${(100*tp).toFixed(0)}%)  tornadoes ${m.tornadoes}  day ${m.dayCategory}`);
};
console.log(`seed ${seed}, 16Z + ${hours} h; truth: severe cells ${sum(truth.reports.severe)}, tornado cells ${sum(truth.reports.tornado)}, tornadoes ${truth.tornadoes}, day ${truth.dayCategory}`);
for (let m = 0; m < 4; m++) show(`dice ${m}`, run(m, none));
for (let m = 0; m < 4; m++) show(`perturbed ${m}`, run(m, {}));
