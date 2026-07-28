import assert from 'node:assert/strict';
import { initializeStormStructure } from '../js/storms/StormStructureEngine.js';
import { createRadarSnapshot, rasterizeRadarValues } from '../js/radar/RadarRenderer.js';

const storm={id:'TEST',mode:'discrete supercell',positionKm:{x:250,y:250},velocityKph:{east:40,north:15},ageHours:2.5,lifecycleState:'mature',intensity:.9,organization:.88,updraftStrength:.92,coldPoolStrength:.35,mesocycloneStrength:.9,rotationStrength:.88,orientationDeg:35,mergeCount:0,hazards:{hailProbability:.8,tornadoProbability:.65},tornado:{active:true,intensity:.75},active:true};
initializeStormStructure(storm,{cape:3200,bulkShear:52,midlevelLapseRate:7.6,dewpoint:69},'test');
assert.ok(storm.structure.features.some(f=>f.type==='hookArc'));
assert.ok(storm.structure.features.some(f=>f.type==='hailCore'));
assert.ok(storm.structure.features.some(f=>f.type==='debris'));
const world={width:50,height:50,cellSizeKm:10,domainWidthKm:500,domainHeightKm:500,validHourUtc:21,stormEngine:{validHourUtc:21,revision:1},radarNetwork:{networkId:'test',scanNumber:1,stations:[{id:'KAAA',name:'A',status:'online',xKm:180,yKm:250,maxRangeKm:460,productRangesKm:{reflectivity:460,velocity:300,correlationCoefficient:230},blockedSectors:[]}]},storms:[storm],getCell(){return {terrain:{elevationM:0}}}};
const snap=createRadarSnapshot(world);
assert.ok(snap.storms[0].structure.features.length>=6);
const refl=rasterizeRadarValues(snap,'reflectivity','KAAA');
const vel=rasterizeRadarValues(snap,'velocity','KAAA');
const cc=rasterizeRadarValues(snap,'correlationCoefficient','KAAA');
let max=-Infinity,minV=Infinity,maxV=-Infinity,minCc=1,count=0;
for(const v of refl.values)if(Number.isFinite(v)){max=Math.max(max,v);if(v>20)count++;}
for(const v of vel.values)if(Number.isFinite(v)){minV=Math.min(minV,v);maxV=Math.max(maxV,v);}
for(const v of cc.values)if(Number.isFinite(v))minCc=Math.min(minCc,v);
assert.ok(max>65,`max dBZ ${max}`); assert.ok(count>500,'structured echo footprint');
assert.ok(minV<0&&maxV>0,`velocity ${minV}..${maxV}`); assert.ok(minCc<.85,`CC ${minCc}`);
console.log('2.24.0 radar physics passed', {max,count,minV,maxV,minCc});
