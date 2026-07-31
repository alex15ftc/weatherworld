import assert from 'node:assert/strict';
import { generateAtmosphericSeed, createSeededRandom } from '../scripts/generate-atmospheric-seed.mjs';

const names = [
  'thermodynamics.capeMaxJkg','thermodynamics.capeMeanJkg','thermodynamics.cinMeanJkg','thermodynamics.dewpointMeanK',
  'windProfile.wind850MeanMs','windProfile.wind500MeanMs','windProfile.wind250MeanMs','windProfile.shear850To500Ms',
  'synoptic.meanSeaLevelPressurePa','synoptic.jetStrengthMs','synoptic.moistureTransportProxy',
  'spatial.capeCoverage1000Proxy','spatial.forcingInstabilityOverlapProxy','spatialDirect.peakTimeFraction',
  'spatialDirect.capeCentroidX','spatialDirect.capeCentroidY','spatialDirect.capeCorridorOrientationDeg'
];
const normalization = { features: Object.fromEntries(names.map(name => [name, {
  mean: name.includes('Pressure') ? 101000 : name.includes('dewpoint') ? 285 : name.includes('cape') ? 1200 : name.includes('Orientation') ? 90 : 20,
  standardDeviation: name.includes('Pressure') ? 900 : name.includes('cape') ? 800 : name.includes('Centroid') || name.includes('Fraction') || name.includes('Coverage') || name.includes('Overlap') ? .2 : 12,
  p10: name.includes('Pressure') ? 99500 : 0,
  p90: name.includes('Pressure') ? 102500 : name.includes('cape') ? 3000 : name.includes('Centroid') || name.includes('Fraction') || name.includes('Coverage') || name.includes('Overlap') ? 1 : 100
}])) };
const opts = { analogs: false, normalization };
const first = generateAtmosphericSeed('weather-world-2410', opts);
const second = generateAtmosphericSeed('weather-world-2410', opts);
const third = generateAtmosphericSeed('weather-world-2411', opts);
assert.deepEqual(first.inputs, second.inputs, 'Same seed must reproduce identical atmospheric inputs.');
assert.deepEqual(first.latentState, second.latentState, 'Same seed must reproduce identical latent state.');
assert.notDeepEqual(first.inputs, third.inputs, 'Different seeds should produce different atmospheric inputs.');
assert.equal(first.validation.valid, true);
assert.equal(first.schemaVersion, '2.41.0');
assert.ok(first.narrative.synopticPattern);
const a = createSeededRandom('repeat'); const b = createSeededRandom('repeat');
assert.deepEqual([a(),a(),a()], [b(),b(),b()]);
console.log('2.41.0 atmosphere-first seed generator regression: PASS');
