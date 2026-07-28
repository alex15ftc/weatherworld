import assert from 'node:assert/strict';
import { initializeTornadoState, updateTornadoState } from '../js/storms/TornadoEngine.js';

function makeStorm(id) {
  const storm={id,positionKm:{x:100,y:100},previousPositionKm:{x:100,y:100},velocityKph:{east:45,north:10},orientationDeg:20,ageHours:2,mode:'discrete supercell',lifecycleState:'mature',intensity:.72,organization:.72,updraftStrength:.72,rotationStrength:.68,mesocycloneStrength:.68,inflowQuality:.8,coldPoolStrength:.45,interactionSuppression:0};
  initializeTornadoState(storm);
  storm.tornado.onGround=true; storm.tornado.state='on-ground'; storm.tornado.windSpeedMph=75; storm.tornado.startedHourUtc=0;
  return storm;
}
const world={validHourUtc:0,stormEngine:{validHourUtc:0},evolution:{config:{seed:42}}};
const modest={stp:.45,lcl:1500,srh:125,bulkShear:38,cape:1350,readiness:.55,openWarmSectorSupport:.45,prefrontalSupercellSupport:.28,tornadicEnvironmentSupport:.25,synopticAscent:.25,synopticCoherence:.7,moisturePooling:.35,capErosion:.45,boundaryInfluence:.15,outflowConvergence:.05,mesoscale:{effectiveInflow:.58,stretchingPotential:.28,interactionQuality:.7,processedAirFraction:.1,stormCompetition:.15}};
const strong={stp:6.5,lcl:850,srh:360,bulkShear:58,cape:2900,readiness:.9,openWarmSectorSupport:.9,prefrontalSupercellSupport:.88,tornadicEnvironmentSupport:.95,synopticAscent:.85,synopticCoherence:.9,moisturePooling:.85,capErosion:.85,boundaryInfluence:.45,outflowConvergence:.15,mesoscale:{effectiveInflow:.92,stretchingPotential:.82,interactionQuality:.92,processedAirFraction:.03,stormCompetition:.05}};
const a=makeStorm('M');
for(let i=0;i<12;i++){world.stormEngine.validHourUtc+=1/12; updateTornadoState(world,a,modest,1/12);}
assert.ok(a.tornado.peakWindSpeedMph < 136, `modest environment reached EF3: ${a.tornado.peakWindSpeedMph}`);
assert.ok((a.tornado.environmentWindCeilingMph??999)<=120);
const b=makeStorm('S');
for(let i=0;i<24;i++){world.stormEngine.validHourUtc+=1/12; updateTornadoState(world,b,strong,1/12); if(!b.tornado.onGround){b.tornado.onGround=true;b.tornado.state='on-ground';}}
assert.ok((b.tornado.environmentWindCeilingMph??0)>=190);
assert.ok(b.tornado.peakWindSpeedMph > a.tornado.peakWindSpeedMph);
console.log('tornado intensity environment calibration: ok', {modest:a.tornado.peakWindSpeedMph,strong:b.tornado.peakWindSpeedMph});
