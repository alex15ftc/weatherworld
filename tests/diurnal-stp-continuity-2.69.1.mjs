import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';

const world=new Atmosphere(SIMULATION_CONFIG.fixedColumns,SIMULATION_CONFIG.fixedRows);
const config=generateScenario(world,80444615);
initializeEvolution(world,config,{profile:'gameplay'});

function maxStp(){
  let result={stp:-Infinity,raw:0,factor:0};
  world.forEachCell(cell=>{
    const stp=Number(cell.derived?.stp)||0;
    if(stp>result.stp)result={stp,raw:Number(cell.derived?.rawStp)||0,factor:Number(cell.derived?.stpComponents?.airMassFactor)||0,target:Number(cell.derived?.stpComponents?.targetAirMassFactor)||0};
  });
  return result;
}

const samples=[maxStp()];
assert(samples[0].factor<1,'initial STP must already include fractional air-mass validity');
assert(samples[0].stp<10,'known morning seed must not initialize with an implausibly extreme STP maximum');
for(let i=0;i<6;i++){
  advanceAtmosphere(world,.5);
  samples.push(maxStp());
  assert.equal(world.stpContinuity?.version,'2.69.1');
  assert.equal(world.stpContinuity?.discontinuities,0,'ordinary morning evolution must not trigger an artificial STP discontinuity');
}
for(let i=1;i<samples.length;i++){
  const drop=(samples[i-1].stp-samples[i].stp)/Math.max(.5,samples[i-1].stp);
  assert(drop<.45,`STP maximum collapsed too quickly at sample ${i}: ${samples[i-1].stp.toFixed(2)} -> ${samples[i].stp.toFixed(2)}`);
  assert(Math.abs(samples[i].factor-samples[i-1].factor)<=.25,'air-mass factor must evolve continuously between half-hour steps');
}
console.log('2.69.1 diurnal STP continuity and air-mass consistency: PASS');
