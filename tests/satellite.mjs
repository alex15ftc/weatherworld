// Satellite images (js/satellite/Satellite.js): the whole map at 2 km, deterministic; storm tops
// cold in the IR (their equilibrium levels' air, colder where they overshoot); clear ground warm;
// visible dark once the sun is down; the sun where the engine's day puts it.
import assert from 'node:assert/strict';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { buildSatellite, sunAt } from '../js/satellite/Satellite.js';
import { AnvilField } from '../js/satellite/AnvilField.js';
import { decodeSatelliteValue, encodeSatelliteValue, SATELLITE_KINDS } from '../js/satellite/SatelliteFormat.js';
import { REGIONAL_DEFAULTS } from '../js/atmosphere/RegionalAtmosphere.js';

// The sun: up at the engine's sunrise and down at its sunset, highest at noon, from the south.
const lat = 37.3;
assert.ok(Math.abs(sunAt(lat, REGIONAL_DEFAULTS.sunriseLocal).elevationDeg) < 0.5, 'sun on the horizon at sunrise');
assert.ok(Math.abs(sunAt(lat, REGIONAL_DEFAULTS.sunsetLocal).elevationDeg) < 0.5, 'sun on the horizon at sunset');
const noon = sunAt(lat, 12);
assert.ok(noon.elevationDeg > 60 && Math.abs(noon.azimuthDeg - 180) < 1, `noon sun high in the south, got ${JSON.stringify(noon)}`);
assert.ok(sunAt(lat, 17).azimuthDeg > 250, 'afternoon sun in the west');
const ROUND_TRIP = { ir: [[-80, -20.4, 15], 0.31], visible: [[0.04, 0.5, 1], 0.01], fog: [[-12.3, 0, 4.2], 0.13] };
for (const kind of SATELLITE_KINDS) for (const v of ROUND_TRIP[kind][0]) {
  const back = decodeSatelliteValue(kind, encodeSatelliteValue(kind, v));
  assert.ok(Math.abs(back - v) < ROUND_TRIP[kind][1], `${kind} ${v} round trip, got ${back}`);
}

const engine = new AtmosphereWorld({ seed: 2 }), world = engine.world;
let k = 0;
// To 21Z on the first day with an updraught to look at (2026-11-16: since the soundings keep the mixed layer's
// vapour, this seed's first afternoon has no storms; its second does).
const step = () => { engine.advanceStormLayer(1 / 12); if (++k % 6 === 0) engine.advance(0.5, { advanceStorms: false }); };
const hasStorm = () => world.storms.some(s => s.active !== false && s.geometry?.updraught);
while (Number(world.stormEngine.validHourUtc) % 24 < 21 - 1e-6 || k < 12) { step(); if (k > 600) break; }
for (let day = 0; day < 3 && !hasStorm(); day++) { for (let n = 0; n < 12; n++) step(); while (Number(world.stormEngine.validHourUtc) % 24 < 21 - 1e-6) step(); }
const anvils = new AnvilField().update(world), sat = buildSatellite(world, { seed: 2, regional: engine.regional, anvils });
assert.equal(sat.ir.length, sat.width * sat.height);
assert.ok(Math.abs(sat.width * sat.resKm - world.width * world.cellSizeKm) < sat.resKm, 'covers the map');
assert.deepEqual(buildSatellite(world, { seed: 2, regional: engine.regional, anvils: new AnvilField().update(world) }).ir, sat.ir, 'deterministic');
const irAt = (xKm, yKm) => decodeSatelliteValue('ir', sat.ir[Math.floor(yKm / sat.resKm) * sat.width + Math.floor(xKm / sat.resKm)]);
const visAt = (xKm, yKm) => decodeSatelliteValue('visible', sat.visible[Math.floor(yKm / sat.resKm) * sat.width + Math.floor(xKm / sat.resKm)]);

// The strongest storm's top: colder than -50 C within a few km of its updraught, and bright.
const domain = world.width * world.cellSizeKm;
const strong = world.storms.filter(s => s.active !== false && s.geometry?.updraught && s.positionKm.x > 10 && s.positionKm.y > 10 && s.positionKm.x < domain - 10 && s.positionKm.y < domain - 10)
  .sort((a, b) => (b.updraughtMs ?? 0) - (a.updraughtMs ?? 0))[0];
assert.ok(strong, 'a storm to look at');
let coldest = Infinity, brightest = 0;
for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) {
  coldest = Math.min(coldest, irAt(strong.geometry.updraught.xKm + dx, strong.geometry.updraught.yKm + dy));
  brightest = Math.max(brightest, visAt(strong.geometry.updraught.xKm + dx, strong.geometry.updraught.yKm + dy));
}
assert.ok(coldest < -50, `the strongest storm's top should be colder than -50 C, got ${coldest}`);
assert.ok(brightest > 0.35, `the strongest storm's top should be bright in the visible, got ${brightest}`);
// Somewhere is clear: the warmest pixel is near the ground's temperature (above 15 C on a warm afternoon).
let warmest = -Infinity;
for (const b of sat.ir) warmest = Math.max(warmest, decodeSatelliteValue('ir', b));
assert.ok(warmest > 15, `clear ground should read warm, got ${warmest}`);

// Night: the visible is dark everywhere.
{ const k0 = k; while (Number(world.stormEngine.validHourUtc) % 24 < 23.5 || Number(world.stormEngine.validHourUtc) % 24 > 23.99) { engine.advanceStormLayer(1 / 12); if (++k > k0 + 100) break; } }
for (let n = 0; n < 48; n++) engine.advanceStormLayer(1 / 12);
const night = buildSatellite(world, { seed: 2 });
assert.ok(night.sun.elevationDeg < 0, `should be night at ${night.sun.localHour} local`);
assert.ok(night.visible.every(b => decodeSatelliteValue('visible', b) === 0), 'visible is dark at night');
// Night fog (BT 10.3 - BT 3.9): clear ground a little positive (its emissivity at 3.9 um under 1),
// cirrus and anvils negative (the warm ground through them counts for more at 3.9 um).
// (clear: the IR within 1 K of the ground under it; high: tops colder than -40 C)
const clearFog = [], highFog = [];
for (let y = 0; y < night.height; y++) for (let x = 0; x < night.width; x++) {
  const p = y * night.width + x, bt = decodeSatelliteValue('ir', night.ir[p]), v = decodeSatelliteValue('fog', night.fog[p]);
  const c = world.getCell(Math.min(world.width - 1, Math.floor(x * night.resKm / world.cellSizeKm)), Math.min(world.height - 1, Math.floor(y * night.resKm / world.cellSizeKm)));
  if (Math.abs(bt - (c.surface.temperature - 32) / 1.8) < 1) clearFog.push(v); else if (bt < -40) highFog.push(v);
}
const median = a => a.sort((p, q) => p - q)[a.length >> 1];
assert.ok(clearFog.length > 20 && median(clearFog) > 0 && median(clearFog) < 2.5, `clear ground at night should read 0 to 2.5 K in the fog image, got ${median(clearFog)} (${clearFog.length})`);
assert.ok(highFog.length > 20 && median(highFog) < median(clearFog), `high cloud at night should read below clear ground in the fog image, got ${median(highFog)} (${highFog.length})`);
// The low cloud's two kinds: a world's cells carry both, and their larger is its low cloud.
world.forEachCell(c => assert.ok(Math.abs(Math.max(c.features.cloudStratus, c.features.cloudCumulus) - c.features.cloudLow) < 1e-12, 'cloudLow is the larger of stratus and cumulus'));
console.log(`satellite ok: ${sat.width}x${sat.height}, strongest storm top ${coldest.toFixed(1)} C, warmest ${warmest.toFixed(1)} C, sun ${sat.sun.elevationDeg.toFixed(1)} deg; night fog clear ${median(clearFog).toFixed(1)} K, high ${median(highFog).toFixed(1)} K`);
