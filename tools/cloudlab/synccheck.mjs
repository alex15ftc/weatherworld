// Engine against model over storms' lives: are the cloud model's storms doing what the engine says
// its storms are doing? Young storms of a seed's world each get a model (with its nest, the engine's
// record every storm tick, as the workers do: js/game/StormWorkers.js) for up to HOURS game hours.
// Every 10 model minutes it logs both sides:
//   strength    engine intensity (0-1)          model peak updraft at 5 km (m/s)
//   updraft     engine updraughtMs (m/s)        model peak updraft anywhere (m/s)
//   rain        engine max reflectivity (dBZ)   model peak ground rain (mm/h)
//   hail        engine hail size (in)           model peak ground hail (mm/h liquid)
//   stone       engine hail size (in)           model biggest stone at the ground (in, EngineRun.hailSize)
//   rotation    engine mesocyclone (0-1)        model peak 1 km vertical vorticity (1/s)
//   low spin    engine low-level rotation (0-1) model peak nest 50 m vorticity (1/s, once the nest runs)
//   cold pool   engine deficit (K)              model mean ground deficit (K, cells over 1 K)
// and where the low-level mesocyclone sits from the updraught (km east, north): the engine's wall
// cloud from its updraught (js/storms/StormGeometry.js), the model's strongest 0-1 km spin in its
// 250 m nest from the box's follow point (drawn at the engine's updraught: StormWorkers drawnAt)
// and at the end, for each pair, how closely they move together (Pearson r over the storm's life)
// and the model's share of the engine's: whether strength rising and falling in the engine shows in
// the model. One process a storm, in parallel.
//   node tools/cloudlab/synccheck.mjs [seed=2] [storms=3] [hours=3]
//   SYNC_LIFT=8 node tools/cloudlab/synccheck.mjs ...   (the old pull lift, to compare)
//   SYNC_M2=0 ...  (without the engine's maintenance lift, js/storms/StormMaintenance.js: the record
//                   as before M2, and the push up to PUSH_MAX)
//   node tools/cloudlab/synccheck.mjs one <seed> <stormId> <hours>     (one storm; used by the above)
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WeatherAuthorityRuntime } from '../../server/WeatherAuthorityRuntime.js';
import { workerRecord } from '../../js/game/StormWorkers.js';
import { EngineRun, ENGINE_RUN, columnSpin, pinPoint } from '../../js/cloudmodel/EngineRun.js';
import { drawnAt } from '../../js/game/StormWorkers.js';
import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';
import { maintenanceLift } from '../../js/storms/StormMaintenance.js';
import { buildSounding } from '../../js/sounding.js';

avoidBackgroundThrottling();
// tuning: SYNC_PUSH_MAX (m/s^2), SYNC_PUSH_TAU (s), SYNC_LIFT_R (m)
if (process.env.SYNC_PUSH_MAX) ENGINE_RUN.PUSH_MAX = ENGINE_RUN.PUSH_MAX_M2 = Number(process.env.SYNC_PUSH_MAX);
if (process.env.SYNC_PUSH_TAU) ENGINE_RUN.PUSH_TAU = Number(process.env.SYNC_PUSH_TAU);
const PAIRS = [
  ['strength', 'intensity', 'w5'],
  ['updraft', 'updraftMs', 'wmax'],
  ['rain', 'dbz', 'rain'],
  ['hail', 'hailIn', 'hail'],
  ['stone', 'hailIn', 'hailSize'],
  ['rotation', 'meso', 'zeta1'],
  ['low spin', 'lowRot', 'zetaNest'],
  ['cold pool', 'coldK', 'coldMean'],
];

function world(seed) {
  const rt = new WeatherAuthorityRuntime({ seed, spinUpDays: 6 });
  rt.saveState = () => {};
  return rt;
}
const young = rt => (rt.atmosphere.storms ?? []).filter(s => s.active !== false && (s.ageHours ?? 9) < 0.75);

async function one(seed, id, hours) {
  const rt = world(seed), w = rt.atmosphere;
  for (let i = 0; i < 48 && !young(rt).some(s => String(s.id) === id); i++) rt.advance(0.5);
  const storm = young(rt).find(s => String(s.id) === id);
  if (!storm) return { id, error: 'no such young storm' };
  const hour = () => w.stormEngine?.validHourUtc ?? w.validHourUtc;
  const M2 = process.env.SYNC_M2 !== '0';
  const rec = s => { const r = workerRecord(w, s, hour()); if (M2) { const mt = maintenanceLift(w, s); r.m2 = { cin: mt.cinJkg, L: mt.liftJkg, D: mt.deficitJkg, conv: r.maintenance }; } else delete r.maintenance; return r; };
  const run = new EngineRun(rec(storm), { nest: true, pushR: process.env.SYNC_LIFT_R ? Number(process.env.SYNC_LIFT_R) : undefined, lift: process.env.SYNC_LIFT ? Number(process.env.SYNC_LIFT) : undefined });
  const m = run.model, k5 = m.levelAt(5000), k1 = m.levelAt(1000);
  const rows = [];
  for (let tick = 1; tick <= hours * 12; tick++) {
    rt.engine.advanceStormLayer(1 / 12);
    const s = w.storms.find(x => x.id === storm.id);
    const alive = s && s.active !== false;
    const r = alive ? rec(s) : null;
    run.update(r);
    while (m.time < tick * 300) run.step();
    if (tick % 2) continue;
    const wf = m.f('w'), rain = m.f('rainSfc'), hail = m.f('hailSfc');
    let w5 = 0, wmax = 0, rmax = 0, hmax = 0, z1 = 0;
    for (let j = 1; j <= m.ny; j++) for (let i = 1; i <= m.nx; i++) {
      w5 = Math.max(w5, wf[m.idx(i, j, k5)]);
      for (let k = 1; k <= m.nz; k++) wmax = Math.max(wmax, wf[m.idx(i, j, k)]);
      const cs = (j + 1) * m.SX + i + 2;
      rmax = Math.max(rmax, rain[cs]); hmax = Math.max(hmax, hail[cs]);
      z1 = Math.max(z1, m.zeta(i, j, k1));
    }
    // the low-level mesocyclone from the updraught (km east, north)
    const g = alive ? s.geometry : null;
    const eOff = g?.wallCloud && g?.updraught ? [g.wallCloud.xKm - g.updraught.xKm, -(g.wallCloud.yKm - g.updraught.yKm)] : null;
    let mOff = null;
    if (run.nest) {
      const n = run.nest, c = columnSpin(n);
      if (c.i > 0 && c.zeta > 0.005) mOff = [((n.get('i0') - 1) * m.dx + (c.i - 0.5) * n.dx - (Math.floor(0.5 * m.nx) - 0.5) * m.dx) / 1000, ((n.get('j0') - 1) * m.dx + (c.j - 0.5) * n.dx - (Math.floor(0.45 * m.ny) - 0.5) * m.dx) / 1000];
    }
    // the pinned point (the model's tornado, else meso) from the engine's (its tornado, else wall
    // cloud), km: drawn at the updraught (the pin that moved it is gone since 2026-11-06, so both are that)
    let miss = null;
    if (alive && g?.updraught) {
      const pin = pinPoint(run), to = g.tornado ?? g.wallCloud;
      const at = drawnAt(s), pos = at;
      if (pin && to) miss = [Math.hypot(to.xKm - at[0] - pin.east, to.yKm - at[1] + pin.north), Math.hypot(to.xKm - pos[0] - pin.east, to.yKm - pos[1] + pin.north)];
    }
    let zn = null;
    if (run.nest) { zn = 0; const n = run.nest; for (let j = 1; j <= n.ny; j++) for (let i = 1; i <= n.nx; i++) zn = Math.max(zn, n.zeta(i, j, 1)); }
    rows.push({
      min: tick * 5, alive,
      intensity: alive ? s.intensity ?? 0 : 0, updraftMs: alive ? s.updraughtMs ?? 0 : 0, dbz: alive ? s.radar?.maxReflectivityDbz ?? 0 : 0,
      hailIn: alive ? s.currentHailSizeInches ?? 0 : 0, meso: alive ? s.mesocycloneStrength ?? 0 : 0, lowRot: alive ? s.lowRotation ?? 0 : 0,
      coldK: alive ? (s.coldPoolTemperatureDeficitF ?? 0) / 1.8 : 0, tornado: !!(alive && s.tornado?.onGround),
      e3: alive ? e3Offset(w, s, eOff) : null, motion: alive && s.velocityKph ? [s.velocityKph.east, s.velocityKph.north] : null,
      m2: r?.m2 ?? null, w5, wmax, rain: rmax, hail: hmax, zeta1: z1, zetaNest: zn, coldMean: run.coldMean, eOff, mOff, miss, push: run.lift === 'push' ? run.push : null, hailSize: run.hailNow == null ? null : run.hailNow / 0.0254, n0h: m.n0h,
    });
    if (!alive && rows.filter(r => !r.alive).length >= 3) break;
  }
  return { id, rows };
}

// E3 (test only, docs/research/ENGINE-MODEL-COUPLING.md): the meso's offset from the updraught if the
// lean turned from downwind toward left of the 0-6 km shear as the inflow's streamwise share
// (sin of the storm cell's critical angle: 90 degrees all streamwise, 0 or 180 all crosswise; SRH over
// |net 0-1 km shear| x |inflow| ran 1.2-2 on curved hodographs, so it can't be a share) falls. Same
// lean length as today.
function e3Offset(w, s, eOff) {
  if (!eOff) return null;
  const env = s.environment ?? {}, kt = 0.514444;
  const sfc = env.surfaceWind ?? { eastKt: 0, northKt: 0 }, w8 = env.wind850 ?? sfc, w5 = env.wind500 ?? w8;
  const cx = Math.min(w.width - 1, Math.max(0, Math.floor(s.positionKm.x / w.cellSizeKm)));
  const cy = Math.min(w.height - 1, Math.max(0, Math.floor(s.positionKm.y / w.cellSizeKm)));
  const crit = buildSounding(w.getCell(cx, cy)).params.criticalAngle;
  const share = Number.isFinite(crit) ? Math.abs(Math.sin(crit * Math.PI / 180)) : 1;
  const tilt = Math.hypot(eOff[0], eOff[1]);
  if (tilt < 1e-3) return { off: eOff, share };
  const down = [-eOff[0] / tilt, -eOff[1] / tilt]; // today's lean direction (downwind)
  const sh = [(w5.eastKt - sfc.eastKt) * kt, (w5.northKt - sfc.northKt) * kt], sl = Math.hypot(sh[0], sh[1]) || 1;
  const left = [-sh[1] / sl, sh[0] / sl];
  let d = [share * down[0] + (1 - share) * left[0], share * down[1] + (1 - share) * left[1]];
  const dl = Math.hypot(d[0], d[1]) || 1; d = [d[0] / dl, d[1] / dl];
  return { off: [-d[0] * tilt, -d[1] * tilt], share };
}

function pearson(a, b) {
  const n = a.length; if (n < 4) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let k = 0; k < n; k++) { sab += (a[k] - ma) * (b[k] - mb); saa += (a[k] - ma) ** 2; sbb += (b[k] - mb) ** 2; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

if (process.argv[2] === 'one') {
  const [, , , seed, id, hours] = process.argv;
  process.stdout.write(JSON.stringify(await one(Number(seed), id, Number(hours))));
  process.exit(0);
}

const [SEED = 2, STORMS = 3, HOURS = 3] = process.argv.slice(2).map(Number);
// the first young storms the world makes
const rt = world(SEED);
const ids = [];
for (let i = 0; i < 48 && ids.length < STORMS; i++) {
  rt.advance(0.5);
  for (const s of young(rt)) if (!ids.includes(String(s.id)) && ids.length < STORMS) ids.push(String(s.id));
}
console.log(`seed ${SEED}: storms ${ids.join(', ')}, up to ${HOURS} game hours each`);
const self = fileURLToPath(import.meta.url);
const results = await Promise.all(ids.map(id => new Promise(done => execFile(process.execPath, [self, 'one', String(SEED), id, String(HOURS)], { maxBuffer: 1 << 24 }, (err, out) => done(err ? { id, error: String(err.message).slice(0, 200) } : JSON.parse(out))))));
const f = (v, d = 0) => v == null ? '  -' : v.toFixed(d);
for (const r of results) {
  if (r.error) { console.log(`\n${r.id}: ${r.error}`); continue; }
  console.log(`\n${r.id}  min | engine: int  updr  dBZ  hail  meso  lowRot coldK tor | model: w5  wmax  rain  hail  z1km   z50m   cold  push  stone(in) n0h | meso from updraught (km): engine / model | miss km: unpinned / pinned | M2: CIN, lift, deficit J/kg, added conv 1e-5/s`);
  const off = v => v ? `${v[0].toFixed(1)},${v[1].toFixed(1)}` : '-';
  for (const x of r.rows) console.log(`   ${String(x.min).padStart(3)} |        ${f(x.intensity, 2)} ${f(x.updraftMs).padStart(4)} ${f(x.dbz).padStart(4)} ${f(x.hailIn, 1).padStart(5)} ${f(x.meso, 2).padStart(5)} ${f(x.lowRot, 2).padStart(6)} ${f(x.coldK, 1).padStart(5)} ${x.tornado ? ' T ' : '   '} |        ${f(x.w5).padStart(3)} ${f(x.wmax).padStart(5)} ${f(x.rain).padStart(5)} ${f(x.hail).padStart(5)} ${f(x.zeta1, 3).padStart(6)} ${f(x.zetaNest, 3).padStart(6)} ${f(x.coldMean, 1).padStart(5)} ${f(x.push, 3).padStart(6)} ${f(x.hailSize, 2).padStart(6)} ${x.n0h.toExponential(1).padStart(8)} | ${off(x.eOff)} / ${off(x.mOff)} | ${x.miss ? x.miss[0].toFixed(1) + ' / ' + x.miss[1].toFixed(1) : '-'}${x.m2 ? ` | ${x.m2.cin.toFixed(0)} ${x.m2.L.toFixed(0)} ${x.m2.D.toFixed(0)} ${x.m2.conv.toFixed(1)}` : ''}`);
}
// E3: how far the model's meso is from the engine's, today and with E3 (km), and where the model's
// meso sits from its updraught in the storm's frame (km along the motion, to its right)
console.log('\nE3 (test only): model meso from the engine meso, mean km: today / with E3 | streamwise share | model meso along, right of motion (km)');
for (const r of results) {
  if (r.error) continue;
  const rows = r.rows.filter(x => x.eOff && x.mOff && x.e3);
  if (!rows.length) { console.log(`   ${r.id}: no rows with both`); continue; }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const d0 = mean(rows.map(x => Math.hypot(x.mOff[0] - x.eOff[0], x.mOff[1] - x.eOff[1])));
  const d3 = mean(rows.map(x => Math.hypot(x.mOff[0] - x.e3.off[0], x.mOff[1] - x.e3.off[1])));
  const fr = rows.filter(x => x.motion && Math.hypot(...x.motion) > 1).map(x => { const sp = Math.hypot(...x.motion), a = [x.motion[0] / sp, x.motion[1] / sp]; return [x.mOff[0] * a[0] + x.mOff[1] * a[1], x.mOff[0] * a[1] - x.mOff[1] * a[0]]; });
  console.log(`   ${r.id}: ${d0.toFixed(1)} / ${d3.toFixed(1)} (${rows.length} rows) | ${mean(rows.map(x => x.e3.share)).toFixed(2)} | ${fr.length ? mean(fr.map(p => p[0])).toFixed(1) + ', ' + mean(fr.map(p => p[1])).toFixed(1) : '-'}`);
}
console.log('\nhow closely each pair moves together over a life (r: 1 = in step, 0 = unrelated, - = too little change)');
console.log('   pair       ' + results.map(r => r.id.padStart(7)).join(''));
for (const [name, e, mo] of PAIRS) {
  const cells = results.map(r => {
    if (r.error) return '      -';
    const rows = r.rows.filter(x => x.alive && x[mo] != null);
    const v = pearson(rows.map(x => x[e]), rows.map(x => x[mo]));
    return (v == null ? '-' : v.toFixed(2)).padStart(7);
  });
  console.log(`   ${name.padEnd(10)} ${cells.join('')}`);
}
process.exit(0);
