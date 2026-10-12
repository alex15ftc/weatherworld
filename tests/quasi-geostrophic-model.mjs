import assert from 'node:assert/strict';
import { QuasiGeostrophicModel } from '../js/atmosphere/QuasiGeostrophicModel.js';

// Started from large disturbances, so the test reaches full-grown systems quickly. The small
// domain is only for checks that do not need the systems to settle: a domain much smaller
// than the default holds a single wave, which keeps strengthening.
const quick = { initialNoise: 4e-4 }, small = { nx: 64, ny: 32, initialNoise: 4e-4 };
const meanWind = model => (model.params.upperWindMs + model.params.lowerWindMs) / 2;
const disturbanceWind = model => { let sum = 0, n = 0; for (let j = 0; j < model.ny; j += 2) for (let i = 0; i < model.nx; i += 2) { const f = model.fieldsAt(i, j); sum += Math.hypot(f.midWind.u - meanWind(model), f.midWind.v); n++; } return sum / n; };

// --- The undisturbed state is the mean flow of each layer, with colder air to the north.
const calm = new QuasiGeostrophicModel({ nx: 64, ny: 32, initialNoise: 0 });
const p = calm.params, start = calm.fieldsAt(10, 20);
assert.ok(Math.abs(start.upperWind.u - p.upperWindMs) < 1e-9 && Math.abs(start.lowerWind.u - p.lowerWindMs) < 1e-9, 'layer mean winds');
assert.ok(start.surfaceWind.u < start.lowerWind.u && start.midWind.u > start.lowerWind.u && start.midWind.u < start.upperWind.u, 'the wind increases with height');
assert.equal(start.midWind.v, 0, 'the mean flow is zonal');
assert.ok(calm.fieldsAt(10, 26).layerTemperatureK < calm.fieldsAt(10, 14).layerTemperatureK, 'thermal wind: colder air to the north of westerly shear');

// --- The inversion is exact: the Laplacian and stretching of the streamfunctions give back the PV.
const model = new QuasiGeostrophicModel({ ...quick, seed: 5 });
{
  const lap = model.laplacian(model.psi1, new Float64Array(model.q1.length));
  let worst = 0, scale = 0;
  for (let k = 0; k < lap.length; k++) { worst = Math.max(worst, Math.abs(lap[k] + model.F * (model.psi2[k] - model.psi1[k]) - model.q1[k])); scale = Math.max(scale, Math.abs(model.q1[k])); }
  assert.ok(worst < 1e-6 * scale, `inversion residual ${(worst / scale).toExponential(1)}`);
}

// --- The mean state is unstable: disturbances grow into weather systems, and stay bounded.
const before = disturbanceWind(model);
model.advance(20 * 86400);
const after = disturbanceWind(model);
assert.ok(Number.isFinite(after), 'the run stays finite');
assert.ok(after > 3 && after > 3 * before, `systems grow from the disturbances (${before.toFixed(2)} -> ${after.toFixed(1)} m/s)`);
assert.ok(after < 25, `and settle at a realistic strength (${after.toFixed(1)} m/s)`);

// --- Deterministic for a seed; different seeds give different weather.
const run = seed => { const m = new QuasiGeostrophicModel({ ...small, seed }); m.advance(4 * 86400); return Array.from(m.psi2.subarray(0, 200)); };
assert.deepEqual(run(7), run(7));
assert.notDeepEqual(run(7), run(8));
console.log(`quasi-geostrophic model passed (disturbance wind ${before.toFixed(2)} -> ${after.toFixed(1)} m/s in 20 days)`);
