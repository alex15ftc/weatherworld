// The light under a storm (js/storms/StormLight.js) and the cloud and rain optics (js/storms/CloudOptics.js),
// on a made box: a thick low base round the point with a clear gap to its south-west.
import assert from 'node:assert/strict';
import { stormLight } from '../js/storms/StormLight.js';
import { diffuseTransmittance, rainExtinctionPerKm, TAU_LIQUID_PER_GM2, TAU_ICE_PER_GM2 } from '../js/storms/CloudOptics.js';
import { SATELLITE } from '../js/satellite/Satellite.js';

// Optics: the satellite's numbers, a thick cloud passes a few percent, heavy rain ~2 /km.
assert.equal(SATELLITE.reUm, 10); assert.equal(SATELLITE.dgeUm, 50); assert.equal(SATELLITE.g, 0.85);
assert.ok(Math.abs(TAU_LIQUID_PER_GM2 - 0.15) < 1e-9 && Math.abs(TAU_ICE_PER_GM2 - 0.067) < 0.001);
assert.ok(diffuseTransmittance(50) > 0.13 && diffuseTransmittance(50) < 0.16 && diffuseTransmittance(200) < 0.05 && diffuseTransmittance(0) === 1);
assert.ok(rainExtinctionPerKm(50) > 1 && rainExtinctionPerKm(50) < 3, `heavy rain ${rainExtinctionPerKm(50)}`);
assert.ok(rainExtinctionPerKm(5) < rainExtinctionPerKm(50) && rainExtinctionPerKm(0) === 0);

// A 40 km box at 1 km, the point at its middle: low cloud (base 800 m, optical depth 150) within 8 km,
// except a gap from 4 km out between bearings 200 and 250; rain of 40 mm/h north of the point.
const nx = 40, ny = 40, dx = 1000, anchorX = 20000, anchorY = 20000, N = nx * ny;
const runs = new Array(N), low = new Uint8Array(N), rain = new Float64Array(N);
for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
  const k = (j - 1) * nx + (i - 1), x = (i - 0.5) * dx - anchorX, y = (j - 0.5) * dx - anchorY, r = Math.hypot(x, y) / 1000;
  const brg = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360, gap = brg > 200 && brg < 250 && r > 4;
  const cloudy = r < 8 && !gap;
  runs[k] = cloudy ? [[800, 9000, 150]] : [];
  low[k] = cloudy ? 1 : 0;
  rain[k] = cloudy && y > 1000 ? 40 : 0;
}
const cols = { nx, ny, dx, anchorX, anchorY, runs, low, rain };
const L = stormLight(cols, { x: 0, y: 0 }, { baseM: 800, sun: { elevationDeg: 30, azimuthDeg: 225 } });
assert.equal(L.overhead.tau, 150);
assert.ok(Math.abs(L.overhead.transmittance - diffuseTransmittance(150)) < 0.001);
assert.ok(L.slot && L.slot.bearingDeg >= 200 && L.slot.bearingDeg <= 250, `the slot's bearing ${L.slot?.bearingDeg}`);
assert.ok(L.slot.distanceKm >= 4 && L.slot.distanceKm <= 5 && L.slot.openness === 1);
const north = L.bearings.find(b => b.deg === 0), south = L.bearings.find(b => b.deg === 180);
assert.ok(north.rainTau > 0.5 && south.rainTau === 0, 'rain to the north only');
assert.ok(north.sideWeight < south.sideWeight, 'the rain dims the gap past it');
assert.ok(L.slot.weight > south.sideWeight, 'the near gap lights more than the far edge');
// The sun from the south-west comes through the gap only above the cloud's base... it starts under the base
// inside the low cloud's ring, so the ground sees it only through 4 km of cloud at 30 degrees: none.
assert.ok(L.sun[0].direct < 0.01 && L.sun.every(x => !x.leftBox));
// Moved into the gap, the sun reaches the ground.
const inGap = stormLight(cols, { x: -4500, y: -4500 }, { baseM: 800, sun: { elevationDeg: 30, azimuthDeg: 225 } });
assert.ok(inGap.sun[0].direct > 0.99 && inGap.overhead.tau === 0, 'in the clear slot: sunlit');
assert.equal(stormLight(cols, { x: 0, y: 0 }, { baseM: 800, sun: { elevationDeg: -5, azimuthDeg: 0 } }).sun, null, 'night');
console.log('storm-light: ok', JSON.stringify(L.slot));
