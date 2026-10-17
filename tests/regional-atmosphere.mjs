import assert from 'node:assert/strict';
import { QuasiGeostrophicModel } from '../js/atmosphere/QuasiGeostrophicModel.js';
import { RegionalAtmosphere } from '../js/atmosphere/RegionalAtmosphere.js';

// The regional layer on a briefly spun-up outer model: three days, sampled every hour. The
// checks are on behaviour that must come out of the processes, whatever the weather that day.
const model = new QuasiGeostrophicModel({ seed: 3, initialNoise: 4e-4 });
model.advance(8 * 86400);
// The whole geography, high ground included (the live map starts further east: see geographyOffset).
const regional = new RegionalAtmosphere(model, { geographyOffset: 0 });
const world = regional.world, nx = world.width, ny = world.height;
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const column = (x, read) => { const out = []; for (let y = 8; y < ny - 8; y++) out.push(read(world.cells[y][x], y * nx + x)); return mean(out); };
const uv = (speed, direction) => ({ u: -Math.sin(direction * Math.PI / 180) * speed, v: -Math.cos(direction * Math.PI / 180) * speed });

const hourly = new Map();
for (let step = 0; step < 3 * 48; step++) {
  regional.step();
  const utc = regional.hourUtc % 24;
  if (step < 48 || utc % 1 !== 0) continue;   // the first day settles the boundary layer
  const east = x => x >= nx - 12, sample = { t: [], cin: [], jet: [], turn: [], slow: [] };
  world.forEachCell((cell, x, y) => {
    for (const value of [cell.surface.temperature, cell.surface.dewpoint, cell.surface.pressure, cell.levels[850].windSpeed, cell.levels[850].temperature, cell.derived.sounding.mlcape]) assert.ok(Number.isFinite(value), 'every field stays finite');
    assert.ok(cell.surface.dewpoint <= cell.surface.temperature + 1e-6, 'the air is never more than saturated');
    if (!east(x)) return;
    const low = uv(cell.surface.wind.speed, cell.surface.wind.direction), jet = uv(cell.levels[850].windSpeed, cell.levels[850].windDirection);
    sample.t.push(cell.surface.temperature); sample.cin.push(Math.abs(cell.derived.sounding.mlcin)); sample.jet.push(cell.levels[850].windSpeed);
    sample.slow.push(cell.surface.wind.speed);
    if (cell.surface.wind.speed > 3 && cell.levels[850].windSpeed > 3) sample.turn.push(-Math.atan2(low.u * jet.v - low.v * jet.u, low.u * jet.u + low.v * jet.v) * 180 / Math.PI);
  });
  const record = hourly.get(utc) ?? hourly.set(utc, { t: [], cin: [], jet: [], turn: [], slow: [] }).get(utc);
  for (const key of Object.keys(sample)) if (sample[key].length) record[key].push(mean(sample[key]));
}
const cycle = key => [...hourly].map(([hour, record]) => ({ hour, value: mean(record[key]) }));
const highest = key => cycle(key).reduce((a, b) => (b.value > a.value ? b : a)), lowest = key => cycle(key).reduce((a, b) => (b.value < a.value ? b : a));
const within = (hour, from, to) => (from <= to ? hour >= from && hour <= to : hour >= from || hour <= to);

// --- The daily cycle is timed by the sun (local time is UTC - 6).
const warmest = highest('t'), coolest = lowest('t');
assert.ok(within(warmest.hour, 20, 0), `warmest in the late afternoon (${warmest.hour}Z)`);
assert.ok(within(coolest.hour, 10, 14), `coolest near sunrise (${coolest.hour}Z)`);
assert.ok(warmest.value - coolest.value > 12 && warmest.value - coolest.value < 32, `day-night range ${(warmest.value - coolest.value).toFixed(1)} F`);
// The sun wears the cap down through the day. (Not the single weakest hour: with the high
// ground on the map its afternoon mixed layer renews the lid nearby, and the cap stays about as
// weak from late morning to evening.)
const capBetween = (from, to) => mean(cycle('cin').filter(c => within(c.hour, from, to)).map(c => c.value));
assert.ok(capBetween(18, 22) < 0.8 * capBetween(9, 13), `the cap is weaker in the afternoon (${capBetween(18, 22).toFixed(0)} J/kg) than in the morning (${capBetween(9, 13).toFixed(0)})`);

// --- The low-level jet is a night-time feature, and the wind veers with height.
// By day the wind at the ground is the slower, backed foot of the mixed layer's wind.
const slower = mean(hourly.get(22).slow) / mean(hourly.get(22).jet);
assert.ok(slower < 0.85, `the afternoon wind at the ground is slower than at 850 mb (${(100 * slower).toFixed(0)}% of it)`);
assert.ok(mean(hourly.get(22).turn) > 10, `the wind veers from the surface to 850 mb (${mean(hourly.get(22).turn).toFixed(0)} degrees)`);

// --- At night the low-level wind's departure from balance is cut off from the ground and turns
// clockwise at the rate the Earth's rotation sets, keeping its size: the night-time jet.
{
  while (regional.hourUtc % 24 !== 1) regional.step();          // an hour or two after sunset
  const before = { u: Float64Array.from(regional.ageoU), v: Float64Array.from(regional.ageoV) }, hours = 4;
  for (let step = 0; step < hours * 2; step++) regional.step();
  const expected = model.params.f0 * hours * 3600 * 180 / Math.PI, turns = [], sizes = [];
  for (let k = 0; k < before.u.length; k += 7) {
    const size = Math.hypot(before.u[k], before.v[k]);
    if (size < 1) continue;
    // Clockwise turn from the earlier vector to the later one, in degrees.
    turns.push(Math.atan2(before.u[k] * regional.ageoV[k] - before.v[k] * regional.ageoU[k], before.u[k] * regional.ageoU[k] + before.v[k] * regional.ageoV[k]) * -180 / Math.PI);
    sizes.push(Math.hypot(regional.ageoU[k], regional.ageoV[k]) / size);
  }
  assert.ok(turns.length > 20, 'the mixed layer left a departure from balance at sunset');
  assert.ok(Math.abs(mean(turns) - expected) < 3, `it turns clockwise at the inertial rate (${mean(turns).toFixed(0)} against ${expected.toFixed(0)} degrees in ${hours} h)`);
  assert.ok(Math.abs(mean(sizes) - 1) < 0.02, 'and keeps its size');
}

// --- Geography that must follow from the terrain: pressure lower and the air drier and more
// deeply mixed over the high ground, moisture and the shallow moist layer in the east.
// Averaged over five afternoons: on any one, a passing system can bring moist air west or dry
// air east.
const west = 4, east = nx - 5, afternoons = { pressure: [], dewpoint: [], depth: [], southerly: [] };
for (let day = 0; day < 5; day++) {
  do regional.step(); while (regional.hourUtc % 24 !== 22);
  afternoons.pressure.push(column(west, c => c.surface.seaLevelPressure) - column(east, c => c.surface.seaLevelPressure));
  afternoons.dewpoint.push(column(west, c => c.surface.dewpoint) - column(east, c => c.surface.dewpoint));
  afternoons.depth.push(column(west, c => c.features.mixedLayerDepthM) - column(east, c => c.features.mixedLayerDepthM));
  afternoons.southerly.push(column(Math.floor(nx / 2), (c, k) => regional.thermalV[k]));
}
assert.ok(mean(afternoons.pressure) < -2, `lower pressure over the hot high ground (${mean(afternoons.pressure).toFixed(1)} hPa)`);
assert.ok(mean(afternoons.dewpoint) < -12, `dry air in the west, moist in the east (${mean(afternoons.dewpoint).toFixed(0)} F)`);
assert.ok(mean(afternoons.depth) > 400, `a deeper mixed layer over the high ground (${mean(afternoons.depth).toFixed(0)} m)`);
assert.ok(mean(afternoons.southerly) > 0, 'southerly balanced wind east of the thermal low');

// --- Deterministic.
const run = () => { const m = new QuasiGeostrophicModel({ nx: 64, ny: 32, seed: 4, initialNoise: 4e-4 }); m.advance(2 * 86400); const r = new RegionalAtmosphere(m, { columns: 20, rows: 20 }); for (let step = 0; step < 24; step++) r.step(); return r.world.cells[10].map(c => c.surface.dewpoint); };
assert.deepEqual(run(), run());
console.log(`regional atmosphere passed (warmest ${warmest.hour}Z, coolest ${coolest.hour}Z, range ${(warmest.value - coolest.value).toFixed(0)} F, afternoon wind at the ground ${(100 * slower).toFixed(0)}% of the 850 mb wind)`);
