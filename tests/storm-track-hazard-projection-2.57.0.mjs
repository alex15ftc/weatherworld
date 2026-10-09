import assert from 'node:assert/strict';
import { buildForecastStormProjection, applyForecastStormProjection } from '../js/forecast/ForecastStormProjectionEngine.js';

const width=20,height=12;
const grid=Array.from({length:width*height},(_,i)=>({
  peakInitiation:0.02, projectedStormOccupancy:0.03, hazardOverlapScore:0,
  confidence:80, leadTimeConfidence:.8, persistenceSignal:70,
  conditionalTornadoIntensity:0.05, conditionalHailIntensity:0.08, conditionalWindIntensity:0.06,
  tornadoProbability:2,hailProbability:5,windProbability:5,
  trajectory:{dxCells:4,dyCells:1,mode:'discrete'},
  hazardTrajectories:{tornado:{dxCells:4,dyCells:1},hail:{dxCells:4,dyCells:1},wind:{dxCells:5,dyCells:1}}
}));
const origin=5*width+4;
Object.assign(grid[origin],{
  peakInitiation:.86,projectedStormOccupancy:.82,hazardOverlapScore:.75,
  conditionalTornadoIntensity:.9,conditionalHailIntensity:.8,conditionalWindIntensity:.3
});
const projection=buildForecastStormProjection(grid,width,height,{key:'day1'});
assert.ok(projection.candidates.length>=1,'creates forecast storm candidates');
assert.ok(projection.fields.tornado.some(v=>v>0.005),'creates tornado swath');
const before=grid.filter(c=>c.tornadoProbability>=2).length;
applyForecastStormProjection(grid,width,height,{key:'day1'});
const after=grid.filter(c=>c.tornadoProbability>=2).length;
assert.ok(after<before,'storm projection narrows broad environmental background');
assert.ok(grid.some(c=>c.forecastStormProjection?.tornadoSupport>0),'stores per-cell attribution');
console.log('2.57.0 storm-track and hazard projection regression: PASS');
