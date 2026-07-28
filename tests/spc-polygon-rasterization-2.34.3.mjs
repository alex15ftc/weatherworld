import assert from 'node:assert/strict';
import { parseSpcLatLonText, normalizeSpcOutlook } from '../js/historical/spc/SPCOutlookParser.js';
import {
  SPC_RASTERIZER_VERSION,
  createSpcGeographicGrid,
  rasterizeSpcOutlook,
  cellBoundsFromGrid
} from '../js/historical/spc/SPCOutlookRasterizer.js';

assert.equal(SPC_RASTERIZER_VERSION, '2.34.3');

const source = `
PROBABILISTIC OUTLOOK POINTS DAY 1
... TORNADO ...
0.10 35009700 35009800 36009800 36009700 35009700
SIGN 35209780 35209720 35809720 35809780 35209780
&&
CATEGORICAL OUTLOOK POINTS DAY 1
... CATEGORICAL ...
MRGL 34509820 34509680 36209680 36209820 34509820
SLGT 35009790 35009710 36009710 36009790 35009790
&&
`;

const parsed = parseSpcLatLonText(source, {
  forecastDay: 'day1',
  issuedAt: '2024-05-06T16:30:00.000Z',
  validStart: '2024-05-06T16:30:00.000Z',
  validEnd: '2024-05-07T12:00:00.000Z'
});
const normalized = normalizeSpcOutlook(parsed);
const tornadoPolygon = normalized.hazards.tornado[0].polygons[0];
assert.equal(tornadoPolygon.estimatedGridCells, Math.round(tornadoPolygon.areaKm2 / 100));

const grid = createSpcGeographicGrid({
  minLon: -98.25,
  maxLon: -96.75,
  minLat: 34.75,
  maxLat: 36.25,
  cellSizeKm: 10
});
assert.equal(grid.cellSizeKm, 10);
assert.ok(grid.width > 10 && grid.height > 10);
assert.equal(grid.rowDirection, 'south');
const northwest = cellBoundsFromGrid(0, 0, grid);
assert.equal(northwest.maxLat, grid.bounds.maxLat);

const raster = rasterizeSpcOutlook(normalized, { grid, coverageSamples: 4 });
assert.equal(raster.schemaVersion, '2.34.3');
assert.equal(raster.forecastDay, 'day1');
assert.equal(raster.diagnostics.contourCount, 4);
assert.ok(raster.diagnostics.populatedCellCount > 0);
assert.ok(raster.cells.every(cell => cell.contourIds.length > 0));
assert.ok(raster.cells.every(cell => Object.values(cell.hazards).every(hazard => hazard.coverageFraction > 0 && hazard.coverageFraction <= 1)));

const tornadoCells = raster.cells.filter(cell => cell.hazards.tornado?.value === 0.10);
assert.ok(tornadoCells.length > 0);
assert.ok(tornadoCells.some(cell => cell.hazards.significantTornado?.significant === true));
assert.ok(tornadoCells.every(cell => cell.hazards.categorical?.value === 'SLGT' || cell.hazards.categorical?.value === 'MRGL'));
assert.ok(raster.cells.some(cell => cell.hazards.categorical?.value === 'SLGT'));
assert.ok(raster.cells.some(cell => cell.hazards.categorical?.value === 'MRGL'));
assert.ok(raster.contours.every(summary => Number.isFinite(summary.coveredCellEquivalents)));

const complete = rasterizeSpcOutlook(normalized, { grid, coverageSamples: 1, includeEmptyCells: true });
assert.equal(complete.cells.length, grid.width * grid.height);
assert.equal(complete.diagnostics.totalCellCount, grid.width * grid.height);
assert.ok(complete.cells.some(cell => cell.contourIds.length === 0));

console.log('2.34.3 SPC polygon rasterization: passed');
