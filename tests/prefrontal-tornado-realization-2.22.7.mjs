import assert from 'node:assert/strict';
import { Storm } from '../js/storms/Storm.js';
import { initializeTornadoState, updateTornadoState } from '../js/storms/TornadoEngine.js';

// Tornadogenesis is probabilistic: across many mature prefrontal supercells a strong
// environment should be tornadic a realistic fraction of the time within 90 minutes, and a
// weak (high-LCL, low-SRH) one rarely.
const environment={lcl:1050,srh:285,bulkShear:49,cape:2350,readiness:.78,boundaryInfluence:.20,outflowConvergence:.10,openWarmSectorSupport:.78,prefrontalSupercellSupport:.72,tornadicEnvironmentSupport:.68,mesoscale:{effectiveInflow:.82,stretchingPotential:.58}};
function tornadicFraction(env, trials = 80) {
  let tornadic = 0, potential = 0;
  for (let seed = 1; seed <= trials; seed++) {
    const world={validHourUtc:18,evolution:{config:{seed}},stormEngine:{validHourUtc:18,totalTornadoes:0}};
    const storm=new Storm({id:'S0227',xKm:100,yKm:100,velocityEastKph:72,velocityNorthKph:18,sourceCell:{x:10,y:10},createdHourUtc:18,modeHint:'discrete supercell'});
    storm.ageHours=.8; storm.lifecycleState='mature'; storm.intensity=.58; storm.organization=.66;
    storm.updraftStrength=.62; storm.rotationStrength=.42; storm.mesocycloneStrength=.48;
    storm.inflowQuality=.82; storm.coldPoolStrength=.32; storm.orientationDeg=72;
    initializeTornadoState(storm);
    let observed=false;
    for(let i=0;i<18;i++){ world.stormEngine.validHourUtc+=1/12; updateTornadoState(world,storm,env,1/12); observed ||= storm.tornado.onGround || storm.tornadoHistory.length>0; }
    if (observed) tornadic++;
    potential += storm.tornado.genesisPotential;
  }
  return { fraction: tornadic / trials, potential: potential / trials };
}
const strong = tornadicFraction(environment);
const weak = tornadicFraction({ ...environment, lcl: 1750, srh: 95, cape: 1200 });
assert.ok(strong.fraction >= 0.15 && strong.fraction <= 0.7, `strong prefrontal environment tornadic fraction ${strong.fraction}`);
assert.ok(weak.fraction < strong.fraction / 2, `weak environment should rarely be tornadic (${weak.fraction} vs ${strong.fraction})`);
assert.ok(strong.potential >= .25, 'Genesis potential remained artificially suppressed');
console.log(`prefrontal tornado realization passed: strong ${(100*strong.fraction).toFixed(0)}%, weak ${(100*weak.fraction).toFixed(0)}% within 90 min`);
