// Samples of the storm bundle's version 6 (js/game/StormWorkers.js frames ?v=6) for the Roblox
// reader: steps live worlds storm tick by storm tick (5 min) and, for each case below, decodes the
// bundle entry of the first storm that shows it - all the engine's own, nothing made up:
//   tornadoEF3plus, multiVortex, highDecay, funnelAloft, leftMover, mergedFromLive, splitFromLive,
//   endWarning (a tornado's last ticks, with tornadoEndInMin counting down, and the tick after),
//   remnantDied (a storm that died, its anvil left), remnantMerged (one merged into another);
//   whole tornado lives, from the tick of touchdown to the tick after it ends (each tick's scene has its life block:
//   stage, surges, occlusion, track): tornadoTimeline (the first of 8+ ticks), ef3PlusTimeline, failedOcclusionTimeline (one whose occlusion failed),
//   loopTimeline (one whose track loops), surgeTurnTimeline (one turned by a rear-flank surge mid-life).
// Engine frames are built only for the storms a case needs (a build is ~120 ms).
//   node tools/engine/storm-bundle-samples.mjs <out.json> [seed ...] [--hours H]
import fs from 'node:fs';
import { WeatherAuthorityRuntime } from '../../server/WeatherAuthorityRuntime.js';
import { AtmosphereWorld } from '../../js/world/AtmosphereWorld.js';
import { StormWorkers, lookOf, LOOK_FIELDS, LOOK_EXTRA, LOOK_FIELDS_V6, LOOK_CODES } from '../../js/game/StormWorkers.js';
import { inflowSounding, inflowConvergence, inflowCell } from '../../js/game/LabWindow.js';
import { buildSounding } from '../../js/sounding.js';
import { tornadoSceneOf } from '../../js/game/TornadoScene.js';
import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();
const args = process.argv.slice(2), out = args[0];
const hi = args.indexOf('--hours'), hours = hi > 0 ? Number(args[hi + 1]) : 36;
// --only <id,id,...>: follow only those storms' tornado lives (ones a scan picked out); every EF3+ life of theirs is kept
// (ef3PlusTimelines), and it stops once each has one
const oi = args.indexOf('--only'), only = oi > 0 ? new Set(args[oi + 1].split(',')) : null;
// --fresh: the world as the regression suite makes it (AtmosphereWorld, no spin-up), not the server's after 6 days' spin-up
const fresh = args.includes('--fresh');
const seeds = args.slice(1).filter((a, k, all) => !['--hours', '--only', '--fresh'].includes(a) && !['--hours', '--only'].includes(all[k - 1])).map(Number);
if (!out) { console.error('usage: node tools/engine/storm-bundle-samples.mjs <out.json> [seed ...] [--hours H]'); process.exit(1); }
if (!seeds.length) seeds.push(2, 3, 4, 5);

const LOOK_NAMES = ['xKm', 'yKm', 'updraughtMs', 'mesocycloneStrength', 'lowRotation', 'occlusion', 'ageMin', 'updraftRadiusKm', 'anvilLengthKm', 'anvilBearingDeg', 'intensity', 'tornadoMph', 'cloudBaseM', 'wallCloudLoweringM'];
const CODED = { phase: 'phase', mode: 'mode', supercellType: 'supercellType', tornadoEf: 'ef', tornadoEndedBy: 'endedBy', tornadoEndLikely: 'endedBy' };
const r4 = v => +Number(v).toFixed(4);
// The bundle decoded (versions 5 and 6), as tests/storm-bundle-v6.mjs reads it.
export function readBundle(buf) {
  const b = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); let o = 0;
  const version = buf[o++], str = () => { const n = buf[o++]; const s = buf.subarray(o, o + n).toString('utf8'); o += n; return s; };
  const frames = {}, count = b.getUint16(o, true); o += 2;
  for (let i = 0; i < count; i++) {
    const id = str(), seq = b.getUint32(o, true); o += 4; const fl = buf[o++], sizes = {};
    for (const p of ['full', 'near', 'far']) { const n = b.getUint32(o, true); o += 4 + n; sizes[p] = n; }
    frames[id] = { seq, ended: !!(fl & 1), nest: !!(fl & 2), zstdBytes: sizes };
  }
  const storms = {}, n = b.getUint16(o, true); o += 2;
  for (let i = 0; i < n; i++) {
    const id = str(), wf = buf[o++], f = k => r4(b.getFloat32(o + 4 * k, true));
    const s = { warming: !!(wf & 1), posKm: [f(0), f(1)], motionMs: [f(2), f(3)], lightning: { flashesPerMin: f(4), groundShare: f(5), positiveShare: f(6) } }; o += 28;
    const lf = buf[o++];
    s.lookFlags = { look: !!(lf & 1), leftMover: !!(lf & 2), mergedFrom: !!(lf & 4), splitFrom: !!(lf & 8), mergeInto: !!(lf & 16), remnant: !!(lf & 32) };
    if (lf & 1) {
      const v = Array.from({ length: LOOK_FIELDS }, (_, k) => f(k)); o += 4 * LOOK_FIELDS;
      // (version 6: u8 the count of extra numbers, then that many f32)
      if (version >= 6) { const nx = buf[o++]; for (let k = 0; k < nx; k++) v.push(f(k)); o += 4 * nx; }
      s.look = Object.fromEntries(LOOK_NAMES.map((nm, k) => [nm, v[k]]));
      if (version >= 6) {
        s.extra = Object.fromEntries(LOOK_EXTRA.map((nm, k) => { const x = v[LOOK_FIELDS + k]; return [nm, CODED[nm] ? { code: x, name: LOOK_CODES[CODED[nm]][x] ?? null } : x]; }));
        s.events = {};
        for (const [bit, k] of [[4, 'mergedFrom'], [8, 'splitFrom'], [16, 'mergeInto']]) if (lf & bit) s.events[k] = str();
      }
    }
    storms[id] = s;
  }
  return { version, tickHour: r4(b.getFloat64(o, true)), paused: buf[o + 8] === 1, tickAtMs: b.getFloat64(o + 9, true), frames, storms };
}

// The air flowing into a storm, as /api/game/v1/lab/storms?inflow=1 and /lab/window give it (not in
// the bundle): its inflow sounding (js/game/LabWindow.js inflowSounding: the cell INFLOW_KM back
// along the 0-1 km storm-relative wind) and that sounding's parameters, as the window's cells carry them.
function environmentOf(world, s) {
  const p = buildSounding(inflowCell(world, s)).params, r1 = x => Math.round(x * 10) / 10;
  return {
    inflowSounding: inflowSounding(world, s),
    params: { sbcape: Math.round(p.sbcape), mlcape: Math.round(p.mlcape), mlcin: Math.round(p.mlcin), lclAglM: Math.round(p.lclAglM),
      srh01: Math.round(p.srh01), srh03: Math.round(p.srh03), shear06Ms: r1(p.shear06 * 0.514444), stp: Math.round(p.stp * 100) / 100, pwMm: r1((p.precipWater ?? 0) * 25.4) },
    inflowConvergence: inflowConvergence(world, s)
  };
}
const X = n => LOOK_EXTRA.indexOf(n);
const CASES = {
  tornadoEF3plus: (s, e) => s.tornado?.onGround && e[X('tornadoEf')] >= 3,
  multiVortex: (s, e) => s.tornado?.onGround && e[X('tornadoVortices')] > 1,
  highDecay: (s, e) => s.tornado?.onGround && e[X('tornadoDecay')] >= 0.5,
  funnelAloft: (s, e) => !s.tornado?.onGround && e[X('funnelAloft')] > 0,
  leftMover: s => !!s.leftMover,
  mergedFromLive: (s, e, l) => l.events.mergedFrom != null,
  splitFromLive: (s, e, l) => l.events.splitFrom != null,
};
// (the specific cases first; the plain timeline a tornado of 8 ticks or more on the ground - 35+ min. Each life runs
// from up to PRE ticks before its touchdown - gestation - to POST ticks after its end - dissipated.)
const PRE = 3, POST = 3;
const down = ticks => ticks.filter(t => t.scene?.life?.track);
const LIVES = {
  ef3PlusTimeline: life => (life?.peakMph ?? 0) >= 136,
  failedOcclusionTimeline: life => (life?.failedOcclusions ?? 0) > 0,
  loopTimeline: life => (life?.loops ?? 0) > 0,
  surgeTurnTimeline: (life, ticks) => down(ticks).some(t => t.scene?.life?.surge?.kind === 'push' && !t.scene.life.surge.failing),
  tornadoTimeline: (life, ticks) => down(ticks).length >= 8
};
const samples = {}, notFound = new Set([...Object.keys(CASES), ...Object.keys(LIVES), 'endWarning', 'remnantDied', 'remnantMerged']);
const keptOnly = new Set();
const livesOpen = () => Object.keys(LIVES).some(k => notFound.has(k));

for (const seed of seeds) {
  if (!notFound.size) break;
  const rt = fresh ? (aw => ({ atmosphere: aw.world, engine: aw }))(new AtmosphereWorld({ seed })) : new WeatherAuthorityRuntime({ seed, spinUpDays: 6 }); rt.saveState = () => {};
  const world = rt.atmosphere, workers = new StormWorkers({ max: 0, params: { engineFrames: 'only', pollMs: 1e9 } });
  const watchEnd = new Map(), watchLife = new Map(), pre = new Map(), tracked = new Map(); // storm id -> why its frames are built
  for (let tick = 0; tick < hours * 12 && notFound.size && !(only && keptOnly.size >= only.size); tick++) {
    rt.engine.advanceStormLayer(1 / 12);
    // (and the atmosphere every half hour, as the server does - WeatherAuthorityRuntime; until 2026-11-19 it was left at
    // its spin-up, and the storms starved: 2 tornadoes in 36 h on seed 5)
    if ((tick + 1) % 6 === 0) rt.engine.advance(0.5, { advanceStorms: false });
    const hourUtc = world.stormEngine.validHourUtc, active = (world.storms ?? []).filter(s => s.active !== false);
    const storms = new Map(active.map(s => [s.id, s])), build = new Set(), found = [];
    for (const s of active) {
      const look = lookOf(s, hourUtc), e = look.extra;
      for (const [name, test] of Object.entries(CASES)) if (notFound.has(name) && test(s, e, look)) { found.push([name, s.id]); build.add(s.id); notFound.delete(name); }
      // the end warning: a tornado followed from tornadoEndInMin under 15 min to the tick after it ends
      if (notFound.has('endWarning') && s.tornado?.onGround && e[X('tornadoEndInMin')] >= 0 && e[X('tornadoEndInMin')] < 15 && !watchEnd.size) watchEnd.set(s.id, []);
      if (watchEnd.has(s.id)) build.add(s.id);
      // a whole tornado: from the tick before its touchdown (a funnel aloft, perhaps) to the tick after it ends
      // (storms near a tornado - gestation - are followed, their last PRE ticks kept, so a life starts before touchdown)
      if (livesOpen() && (!only || only.has(s.id)) && !s.tornado?.onGround && (s.tornado?.genesisPotential ?? 0) > 0.4 && (pre.has(s.id) || pre.size < 8)) { pre.set(s.id, pre.get(s.id) ?? []); build.add(s.id); }
      else if (!s.tornado?.onGround) pre.delete(s.id);
      if (livesOpen() && (!only || only.has(s.id)) && watchLife.size < 10 && !watchLife.has(s.id) && s.tornado?.onGround && (s.tornado.groundTimeMinutes ?? 0) <= 5 + 1e-6) { watchLife.set(s.id, { ticks: [...(pre.get(s.id) ?? [])], after: 0 }); pre.delete(s.id); }
      if (watchLife.has(s.id)) build.add(s.id);
      // storms that may die or merge soon get frames, so a remnant comes from a real end
      const dying = (s.intensity ?? 1) < 0.2 || s.lifecycle?.phase === 'dissipating';
      const merging = active.some(o => o !== s && Math.hypot(o.positionKm.x - s.positionKm.x, o.positionKm.y - s.positionKm.y) < 10);
      if ((notFound.has('remnantDied') && dying) || (notFound.has('remnantMerged') && merging)) tracked.set(s.id, true);
    }
    for (const id of [...tracked.keys()].slice(0, 4)) if (storms.has(id)) build.add(id);
    // (the bundle's clock, as stormTick sets it on the live server)
    workers.tickHour = hourUtc; workers.tickAtMs = Date.now();
    workers.engineFrames(world, [...build], storms, null);
    const bundle = readBundle(workers.frames('', ['full', 'near', 'far'], { version: 6 }));
    // (each living storm's entry with its environment)
    // tornadoState (2026-11-19, the lab's split: it builds its tornadoes from the engine's state and derives the look
    // itself): the state alone, per tick - the rest of the tick is kept whole, its look fields for the engine's own use
    const stateOf = (s, scene) => {
      const t = s.tornado ?? {}, v = scene?.vortices?.tornado ?? null, ng = scene?.nearGround ?? {}, east = s.velocityKph?.east ?? 0, north = s.velocityKph?.north ?? 0;
      const r = x => x == null ? null : Math.round(x * 1000) / 1000;
      return {
        onGround: !!t.onGround, tornadoPosKm: t.onGround && t.positionKm ? [r(t.positionKm.x), r(t.positionKm.y)] : null,
        headingDeg: Math.round(((Math.atan2(east, north) * 180 / Math.PI) + 360) % 360 * 10) / 10, motionMs: r(Math.hypot(east, north) / 3.6),
        swirlMs: v?.swirlMs ?? null, coreRadiusM: v?.coreRadiusM ?? null,
        stage: scene?.life?.stage ?? null, stageProgress: scene?.life?.stageProgress ?? null,
        touchedDownHourUtc: t.startedHourUtc ?? null, minutesOnGround: t.onGround ? r(t.groundTimeMinutes) : null, lifeMinutes: t.onGround ? r(t.lifeMinutes) : null,
        endsAtMinutes: t.onGround && t.ropeOut ? r(t.ropeOut.endMinutes) : null, endedHourUtc: t.onGround ? null : t.endedHourUtc ?? null,
        coldPoolDeficitK: ng.coldPool?.deficitK ?? null, outflowShare: ng.drawnIn?.outflowShare ?? null, outflowTC: ng.drawnIn?.outflowTC ?? null, outflowTdC: ng.drawnIn?.outflowTdC ?? null, outflowRhPct: ng.drawnIn?.outflowRhPct ?? null,
        rainCore: scene?.precip?.rain ? { intensity: scene.precip.rain.intensity, alongM: scene.precip.rain.alongM, acrossM: scene.precip.rain.acrossM, bearingDeg: scene.precip.rain.bearingDeg, wrap: scene.precip.rain.wrap, maxDbz: scene.precip.maxDbz ?? null } : null,
        rainCoreAtM: scene?.precip?.rain?.at ?? null, mesocycloneAtM: scene?.vortices?.mesocyclone?.[0]?.at ?? null,
        sun: scene?.sun ? { elevationDeg: scene.sun.elevationDeg, azimuthDeg: scene.sun.azimuthDeg, localHour: scene.sun.localHour } : null, simHourUtc: hourUtc,
        ground: scene?.ground ? { cover: scene.ground.cover?.at ?? null, soilMoisture: scene.ground.soilMoisture ?? null, elevationM: scene.ground.elevationM ?? null } : null
      };
    };
    const entry = id => { const en = bundle.storms[`${id}~engine`], s = storms.get(id); if (!(en && s)) return en; const scene = tornadoSceneOf(world, s, hourUtc, { frameInfo: workers.engine.get(`${id}~engine`)?.info ?? null }); return { ...en, environment: environmentOf(world, s), tornadoState: stateOf(s, scene), scene }; };
    for (const [name, id] of found) { samples[name] = { seed, tickHour: bundle.tickHour, stormId: `${id}~engine`, frame: bundle.frames[`${id}~engine`] ?? null, ...entry(id) }; console.log(`seed ${seed} ${hourUtc.toFixed(2)}: ${name} (${id})`); }
    for (const [id, ticks] of pre) { const en = entry(id); if (!en) { pre.delete(id); continue; } ticks.push({ tickHour: bundle.tickHour, frame: bundle.frames[`${id}~engine`] ?? null, ...en }); if (ticks.length > PRE) ticks.shift(); }
    for (const [id, w] of watchLife) {
      const en = entry(id), ticks = w.ticks;
      if (en) ticks.push({ tickHour: bundle.tickHour, frame: bundle.frames[`${id}~engine`] ?? null, ...en });
      if (!storms.get(id)?.tornado?.onGround) w.after++;
      if (en && down(ticks).length <= 60 && w.after < POST) continue;
      // ended, and POST ticks after (its last tick on the ground has its life to date): the first open case it shows
      const life = down(ticks).at(-1)?.scene.life ?? null;
      // (with --only, every EF3+ life of the storms named, as options)
      if (only && life && LIVES.ef3PlusTimeline(life, ticks)) { (samples.ef3PlusTimelines ??= []).push({ seed, stormId: `${id}~engine`, ticks }); keptOnly.add(id); console.log(`seed ${seed} ${hourUtc.toFixed(2)}: ef3PlusTimelines (${id}, ${ticks.length} ticks, ${down(ticks).length} down)`); watchLife.delete(id); continue; }
      for (const [name, test] of Object.entries(LIVES)) if (notFound.has(name) && life && test(life, ticks)) {
        samples[name] = { seed, stormId: `${id}~engine`, ticks }; notFound.delete(name);
        console.log(`seed ${seed} ${hourUtc.toFixed(2)}: ${name} (${id}, ${ticks.length} ticks, ${down(ticks).length} down)`); break;
      }
      watchLife.delete(id);
    }
    for (const [id, ticks] of watchEnd) {
      const en = entry(id);
      if (en) ticks.push({ tickHour: bundle.tickHour, ...en });
      if (!storms.get(id)?.tornado?.onGround || !en) { samples.endWarning = { seed, stormId: `${id}~engine`, ticks }; notFound.delete('endWarning'); watchEnd.clear(); console.log(`seed ${seed} ${hourUtc.toFixed(2)}: endWarning (${id}, ${ticks.length} ticks)`); }
    }
    for (const [key, w] of workers.engine) {
      if (!w.remnant) continue;
      const name = w.remnant.mergeInto != null ? 'remnantMerged' : 'remnantDied', en = bundle.storms[key];
      if (!en) continue;
      const archived = (world.stormArchive ?? []).find(a => String(a.id) === String(w.stormId));
      samples[name] ??= { seed, stormId: key, dissipationReason: archived?.dissipationReason ?? null, ticks: [] };
      if (samples[name].stormId === key && samples[name].ticks.length < 4) { samples[name].ticks.push({ tickHour: bundle.tickHour, ...en }); if (samples[name].ticks.length === 1) console.log(`seed ${seed} ${hourUtc.toFixed(2)}: ${name} (${key})`); }
      if (samples[name].ticks.length >= 2) notFound.delete(name);
    }
    for (const id of [...tracked.keys()]) if (!storms.has(id)) tracked.delete(id);
  }
  workers.close();
}

const doc = {
  _about: {
    description: "The WeatherWorld engine's storm bundle version 6 (GET /api/game/v1/storm/frames?v=6), decoded: one real example of each case, from live worlds stepped storm tick by storm tick. Made by tools/engine/storm-bundle-samples.mjs.",
    generated: new Date().toISOString(), seeds, hoursPerSeed: hours,
    tornadoState: 'per tick, the engine state the lab builds its tornado from (the rest of each tick is the engine look, kept whole; the lab derives its own): tornadoPosKm map km (as posKm, which is the updraught); headingDeg the storm motion toward, from north; motionMs its speed; swirlMs and coreRadiusM the vortex own wind (the ground wind less half the motion) and core; stage and stageProgress (gestation through dissipated); touchedDownHourUtc, minutesOnGround, lifeMinutes (drawn; the engine may end it sooner), endsAtMinutes once it is roping out, endedHourUtc; coldPoolDeficitK and outflowShare (of the air it draws in), outflowTC / outflowTdC / outflowRhPct (the inflow cooled by the deficit through evaporation, capped at saturation: TornadoScene outflowDewpointC); rainCore (intensity 0-1, alongM / acrossM its extent, bearingDeg of its long axis, wrap round the tornado, maxDbz the storm peak); rainCoreAtM and mesocycloneAtM in m from the tornado (scene frame); sun, simHourUtc, ground.',
    units: 'posKm, look.xKm/yKm: map km, x east, y SOUTH. motionMs: [east, north] m/s. tickHour: sim UTC hours (a storm tick is 5 sim min, 37.5 real s at the 8x clock). Wind mph, width yards, heights m.',
    codes: LOOK_CODES, lookExtraOrder: LOOK_EXTRA,
    notes: ['Coded fields are sent as an index into codes, shown here as {code, name}; -1 none.',
      'tornadoCycle with the storm id names a tornado: it goes up by one at each touchdown.',
      'tornadoEndInMin / tornadoEndLikely: the engine\'s outlook for the tornado on the ground (TornadoEngine tornadoEndOutlook); -1 none in sight.',
      'frame: the Zstd sizes of the storm\'s full / near / far cloud frames that tick (none for a remnant).',
      'environment (living storms only; not in the bundle - /api/game/v1/lab/storms?inflow=1 and /lab/window serve the same): inflowSounding rows are [p hPa, T C, Td C, u m/s east, v m/s north], surface first, from the cell 24 km back along the 0-1 km storm-relative wind (the air the storm takes in); params are that sounding\'s (CAPE / CIN J/kg, LCL m AGL, SRH m2/s2, 0-6 km shear m/s, precipitable water mm); inflowConvergence 1e-5 /s.',
      'scene (living storms only; js/game/TornadoScene.js documents every field): what the tornado is seen in - the cloud over it (base, wall cloud, rain-free base, shelf, anvil, sky cover), the rain and hail round it (cores placed in m east / north of the tornado, wrap, rear-flank clear slot, freezing and wet-bulb zero levels), the air (surface T / Td / RH, LCL / LFC / EL, DCAPE, the wind every 250 m to 3 km, the storm motion and its inflow), the ground (height, soil moisture, wind) and the sun. Not the tornado state: that is the look.',
      'tornadoTimeline: one tornado (35+ min on the ground), a tick at a time, from up to 3 ticks before its touchdown (its storm in gestation, where it was) to 3 ticks after it ended (dissipated, then none). ef3PlusTimeline, failedOcclusionTimeline, loopTimeline, surgeTurnTimeline: whole lives the same way, of an EF3+ (peak 136+ mph), a tornado whose occlusion failed, one whose track loops, and one turned by a rear-flank surge mid-life.',
      'scene.life (each tick a tornado is down): its stage (the six of the lab: organizing / mature / shrinking / rope down; gestation before touchdown and dissipated for 10 min after the end, when the block is only {stage, stageProgress}), stageProgress 0-1 through it, contortion 0-1, and life share; windMph is what it shows, intensityMph the vortex its rating and width follow (so peakMph can exceed every windMph a brief one shows); coreRadiusM and matureCoreM; lossFall (decay from the storm losing its rotation); occlusion now and peak; surge under way (wrap: speeds the occlusion; push: turnDeg / speedFactor mid-life, failing: true when it undoes an occlusion); surges and failedOcclusions so far; heldOffsetM (where it is held from the wall cloud: the occlusion offset, the decay drift, a surge push; m east, north); track: its path to date as [m east, m north of it now, minutes ago], with the 30-s substeps while it revolves round the mesocyclone; loops: times that track crosses itself.'],
    notFound: [...notFound]
  },
  ...samples
};
fs.writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`written ${out}; not found: ${[...notFound].join(', ') || 'none'}`);
