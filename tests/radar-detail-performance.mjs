globalThis.ImageData = class ImageData { constructor(width,height){this.width=width;this.height=height;this.data=new Uint8ClampedArray(width*height*4);} };
import { Atmosphere } from '../js/atmosphere.js?v=2.17.0';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js?v=2.17.0';
import { initializeEvolution } from '../js/evolution.js?v=2.17.0';
import { createRadarSnapshot, rasterizeRadar } from '../js/radar/RadarRenderer.js?v=2.20.0';
import { createStormInternalField, evolveStormInternalField } from '../js/storms/StormInternalField.js?v=2.20.0';
const world=new Atmosphere(50,50);initializeEvolution(world,generateScenario(world,515151));
world.storms=[{id:'TOR-1',active:true,positionKm:{x:260,y:250},velocityKph:{east:45,north:25},lifecycleState:'mature',intensity:.95,organization:.9,rotationStrength:.92,orientationDeg:25,mode:'discrete supercell',radar:{radiusXKm:28,radiusYKm:18,maxReflectivityDbz:76},hazards:{tornadoProbability:.8,hailProbability:.7,windProbability:.5},eventTags:['supercell','tornado'],ageHours:2,coldPoolStrength:.55,environment:{}}];
const env={cape:3500,bulkShear:55,srh:360,dewpoint:70,lcl:650,forcing:.8,effectiveInflow:.95,readiness:.95};
createStormInternalField(world.storms[0],env,515151); for(let i=0;i<20;i++)evolveStormInternalField(world.storms[0],env,1/12);
const snap=createRadarSnapshot(world);const t=performance.now();const z=rasterizeRadar(snap,'reflectivity','composite');const elapsed=performance.now()-t;
const v=rasterizeRadar(snap,'velocity','composite'),cc=rasterizeRadar(snap,'correlationCoefficient','composite');
let max=-Infinity,minCc=Infinity,minV=Infinity,maxV=-Infinity;for(const x of z.values)if(x>max)max=x;for(const x of cc.values)if(x<minCc)minCc=x;for(const x of v.values){if(x<minV)minV=x;if(x>maxV)maxV=x;}
if(max<65)throw new Error(`weak reflectivity ${max}`);if(minCc>.8)throw new Error(`missing debris signature ${minCc}`);if(minV>-20||maxV<20)throw new Error(`missing velocity couplet ${minV}/${maxV}`);if(elapsed>1500)throw new Error(`radar raster too slow ${elapsed}`);
console.log(JSON.stringify({elapsedMs:+elapsed.toFixed(1),maxDbz:+max.toFixed(1),minCc:+minCc.toFixed(2),velocity:[+minV.toFixed(1),+maxV.toFixed(1)]},null,2));
