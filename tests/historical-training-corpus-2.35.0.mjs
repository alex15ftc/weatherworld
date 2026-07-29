import assert from 'node:assert/strict';
import { validateNormalizedSpcRecord, createTrainingCorpusCatalog } from '../js/historical/HistoricalTrainingCorpus.js';

const payload = {
  normalizedProduct: {
    schemaVersion: 'test',
    forecastDay: 'day1',
    issuedAt: '2024-05-06T16:30:00.000Z',
    validStart: '2024-05-06T16:30:00.000Z',
    validEnd: '2024-05-07T12:00:00.000Z',
    sourceFormat: 'spc-shapefile',
    hazards: {
      categorical: [{ value: 'SLGT', polygons: [{ outer: [[-101, 31], [-92, 31], [-92, 39], [-101, 31]], holes: [] }] }]
    }
  }
};
const good = validateNormalizedSpcRecord(payload, { sourceFile: 'day1_20240506_1630.json' });
assert.equal(good.valid, true);
assert.equal(good.recordId, '20240506-day1-1630');
assert.equal(good.stats.polygonCount, 1);
assert.deepEqual(good.stats.bounds, { minLon: -101, maxLon: -92, minLat: 31, maxLat: 39 });

const badPayload = structuredClone(payload);
badPayload.normalizedProduct.hazards.categorical[0].polygons[0].outer[1] = [1100000, 450000];
const bad = validateNormalizedSpcRecord(badPayload, { sourceFile: 'bad.json' });
assert.equal(bad.valid, false);
assert.ok(bad.errors.some(item => item.includes('invalid longitude/latitude')));

const catalog = createTrainingCorpusCatalog([{ sourceFile: 'day1_20240506_1630.json', validation: good }], { generatedAt: '2026-07-29T00:00:00.000Z' });
assert.equal(catalog.purpose, 'backend-training-corpus');
assert.equal(catalog.summary.validCount, 1);
assert.equal(catalog.records[0].sourceFile, 'day1_20240506_1630.json');
console.log('historical training corpus 2.35.0 passed');
