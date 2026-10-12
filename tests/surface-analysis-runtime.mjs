import assert from 'node:assert/strict';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { SurfaceAnalysisRuntime } from '../server/SurfaceAnalysisRuntime.js';

// A short spin-up is enough here: the checks are on the product, not on the weather.
const atmosphere = new AtmosphereWorld({ seed: 2, spinUpDays: 3 });
const surface = new SurfaceAnalysisRuntime({ atmosphere });

// --- The analysis: stations scattered over the map (not on a grid), with sensible reports.
atmosphere.advance(10);   // to 22Z, mid-afternoon
const analysis = surface.analysis();
assert.equal(analysis.status, 'ready');
assert.equal(analysis.hourUtc, 22);
assert.equal(analysis.seed, 2);
assert.ok(analysis.stations.length >= 80, `${analysis.stations.length} stations`);
const { widthKm, heightKm, cellKm, columns, rows } = analysis.domain;
for (const station of analysis.stations) {
  assert.ok(station.xKm > 0 && station.xKm < widthKm && station.yKm > 0 && station.yKm < heightKm, 'stations are on the map');
  assert.ok(station.temperatureF > 20 && station.temperatureF < 120 && station.dewpointF <= station.temperatureF, `temperature ${station.temperatureF}/${station.dewpointF}`);
  assert.ok(station.pressureHpa > 960 && station.pressureHpa < 1050, `pressure ${station.pressureHpa}`);
  assert.ok(station.windKt >= 0 && station.windKt < 90 && station.windFromDeg >= 0 && station.windFromDeg < 360);
}
const onCellCentres = analysis.stations.filter(s => Math.abs(((s.xKm / cellKm) % 1) - 0.5) < 0.02 && Math.abs(((s.yKm / cellKm) % 1) - 0.5) < 0.02).length;
assert.ok(onCellCentres < 3, 'stations do not sit on the cell grid');
for (let i = 0; i < analysis.stations.length; i++) for (let j = i + 1; j < analysis.stations.length; j++) assert.ok(Math.hypot(analysis.stations[i].xKm - analysis.stations[j].xKm, analysis.stations[i].yKm - analysis.stations[j].yKm) >= 54, 'stations are not crowded');

// --- A station reports what the field is at its spot.
{
  const station = analysis.stations[5], i = Math.floor(station.yKm / cellKm) * columns + Math.floor(station.xKm / cellKm);
  assert.ok(Math.abs(station.temperatureF - analysis.fields.temperatureF[i]) <= 4, 'station temperature matches the field around it');
  assert.equal(analysis.fields.temperatureF.length, columns * rows);
}

// --- Lines and storms come with what the page needs to draw them.
assert.ok(analysis.isobars.length > 0, 'isobars');
for (const line of analysis.boundaries) {
  assert.ok(['cold', 'warm', 'stationary', 'dryline', 'outflow'].includes(line.type));
  assert.ok(line.pointsKm.length >= 2 && (line.symbolSide === 1 || line.symbolSide === -1) && Number.isFinite(line.advanceMph));
}
assert.ok(Array.isArray(analysis.storms));
for (const storm of analysis.storms) assert.ok(storm.xKm >= 0 && storm.strength >= 0.15 && Number.isFinite(storm.hailInches) && Number.isFinite(storm.towardDeg));
assert.ok(JSON.stringify(analysis).length < 400_000, 'the payload stays small');

// --- Mesoanalysis fields: every listed parameter is served for the whole map, with what the
// page needs to draw it.
assert.ok(analysis.parameters.length >= 20, `${analysis.parameters.length} parameters`);
for (const { key, group, label } of analysis.parameters) {
  const field = surface.parameter(key);
  assert.ok(group && label, `${key} has a group and a label`);
  assert.equal(field.values.length, columns * rows, `${key} covers the map`);
  assert.ok(field.values.every(Number.isFinite), `${key} is finite everywhere`);
  assert.ok(field.levels.length > 2 && field.levels.every((v, i) => i === 0 || v > field.levels[i - 1]), `${key} has rising contour levels`);
  assert.ok(field.shade.length >= 2 && field.shade.every((stop, i) => stop.length === 5 && (i === 0 || stop[0] > field.shade[i - 1][0])), `${key} has a colour scale`);
}
const cape = surface.parameter('mlcape'), world = atmosphere.world;
assert.equal(cape.values[20 * columns + 35], Math.round(world.cells[20][35].derived.sounding.mlcape), "a field is the cells' own values");
assert.ok(Math.max(...cape.values) > 500, 'there is instability somewhere in the afternoon');
const upper = surface.parameter('wind500');
assert.ok(upper.barbs.length > 50 && upper.second.label === 'height' && upper.second.values.every(v => v > 500 && v < 620), 'upper-air fields carry wind barbs and heights');
assert.equal(surface.parameter('nonsense'), null);

// --- History: one frame per atmosphere step, the newest followed by default, older ones kept
// as they were.
assert.deepEqual(surface.analysis().stations, analysis.stations, 'the same analysis until the world moves on');
const before = surface.analysis().frames.length;
atmosphere.advance(0.5); surface.capture();
atmosphere.advance(0.5); surface.capture();
const later = surface.analysis();
assert.equal(later.hourUtc, 23);
assert.equal(later.latest, true);
assert.equal(later.frames.length, before + 2);
assert.notEqual(later.revision, analysis.revision);
const past = surface.analysis(later.frames.at(-3));
assert.equal(past.hourUtc, 22);
assert.equal(past.latest, false);
assert.deepEqual(past.stations, analysis.stations, 'an older frame is served as it was');
assert.deepEqual(surface.parameter('mlcape', later.frames.at(-3)).values, cape.values, 'with its fields');
assert.notDeepEqual(surface.parameter('temperature').values, surface.parameter('temperature', later.frames.at(-3)).values);
for (let step = 0; step < 40; step++) { atmosphere.advance(0.5); surface.capture(); }
assert.equal(surface.analysis().frames.length, 36, 'only the last 18 hours are kept');

// --- Same seed, same stations and weather; another world can be attached.
const again = new AtmosphereWorld({ seed: 2, spinUpDays: 3 }); again.advance(10);
const other = new SurfaceAnalysisRuntime({ atmosphere: again });
assert.deepEqual(other.analysis().stations.map(st => [st.id, st.xKm, st.yKm]), analysis.stations.map(st => [st.id, st.xKm, st.yKm]), 'the same network for the same seed');
surface.attach(again);
assert.equal(surface.analysis().hourUtc, 22);
console.log(`surface analysis passed (${analysis.stations.length} stations, ${analysis.isobars.length} isobars, ${analysis.storms.length} storms, lines: ${analysis.boundaries.map(b => b.type).join(', ') || 'none'})`);
