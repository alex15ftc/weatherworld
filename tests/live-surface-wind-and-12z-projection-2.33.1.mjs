import assert from 'node:assert/strict';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';
import { projectEnvironmentAtHour } from '../js/forecast/OutlookCycleEngine.js';

const runtime = new WeatherAuthorityRuntime({
  seed: 20270503,
  checkpointPath: 'data/test-live-surface-wind-checkpoint.json'
});
const field = runtime.liveField('windSurface');
assert.ok(field.max > 3, `surface-wind live field was blank (max=${field.max})`);
assert.ok(field.max > field.min, `surface-wind live field lacked spatial variation (${field.min}–${field.max})`);

const candidates = [];
runtime.atmosphere.forEachCell(cell => candidates.push(cell));
const baseCell = candidates.sort((a, b) => (b.forecast?.stormCoverage ?? 0) - (a.forecast?.stormCoverage ?? 0))[0];
const cell = {
  ...baseCell,
  features: { ...baseCell.features, warmSector: true },
  forecast: { ...baseCell.forecast, openWarmSectorSupport: 0.8 }
};
const context = {
  issuedHourUtc: 12,
  elapsedHours: Number(runtime.atmosphere.evolution?.elapsedHours) || 0,
  config: runtime.atmosphere.evolution?.config ?? runtime.config
};
const morning = projectEnvironmentAtHour(cell, 12, context);
const afternoon = projectEnvironmentAtHour(cell, 21, context);
assert.ok(afternoon.attainableCape > 0, 'forecast projection omitted attainable instability');
assert.ok(
  afternoon.cape > morning.cape,
  `12Z forecast did not strengthen toward convective initiation (${morning.cape.toFixed(0)} -> ${afternoon.cape.toFixed(0)} J/kg)`
);
assert.ok(
  afternoon.capBreakProbability >= morning.capBreakProbability,
  `cap-break probability weakened into peak heating (${morning.capBreakProbability.toFixed(2)} -> ${afternoon.capBreakProbability.toFixed(2)})`
);
assert.ok(
  afternoon.projectedStormCoverage >= morning.projectedStormCoverage,
  `forecast storm coverage weakened into initiation (${morning.projectedStormCoverage.toFixed(2)} -> ${afternoon.projectedStormCoverage.toFixed(2)})`
);

console.log(`surface wind ${field.min.toFixed(1)}–${field.max.toFixed(1)} kt; projected CAPE ${morning.cape.toFixed(0)} -> ${afternoon.cape.toFixed(0)} J/kg; coverage ${(morning.projectedStormCoverage*100).toFixed(0)} -> ${(afternoon.projectedStormCoverage*100).toFixed(0)}%`);
