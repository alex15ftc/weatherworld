// What a forecast run does not know: its timing error and its own weather upstream.
import assert from 'node:assert/strict';
import { QuasiGeostrophicModel } from '../js/atmosphere/QuasiGeostrophicModel.js';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { TIMING, UPSTREAM, timingErrorMs, perturbUpstream } from '../js/forecast/ensemblePerturbation.js';

// --- Timing: each run's own, the same every time for the same run, centred on none.
const errors = Array.from({ length: 4000 }, (_, k) => timingErrorMs(`9|36|${k}`));
const mean = errors.reduce((a, b) => a + b, 0) / errors.length, spread = Math.sqrt(errors.reduce((a, b) => a + (b - mean) ** 2, 0) / errors.length);
assert.ok(Math.abs(mean) < 0.08, `no lean either way (${mean.toFixed(3)})`);
assert.ok(Math.abs(spread - TIMING.spreadMs) < 0.08, `the spread asked for (${spread.toFixed(2)})`);
assert.equal(timingErrorMs('9|36|3'), timingErrorMs('9|36|3')); assert.notEqual(timingErrorMs('9|36|3'), timingErrorMs('9|36|4'));
assert.equal(timingErrorMs('9|36|3', 0), 0);

// --- A run whose systems travel faster reads the model further back, and the plan for where
// the map goes is still made for where the real map will be.
const world = new AtmosphereWorld({ seed: 3, spinUpDays: 3, storms: false, steering: false }), regional = world.regional, start = regional.origin.x;
regional.timingErrorMs = 2; world.advance(6);
const length = regional.model.lengthX, moved = ((regional.origin.x - start + length / 2) % length + length) % length - length / 2;
assert.ok(Math.abs(moved + 2 * 6 * 3600) < 1, `six hours at 2 m/s: 43 km back (${(moved / 1000).toFixed(1)} km)`);
assert.ok(Math.abs(regional.timingLeadM - 2 * 6 * 3600) < 1);
assert.equal(new AtmosphereWorld({ seed: 3, spinUpDays: 1, storms: false }).regional.timingErrorMs, 0, 'the live world has none');

// --- Upstream: nothing changes over the map, a good deal far to the west of it, and the
// difference reaches the map as the days pass.
const live = new QuasiGeostrophicModel({ seed: 4 }); live.advance(20 * 86400);
const copyOf = () => { const c = new QuasiGeostrophicModel(live.params); for (const key of ['q1', 'q2', 'psi1', 'psi2']) c[key].set(live[key]); c.time = live.time; c.history = live.history; return c; };
const centre = 5000e3, run = perturbUpstream(copyOf(), '4|36|1', centre), same = perturbUpstream(copyOf(), '4|36|1', centre), other = perturbUpstream(copyOf(), '4|36|2', centre), truth = copyOf();
const difference = (a, b, key, fromKm, toKm) => { let sum = 0, count = 0; for (let j = 0; j < a.ny; j++) for (let i = 0; i < a.nx; i++) { const west = (((centre - (i + 0.5) * a.d) % length0 + length0) % length0) / 1000; if (west >= fromKm && west < toKm) { sum += (a[key][j * a.nx + i] - b[key][j * a.nx + i]) ** 2; count++; } } return Math.sqrt(sum / count); };
const length0 = live.nx * live.d, size = Math.sqrt(live.q1.reduce((a, v) => a + v * v, 0) / live.q1.length);
assert.equal(difference(run, truth, 'q1', 0, UPSTREAM.knownKm), 0, 'no difference over the map');
assert.equal(difference(run, truth, 'q1', UPSTREAM.fadeToKm, length0 / 1000), 0, 'nor just east of it');
assert.ok(difference(run, truth, 'q1', UPSTREAM.fullKm, UPSTREAM.fadeFromKm) > 0.25 * size, 'a good deal far upstream');
assert.deepEqual(same.q1, run.q1, 'the same run gets the same difference'); assert.ok(difference(other, run, 'q1', UPSTREAM.fullKm, UPSTREAM.fadeFromKm) > 0.25 * size, 'another run gets another');
assert.deepEqual(perturbUpstream(copyOf(), 'x', centre, 0).q1, truth.q1);
const overMap = () => difference(run, truth, 'psi2', 0, 400) + difference(run, truth, 'psi2', length0 / 1000 - 400, length0 / 1000), reach = [overMap()];
for (let day = 1; day <= 3; day++) { run.advance(86400); truth.advance(86400); reach.push(overMap()); }
assert.ok(reach[1] > 1.5 * reach[0] && reach[2] > 1.3 * reach[1] && reach[3] > reach[2], `the difference over the map grows day by day (${reach.map(v => v.toExponential(1)).join(', ')})`);
console.log(`ensemble perturbation passed (difference over the map, relative to day 0: ${reach.map(v => (v / reach[0]).toFixed(1)).join(', ')})`);
