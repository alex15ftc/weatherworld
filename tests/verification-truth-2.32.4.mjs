import assert from 'node:assert/strict';
import { aggregateTruth, captureTruth, runSeedVerification } from '../js/verification/ForecastVerificationEngine.js';

const storm = {
  id: 'S1', active: true, intensity: 0.6, maxIntensity: 0.6,
  positionKm: { x: 5, y: 5 }, createdHourUtc: 12,
  mode: 'discrete supercell', lifecycleState: 'mature',
  hazards: { hailProbability: 0.95, windProbability: 0.95 },
  hazardExtremes: {
    tornado: { maxWindMph: 0, maxWidthYards: 0, maxPathLengthKm: 0, cycles: 0 },
    hail: { maxSizeInches: 0 },
    wind: { maxSustainedMph: 30, maxGustMph: 45 }
  },
  surfaceWind: { gustMph: 45 },
  tornado: { onGround: false, trackPoints: [] }, tornadoHistory: [],
  ageHours: 1, trackKm: 5, eventTags: []
};
const world = {
  width: 2, height: 1, cellSizeKm: 10, validHourUtc: 12,
  storms: [storm], stormEngine: { totalCreated: 1, totalTornadoes: 0 }
};
const frames = [], initiations = [], records = new Map();
captureTruth(world, frames, new Set(), initiations, records);
assert.equal(frames[0].hail[0], 0, 'hazard probability is not observed hail truth');
assert.equal(frames[0].wind[0], 0, 'hazard probability is not observed wind truth');
assert.equal(initiations.length, 1);

const movingFrames = [
  { storm: Uint8Array.from([1,0]), tornado:new Uint8Array(2), tornadoSig:new Uint8Array(2), tornadoExtreme:new Uint8Array(2), tornadoViolent:new Uint8Array(2), hail:new Uint8Array(2), hailSig:new Uint8Array(2), hailExtreme:new Uint8Array(2), wind:new Uint8Array(2), windSig:new Uint8Array(2), windExtreme:new Uint8Array(2) },
  { storm: Uint8Array.from([0,1]), tornado:new Uint8Array(2), tornadoSig:new Uint8Array(2), tornadoExtreme:new Uint8Array(2), tornadoViolent:new Uint8Array(2), hail:new Uint8Array(2), hailSig:new Uint8Array(2), hailExtreme:new Uint8Array(2), wind:new Uint8Array(2), windSig:new Uint8Array(2), windExtreme:new Uint8Array(2) }
];
const truth = aggregateTruth(movingFrames, [{ x:0, y:0, hourUtc:12 }], 2, 1, 0, 10);
assert.deepEqual([...truth.initiation], [1,0], 'storm movement must not create false initiation truth');

assert.throws(() => runSeedVerification(1, { hours:-1 }), /hours/);
assert.throws(() => runSeedVerification(1, { hours:1, stepHours:0 }), /stepHours/);
console.log('2.32.4 verification truth regression passed');
