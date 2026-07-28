import assert from 'node:assert/strict';
import { buildSpatialPlacementDiagnostics } from '../js/verification/ForecastVerificationEngine.js';
const product={grid:[
 {risk:'SLGT',categories:{tornado:'SLGT'},tornadoProbability:5,tornadoCig:0},
 {risk:'MDT',categories:{tornado:'MDT'},tornadoProbability:15,tornadoCig:2},
 {risk:'TSTM',categories:{tornado:'TSTM'},tornadoProbability:0,tornadoCig:0}
]};
const truth={
 tornadoExact:Uint8Array.from([1,1,0]),hailExact:new Uint8Array(3),windExact:new Uint8Array(3),
 risk:['MDT','MDT','TSTM'],
 observedProbability:{tornado:Uint8Array.from([15,15,0]),hail:new Uint8Array(3),wind:new Uint8Array(3)},
 observedCig:{tornado:Uint8Array.from([2,2,0]),hail:new Uint8Array(3),wind:new Uint8Array(3)}
};
const d=buildSpatialPlacementDiagnostics(product,truth);
assert.equal(d.hazards.tornado.eventCellCount,2);
assert.equal(d.hazards.tornado.underforecastRate,.5);
assert.equal(d.hazards.tornado.forecastCategoryCounts.SLGT,1);
assert.equal(d.hazards.tornado.forecastCategoryCounts.MDT,1);
console.log('spatial outlook verification 2.28.15.1: ok');
