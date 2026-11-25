// The storm bundle's version 6 (js/game/StormWorkers.js frames, ?v=6): the engine's frames for a
// storm near a player, read back as version 5 (unchanged: the default) and as version 6 (the
// look's life, type and tornado numbers, its merge / split ids, and remnants of storms that have
// gone - a dead storm's anvil drifting and thinning, a merged one gliding into its keeper). No
// worker processes (engine frames only).
//   node tests/storm-bundle-v6.mjs
import assert from 'node:assert/strict';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';
import { StormWorkers, lookOf, LOOK_FIELDS, LOOK_EXTRA, LOOK_FIELDS_V6, LOOK_CODES } from '../js/game/StormWorkers.js';
import { LIFE } from '../js/storms/StormAppearance.js';
import { tornadoEndOutlook } from '../js/storms/TornadoEngine.js';
import { tornadoSceneOf } from '../js/game/TornadoScene.js';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

// A reader of the bundle (versions 5 and 6), as the Roblox one (Shared/CloudModel/StormFrames.luau) will be.
function readBundle(buf) {
  const b = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  const version = b.getUint8(o++), str = () => { const n = buf[o++]; const s = buf.subarray(o, o + n).toString('utf8'); o += n; return s; };
  const frames = {};
  const count = b.getUint16(o, true); o += 2;
  for (let i = 0; i < count; i++) {
    const id = str(), seq = b.getUint32(o, true); o += 4; const flags = buf[o++];
    const sizes = [];
    for (let k = 0; k < 3; k++) { const n = b.getUint32(o, true); o += 4 + n; sizes.push(n); }
    frames[id] = { seq, ended: !!(flags & 1), sizes };
  }
  const where = {};
  const nLive = b.getUint16(o, true); o += 2;
  for (let i = 0; i < nLive; i++) {
    const id = str(); o += 1;
    const f = k => b.getFloat32(o + 4 * k, true);
    const w = { xKm: f(0), yKm: f(1), ue: f(2), ve: f(3), flashesPerMin: f(4) }; o += 28;
    const lf = buf[o++];
    if (lf & 1) {
      w.values = Array.from({ length: LOOK_FIELDS }, (_, k) => f(k)); o += 4 * LOOK_FIELDS;
      if (version >= 6) {
        // (u8 the count of extra numbers, then that many f32)
        const nx = buf[o++];
        assert.equal(nx, LOOK_FIELDS_V6 - LOOK_FIELDS, 'the extra count');
        for (let k = 0; k < nx; k++) w.values.push(f(k));
        o += 4 * nx;
      }
      w.extra = version >= 6 ? Object.fromEntries(LOOK_EXTRA.map((name, k) => [name, w.values[LOOK_FIELDS + k]])) : null;
      w.leftMover = !!(lf & 2); w.remnant = !!(lf & 32);
      if (version >= 6) for (const [bit, k] of [[4, 'mergedFrom'], [8, 'splitFrom'], [16, 'mergeInto']]) if (lf & bit) w[k] = str();
    }
    where[id] = w;
  }
  const tickHour = b.getFloat64(o, true), paused = buf[o + 8] === 1, tickAtMs = b.getFloat64(o + 9, true); o += 17;
  assert.equal(o, buf.length, `version ${version}: nothing after the clock`);
  return { version, frames, where, tickHour, paused, tickAtMs };
}
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const runtime = new WeatherAuthorityRuntime({ seed: 2, spinUpDays: 6 });
runtime.saveState = () => {};
const world = runtime.atmosphere;
for (let i = 0; i < 48 && !(world.storms ?? []).some(s => s.active && s.intensity > 0.3); i++) runtime.advance(0.5);
const storm = (world.storms ?? []).filter(s => s.active).sort((a, b) => b.intensity - a.intensity)[0];
assert.ok(storm, 'the world has a storm');

const workers = new StormWorkers({ max: 0, params: { engineFrames: 'only', pollMs: 60_000 } });
runtime.stormWorkers = workers;
try {
  const key = `${storm.id}~engine`;
  const show = () => { workers.reportPlayers('test', [[storm.positionKm.x + 5, storm.positionKm.y]]); runtime.engine.advanceStormLayer(1 / 12); };
  show();
  assert.ok(workers.engine.has(key), 'a player 5 km away gives the storm engine frames');
  const hour = world.stormEngine.validHourUtc;

  // Version 5, the default: as before (no extra numbers, no event ids).
  const v5 = readBundle(workers.frames(''));
  assert.equal(v5.version, 5, 'version 5 by default');
  assert.equal(v5.where[key].values.length, LOOK_FIELDS);
  assert.ok(v5.frames[key]?.sizes.every(n => n > 0), 'its frames');

  // Version 6: the same, and the look's extra numbers.
  const v6 = readBundle(workers.frames('', ['full', 'near', 'far'], { version: 6 }));
  assert.equal(v6.version, 6);
  const w = v6.where[key], want = lookOf(storm, hour, workers.engine.get(key).info?.tornado);
  assert.deepEqual(w.values.slice(0, LOOK_FIELDS).map(Math.fround), v5.where[key].values, 'the version 5 numbers unchanged');
  LOOK_EXTRA.forEach((name, k) => assert.ok(near(w.extra[name], want.extra[k]), `${name}: ${w.extra[name]} vs ${want.extra[k]}`));
  assert.equal(LOOK_CODES.phase[w.extra.phase], storm.lifecycle.phase, 'its lifecycle phase');
  assert.ok(w.extra.mode >= 0, `its mode is one of LOOK_CODES.mode (${w.extra.mode})`);
  for (const name of ['growth', 'decay', 'coldPool', 'towering', 'organization', 'rotating', 'linear', 'tornadoLifeShare', 'tornadoDecay', 'tornadoCondensed', 'tornadoDebris', 'funnelAloft'])
    assert.ok(w.extra[name] >= 0 && w.extra[name] <= 1, `${name} in 0-1 (${w.extra[name]})`);
  assert.ok(w.extra.trend >= -1 && w.extra.trend <= 1, 'trend in -1..1');
  assert.equal(w.extra.fade, 0, 'a living storm has not faded');
  if (storm.tornado?.onGround) assert.ok(w.extra.tornadoYards > 0 && w.extra.tornadoEf >= 0, 'its tornado');
  else assert.ok(w.extra.tornadoYards === 0 && w.extra.tornadoEf === -1, 'no tornado');
  assert.equal(w.remnant, false);
  assert.equal(w.extra.tornadoCycle, storm.tornado?.cycleCount ?? 0, 'its tornado count');
  if (!storm.tornado?.onGround) assert.ok(w.extra.tornadoEndInMin === -1 && w.extra.tornadoEndLikely === -1, 'no end outlook without a tornado');

  // The end outlook (TornadoEngine tornadoEndOutlook): the first of its drawn life running out and its
  // rotation, falling at its present rate in log space, below sustainRotation (0.055).
  const down = (t, s = {}) => tornadoEndOutlook({ lowRotation: 0.2, lowRotationTrend: -0.6, lowRotationFree: 0.3, ...s, tornado: { onGround: true, lifeMinutes: 60, groundTimeMinutes: 10, ...t } });
  const logMinutes = Math.log(0.055 / 0.2) / (-0.6 / 0.2) * 60; // 25.8 (straight-line: 14.5)
  assert.ok(Math.abs(down({}).minutes - logMinutes) < 1e-9 && down({}).by === 'occluded', 'rotation going first, the storm still holding it: occluded');
  assert.equal(down({}, { lowRotationFree: 0.03 }).by, 'rotation faded');
  assert.deepEqual(down({ groundTimeMinutes: 55 }), { minutes: 5, by: 'vortex spent' }, 'its life going first');
  assert.equal(down({}, { lowRotationTrend: 0.1 }).minutes, 50, 'rotation steady or rising: its life');
  assert.equal(down({}, { lowRotation: 0.05 }).minutes, 0, 'already below what holds it');
  assert.equal(tornadoEndOutlook({ tornado: { onGround: false } }), null);
  console.log(`storm ${storm.id}: ${LOOK_CODES.phase[w.extra.phase]}, ${LOOK_CODES.mode[w.extra.mode]}, growth ${w.extra.growth.toFixed(2)} trend ${w.extra.trend.toFixed(2)}, tornado ${storm.tornado?.onGround ? LOOK_CODES.ef[w.extra.tornadoEf] : 'none'}`);

  // The scene round it for a lab (js/game/TornadoScene.js): the engine's own numbers, placed round the tornado.
  const scene = tornadoSceneOf(world, storm, hour, { frameInfo: workers.engine.get(key).info });
  // The scene endpoint (GET /api/game/v1/storm/scene): built from the storm's frame of this tick, kept until the next.
  const served = workers.scenes(world, [storm.id]);
  assert.deepEqual(Object.keys(served.storms), [storm.id], 'the storms asked for');
  assert.equal(served.storms[storm.id].seq, workers.engine.get(key).seq, 'from its frame of this tick');
  assert.deepEqual(served.storms[storm.id].scene, scene, 'the scene the samples give');
  assert.equal(workers.scenes(world, [storm.id]).storms[storm.id].scene, served.storms[storm.id].scene, 'kept until the next frame');
  assert.equal(served.tickHour, Number(workers.tickHour) || 0);
  if (scene.tornado) {
    // One funnel: the appearance's is the frame's (TornadoFunnel.js), and the wall cloud is over the tornado.
    assert.ok(Math.abs(scene.tornado.condensedM - scene.nearGround.funnelTipM) <= 1, `the funnel's tip: ${scene.tornado.condensedM} vs the frame's ${scene.nearGround.funnelTipM}`);
    assert.equal(scene.tornado.baseM, scene.nearGround.wallCloudBaseM, 'under the frame\'s wall cloud');
    assert.ok(Math.hypot(...scene.cloud.wallCloud.at) < 1, 'the wall cloud over the tornado');
  }
  // The light round it (StormLight.js), from the frame's cloud: built with the sun over the tornado.
  const L = scene.light;
  assert.ok(L && L.overhead.transmittance > 0 && L.overhead.transmittance <= 1 && L.bearings.length === 16, 'the light under it');
  assert.ok(L.bearings.every(b => b.sideWeight >= 0 && b.sideWeight <= 0.5 && (b.edgeKm == null) === (b.boxKm != null)), 'the gap on each bearing');
  if (L.slot) assert.ok(L.slot.weight === Math.max(...L.bearings.map(b => b.sideWeight)) && L.slot.widthDeg >= 22.5, 'the clear slot is the strongest gap');
  if (scene.sun.elevationDeg > 0) assert.ok(L.sun?.length === 3 && L.sun.every(x => x.direct >= 0 && x.direct <= 1), 'the direct sun'); else assert.equal(L.sun, null, 'no sun at night');
  assert.ok(scene.sun.elevationDeg > -90 && scene.sun.elevationDeg <= 90 && scene.sun.azimuthDeg >= 0 && scene.sun.azimuthDeg < 360, 'the sun');
  assert.equal(scene.vortices.mesocyclone.length, 4);
  assert.ok(scene.vortices.mesocyclone.every(m => m.radiusM > 0 && m.windMs >= 0 && m.at.every(Number.isFinite)), 'the mesocyclone in m and m/s');
  assert.equal(scene.vortices.tornado == null, !storm.tornado?.onGround, 'the tornado vortex only with one down');
  assert.ok(scene.nearGround.coldPool.depthM > 0 && Number.isFinite(scene.gustFront.groundMs) && scene.gustFront.at.every(Number.isFinite), 'the cold pool and gust front');
  assert.ok(LOOK_CODES && scene.ground.cover?.at && Math.abs(Object.values(scene.ground.cover.shares).reduce((s, v) => s + v, 0) - 1) < 0.05, `the ground cover (${scene.ground.cover?.at})`);
  assert.ok(Math.abs(scene.cloud.baseM - w.values[12]) < 1, `the cloud base is the bundle's (${scene.cloud.baseM} vs ${w.values[12]})`);
  assert.equal(scene.air.windProfile.length, 13, 'the wind every 250 m to 3 km');
  assert.ok(scene.air.lclM > 0 && scene.precip.freezingM > scene.air.lclM, `freezing level ${scene.precip.freezingM} m above the LCL ${scene.air.lclM} m`);
  assert.ok(scene.air.surface.rhPct > 0 && scene.air.surface.rhPct <= 100 && scene.ground.soilMoisture >= 0 && scene.ground.soilMoisture <= 1, 'humidity and soil');
  assert.ok([scene.precip.rain.at, scene.precip.hail.at, scene.cloud.wallCloud.at].flat().every(Number.isFinite), 'the cores placed');
  assert.ok(scene.sun.localHour >= 0 && scene.sun.localHour < 24);
  console.log(`scene: base ${scene.cloud.baseM} m, freezing ${scene.precip.freezingM} m, rain wrap ${scene.precip.rain.wrap}, RH ${scene.air.surface.rhPct}%`);

  // A tornado that has just ended is told why, for LIFE.eventHours.
  const ended = { ...storm, tornado: { ...(storm.tornado ?? {}), onGround: false }, tornadoHistory: [{ endedHourUtc: hour - 0.05, endedBy: 'occluded' }] };
  const X = name => LOOK_EXTRA.indexOf(name);
  assert.equal(lookOf(ended, hour).extra[X('tornadoEndedBy')], LOOK_CODES.endedBy.indexOf('occluded'), 'why its tornado ended');
  assert.equal(lookOf(ended, hour + LIFE.eventHours + 0.1).extra[X('tornadoEndedBy')], -1, '...for a while only');
  // A merge or split is told by id.
  const merged = lookOf({ ...storm, lastMergedFromId: 'other', mergedAtAgeHours: storm.ageHours }, hour);
  assert.equal(merged.events.mergedFrom, 'other');
  workers.engine.get(key).look.events = merged.events;
  assert.equal(readBundle(workers.frames('', [], { version: 6 })).where[key].mergedFrom, 'other', 'the merge in the bundle');

  // The storm dies: its anvil stays a while, drifting with the wind aloft and thinning (version 6 only).
  const entry = workers.engine.get(key), last = entry.look.values, built = entry.builtHour;
  const later = built + 1 / 12;
  const dead = { stormEngine: { validHourUtc: later }, stormArchive: [{ id: storm.id, dissipationReason: 'collapsed' }] };
  workers.engineFrames(dead, [], new Map(), null);
  assert.ok(workers.engine.get(key)?.remnant, 'a remnant');
  assert.deepEqual(workers.scenes({ storms: [storm] }).storms, {}, 'a remnant has no scene');
  const r6 = readBundle(workers.frames('', ['full', 'near', 'far'], { version: 6 })), r = r6.where[key];
  assert.ok(r.remnant && !r6.frames[key], 'sent as a remnant, without frames');
  assert.ok(r.values[2] === 0 && r.values[10] === 0 && r.values[11] === 0, 'no updraught, intensity or tornado');
  const lifeHours = workers.engine.get(key).remnant.lifeHours;
  assert.ok(lifeHours >= LIFE.remnantHours[0] && lifeHours <= LIFE.remnantHours[1], `it lasts ${lifeHours.toFixed(2)} h`);
  assert.ok(near(r.extra.fade, (later - built) / lifeHours), `fading (${r.extra.fade.toFixed(2)})`);
  assert.ok(near(r.values[8], last[8]), 'its anvil kept');
  const aloft = entry.remnant.aloftKph;
  assert.ok(near(r.values[0], last[0] + aloft.east / 12, 1e-4) && near(r.values[1], last[1] - aloft.north / 12, 1e-4), 'drifting with the wind aloft');
  assert.equal(LOOK_CODES.phase[r.extra.phase], 'dissipating');
  assert.ok(!readBundle(workers.frames('', [], { version: 5 })).where[key], 'left out of version 5');
  workers.engineFrames({ ...dead, stormEngine: { validHourUtc: built + lifeHours + 0.01 } }, [], new Map(), null);
  assert.ok(!workers.engine.has(key), 'gone once it has faded');

  // Merged: it glides into the storm that took it in, then goes.
  show();
  const again = workers.engine.get(key);
  assert.ok(again && !again.remnant, 'shown again');
  const k0 = again.look.values;
  const keeper = { id: 'keeper', positionKm: { x: k0[0] + 10, y: k0[1] }, velocityKph: { east: 0, north: 0 } };
  const t0 = again.builtHour;
  workers.engineFrames({ stormEngine: { validHourUtc: t0 + LIFE.eventHours / 2 }, stormArchive: [{ id: storm.id, dissipationReason: 'merged-into-keeper' }] }, [], new Map([['keeper', keeper]]), null);
  const m = readBundle(workers.frames('', [], { version: 6 })).where[key];
  assert.ok(m.remnant && m.mergeInto === 'keeper', 'merging into its keeper');
  assert.ok(m.values[0] > k0[0] && m.values[0] <= keeper.positionKm.x + 1e-3, `gliding toward it (${(m.values[0] - k0[0]).toFixed(2)} km)`);
  workers.engineFrames({ stormEngine: { validHourUtc: t0 + LIFE.eventHours / 2 }, stormArchive: [{ id: storm.id, dissipationReason: 'merged-into-keeper' }] }, [], new Map(), null);
  assert.ok(!workers.engine.has(key), 'gone when its keeper has gone');

  // Left the map: no remnant.
  show();
  workers.engineFrames({ stormEngine: { validHourUtc: workers.engine.get(key).builtHour + 0.05 }, stormArchive: [{ id: storm.id, dissipationReason: 'left-domain' }] }, [], new Map(), null);
  assert.ok(!workers.engine.has(key), 'a storm that left the map leaves nothing');
  assert.ok(workers.status().engine.every(e => e.bytes), 'status reads');
  console.log(`bundle v5 ${workers.frames('').length} B, v6 ${workers.frames('', ['full', 'near', 'far'], { version: 6 }).length} B`);
  console.log('storm bundle v6: ok');
} finally {
  workers.close();
}
setTimeout(() => process.exit(0), 200);
