import assert from 'node:assert/strict';
import { initializeOutlookCycle } from '../js/forecast/OutlookCycleEngine.js';

function cell(x,y){
  return {
    x,y,terrain:{elevationM:250},surface:{dewpoint:72},
    levels:{500:{windDirection:245,windSpeed:42},850:{windSpeed:52}},
    features:{warmSector:true,synopticAscent:.9,synopticCoherence:.9},memory:{recovery:.98},
    derived:{cape:2600,cin:45,srh:330,bulkShear:52,lclAgl:850,midLevelLapseRate:7.5,freezingLevelM:3300,dcape:1100,stp:5.5,diagnostics:{forcing:.86},hazards:{tornadoProbability:5,hailProbability:15,windProbability:15}},
    dynamics:{convectiveReadiness:.94,forcingScore:.86},
    forecast:{initiationProbability:.76,stormCoverage:.96,initiationCorridor:.9,projectedStormTrackSupport:.94,capErosion:.8,discreteFraction:.84,linearFraction:.8,conditionalTornadoIntensity:1.04,conditionalHailIntensity:1.0,conditionalWindIntensity:1.02}
  };
}
const width=9,height=9,cells=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>cell(x,y)));
const world={width,height,validHourUtc:12,cellSizeKm:10,stateRevision:1,seed:2232,config:{seed:2232},setupForecast:{key:'dryline_cyclone',profile:{coverage:.92}},cells,getCell(x,y){return x<0||y<0||x>=width||y>=height?null:cells[y][x]}};
initializeOutlookCycle(world);
const grid=world.outlookCycle.products.day1.grid;
assert.ok(grid.some(v=>v.hailCig>=1),'projected hail CIG1 should be possible');
assert.ok(grid.some(v=>v.windCig>=1),'projected wind CIG1 should be possible');
assert.ok(grid.every(v=>v.tornadoCig<3 || v.tornadoProbability>=30),'tornado CIG3 requires 30% probability');
assert.ok(grid.every(v=>v.windCig<3 || v.windProbability>=45),'wind CIG3 requires 45% probability');
assert.ok(grid.every(v=>v.trajectory && Number.isFinite(v.trajectory.dxCells)),'outlook cells retain trajectory diagnostics');
console.log('forecast CIG and trajectory 2.23.2 passed');
