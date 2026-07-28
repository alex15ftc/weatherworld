import assert from 'node:assert/strict';
import { rasterizeSpcOutlook } from '../js/historical/spc/SPCOutlookRasterizer.js';
import { createHistoricalOutlookCase, createHistoricalOutlookCatalog, assertCoordinateSpace, HISTORICAL_COORDINATE_SPACE } from '../js/historical/HistoricalOutlookDataset.js';

const polygon = {
  outer: [[-100, 35], [-99, 35], [-99, 36], [-100, 36], [-100, 35]],
  holes: [],
  bbox: { minLon: -100, maxLon: -99, minLat: 35, maxLat: 36 },
  estimatedGridCells: 100
};
const normalizedProduct = {
  schemaVersion: '2.34.2.6', forecastDay: 'day1', issuedAt: '2024-05-06T16:30:00.000Z',
  validStart: '2024-05-06T16:30:00.000Z', validEnd: '2024-05-07T12:00:00.000Z',
  hazards: {
    categorical: [{ id:'DAY1_TEST_CATEGORICAL_SLGT_01', hazardType:'categorical', value:'SLGT', polygons:[polygon] }],
    tornado: [{ id:'DAY1_TEST_TORNADO_10_01', hazardType:'tornado', value:.10, polygons:[polygon] }],
    wind: [], hail: [], significantTornado: [], significantWind: [], significantHail: []
  }
};
const rasterizedOutlook = rasterizeSpcOutlook(normalizedProduct, { coverageSamples: 2, paddingCells: 0 });
assert.equal(rasterizedOutlook.coordinateSpace, HISTORICAL_COORDINATE_SPACE);
const historicalCase = createHistoricalOutlookCase({
  originalProduct: { issueDate:'20240506', cycle:'1630', forecastDay:'day1' },
  normalizedProduct,
  rasterizedOutlook,
  sourceFile:'day1_20240506_1630.json'
});
assert.equal(historicalCase.caseId, '20240506-day1-1630');
assert.equal(historicalCase.completeness, 'outlook-only');
assert.equal(historicalCase.coordinateSpace, HISTORICAL_COORDINATE_SPACE);
assert.equal(historicalCase.available.outlook, true);
assert.ok(historicalCase.diagnostics.populatedCellCount > 0);
const catalog = createHistoricalOutlookCatalog([historicalCase], { generatedAt:'2026-07-28T00:00:00.000Z' });
assert.equal(catalog.summary.caseCount, 1);
assert.equal(catalog.cases[0].fileName, '20240506-day1-1630.json');
assert.throws(() => assertCoordinateSpace('fictional-world', HISTORICAL_COORDINATE_SPACE), /Coordinate-space mismatch/);
console.log('Historical outlook dataset 2.34.4 checks passed.');
