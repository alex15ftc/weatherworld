// Cheap-run prototype: one control atmosphere; each cheap run is only a storm layer (its own storms
// and dice) moved through the control's air each step. A: the control has its own storms (cheap runs
// feel its outflow). B: the control has none.  node cheap-job.mjs <A|B> <seed> <count>
import fs from 'node:fs';
import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../../js/world/AtmosphereWorld.js';
import { advanceStormEngine } from '../../js/storms/StormEngine.js';
import { captureTruth } from '../../js/verification/truth.js';
avoidBackgroundThrottling();
const [variant, seedArg, countArg] = process.argv.slice(2), seed = Number(seedArg), count = Number(countArg), HOURS = 20;
const built = new AtmosphereWorld({ seed }); built.advance(4);
const state = built.saveState();
const KEYS = ['storms', 'stormEngine', 'stormArchive', 'stormHistory', 'evolution'];
const tSetup = performance.now();
const ctl = AtmosphereWorld.restore(structuredClone(state)), world = ctl.world;
world.withoutStormPictures = true; ctl.model.fastTransforms = true;
const withSeed = (w, s) => ({ ...(w.evolution ?? {}), config: { ...(w.evolution?.config ?? {}), seed: s } });
world.evolution = withSeed(world, `${seed}|ctl`);
if (variant === 'B') { ctl.stormsEnabled = false; for (const s of world.storms) s.active = false; }
// each cheap run's storm layer, from its own copy of the start (only the storms are kept)
const runs = Array.from({ length: count }, (_, m) => {
  const w = AtmosphereWorld.restore(structuredClone(state)).world;
  return { m, layer: { storms: w.storms, stormEngine: w.stormEngine, stormArchive: w.stormArchive, stormHistory: w.stormHistory, evolution: withSeed(w, `${seed}|cheap|${m}`) }, frames: [], seen: new Set(), inits: [] };
});
const setupMs = performance.now() - tSetup;
let ctlMs = 0, cheapMs = 0;
for (let h = 0; h < HOURS - 1e-9; h += 0.5) {
  let t = performance.now(); ctl.advance(0.5); ctlMs += performance.now() - t;
  t = performance.now();
  const own = Object.fromEntries(KEYS.map(k => [k, world[k]]));
  for (const r of runs) {
    Object.assign(world, r.layer);
    advanceStormEngine(world, 0.5, { applyFeedback: false });
    captureTruth(world, r.frames, r.seen, r.inits, null);
    for (const k of KEYS) r.layer[k] = world[k];
  }
  Object.assign(world, own);
  cheapMs += performance.now() - t;
}
const n = world.width * world.height, pack = g => Array.from(g, v => (v ? 1 : 0)).join('');
const out = { kind: `cheap${variant}`, seed, width: world.width, height: world.height, setupMs, ctlMs, cheapMsEach: cheapMs / count, members: runs.map(r => {
  const g = { tornado: new Uint8Array(n), tornadoSig: new Uint8Array(n), severe: new Uint8Array(n) };
  for (const f of r.frames) for (let i = 0; i < n; i++) { if (f.tornado[i]) g.tornado[i] = 1; if (f.tornadoSig[i]) g.tornadoSig[i] = 1; if (f.tornado[i] || f.hail[i] || f.wind[i]) g.severe[i] = 1; }
  return { member: r.m, tornado: pack(g.tornado), tornadoSig: pack(g.tornadoSig), severe: pack(g.severe) };
}) };
fs.mkdirSync('tmp/ens/cheap', { recursive: true });
fs.writeFileSync(`tmp/ens/cheap/cheap${variant}-${seed}.json`, JSON.stringify(out));
console.log(`${variant} seed ${seed}: control ${(ctlMs / 1000).toFixed(1)} s, each cheap run ${(cheapMs / count / 1000).toFixed(2)} s, setup ${(setupMs / 1000).toFixed(1)} s`);
