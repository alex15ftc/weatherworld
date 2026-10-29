// How accurate is one forecast run, by lead hour? Truth = the live world stepped as the server
// steps it (storms in 5-min ticks, then the atmosphere), with the live world's own dice.
// Variants (HRRR-style runs step the same way; the outlook member steps storms every 30 min):
//   shared3     live dice for the first 3 h, then its own; no forecast errors
//   shared3+err the same with the forecast errors of today's members (member 0's)
//   own         its own dice from the start; no errors
//   own+err     its own dice, with errors
//   outlook     today's outlook member (30-min storm steps, own dice, errors)
import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../../js/world/AtmosphereWorld.js';
import { captureTruth } from '../../js/verification/truth.js';
import { timingErrorMs, perturbUpstream, perturbMesoscale, mesoscaleShare } from '../../js/forecast/ensemblePerturbation.js';
avoidBackgroundThrottling();
const seed = Number(process.argv[2] ?? 1000), HOURS = 18, SHARE_HOURS = 3, R = 2;
const BINS = [[0, 1], [1, 3], [3, 6], [6, 12], [12, 18]];
const built = new AtmosphereWorld({ seed }); built.advance(4); // 16Z
const state = built.saveState();
const liveSeed = built.world.evolution?.config?.seed;

function run({ forecast, dice, errors, serverSteps }) {
  const atm = AtmosphereWorld.restore(structuredClone(state)), world = atm.world;
  const own = `${seed}|hrrr-check`;
  const setDice = d => { world.evolution = { ...(world.evolution ?? {}), config: { ...(world.evolution?.config ?? {}), seed: d } }; };
  setDice(dice === 'own' ? own : liveSeed);
  if (forecast) { world.withoutStormPictures = true; atm.model.fastTransforms = true; }
  if (errors) {
    const key = `${seed}|${world.validHourUtc}|0`, regional = atm.regional;
    regional.timingErrorMs = timingErrorMs(key);
    perturbUpstream(atm.model, key, regional.origin.x + regional.nx * regional.dx / 2);
    perturbMesoscale(atm, `${seed}|${world.validHourUtc}|pair0`, mesoscaleShare(world.validHourUtc), undefined, 1);
  }
  const frames = [], seen = new Set(), inits = [], start = world.validHourUtc;
  for (let h = 0; h < HOURS - 1e-9; h += 0.5) {
    if (dice === 'shared3' && h >= SHARE_HOURS - 1e-9) setDice(own);
    if (serverSteps) { for (let k = 0; k < 6; k++) atm.advanceStormLayer(1 / 12); atm.advance(0.5, { advanceStorms: false }); }
    else atm.advance(0.5);
    captureTruth(world, frames, seen, inits, null);
  }
  const n = world.width * world.height;
  const grids = BINS.map(([a, b]) => {
    const g = { severe: new Uint8Array(n), tornado: new Uint8Array(n), storm: new Uint8Array(n) };
    for (const f of frames) { const lead = f.hourUtc - start; if (lead <= a || lead > b + 1e-9) continue;
      for (let i = 0; i < n; i++) { if (f.hail[i] || f.wind[i] || f.tornado[i]) g.severe[i] = 1; if (f.tornado[i]) g.tornado[i] = 1; if (f.storm[i]) g.storm[i] = 1; } }
    return g;
  });
  return { grids, width: world.width, height: world.height, tornadoes: new Set(frames.flatMap(f => (f.tornadoTrackPoints ?? []).map(p => p.tornado))).size };
}
const near = (a, b, W, H) => { let n = 0, hit = 0;
  for (let i = 0; i < a.length; i++) { if (!a[i]) continue; n++; const x = i % W, y = (i / W) | 0; let ok = false;
    for (let dy = -R; dy <= R && !ok; dy++) for (let dx = -R; dx <= R && !ok; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && b[yy * W + xx]) ok = true; } if (ok) hit++; }
  return [hit, n]; };
const t0 = performance.now();
const truth = run({ forecast: false, dice: 'live', errors: false, serverSteps: true });
const variants = {
  'shared3': { forecast: true, dice: 'shared3', errors: false, serverSteps: true },
  'shared3+err': { forecast: true, dice: 'shared3', errors: true, serverSteps: true },
  'own': { forecast: true, dice: 'own', errors: false, serverSteps: true },
  'own+err': { forecast: true, dice: 'own', errors: true, serverSteps: true },
  'outlook': { forecast: true, dice: 'own', errors: true, serverSteps: false },
};
const out = { seed, truthTornadoes: truth.tornadoes, variants: {} };
for (const [name, v] of Object.entries(variants)) {
  const t = performance.now(), r = run(v), ms = performance.now() - t;
  out.variants[name] = { ms, tornadoes: r.tornadoes, bins: BINS.map((bin, k) => Object.fromEntries(['severe', 'tornado', 'storm'].map(field => {
    const [found, truthN] = near(truth.grids[k][field], r.grids[k][field], r.width, r.height);
    const [good, runN] = near(r.grids[k][field], truth.grids[k][field], r.width, r.height);
    return [field, { found, truthN, good, runN }];
  }))) };
}
out.totalMs = performance.now() - t0;
console.log(JSON.stringify(out));
