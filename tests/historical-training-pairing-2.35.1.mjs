import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateNormalizedSpcRecord, createTrainingCorpusCatalog, pairTrainingCorpus } from '../js/historical/HistoricalTrainingCorpus.js';

const sample = JSON.parse(await readFile('data/historical/normalized/spc/day1_20110427_1300.json', 'utf8'));
const validation = validateNormalizedSpcRecord(sample, { sourceFile: 'day1_20110427_1300.json' });
assert.equal(validation.valid, true, validation.errors.join('; '));
assert.equal(validation.metadata.eventDate, '2011-04-27');
assert.equal(validation.metadata.cycle, '1300');
assert.equal(validation.stats.hazardMaxima.categorical, 'HIGH');
assert.equal(validation.stats.hazardMaxima.tornado, 0.30);
assert.ok(validation.stats.hazardLevels.wind.includes(0.45));

const catalog = createTrainingCorpusCatalog([{ sourceFile: 'day1_20110427_1300.json', validation }], { generatedAt: '2026-01-01T00:00:00Z' });
const paired = pairTrainingCorpus({
  spcCatalog: catalog,
  era5ByDate: { '2011-04-27': { family: 'test' } },
  noaaCatalog: { records: [{ eventDate: '2011-04-27', intensity: { score: 1 }, outcomes: { tornado: 1 }, provenance: {} }] },
  generatedAt: '2026-01-01T00:00:00Z'
});
assert.equal(paired.summary.completeCount, 1);
assert.equal(paired.cases[0].status, 'complete');
assert.equal(paired.cases[0].spc.issuances[0].hazardMaxima.categorical, 'HIGH');
console.log('2.35.1 historical target validation and pairing regression passed.');
