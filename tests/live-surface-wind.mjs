import assert from 'node:assert/strict';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';

const runtime = new WeatherAuthorityRuntime({
  seed: 20270503,
  outlookWorkers: 0
});
const field = runtime.liveField('windSurface');
assert.ok(field.max > 3, `surface-wind live field was blank (max=${field.max})`);
assert.ok(field.max > field.min, `surface-wind live field lacked spatial variation (${field.min}–${field.max})`);
console.log(`surface wind ${field.min.toFixed(1)}–${field.max.toFixed(1)} kt`);
