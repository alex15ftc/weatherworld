import assert from 'node:assert/strict';
import { initializeTornadoState, updateTornadoState } from '../js/storms/TornadoEngine.js';

function makeStorm() {
  const storm = {
    id:'stp-invariance', mode:'right-moving supercell', lifecycleState:'mature', ageHours:1.5,
    intensity:.82, organization:.86, updraftStrength:.84, rotationStrength:.72,
    mesocycloneStrength:.76, inflowQuality:.84, coldPoolStrength:.48,
    interactionQuality:.88, interactionSuppression:.05, positionKm:{x:100,y:100},
    velocityKph:{east:42,north:18}, orientationDeg:65, tornadoHistory:[]
  };
  initializeTornadoState(storm);
  return storm;
}
const base = {
  lcl:900, srh:310, bulkShear:52, cape:2450, cin:45, readiness:.88,
  openWarmSectorSupport:.84, prefrontalSupercellSupport:.81, tornadicEnvironmentSupport:.86,
  synopticAscent:.76, synopticCoherence:.88, moisturePooling:.79, capErosion:.82,
  boundaryInfluence:.30, outflowConvergence:.10,
  mesoscale:{effectiveInflow:.88,stretchingPotential:.74,interactionQuality:.90,processedAirFraction:.03,stormCompetition:.06}
};
function run(stp) {
  const world={validHourUtc:18,stormEngine:{validHourUtc:18},evolution:{config:{seed:9182}}};
  const storm=makeStorm();
  for(let i=0;i<30;i++) {
    world.stormEngine.validHourUtc += 5/60;
    storm.ageHours += 5/60;
    updateTornadoState(world,storm,{...base,stp},5/60);
  }
  return {
    state:storm.tornado.state,onGround:storm.tornado.onGround,cycles:storm.tornado.cycleCount,
    favorable:storm.tornado.favorableMinutes,potential:storm.tornado.genesisPotential,
    wind:storm.tornado.windSpeedMph,peak:storm.tornado.peakWindSpeedMph,
    ceiling:storm.tornado.environmentWindCeilingMph,path:storm.tornado.pathLengthKm
  };
}
assert.deepEqual(run(0),run(15));
console.log('STP non-causal tornado physics: ok');
