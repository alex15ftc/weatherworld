import assert from 'node:assert/strict';
import {
  ANALOG_GROUP_ORDER,
  EXCLUDED_RETRIEVAL_FEATURES,
  compareFeatureVectors,
  isRetrievalFeature,
  orderedGroupEntries
} from '../scripts/training-analogs.mjs';

const query = {
  thermodynamics: { capeMaxJkg: 1.0 },
  windProfile: { shear850To500Ms: 0.5 },
  synoptic: { jetStrengthMs: -0.25 },
  spatial: { capeCoverage2000Proxy: 0.4, spatialTensorAvailable: 1 },
  spatialDirect: { peakTimeFraction: 0.7, peakTimeIndex: 6, spatialTensorRead: 1 }
};
const candidate = {
  thermodynamics: { capeMaxJkg: 0.8 },
  windProfile: { shear850To500Ms: 0.4 },
  synoptic: { jetStrengthMs: -0.1 },
  spatial: { capeCoverage2000Proxy: 0.2, spatialTensorAvailable: 1 },
  spatialDirect: { peakTimeFraction: 0.65, peakTimeIndex: 6, spatialTensorRead: 1 }
};

for (const feature of EXCLUDED_RETRIEVAL_FEATURES) assert.equal(isRetrievalFeature(feature), false, `${feature} must be excluded.`);
assert.equal(isRetrievalFeature('quality.diagnosticCompleteness'), false);
assert.equal(isRetrievalFeature('spatialDirect.peakTimeFraction'), true);

const comparison = compareFeatureVectors(query, candidate);
assert.equal(comparison.sharedFeatureCount, 5);
assert.equal(comparison.groups.spatial.featureCount, 1);
assert.equal(comparison.groups.spatialDirect.featureCount, 1);
const explained = [...comparison.strongestMatches, ...comparison.largestDifferences].map(item => item.feature);
assert.ok(!explained.includes('spatial.spatialTensorAvailable'));
assert.ok(!explained.includes('spatialDirect.spatialTensorRead'));
assert.ok(!explained.includes('spatialDirect.peakTimeIndex'));

const unordered = { spatialDirect: 1, synoptic: 2, thermodynamics: 3, spatial: 4, windProfile: 5 };
assert.deepEqual(orderedGroupEntries(unordered).map(([name]) => name), ANALOG_GROUP_ORDER);

console.log('2.41.0.2 analog retrieval feature hygiene regression: PASS');
