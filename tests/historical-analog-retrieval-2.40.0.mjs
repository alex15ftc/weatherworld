import assert from 'node:assert/strict';
import { compareFeatureVectors, retrieveAnalogs, classifySynopticPattern } from '../scripts/training-analogs.mjs';

function record(eventDate, shift, quality = 1, roles = ['event']) {
  const normalized = {
    thermodynamics: { capeMaxJkg: shift, cinMeanJkg: shift * 0.5 },
    windProfile: { shear850To500Ms: shift, turning850To500Deg: shift * 0.2 },
    synoptic: { jetStrengthMs: shift, moistureTransportProxy: shift * 0.1 },
    spatial: { forcingInstabilityOverlapProxy: shift * 0.1 },
    spatialDirect: { capeCorridorElongation: shift * 0.1, peakTimeFraction: 0.5 }
  };
  return { eventDate, corpusRoles: roles, inputs: { normalized, raw: {
    thermodynamics: { capeMaxJkg: 3200 + shift * 10 }, windProfile: { shear850To500Ms: 24, turning850To500Deg: 40 },
    synoptic: { jetStrengthMs: 42, moistureTransportProxy: 0.12 }, spatial: { forcingInstabilityOverlapProxy: 0.6 },
    spatialDirect: { capeCorridorElongation: 2.1, peakTimeFraction: 0.5 }
  } }, quality: { score: quality }, labels: { outcomes: { tornadoReports: shift } } };
}

const query = record('2024-05-06', 0);
const close = record('2021-12-15', 0.2);
const medium = record('2011-04-27', 1.5);
const far = record('1974-04-03', 4);
const comparison = compareFeatureVectors(query.inputs.normalized, close.inputs.normalized);
assert.ok(comparison.atmosphericSimilarity > 0.8);
assert.equal(comparison.sharedFeatureCount, 9);
assert.ok(comparison.largestDifferences.length > 0);

const report = retrieveAnalogs(query, [query, far, close, medium], { top: 3, role: 'event' });
assert.deepEqual(report.results.map(result => result.eventDate), ['2021-12-15', '2011-04-27', '1974-04-03']);
assert.equal(report.results[0].rank, 1);
assert.ok(report.results[0].similarity > report.results[1].similarity);
assert.ok(report.confidence.score >= 0 && report.confidence.score <= 1);
assert.match(classifySynopticPattern(query), /Classic Plains cyclone/);
assert.equal(report.results[0].labels.outcomes.tornadoReports, 0.2);
console.log('2.40.0 historical analog retrieval regression test passed.');
