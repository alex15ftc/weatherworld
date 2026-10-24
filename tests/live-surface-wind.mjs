import assert from 'node:assert/strict';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';

const runtime = new WeatherAuthorityRuntime({
  seed: 20270503,
  // (4 until 2026-10-23. With the jet stream the mean wind at the ground under its core is nearly
  // calm (the shear takes most of the lower layer's wind away at the ground), so the surface wind
  // is the weather systems', and from noise they take two to three weeks to grow: 2.6 kt at most
  // after 10 days, 15.6 after 20.)
  spinUpDays: 20
});
const field = runtime.liveField('windSurface');
assert.ok(field.max > 3, `surface-wind live field was blank (max=${field.max})`);
assert.ok(field.max > field.min, `surface-wind live field lacked spatial variation (${field.min}–${field.max})`);
console.log(`surface wind ${field.min.toFixed(1)}–${field.max.toFixed(1)} kt`);
