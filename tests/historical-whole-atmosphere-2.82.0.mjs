import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';

const world=new Atmosphere(24,18);
const config=generateScenario(world,41);
assert.equal(config.analogGuidance.analogProviderId,'noaa-narr-igra');
assert.match(config.analogGuidance.historicalAtmosphereEventDate,/^\d{4}-\d{2}-\d{2}$/);
assert.equal(config.analogGuidance.historicalAtmosphereSequence?.length,5);
assert.deepEqual(config.analogGuidance.historicalAtmosphereSequence.map(frame=>frame.hourUtc),[12,18,24,30,36]);
assert.ok(config.analogGuidance.historicalAtmosphereSequence.every(frame=>
  frame.width===16&&frame.height===10&&frame.fields.mslpHpa.length===160));
assert.ok(world.cells.flat().filter(cell=>cell.features?.historicalAtmosphereSource).length>world.width*world.height*.95);

initializeEvolution(world,config);
const initialMeanPressure=mean(world,cell=>cell.surface.seaLevelPressure);
const initialMeanHeight=mean(world,cell=>cell.levels[500].heightDm);
advanceAtmosphere(world,6,{advanceStorms:false});
assert.ok(world.synopticObjects?.fronts?.length>=3);
assert.ok(world.synopticObjects.fronts.every(front=>front.pointsKm.length>=2));
assert.ok(world.synopticObjects.fronts.some(front=>front.pointsKm.length<20));
assert.ok(Math.abs(mean(world,cell=>cell.surface.seaLevelPressure)-initialMeanPressure)>.05);
assert.ok(Math.abs(mean(world,cell=>cell.levels[500].heightDm)-initialMeanHeight)>.05);
assert.ok(world.cells.flat().filter(cell=>cell.features?.historicalAtmosphereSource).length>world.width*world.height*.95);
console.log({
  historicalDate:config.analogGuidance.historicalAtmosphereEventDate,
  frames:config.analogGuidance.historicalAtmosphereSequence.length,
  fronts:world.synopticObjects.fronts.map(front=>front.type),
  meanPressureChange:Number((mean(world,cell=>cell.surface.seaLevelPressure)-initialMeanPressure).toFixed(2)),
  mean500HeightChange:Number((mean(world,cell=>cell.levels[500].heightDm)-initialMeanHeight).toFixed(2))
});

function mean(world,getter){
  let total=0,count=0;
  world.forEachCell(cell=>{total+=getter(cell);count++;});
  return total/count;
}
