import assert from 'node:assert/strict';
import { initializeOutlookCycle } from '../js/forecast/OutlookCycleEngine.js';
function cell(x,y){return {x,y,terrain:{elevationM:300},surface:{dewpoint:68},levels:{500:{windDirection:240,windSpeed:35},850:{windDirection:180,windSpeed:38}},features:{warmSector:true,synopticAscent:.75,synopticCoherence:.75},memory:{recovery:.9},derived:{cape:2400,cin:55,srh:220,bulkShear:44,lclAgl:1050,dcape:900,diagnostics:{forcing:.72},hazards:{tornadoProbability:2,hailProbability:5,windProbability:5}},dynamics:{convectiveReadiness:.85,forcingScore:.72},forecast:{initiationProbability:.62,stormCoverage:.82,initiationCorridor:.82,projectedStormTrackSupport:.85,capErosion:.7,discreteFraction:.72,linearFraction:.72,conditionalTornadoIntensity:.72,conditionalHailIntensity:.9,conditionalWindIntensity:.84}}}
const width=3,height=3,cells=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>cell(x,y)));
const world={width,height,validHourUtc:12,cellSizeKm:10,stateRevision:1,seed:4,config:{seed:4},setupForecast:{key:'dryline_cyclone',profile:{coverage:.78}},cells,getCell(x,y){return x<0||y<0||x>=width||y>=height?null:cells[y][x]}};
initializeOutlookCycle(world);
const d1=world.outlookCycle.products.day1;
assert.equal(d1.validStartHour,12);assert.equal(d1.validEndHour,36);
assert.ok(d1.grid.some(c=>c.hailProbability>=30),'peak hail should not remain tied to the weak 12Z current probability');
assert.ok(d1.grid.some(c=>c.windProbability>=15),'peak wind should use coverage/intensity overlap');
assert.ok(d1.grid.every(c=>c.peakHourUtc>=12&&c.peakHourUtc<=36));
console.log('outlook peak overlap 2.23.1 passed');
