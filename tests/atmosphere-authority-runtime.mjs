import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';
import { SurfaceAnalysisRuntime } from '../server/SurfaceAnalysisRuntime.js';

// The live authority: every product the
// pages ask for is served, and the clock moves storms and atmosphere together.
const runtime = new WeatherAuthorityRuntime({ seed: 2, spinUpDays: 6 });
const world = runtime.atmosphere;

// --- Products.
const meta = runtime.metadata();
assert.equal(meta.seed, 2);
assert.equal(meta.validHourUtc, 12);
assert.equal(meta.outlookStatus.enabled, false, 'outlooks are not issued on this engine yet');
assert.equal(meta.spatialIntegrity.ok, true);
runtime.advance(10);   // to 22Z
assert.equal(world.validHourUtc, 22);
assert.equal(world.stormEngine.validHourUtc, 22);
for (const product of ['temperature', 'dewpoint', 'cape']) assert.equal(runtime.liveField(product).width, world.width, `${product} field`);
assert.ok(Array.isArray(runtime.boundaries()), 'boundaries');
assert.ok(Array.isArray(runtime.storms().storms), 'storms');
assert.ok(runtime.cellSummary(25, 30).instability.cape >= 0 && runtime.sounding(25, 30).profile.length > 10, 'cell summary and sounding');
{ const sounding = runtime.sounding(25, 30); assert.ok(['PDS TOR', 'TOR', 'MRGL TOR', 'SVR', 'MRGL SVR', 'NONE'].includes(sounding.display.hazardType) && Number.isFinite(sounding.display.ship) && Number.isFinite(sounding.engineMotion.right.u) && Number.isFinite(sounding.params.parcels.mostUnstable.cape), 'the sounding carries its hazard type, table values and the engine\'s storm motion'); }
assert.ok(runtime.mapManifest({}).overlays.isobars.length > 0, 'map overlays');
assert.ok((await runtime.productTile({ scope: 'live', z: 1, x: 0, y: 0, product: 'temperature', day: 'day1' })).length > 100, 'tiles');
const catalog = runtime.radarCatalog();
assert.ok(catalog.sites.length > 0 && (await runtime.radarMosaic()).bytes.length > 0 && (await runtime.radarScan(catalog.sites[0].id, 0.5)).products.reflectivity, 'radar');
assert.equal(runtime.outlook('day1'), null);

// --- The clock (12x since 2026-10-15): storms move every 5 simulated minutes (25 real
// seconds), the atmosphere every half hour (2.5 real minutes), and storms never run more than
// one step ahead.
const start = Date.now();
runtime.lastAdvancedAt = start; runtime.lastStormAdvancedAt = start;
assert.equal(runtime.advanceOnTimer(start + 10_000), false, 'nothing is due after 10 seconds');
runtime.advanceOnTimer(start + 76_000);
assert.equal(world.validHourUtc, 22);
assert.ok(Math.abs(world.stormEngine.validHourUtc - 22.25) < 1e-5, 'three storm ticks in 75 seconds');
runtime.advanceOnTimer(start + 151_000);
assert.equal(world.validHourUtc, 22.5);
assert.ok(Math.abs(world.stormEngine.validHourUtc - 22.5) < 1e-6, 'atmosphere and storms meet at the half hour');
runtime.advanceOnTimer(start + 151_000 + 55_000);
assert.ok(world.stormEngine.validHourUtc > world.validHourUtc && world.stormEngine.validHourUtc <= world.validHourUtc + 0.5 + 1e-6);
runtime.advance(1);
assert.equal(world.validHourUtc, 23.5);
assert.ok(Math.abs(world.stormEngine.validHourUtc - 23.5) < 1e-6, 'a manual advance brings both to the same time');
runtime.setAutoAdvance(false);
assert.equal(runtime.advanceOnTimer(Date.now() + 600_000), false, 'a paused clock does not move');

// --- The surface map can show this same world.
const surface = new SurfaceAnalysisRuntime({ atmosphere: runtime.engine });   // as the server does
const analysis = surface.analysis();
assert.equal(analysis.status, 'ready');
assert.equal(analysis.hourUtc, 23.5);
runtime.advance(0.5);
assert.equal(surface.analysis().hourUtc, 0, 'and the map follows it');

// --- A reset starts a new world.
assert.equal(runtime.reset(3).seed, 3);
assert.equal(runtime.atmosphere.validHourUtc, 12);
assert.notEqual(runtime.atmosphere, world);
// --- With a state file the world is resumed at the hour it was saved, unless a seed is given.
{
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'weatherworld-')), 'atmosphere-state.bin');
  const first = new WeatherAuthorityRuntime({ seed: 4, statePath, spinUpDays: 4 });
  first.advance(5);
  while (first.savingState) await first.savingState;   // the save from the advance follows the one from start-up
  const second = new WeatherAuthorityRuntime({ statePath, spinUpDays: 4 });
  assert.equal(second.seed, 4);
  assert.equal(second.atmosphere.validHourUtc, 17, 'resumed at the saved hour');
  assert.equal(second.atmosphere.storms.length, first.atmosphere.storms.length);
  assert.equal(second.liveField('temperature').max, first.liveField('temperature').max);
  const fresh = new WeatherAuthorityRuntime({ seed: 5, statePath, spinUpDays: 4 });
  assert.equal(fresh.atmosphere.validHourUtc, 12, 'an explicit seed starts fresh');
  while (fresh.savingState) await fresh.savingState;
  fs.rmSync(path.dirname(statePath), { recursive: true, force: true });
}
console.log('atmosphere authority runtime passed');
