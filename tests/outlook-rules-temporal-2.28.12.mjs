import assert from 'node:assert/strict';
import { categoryFromHazard, publishedCigForHazard } from '../js/diagnostics/riskDiagnosis.js';
assert.equal(publishedCigForHazard('tornado',2,3),1);
assert.equal(publishedCigForHazard('tornado',5,2),1);
assert.equal(publishedCigForHazard('tornado',10,3),2);
assert.equal(categoryFromHazard('tornado',5,3),'SLGT');
assert.equal(categoryFromHazard('tornado',10,2),'ENH');
console.log('2.28.12 outlook rule tests passed');
