import assert from 'node:assert/strict';
import { HISTORICAL_ANALOG_CATALOG } from '../js/analogs/generatedHistoricalAnalogCatalog.js';
import { calibrateIntensityScore, leaveOneOutCalibration, patternDistance } from '../js/analogs/AnalogCalibration.js';
import { chooseAnalogBlend } from '../js/scenarios/AnalogPatternLibrary.js';
import { buildAnalogEnsemble } from '../js/forecast/AnalogEnsembleEngine.js';
import { mulberry32 } from '../js/scenarios/math.js';

assert.ok(HISTORICAL_ANALOG_CATALOG.length>=8);
assert.equal(patternDistance(HISTORICAL_ANALOG_CATALOG[0].pattern,HISTORICAL_ANALOG_CATALOG[0].pattern),0);
const calibration=leaveOneOutCalibration(HISTORICAL_ANALOG_CATALOG);
assert.equal(calibration.sampleCount,HISTORICAL_ANALOG_CATALOG.length);
assert.ok(Number.isFinite(calibration.rmse));
assert.ok(Number.isFinite(calibration.rmseByBand.organized));
assert.ok(calibration.brierByThreshold[40]>=0&&calibration.brierByThreshold[40]<=1);
assert.ok(calibration.brierByHazard.tornado>=0&&calibration.brierByHazard.tornado<=1);
assert.ok(calibrateIntensityScore(50,calibration)>=0);

const analogGuidance=chooseAnalogBlend(mulberry32(404),'dryline_cyclone','mixed_mode',{targetBand:'significant'});
assert.ok(analogGuidance.historicalResiduals.length>=3);
const ensemble=buildAnalogEnsemble({seed:404,intensity:.7,analogGuidance},'day2',30);
assert.ok(new Set(ensemble.members.map(member=>member.historicalAnalogId)).size>1);
assert.ok(ensemble.means.realization>0&&ensemble.means.realization<=1);
console.log(`analog hindcast calibration passed: ${calibration.sampleCount} samples, RMSE ${calibration.rmse.toFixed(2)}`);
