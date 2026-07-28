import assert from 'node:assert/strict';
import { initializeOutlookCycle, updatePredictiveOutlooks } from '../js/forecast/OutlookCycleEngine.js?v=2.17.0';

const width=6,height=6;
const cells=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>({x,y,levels:{500:{windDirection:240,windSpeed:45}},surface:{},forecast:{stormCoverage:.55},dynamics:{forcingScore:.65,convectiveReadiness:.7},derived:{hazards:{tornadoProbability:x>2?10:2,hailProbability:x>2?30:5,windProbability:x>2?30:5},risk:'SLGT'}})));
const world={width,height,cellSizeKm:10,validHourUtc:12,cells,getCell(x,y){return x<0||y<0||x>=width||y>=height?null:cells[y][x]}};
initializeOutlookCycle(world);
assert.deepEqual(Object.keys(world.outlookCycle.products).sort(),['day1','day2','day3']);
assert.equal(world.outlookCycle.products.day1.cadenceHours,6);
assert.equal(world.outlookCycle.products.day2.cadenceHours,12);
assert.equal(world.outlookCycle.products.day3.cadenceHours,24);
const d1Issue=world.outlookCycle.products.day1.issuedHourUtc;
world.validHourUtc=17.5; updatePredictiveOutlooks(world); assert.equal(world.outlookCycle.products.day1.issuedHourUtc,d1Issue);
world.validHourUtc=18; updatePredictiveOutlooks(world); assert.equal(world.outlookCycle.products.day1.issuedHourUtc,18);
assert.ok(cells[0][0].predictiveOutlook.day3);
console.log('predictive outlook cycle passed');
