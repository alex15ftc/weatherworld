// Engine data for the storm lab (roblox/src/stormlab): a window of the weather engine's world
// around one storm at one moment, so the lab can rebuild its environment and storms from real
// fields instead of made-up numbers.
//   node scripts/export-lab-scenario.mjs --seed 8181 --days 2 --name Supercell
//   node scripts/export-lab-scenario.mjs --seed 2112 --days 3 --focus line --name SquallLine
// Finds the moment like scripts/export-storm-replay.mjs (the strongest tornado, or the best line
// in daylight), runs the same world again to LEAD_HOURS before it and writes
// roblox/src/stormlab/data/<name>.luau, a module returning JSON text:
//   meta       seed, sim hour (UTC), sun, window size, cell size, map position of the window centre
//   cells      per engine cell in the window: lab position (m east / north of the window centre),
//              terrain, surface T/Td (C), wind (m/s), MSLP, cold pool (K), convergence, the
//              engine's own diagnostics (for comparison only) and its full sounding
//              (rows p hPa, t C, td C, u m/s, v m/s from the surface up)
//   boundaries the engine's analysed fronts / drylines / outflows (lab metres)
//   storms     every storm in the window: position, motion, intensity, rotation, cold pool,
//              line organisation, tornado; plus the game feed's appearance block (feed)
//   track      what the engine then did with the focus storm (and its tornado) every 5 minutes,
//              for comparing the lab's own evolution against it
// Lab frame: x east, y NORTH, metres, (0, 0) = the window centre (the engine's map has y south).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { buildStormFeedList } from '../js/storms/StormAppearance.js';
import { lineShare, rotatingShare } from '../js/storms/StormModeEngine.js';
import { buildSkyAppearance } from '../js/world/SkyAppearance.js';
import { buildSounding } from '../js/sounding.js';

avoidBackgroundThrottling();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const seed = Number(flag('--seed', 8181)), days = Number(flag('--days', 2)), focusOn = flag('--focus', 'tornado');
const name = flag('--name', focusOn === 'line' ? 'SquallLine' : 'Supercell');
const HALF = Number(flag('--half', 7)); // cells each way from the centre cell: a 15 x 15 window
const LEAD_HOURS = Number(flag('--lead', focusOn === 'line' ? 1.5 : 1));
const TRACK_HOURS = Number(flag('--track', 2.5));
const TICK_HOURS = 1 / 12, KT = 0.514444;
const OUT = path.join(ROOT, 'roblox/src/stormlab/data', `${name}.luau`);

function run(onTick) {
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world;
  for (let tick = 0; tick < days * 24 / TICK_HOURS; tick++) {
    atmosphere.advanceStormLayer(TICK_HOURS);
    if ((tick + 1) % Math.round(0.5 / TICK_HOURS) === 0) atmosphere.advance(0.5, { advanceStorms: false });
    if (onTick(world, world.stormEngine?.validHourUtc ?? world.validHourUtc, atmosphere) === false) break;
  }
}

let sun = null;
const daylight = (world, hour) => {
  sun ??= buildSkyAppearance(world)?.sun;
  if (!sun) return true;
  const local = ((hour + sun.utcOffsetHours) % 24 + 24) % 24;
  return local > sun.sunriseLocal + 0.5 && local < sun.sunsetLocal - 0.5;
};

// Pass 1: the moment.
const started = Date.now();
let best = null;
const born = new Map(); // storm id -> the first hour it was seen
const noteBirths = (world, hour) => { for (const s of world.storms ?? []) if (s.active && !born.has(s.id)) born.set(s.id, hour); };
if (focusOn === 'line') run((world, hour) => {
  noteBirths(world, hour);
  if (!daylight(world, hour)) return;
  for (const storm of world.storms ?? []) {
    if (!storm.active || lineShare(storm) < 0.5) continue;
    const score = (storm.lineHalfLengthKm ?? 0) * Math.min(1, storm.coldPoolStrength ?? 0) * Math.min(1, storm.intensity ?? 0);
    if (!best || score > best.score) best = { stormId: storm.id, score, hourUtc: hour };
  }
});
else run((world, hour) => {
  noteBirths(world, hour);
  if (!daylight(world, hour)) return;
  for (const storm of world.storms ?? []) {
    const t = storm.tornado;
    if (!storm.active || !t?.onGround || t.startedHourUtc == null) continue;
    if (!best || t.windSpeedMph > best.peakMph) best = { stormId: storm.id, hourUtc: t.startedHourUtc, peakMph: t.windSpeedMph };
  }
});
if (!best) { console.log(`seed ${seed}: no ${focusOn} in daylight in ${days} days`); process.exit(1); }
// LEAD_HOURS before the event, but not before the storm has been alive 10 minutes
const at = Math.max(best.hourUtc - LEAD_HOURS, (born.get(best.stormId) ?? -Infinity) + 10 / 60);
console.log(`seed ${seed}: ${focusOn} on ${best.stormId} at hour ${best.hourUtc.toFixed(2)}; snapshot at ${at.toFixed(2)} (${Math.round((Date.now() - started) / 1000)} s)`);

const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;
const windUv = (dirFrom, speedKt) => {
  const r = dirFrom * Math.PI / 180;
  return [-Math.sin(r) * speedKt * KT, -Math.cos(r) * speedKt * KT];
};

// Pass 2: the snapshot, then the engine's own track of the focus storm.
let scenario = null;
let centre = null;
const track = [];
run((world, hour, atmosphere) => {
  if (hour < at - 0.75 - 1e-6) return true;
  // the feed remembers remnants per world: build it every tick from 45 min before
  const feed = buildStormFeedList(world, new Map());
  if (hour < at - 1e-6) return true;
  const focus = (world.storms ?? []).find(s => s.id === best.stormId);
  if (!scenario) {
    if (!focus) { console.log(`storm ${best.stormId} not alive at the snapshot`); process.exit(1); }
    const cellKm = world.cellSizeKm;
    const cx = Math.min(world.width - 1 - HALF, Math.max(HALF, Math.floor(focus.positionKm.x / cellKm)));
    const cy = Math.min(world.height - 1 - HALF, Math.max(HALF, Math.floor(focus.positionKm.y / cellKm)));
    centre = { x: (cx + 0.5) * cellKm, y: (cy + 0.5) * cellKm };
    const lab = (xKm, yKm) => [Math.round((xKm - centre.x) * 1000), Math.round(-(yKm - centre.y) * 1000)];
    const cells = [];
    for (let j = -HALF; j <= HALF; j++) for (let i = -HALF; i <= HALF; i++) {
      const cell = world.getCell(cx + i, cy + j);
      const s = buildSounding(cell);
      const elev = cell.terrain.elevationM ?? 0;
      const [us, vs] = windUv(cell.surface.wind.direction, cell.surface.wind.speed);
      const d = cell.derived ?? {};
      cells.push({
        i, j: -j, // j: rows NORTH of the centre
        pos: lab((cx + i + 0.5) * cellKm, (cy + j + 0.5) * cellKm),
        elevM: Math.round(elev),
        tC: r1((cell.surface.temperature - 32) * 5 / 9),
        tdC: r1((cell.surface.dewpoint - 32) * 5 / 9),
        u: r1(us), v: r1(vs),
        mslp: r1(cell.surface.seaLevelPressure ?? 1013),
        coldPoolK: r1(cell.features?.coldPoolK ?? 0),
        convergence: Number(((cell.dynamics?.surfaceConvergenceS1 ?? 0) * 1e5).toFixed(2)), // 1e-5 /s
        engine: { sbcape: Math.round(s.params.sbcape), mlcape: Math.round(s.params.mlcape), mlcin: Math.round(s.params.mlcin), lclAgl: Math.round(s.params.lclAglM), srh01: Math.round(s.params.srh01), srh03: Math.round(s.params.srh03), shear06: r1(s.params.shear06 * KT), stp: r2(s.params.stp), pwMm: r1((s.params.precipWater ?? 0) * 25.4) },
        sounding: s.profile.map(row => [r1(row.p), r1(row.t), r1(row.td), r1(row.u * KT), r1(row.v * KT)]),
      });
    }
    const half = (HALF + 0.5) * cellKm;
    const inside = p => Math.abs(p.x - centre.x) <= half && Math.abs(p.y - centre.y) <= half;
    const boundaries = (atmosphere.boundaries ?? world.mesoscale?.boundaries ?? []).filter(b => b.pointsKm?.some(inside)).map(b => ({
      id: b.id, type: b.type, strength: r2(b.strength ?? 0), contrast: r2(b.contrast ?? 0), advanceMs: r2(b.advanceMs ?? 0), symbolSide: b.symbolSide,
      points: b.pointsKm.map(p => lab(p.x, p.y)),
    }));
    const storms = (world.storms ?? []).filter(s => s.active && inside(s.positionKm)).map(s => ({
      id: s.id, focus: s.id === best.stormId,
      pos: lab(s.positionKm.x, s.positionKm.y),
      motion: [r1(s.velocityKph.east / 3.6), r1(s.velocityKph.north / 3.6)],
      ageMin: Math.round((s.ageHours ?? 0) * 60), mode: s.mode,
      intensity: r2(s.intensity ?? 0), updraftMs: r1(s.updraughtMs ?? 0),
      meso: r2(s.mesocycloneStrength ?? 0), lowRotation: r2(s.lowRotation ?? 0), occlusion: r2(s.occlusion ?? 0),
      rotating: r2(rotatingShare(s)), line: r2(lineShare(s)), lineHalfKm: r1(s.lineHalfLengthKm ?? 0), rearInflow: r2(s.rearInflow ?? 0),
      coldPool: r2(s.coldPoolStrength ?? 0), coldPoolKm: r1(s.coldPoolRadiusKm ?? 0), leftMover: !!s.leftMover,
      maxDbz: Math.round(s.radar?.maxReflectivityDbz ?? 0), hailIn: r2(s.currentHailSizeInches ?? 0),
      tornado: s.tornado?.onGround ? { mph: Math.round(s.tornado.windSpeedMph), yards: Math.round(s.tornado.widthYards ?? 0), pos: lab(s.tornado.positionKm.x, s.tornado.positionKm.y) } : null,
      feed: feed.find(f => f.id === s.id) ?? null,
    }));
    const sky = buildSkyAppearance(world);
    scenario = {
      meta: { name, seed, focus: focusOn, focusStorm: best.stormId, simHourUtc: r2(hour), eventHourUtc: r2(best.hourUtc), cellKm: r2(cellKm), half: HALF, centreMapKm: { x: r1(centre.x), y: r1(centre.y) }, sun: sky?.sun ?? null, peakMph: best.peakMph ? Math.round(best.peakMph) : 0 },
      cells, boundaries, storms, track,
    };
    console.log(`snapshot: ${cells.length} cells, ${boundaries.length} boundaries, ${storms.length} storms (focus ${focus.mode}, intensity ${focus.intensity?.toFixed(2)})`);
  }
  if (hour > at + TRACK_HOURS + 1e-6) return false;
  if (focus) {
    const lab = (xKm, yKm) => [Math.round((xKm - centre.x) * 1000), Math.round(-(yKm - centre.y) * 1000)];
    const t = focus.tornado?.onGround ? focus.tornado : null;
    track.push({ min: Math.round((hour - at) * 60), pos: lab(focus.positionKm.x, focus.positionKm.y), intensity: r2(focus.intensity ?? 0), meso: r2(focus.mesocycloneStrength ?? 0), lowRotation: r2(focus.lowRotation ?? 0), coldPool: r2(focus.coldPoolStrength ?? 0), line: r2(lineShare(focus)),
      tornado: t ? { mph: Math.round(t.windSpeedMph), yards: Math.round(t.widthYards ?? 0), ef: t.estimatedEf ?? null, pos: lab(t.positionKm.x, t.positionKm.y) } : null });
  }
  return true;
});

mkdirSync(path.dirname(OUT), { recursive: true });
const text = JSON.stringify(scenario);
writeFileSync(OUT, `-- Generated by scripts/export-lab-scenario.mjs (seed ${seed}, ${focusOn}); do not edit by hand\nreturn [==[${text}]==]\n`);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(text.length / 1024).toFixed(0)} KB, ${track.length} track points) in ${Math.round((Date.now() - started) / 1000)} s`);
