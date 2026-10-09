import assert from 'node:assert/strict';
import { buildSpatialFieldVerification } from '../js/verification/ForecastVerificationEngine.js';

const width = 5;
const height = 3;
const n = width * height;
const grid = Array.from({ length: n }, () => ({
  risk: 'TSTM', tornadoProbability: 0, hailProbability: 0, windProbability: 0, peakInitiation: 0
}));
const truth = {
  width, height, cellMiles: 6.21371,
  risk: Array(n).fill('TSTM'),
  observedProbability: {
    tornado: new Uint8Array(n), hail: new Uint8Array(n), wind: new Uint8Array(n)
  },
  initiation: new Uint8Array(n)
};

for (const index of [6, 7, 11, 12]) {
  grid[index].risk = 'SLGT';
  grid[index].tornadoProbability = 5;
  grid[index].peakInitiation = 0.7;
  truth.risk[index] = 'SLGT';
  truth.observedProbability.tornado[index] = 5;
  truth.initiation[index] = 1;
}

const perfect = buildSpatialFieldVerification({ grid }, truth);
assert.equal(perfect.categoricalContours.atLeastSLGT.iou, 1);
assert.equal(perfect.hazards.tornado.contours['5pct'].iou, 1);
assert.equal(perfect.initiation.contour.iou, 1);
assert.equal(perfect.summary.spatialScore, 1);

const shiftedGrid = grid.map(cell => ({ ...cell, risk: 'TSTM', tornadoProbability: 0, peakInitiation: 0 }));
for (const index of [2, 3, 7, 8]) {
  shiftedGrid[index].risk = 'SLGT';
  shiftedGrid[index].tornadoProbability = 5;
  shiftedGrid[index].peakInitiation = 0.7;
}
const shifted = buildSpatialFieldVerification({ grid: shiftedGrid }, truth);
assert.ok(shifted.categoricalContours.atLeastSLGT.iou < 1);
assert.ok(shifted.categoricalContours.atLeastSLGT.centroidErrorMiles > 0);
assert.ok(shifted.summary.spatialScore < perfect.summary.spatialScore);

console.log('2.46.0 spatial verification framework regression: PASS');
