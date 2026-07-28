import assert from 'node:assert/strict';
import { Storm } from '../js/storms/Storm.js';
import { initializeTornadoState, updateTornadoState } from '../js/storms/TornadoEngine.js';

const world={validHourUtc:18,evolution:{config:{seed:227}},stormEngine:{validHourUtc:18,totalTornadoes:0}};
const storm=new Storm({id:'S0227',xKm:100,yKm:100,velocityEastKph:72,velocityNorthKph:18,sourceCell:{x:10,y:10},createdHourUtc:18,modeHint:'discrete supercell'});
storm.ageHours=.8; storm.lifecycleState='mature'; storm.intensity=.58; storm.organization=.66;
storm.updraftStrength=.62; storm.rotationStrength=.42; storm.mesocycloneStrength=.48;
storm.inflowQuality=.82; storm.coldPoolStrength=.32; storm.orientationDeg=72;
initializeTornadoState(storm);
const environment={lcl:1050,srh:285,bulkShear:49,cape:2350,readiness:.78,boundaryInfluence:.20,outflowConvergence:.10,openWarmSectorSupport:.78,prefrontalSupercellSupport:.72,tornadicEnvironmentSupport:.68,mesoscale:{effectiveInflow:.82,stretchingPotential:.58}};
let tornadoObserved=false;
for(let i=0;i<18;i++){
  world.stormEngine.validHourUtc+=1/12;
  updateTornadoState(world,storm,environment,1/12);
  tornadoObserved ||= storm.tornado.onGround || storm.tornadoHistory.length>0;
}
assert.ok(tornadoObserved,'A mature prefrontal supercell failed to produce a tornado within 90 minutes');
assert.ok(storm.tornado.genesisPotential>=.25,'Genesis potential remained artificially suppressed');
console.log('prefrontal tornado realization 2.22.7 passed');
