import assert from 'node:assert/strict';
import { applyConditionalIntensityHatch } from '../server/tiles/ProductTileRenderer.js';

const base=[200,180,160];
const marked=(level,x,y)=>applyConditionalIntensityHatch(base,x,y,level)[0]===18;

// CIG1 must be broken: the same diagonal contains both marked and unmarked runs.
assert.equal(marked(1,0,0),true);
assert.equal(marked(1,12,4),false);

// CIG2 must be a continuous single-direction diagonal.
assert.equal(marked(2,0,0),true);
assert.equal(marked(2,6,7),true); // x+y = 13
assert.equal(marked(2,6,6),false);

// CIG3 must contain both diagonal directions (cross hatch).
assert.equal(marked(3,0,0),true);
assert.equal(marked(3,6,6),true); // reverse diagonal x-y = 0
assert.equal(marked(3,5,7),true); // forward diagonal x+y = 12

// No CIG leaves the probability color untouched.
assert.deepEqual(applyConditionalIntensityHatch(base,0,0,0),base);
console.log('CIG rendering regression test passed.');
