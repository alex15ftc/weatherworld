import assert from 'node:assert/strict';
import { shouldUpscaleIntoLine } from '../js/storms/StormModeEngine.js?v=2.17.0.3';
import { categoryFromHazard } from '../js/diagnostics/riskDiagnosis.js?v=2.17.0.3';

const storm = { mode:'discrete supercell', ageHours:5.8, coldPoolStrength:0.52 };
assert.equal(shouldUpscaleIntoLine(storm, 2, {linearFraction:0.48, forcing:0.55}), true);
assert.equal(shouldUpscaleIntoLine({...storm, ageHours:2}, 2, {linearFraction:0.48, forcing:0.55}), false);
assert.equal(categoryFromHazard('tornado', 15, 2), 'MDT');
assert.equal(categoryFromHazard('tornado', 30, 2), 'HIGH');
assert.equal(categoryFromHazard('wind', 60, 2), 'HIGH');
console.log('risk/upscale regression passed');
