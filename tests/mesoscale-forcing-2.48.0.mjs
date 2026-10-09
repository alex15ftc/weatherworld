import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findInitiationCandidates } from '../js/storms/InitiationEngine.js';
import { critiqueVerification, aggregateCritiques } from '../js/verification/CalibrationCritic.js';

const cells = Array.from({length:25}, (_,i) => {
  const x=i%5,y=Math.floor(i/5), center=x===2;
  return {x,y,forecast:{initiationProbability:.04,capFailureProbability:.55,forcingConfidence:.6,releaseProbability:.5,convectivePotential:.7,capErosion:.75,surfaceBasedTiming:.8,stormCoverage:.6},dynamics:{initiationPotential:.04,convectiveReadiness:.65,triggerStrength:center?.7:.2},mesoscaleFields:{initiationFocus:center?.75:.12,convergenceCorridor:center?.8:.1},features:{synopticAscent:center?.6:.15,explicitBoundaryInfluence:center?.8:.05,boundaryConvergence:center?.75:.05,primaryBoundaryId:center?'DL-1':null,primaryBoundaryType:center?'dryline':null,warmSector:true},derived:{cin:15,sounding:{mucape:2200},cape:2200}};
});
const world={width:5,height:5,cellSizeKm:10,setupForecast:{profile:{coverage:.5},key:'dryline_cyclone'},evolution:{elapsedHours:12,config:{seed:2,scenarioEvolution:{narrative:'mixed_mode',peakHour:20,developmentHours:10}}},getCell:(x,y)=>cells[y*5+x]};
const candidates=findInitiationCandidates(world,[],20);
assert.ok(candidates.length>0);
assert.ok(candidates.every(c=>typeof c.corridorId==='string'));
assert.ok(candidates.some(c=>c.corridorId.startsWith('boundary:DL-1:segment:')));
assert.ok(candidates.some(c=>c.boundaryType==='dryline'));

const stormSource=fs.readFileSync(new URL('../js/storms/StormEngine.js',import.meta.url),'utf8');
assert.match(stormSource,/corridorCooldowns/);
assert.match(stormSource,/dailyBudget/);
assert.match(stormSource,/perCorridorThisSlot/);

const critic=critiqueVerification({atmosphericEnvironmentSamples:[],event:{initiations:40,initiationCorridors:{uniqueCorridors:4,boundaryRootedFraction:.7}},products:[],forecast:{byDay:{day1:{}},latestIssuedByDay:{day1:null}}},{});
assert.ok(critic.flags.some(f=>f.code==='EXCESSIVE_STORM_BIRTHS'));
const agg=aggregateCritiques([{score:.8,risk:{label:'SLGT'},critic:{environmentScore:null,consistencyScore:.8,spatialScore:.5,flags:[]}}]);
assert.equal(agg.meanEnvironmentScore,null);
console.log('2.48.0 mesoscale forcing corridor regression: PASS');
