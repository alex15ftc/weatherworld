// A recorded stretch of real storm frames for the Roblox place to play without the live server
// (Studio's game servers cannot reach localhost). Finds the strongest tornado of a seed's first
// days, runs the same world again and keeps the game frames (server/GameFeed.js) from an hour
// before it touches down to half an hour after it ends, with the storms within RADIUS_KM.
//   node scripts/export-storm-replay.mjs [--seed 2] [--days 2]
// With --focus line it follows instead the longest, strongest line of storms (a line share of at
// least a half; score: half-length x cold pool x intensity) in daylight, from 1.5 h before its
// best to 1.5 h after, and Meta.luau carries line = { ... } (its tornado entry, kept for the
// places that read it, is the line's storm with no tornado, starting the playback at frame 1).
//   node scripts/export-storm-replay.mjs --seed 2112 --days 3 --focus line --out StormReplayLine
// Writes roblox/src/worlddata/StormReplay/ (or --out's folder there; gitignored; Rojo syncs it):
//   Meta.luau   { seed, frames, tickMs, focusMiles = { x, y }, tornado = { ... } }
//   F001.luau ... each returns one frame as JSON text.
// The place plays it when the Workspace attribute StormSource is "replay" (server/WeatherFeed.luau).
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { buildStormFeedList } from '../js/storms/StormAppearance.js';
import { lineShare } from '../js/storms/StormModeEngine.js';
import { buildSkyAppearance } from '../js/world/SkyAppearance.js';
import { buildStormPrecipGrids } from '../js/radar/StormPrecipGrid.js';

avoidBackgroundThrottling();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const seed = Number(flag('--seed', 2)), days = Number(flag('--days', 2)), focusOn = flag('--focus', 'tornado');
const OUT = path.join(ROOT, 'roblox/src/worlddata', path.basename(flag('--out', 'StormReplay')));
const TICK_HOURS = 1 / 12, TICK_MS = 25_000, RADIUS_KM = 250, KM_PER_MILE = 1.609344;
const BEFORE_HOURS = 1, AFTER_HOURS = 0.5, MAX_HOURS = 3;

function run(onTick) {
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world;
  for (let tick = 0; tick < days * 24 / TICK_HOURS; tick++) {
    atmosphere.advanceStormLayer(TICK_HOURS);
    if ((tick + 1) % Math.round(0.5 / TICK_HOURS) === 0) atmosphere.advance(0.5, { advanceStorms: false });
    if (onTick(world, world.stormEngine?.validHourUtc ?? world.validHourUtc) === false) break;
  }
}

// Pass 1: the strongest tornado, at least BEFORE_HOURS into the run (or the best line in daylight).
let best = null;
const started = Date.now();
let sun = null;
const daylight = (world, hour) => {
  sun ??= buildSkyAppearance(world)?.sun;
  if (!sun) return true;
  const local = ((hour + sun.utcOffsetHours) % 24 + 24) % 24;
  return local > sun.sunriseLocal + 0.5 && local < sun.sunsetLocal - 0.5;
};
if (focusOn === 'line') run((world, hour) => {
  if (!daylight(world, hour)) return;
  for (const storm of world.storms ?? []) {
    if (!storm.active || lineShare(storm) < 0.5) continue;
    const score = (storm.lineHalfLengthKm ?? storm.radar?.radiusXKm ?? 0) * Math.min(1, storm.coldPoolStrength ?? 0) * Math.min(1, storm.intensity ?? 0);
    if (!best || score > best.score) best = { stormId: storm.id, score, hourUtc: hour, mode: storm.mode, halfLengthKm: storm.lineHalfLengthKm ?? 0, peakMph: 0 };
  }
});
else run((world, hour) => {
  for (const storm of world.storms ?? []) {
    const t = storm.tornado;
    if (!storm.active || !t?.onGround || t.startedHourUtc == null) continue;
    if (!best || t.windSpeedMph > best.peakMph) best = { stormId: storm.id, startedHourUtc: t.startedHourUtc, peakMph: t.windSpeedMph, endedHourUtc: null };
    if (best.stormId === storm.id && best.startedHourUtc === t.startedHourUtc) best.lastHourUtc = hour;
  }
});
if (!best) { console.log(`seed ${seed}: no ${focusOn} in ${days} days`); process.exit(1); }
const line = focusOn === 'line';
const first = line ? best.hourUtc - MAX_HOURS / 2 : best.startedHourUtc - BEFORE_HOURS;
const last = line ? best.hourUtc + MAX_HOURS / 2 : Math.min(best.lastHourUtc + AFTER_HOURS, first + MAX_HOURS);
if (line) console.log(`seed ${seed}: best line on storm ${best.stormId} (${best.mode}, half-length ${Math.round(best.halfLengthKm)} km, score ${best.score.toFixed(1)}) at hour ${best.hourUtc.toFixed(2)} (${Math.round((Date.now() - started) / 1000)} s)`);
else console.log(`seed ${seed}: strongest tornado ${Math.round(best.peakMph)} mph on storm ${best.stormId}, hours ${best.startedHourUtc.toFixed(2)}-${best.lastHourUtc.toFixed(2)} (${Math.round((Date.now() - started) / 1000)} s)`);

// Pass 2: the same world again, keeping the frames.
const frames = [];
let focus = null, tornadoSeen = false;
run((world, hour) => {
  if (hour < first - 0.75 - 1e-6) return true;
  if (hour > last + 1e-6) return false;
  const storm = (world.storms ?? []).find(s => s.id === best.stormId);
  if (storm) focus = { ...storm.positionKm };
  // Every tick from 45 min before the first frame (the longest a remnant lasts), so the
  // remnants of storms that have gone are worked out from their last frames.
  const storms = buildStormFeedList(world, buildStormPrecipGrids(world), (x, y) => !focus || Math.hypot(x - focus.x, y - focus.y) <= RADIUS_KM);
  if (hour < first - 1e-6) return true;
  if (line ? storms.some(a => a.id === best.stormId && a.life.decay < 1) : storms.some(a => a.id === best.stormId && a.tornado)) tornadoSeen = true;
  if (line && storm && Math.abs(hour - best.hourUtc) < 1e-6) best.peakKm = { ...storm.positionKm }, best.peakFrame = frames.length + 1;
  frames.push({ seq: frames.length + 1, atMs: frames.length * TICK_MS, simHourUtc: +hour.toFixed(4), storms, sky: buildSkyAppearance(world) });
  if (!best.touchdownKm && storm?.tornado?.onGround) best.touchdownKm = { ...storm.tornado.positionKm };
  return true;
});
if (!tornadoSeen) { console.log(`the second run did not reproduce the ${focusOn}: the world is not deterministic`); process.exit(1); }

if (existsSync(OUT)) for (const name of readdirSync(OUT)) if (/^F\d+\.luau$|^Meta\.luau$/.test(name)) rmSync(path.join(OUT, name));
mkdirSync(OUT, { recursive: true });
let bytes = 0;
frames.forEach((frame, i) => {
  const text = JSON.stringify(frame);
  bytes += text.length;
  writeFileSync(path.join(OUT, `F${String(i + 1).padStart(3, '0')}.luau`), `-- Generated by scripts/export-storm-replay.mjs\nreturn [==[${text}]==]\n`);
});
const at = (line ? best.peakKm : best.touchdownKm) ?? focus;
writeFileSync(path.join(OUT, 'Meta.luau'), `-- Generated by scripts/export-storm-replay.mjs\nreturn {
\tseed = ${seed},
\tframes = ${frames.length},
\ttickMs = ${TICK_MS},
\t-- Where the ${line ? 'line was at its best' : 'tornado touched down'}, in map miles east and south of the north-west corner.
\tfocusMiles = { x = ${(at.x / KM_PER_MILE).toFixed(2)}, y = ${(at.y / KM_PER_MILE).toFixed(2)} },
${line ? `\t-- No tornado: the line's storm, and touchdownFrame 4 so places that start 3 frames before it start at frame 1.
\ttornado = { stormId = ${JSON.stringify(String(best.stormId))}, peakMph = 0, touchdownFrame = 4 },
\tline = { stormId = ${JSON.stringify(String(best.stormId))}, mode = ${JSON.stringify(best.mode)}, halfLengthKm = ${Math.round(best.halfLengthKm)}, peakFrame = ${best.peakFrame} },`
  : `\ttornado = { stormId = ${JSON.stringify(String(best.stormId))}, peakMph = ${Math.round(best.peakMph)}, touchdownFrame = ${Math.round((best.startedHourUtc - first) / TICK_HOURS) + 1} },`}
}\n`);
const storms = frames.reduce((a, f) => a + f.storms.length, 0);
console.log(`wrote ${frames.length} frames (${(bytes / 1024).toFixed(0)} KB, ${(bytes / Math.max(1, storms)).toFixed(0)} bytes a storm, up to ${Math.max(...frames.map(f => f.storms.length))} storms a frame) to ${path.relative(ROOT, OUT)}; touchdown at map miles ${(at.x / KM_PER_MILE).toFixed(1)}, ${(at.y / KM_PER_MILE).toFixed(1)}`);
