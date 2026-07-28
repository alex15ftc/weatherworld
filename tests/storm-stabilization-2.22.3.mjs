import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { initializeStormEngine, advanceStormEngine } from '../js/storms/StormEngine.js';
const world=new Atmosphere(12,12,10); world.validHourUtc=12; world.domainWidthKm=120;world.domainHeightKm=120;world.evolution={config:{seed:42}};world.setupForecast={key:'classic'};initializeStormEngine(world);
assert.equal(world.stormEngine.schemaVersion,3);assert.ok(Array.isArray(world.stormArchive));
world.storms=[{id:'STEST',active:false,parentId:null,children:[],mergedStormIds:[],mode:'multicell',createdHourUtc:10,ageHours:2,trackKm:30,maxIntensity:.7,peakRotationStrength:.4,peakUpdraftStrength:.8,surfaceWind:{maxGustMph:65},tornadoHistory:[],dissipationReason:'test'}];
advanceStormEngine(world,0,{initiate:false,applyFeedback:false});assert.equal(world.storms.length,0);assert.equal(world.stormArchive.length,1);assert.equal(world.stormArchive[0].id,'STEST');console.log('storm stabilization 2.22.3 ok');
