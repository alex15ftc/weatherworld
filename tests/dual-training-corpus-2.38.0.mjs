import assert from 'node:assert/strict';
import { pairTrainingCorpus } from '../js/training/TrainingCorpus.js';

const spcCatalog = { records: [{ eventDate: '2020-01-01', valid: true, issuedAt: '2020-01-01T12:00:00Z' }] };
const era5ByDate = { '1974-04-03': { cape: 1 }, '2020-01-01': { cape: 1 }, '2024-05-06': { cape: 1 } };
const noaaCatalog = { records: [{ eventDate: '1974-04-03' }, { eventDate: '2020-01-01' }] };
const result = pairTrainingCorpus({ spcCatalog, era5ByDate, noaaCatalog, generatedAt: '2026-01-01T00:00:00Z' });
const historic = result.cases.find(item => item.eventDate === '1974-04-03');
const modern = result.cases.find(item => item.eventDate === '2020-01-01');
const incomplete = result.cases.find(item => item.eventDate === '2024-05-06');
assert.equal(historic.corpusMembership.event.complete, true);
assert.equal(historic.corpusMembership.forecast.eligible, false);
assert.deepEqual(historic.missing, []);
assert.equal(modern.corpusMembership.forecast.complete, true);
assert.equal(incomplete.corpusMembership.event.complete, false);
assert.deepEqual(incomplete.corpusMembership.event.missing, ['noaaOutcomes']);
assert.equal(result.summary.eventCompleteCount, 2);
assert.equal(result.summary.forecastCompleteCount, 1);
console.log('2.38.0 dual training corpus tests passed.');
