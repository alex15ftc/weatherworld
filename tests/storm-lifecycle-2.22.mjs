import assert from 'node:assert/strict';
import { Storm } from '../js/storms/Storm.js';
import { initializeTornadoState, updateTornadoState } from '../js/storms/TornadoEngine.js';

const world={validHourUtc:18,evolution:{config:{seed:42}},stormEngine:{validHourUtc:18,totalTornadoes:0}};
const storm=new Storm({id:'S0001',xKm:100,yKm:100,velocityEastKph:55,velocityNorthKph:20,sourceCell:{x:10,y:10},createdHourUtc:18,modeHint:'discrete supercell'});
storm.ageHours=2;storm.lifecycleState='mature';storm.intensity=.9;storm.organization=.92;storm.updraftStrength=.95;storm.rotationStrength=1;storm.inflowQuality=.95;storm.coldPoolStrength=.52;storm.orientationDeg=70;
initializeTornadoState(storm);
const environment={lcl:650,srh:420,bulkShear:58,cape:3300,readiness:.95,boundaryInfluence:.8,outflowConvergence:.5,mesoscale:{effectiveInflow:.95,stretchingPotential:.95}};
let touched=false;
for(let i=0;i<240;i++){
  world.stormEngine.validHourUtc += 1/12;
  updateTornadoState(world,storm,environment,1/12);
  if(storm.tornado.onGround || storm.tornadoHistory.length){touched=true;break;}
}
assert.ok(touched,'Strong tornadic supercell environment never produced a tornado lifecycle');
assert.ok(Number.isFinite(storm.tornado.forwardSpeedMph));
assert.ok(Number.isFinite(storm.tornado.motionDirectionDeg));
assert.ok(storm.tornado.windSpeedMph >= 0);
console.log(JSON.stringify({state:storm.tornado.state,onGround:storm.tornado.onGround,history:storm.tornadoHistory.length,probability:storm.tornado.probability},null,2));
