import assert from 'node:assert/strict';
import { aggregateCalibrationReports, selectStratifiedSeeds } from '../scripts/calibrate-outlooks.mjs';

const selected=selectStratifiedSeeds(1,1,10000);
assert.equal(Object.keys(selected).length,8);
assert.ok(Object.values(selected).every(seeds=>seeds.length===1),'failed to find every setup family');
assert.equal(new Set(Object.values(selected).flat()).size,8,'stratified selector reused a seed');

const report=(seed,setup,bias,forecastRisk,observedRisk)=>({
  seed,scenario:{setupType:setup,narrative:'test'},
  event:{totalTornadoes:1,peakConvectiveHourByDay:{day1:23}},
  forecast:{
    calibration:{tornado:{forecastBias:bias,meanPOD:.5,meanFAR:.2,meanCSI:.4},hail:{forecastBias:bias,meanPOD:.6,meanFAR:.3,meanCSI:.45},wind:{forecastBias:bias,meanPOD:.4,meanFAR:.25,meanCSI:.35}},
    byDay:{day1:{meanScore:50,latest:{forecastOverallRisk:forecastRisk,observedOverallRisk:observedRisk,peakForecastHourUtc:22.5,spatialPlacement:{tornadoTracks:{contourCapture:{'2pct':1,'5pct':.5},bullseye:{medianCoreDisplacementMiles:20}}}}}}
  }
});
const summary=aggregateCalibrationReports([
  report(1,'dryline_cyclone',-.1,'ENH','MDT'),
  report(2,'progressive_cold_front',.1,'SLGT','SLGT')
]);
assert.equal(summary.overall.seeds,2);
assert.equal(summary.overall.meanAbsoluteTimingErrorHours,.5);
assert.equal(summary.overall.tornadoTrackCapture.pct5,.5);
assert.equal(summary.bySetup.dryline_cyclone.hazards.wind.bias,-.1);
assert.equal(summary.overall.forecastRiskFrequency.ENH,1);
console.log('setup calibration aggregation passed');
