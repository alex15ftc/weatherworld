import assert from 'node:assert/strict';
import { initializeMeteorologicalIntegrity, runMeteorologicalIntegrity } from '../js/atmosphere/MeteorologicalIntegrityEngine.js';

function makeCell(x,y){return{id:`${x},${y}`,surface:{temperature:80,dewpoint:65,seaLevelPressure:1008,wind:{direction:180,speed:25}},derived:{sbcape:1800,mlcape:2200,mucape:2400,cin:40,lcl:900,stp:3,rawStp:4},features:{boundaryConvergence:.5,synopticAscent:.5},forecast:{initiationProbability:.2},dynamics:{forcing:.5},airMassFractions:{maritimeTropical:.75,dryMixed:.1,continentalPolar:.05,coolStable:.05,outflowModified:.05},airMassAuthority:{warmMoistFraction:.75,dryFraction:.1,coldFraction:.1},airMass:{sector:'warm-sector'}};}
const width=12,height=12,cells=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>makeCell(x,y)));
const world={width,height,cellSizeKm:10,validHourUtc:18,runtime:{profile:{atmosphereStepHours:.5}},getCell(x,y){return x>=0&&y>=0&&x<width&&y<height?cells[y][x]:null;},forEachCell(fn){for(let y=0;y<height;y++)for(let x=0;x<width;x++)fn(cells[y][x],x,y);},synopticObjects:{surfaceLow:{x:60,y:20},fronts:[{id:'cold',type:'cold',confidence:.8,velocityKph:{east:14,north:2},pointsKm:[{x:60,y:20},{x:60,y:50},{x:60,y:80},{x:60,y:110}]},{id:'dry',type:'dryline',confidence:.8,velocityKph:{east:7,north:0},pointsKm:[{x:80,y:20},{x:80,y:50},{x:80,y:80},{x:80,y:110}]}]}};
// Make the cold side cooler and dryline dry side drier.
for(let y=0;y<height;y++)for(let x=0;x<width;x++){if(x<6){cells[y][x].surface.temperature=68;cells[y][x].surface.dewpoint=50;}if(x<8)cells[y][x].surface.dewpoint=Math.min(cells[y][x].surface.dewpoint,48);}
// Explicit impossible high STP in cold/dry air.
const bad=cells[5][4];bad.derived.stp=5;bad.derived.rawStp=6;bad.derived.sbcape=50;bad.airMass={sector:'post-cold-front'};bad.airMassFractions={maritimeTropical:.05,dryMixed:.15,continentalPolar:.7,coolStable:.1};bad.airMassAuthority={warmMoistFraction:.05,dryFraction:.15,coldFraction:.8};bad.features.boundaryRelative={frontId:'cold',type:'cold',side:'behind',distanceKm:15};

const first=initializeMeteorologicalIntegrity(world);
assert.equal(first.version,'2.70.0');
assert.ok(first.elapsedMs<100,'integrity pass should be lightweight');
assert.equal(bad.meteorologicalIntegrity.initiationCompatible,false);
assert.ok(first.errors.some(x=>x.code==='HIGH_STP_POST_COLD_FRONT'));
assert.ok(world.synopticObjects.fronts.every(f=>f.integrity?.version==='2.70.0'));
const second=runMeteorologicalIntegrity(world);
assert.ok(second.checks.boundaryMotionIndependence>=0&&second.checks.boundaryMotionIndependence<=1);
console.log('2.70.0 meteorological integrity and invariant enforcement: PASS');
