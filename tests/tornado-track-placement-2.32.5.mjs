import assert from 'node:assert/strict';
import { buildTornadoTrackPlacementDiagnostics } from '../js/verification/ForecastVerificationEngine.js';

const probabilities = [15, 5, 10, 10, 10];
const risks = ['MDT','SLGT','ENH','ENH','ENH'];
const grid = probabilities.map((probability,index) => ({
  tornadoProbability:probability,
  tornadoCig:2,
  categories:{tornado:risks[index],hail:'TSTM',wind:'TSTM'},
  risk:risks[index]
}));
const product = {
  overallRisk:'MDT',
  decisionTree:{drivingHazard:'tornado'},
  grid
};
const frames = [{
  tornadoTrackPoints:[
    {stormId:'A',xKm:35,yKm:5,hourUtc:20,ef:2},
    {stormId:'A',xKm:45,yKm:5,hourUtc:20.2,ef:3}
  ]
}];
const world = {width:5,height:1,cellSizeKm:10,cellSizeMiles:10};
const result = buildTornadoTrackPlacementDiagnostics(product,frames,world);

assert.equal(result.hazardDriver,'tornado');
assert.equal(result.tornadoCoreCategory,'MDT');
assert.equal(result.tornadoCount,1);
assert.equal(result.categoryExposure.ENH,1);
assert.equal(result.overallRiskExposure.ENH,1);
assert.equal(result.bullseye.tornadoHitRate,0);
assert.equal(result.bullseye.coreUtilizationWithin25Miles,0);
assert.equal(result.contourCapture['10pct'],1);
assert.equal(result.contourCapture['15pct'],0);
assert.ok(result.displacementMiles['15pct'].median>=30);
assert.ok(result.placementScore<50,'correct magnitude with a displaced MDT bullseye must receive a poor placement score');

console.log('2.32.5 tornado track placement regression passed');
