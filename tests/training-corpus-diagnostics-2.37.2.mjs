import assert from 'node:assert/strict';
import { pairTrainingCorpus } from '../js/training/TrainingCorpus.js';

const paired = pairTrainingCorpus({
  spcCatalog: { records: [{ eventDate: '2020-01-01', valid: true, issuedAt: '2020-01-01T12:00:00Z' }] },
  era5ByDate: { '2020-01-01': { sample: true }, '2020-01-02': { sample: true } },
  noaaCatalog: { records: [{ eventDate: '2020-01-01', outcomes: {}, intensity: {} }] },
  generatedAt: '2020-01-03T00:00:00Z'
});

const complete = paired.cases.find(item => item.eventDate === '2020-01-01');
const partial = paired.cases.find(item => item.eventDate === '2020-01-02');
assert.equal(complete.status, 'complete');
assert.equal(complete.quality, 100);
assert.deepEqual(complete.missing, []);
assert.equal(partial.status, 'partial');
assert.equal(partial.quality, 33);
assert.deepEqual(partial.missing.sort(), ['noaaOutcomes', 'spcTargets']);
console.log('2.37.2 training corpus diagnostics tests passed.');
