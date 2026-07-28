import assert from 'node:assert/strict';
import { categoryFromHazard } from '../js/diagnostics/riskDiagnosis.js';

// Exact probability × CIG categorical mappings from the supplied SPC matrix.
assert.equal(categoryFromHazard('tornado', 2, 0), 'MRGN');
assert.equal(categoryFromHazard('tornado', 2, 1), 'MRGN');
assert.equal(categoryFromHazard('tornado', 2, 2), 'MRGN');
assert.equal(categoryFromHazard('tornado', 2, 3), 'MRGN'); // unused falls back
assert.equal(categoryFromHazard('tornado', 10, 1), 'ENH');
assert.equal(categoryFromHazard('tornado', 15, 2), 'MDT');
assert.equal(categoryFromHazard('tornado', 30, 2), 'HIGH');
assert.equal(categoryFromHazard('tornado', 60, 1), 'HIGH');

assert.equal(categoryFromHazard('wind', 5, 2), 'SLGT');
assert.equal(categoryFromHazard('wind', 30, 3), 'ENH'); // unused falls back
assert.equal(categoryFromHazard('wind', 45, 3), 'HIGH');
assert.equal(categoryFromHazard('wind', 60, 2), 'HIGH');

assert.equal(categoryFromHazard('hail', 5, 2), 'SLGT');
assert.equal(categoryFromHazard('hail', 45, 2), 'MDT');
assert.equal(categoryFromHazard('hail', 60, 2), 'MDT');
console.log('hazard probability × CIG matrix 2.22.11: ok');
