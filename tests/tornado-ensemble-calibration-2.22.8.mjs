import assert from 'node:assert/strict';
import { Storm } from '../js/storms/Storm.js';
import { initializeTornadoState, updateTornadoState } from '../js/storms/TornadoEngine.js';

let tornadoes=0;
for(let n=0;n<100;n++){
  const world={validHourUtc:18,evolution:{config:{seed:800+n}},stormEngine:{validHourUtc:18}};
  const storm=new Storm({id:`S${n}`,xKm:100,yKm:100,velocityEastKph:65,velocityNorthKph:15,sourceCell:{x:10,y:10},createdHourUtc:18,modeHint:'discrete supercell'});
  Object.assign(storm,{ageHours:.8,lifecycleState:'mature',intensity:.62,organization:.70,updraftStrength:.67,rotationStrength:.48,mesocycloneStrength:.54,inflowQuality:.84,coldPoolStrength:.34,orientationDeg:72});
  initializeTornadoState(storm);
  const environment={lcl:1050,srh:285,bulkShear:49,cape:2350,readiness:.78,boundaryInfluence:.20,outflowConvergence:.10,openWarmSectorSupport:.78,prefrontalSupercellSupport:.72,tornadicEnvironmentSupport:.68,mesoscale:{effectiveInflow:.82,stretchingPotential:.58,interactionQuality:.82,processedAirFraction:.08,stormCompetition:.12}};
  let observed=false;
  for(let i=0;i<24;i++){
    world.stormEngine.validHourUtc+=1/12;
    updateTornadoState(world,storm,environment,1/12);
    observed ||= storm.tornado.onGround || storm.tornadoHistory.length>0;
  }
  if(observed) tornadoes++;
}
assert.ok(tornadoes>=55,'Strong tornadic supercells should produce tornadoes commonly');
assert.ok(tornadoes<=90,'Not every strong supercell should automatically produce a tornado');
console.log({tornadoes,total:100});
