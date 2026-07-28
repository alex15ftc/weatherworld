import assert from 'node:assert/strict';
import { initializeSetupForecast, updateSetupForecast } from '../js/scenarios/SetupForecastEngine.js';
import { initializeOutlookCycle, updatePredictiveOutlooks } from '../js/forecast/OutlookCycleEngine.js';

function cell(x,y){return {x,y,terrain:{elevationM:350,soilMoisture:.55},surface:{dewpoint:65},levels:{500:{windDirection:240,windSpeed:45},850:{windSpeed:38}},features:{warmSector:true,synopticAscent:.7,synopticCoherence:.72},mesoscaleFields:{effectiveInflow:.8,moisturePooling:.75},derived:{cape:2400,srh:240,bulkShear:52,lclAgl:850,stp:3,hazards:{tornadoProbability:15,hailProbability:30,windProbability:30}},dynamics:{convectiveReadiness:.78,triggerStrength:.65,initiationPotential:.72,forcingScore:.68}}}
const width=4,height=4,cells=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>cell(x,y)));
const world={width,height,cellSizeKm:10,validHourUtc:12,scenarioMetadata:{setupType:'dryline_cyclone'},evolution:{config:{setupType:'dryline_cyclone'}},cells,getCell(x,y){return x<0||y<0||x>=width||y>=height?null:cells[y][x]},forEachCell(fn){for(let y=0;y<height;y++)for(let x=0;x<width;x++)fn(cells[y][x],x,y)}};
initializeSetupForecast(world);
const noon=world.getCell(0,0).forecast.initiationProbability;
world.validHourUtc=21.5; updateSetupForecast(world);
const evening=world.getCell(0,0).forecast.initiationProbability;
assert.ok(evening > noon * 1.25, `expected late-afternoon CI peak: noon=${noon}, evening=${evening}`);
world.validHourUtc=0; world.stateRevision=1; world.seed=7; world.config={seed:7};
initializeOutlookCycle(world);
assert.equal(world.outlookCycle.products.day1.peakForecastHourUtc,23);
const prior=world.outlookCycle.products.day2;
world.validHourUtc=24; updatePredictiveOutlooks(world,{force:true});
assert.ok(world.outlookCycle.products.day1.grid.length===width*height);
assert.ok(prior.grid.length===width*height);
console.log('forecast recovery and timing calibration passed');
