import assert from 'node:assert/strict';
import { fillEnclosedLowerAreas } from '../js/diagnostics/riskDiagnosis.js?v=2.17.0';

// A closed rank-3 ring around rank 2 must fill the center to rank 3.
const closed = new Uint8Array([
  0,0,0,0,0,0,0,
  0,3,3,3,3,3,0,
  0,3,2,2,2,3,0,
  0,3,2,1,2,3,0,
  0,3,2,2,2,3,0,
  0,3,3,3,3,3,0,
  0,0,0,0,0,0,0
]);
fillEnclosedLowerAreas(closed, 7, 7, 3);
assert.equal(closed[3 * 7 + 3], 3, 'closed lower-risk island should be promoted');

// A lower-risk channel connected to the map edge must remain lower.
const open = new Uint8Array([
  0,0,0,0,0,0,0,
  0,3,3,0,3,3,0,
  0,3,2,0,2,3,0,
  0,3,2,1,2,3,0,
  0,3,2,2,2,3,0,
  0,3,3,3,3,3,0,
  0,0,0,0,0,0,0
]);
fillEnclosedLowerAreas(open, 7, 7, 3);
assert.equal(open[3 * 7 + 3], 1, 'edge-connected lower-risk area should not be filled');

console.log('risk topology regression passed');
