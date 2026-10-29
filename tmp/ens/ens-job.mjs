// One job of the ensemble-size test. Day from 16Z to 12Z (20 h).
//   node ens-job.mjs truth <seed>                 the live world (server stepping, live dice)
//   node ens-job.mjs <full|dice> <seed> <from> <count>   outlook members (full: today's errors; dice: no errors)
import fs from 'node:fs';
import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../../js/world/AtmosphereWorld.js';
import { captureTruth } from '../../js/verification/truth.js';
import { runOutlookMemberDays } from '../../js/forecast/DayOneOutlook.js';
avoidBackgroundThrottling();
const [kind, seedArg, fromArg, countArg] = process.argv.slice(2), seed = Number(seedArg), HOURS = 20;
const built = new AtmosphereWorld({ seed }); built.advance(4);
const state = built.saveState();
const pack = g => Array.from(g, v => (v ? 1 : 0)).join('');
const out = { kind, seed, width: built.world.width, height: built.world.height, members: [] };
if (kind === 'truth') {
  const atm = AtmosphereWorld.restore(structuredClone(state)), world = atm.world, frames = [];
  const n = world.width * world.height, g = { tornado: new Uint8Array(n), tornadoSig: new Uint8Array(n), severe: new Uint8Array(n) };
  for (let h = 0; h < HOURS - 1e-9; h += 0.5) {
    for (let k = 0; k < 6; k++) atm.advanceStormLayer(1 / 12);
    atm.advance(0.5, { advanceStorms: false });
    const f = captureTruth(world, frames, new Set(), [], null);
    for (let i = 0; i < n; i++) { if (f.tornado[i]) g.tornado[i] = 1; if (f.tornadoSig[i]) g.tornadoSig[i] = 1; if (f.tornado[i] || f.hail[i] || f.wind[i]) g.severe[i] = 1; }
  }
  out.members.push({ tornado: pack(g.tornado), tornadoSig: pack(g.tornadoSig), severe: pack(g.severe) });
} else {
  const none = { timingSpreadMs: 0, upstreamShare: 0, mesoscale: 0 };
  for (let m = Number(fromArg); m < Number(fromArg) + Number(countArg); m++) {
    const t = performance.now();
    const day = runOutlookMemberDays(structuredClone(state), kind === 'dice' ? 1000 + m : m, HOURS, kind === 'dice' ? none : {})[0];
    out.members.push({ member: m, ms: performance.now() - t, tornado: pack(day.reports.tornado), tornadoSig: pack(day.reports.tornadoSig), severe: pack(day.reports.severe) });
  }
}
fs.writeFileSync(`tmp/ens/size/${kind}-${seed}-${fromArg ?? 0}.json`, JSON.stringify(out));
