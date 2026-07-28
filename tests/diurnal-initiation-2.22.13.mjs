import assert from 'node:assert/strict';
import { initializeSetupForecast, updateSetupForecast } from '../js/scenarios/SetupForecastEngine.js';
import { findInitiationCandidates } from '../js/storms/InitiationEngine.js';

function makeCell(x,y){
  return {
    x,y,
    terrain:{elevationM:350,soilMoisture:.52},
    surface:{dewpoint:66},
    levels:{500:{windDirection:240,windSpeed:46},850:{windSpeed:38}},
    features:{warmSector:true,synopticAscent:.62,synopticCoherence:.72,explicitBoundaryInfluence:.44,explicitBoundaryType:'dryline'},
    mesoscaleFields:{effectiveInflow:.78,moisturePooling:.72,convergenceCorridor:.50,initiationFocus:.54},
    derived:{cape:2600,cin:95,srh:235,bulkShear:52,lclAgl:900,stp:3},
    dynamics:{convectiveReadiness:.76,triggerStrength:.57,initiationPotential:.68,forcingScore:.62}
  };
}
function makeWorld(setupType='dryline_cyclone'){
  const width=8,height=8,cells=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>makeCell(x,y)));
  return {width,height,cellSizeKm:10,validHourUtc:12,scenarioMetadata:{setupType},evolution:{config:{setupType,seed:'diurnal-test'}},cells,
    getCell(x,y){return x<0||y<0||x>=width||y>=height?null:cells[y][x]},
    forEachCell(fn){for(let y=0;y<height;y++)for(let x=0;x<width;x++)fn(cells[y][x],x,y)}
  };
}

const world=makeWorld();
initializeSetupForecast(world);
const noon=world.getCell(3,3).forecast;
const noonCandidates=findInitiationCandidates(world,[],12);
world.validHourUtc=22;
updateSetupForecast(world);
const evening=world.getCell(3,3).forecast;
const eveningCandidates=findInitiationCandidates(world,[],22);
assert.ok(noon.surfaceBasedTiming < .10, `12Z surface timing too high: ${noon.surfaceBasedTiming}`);
assert.ok(noon.capErosion < .20, `12Z cap erosion too high: ${noon.capErosion}`);
assert.ok(evening.surfaceBasedTiming > .60, `22Z surface timing too low: ${evening.surfaceBasedTiming}`);
assert.ok(evening.capErosion > noon.capErosion * 3, `cap did not erode enough: ${noon.capErosion} -> ${evening.capErosion}`);
assert.ok(evening.initiationProbability > noon.initiationProbability * 4, `CI did not peak late enough: ${noon.initiationProbability} -> ${evening.initiationProbability}`);
assert.ok(eveningCandidates.length >= noonCandidates.length, `expected at least as many 22Z candidates: ${noonCandidates.length} vs ${eveningCandidates.length}`);

const nocturnal=makeWorld('elevated_mcs');
nocturnal.validHourUtc=3;
initializeSetupForecast(nocturnal);
const night=nocturnal.getCell(3,3).forecast;
assert.ok(night.nocturnalElevatedSupport > .20, `elevated nocturnal support missing: ${night.nocturnalElevatedSupport}`);
assert.ok(night.nightStability > 0, 'nighttime stabilization should still exist');
console.log('diurnal initiation and nocturnal elevated calibration passed');
