import assert from 'node:assert/strict';
import { activeStormRealization } from '../js/forecast/OutlookCycleEngine.js';

const world = {
  cellSizeKm: 10,
  storms: [{
    active: true,
    positionKm: { x: 105, y: 105 },
    velocityKph: { east: 0, north: 0 },
    lifecycleState: 'mature',
    intensity: .86,
    organization: .88,
    radar: { radiusXKm: 26 },
    confidence: { persistence: .86, organization: .9, hazard: .88, tornado: .82, hail: .84, wind: .72 },
    hazards: { tornadoProbability: .58, hailProbability: .72, windProbability: .52 },
    surfaceWind: { gustMph: 68 },
    tornado: { onGround: false }
  }]
};

const near = activeStormRealization(world, 10, 10, 1);
const far = activeStormRealization(world, 40, 40, 1);
const longLead = activeStormRealization(world, 10, 10, 18);
assert.ok(near.signal >= 60, `mature nearby storm should have strong realization signal, got ${near.signal}`);
assert.ok(near.tornado >= 5, `nearby mature supercell should raise tornado probability, got ${near.tornado}`);
assert.ok(near.hail >= 15, `nearby mature storm should raise hail probability, got ${near.hail}`);
assert.ok(near.wind >= 15, `observed severe gust should raise wind probability, got ${near.wind}`);
assert.equal(far.signal, 0, 'far cells should not inherit active-storm realization');
assert.deepEqual(longLead, { tornado: 0, hail: 0, wind: 0, signal: 0 }, 'active storms should not dominate long-range forecasts');
console.log('2.28.1 storm realization regression passed');
