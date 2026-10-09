import assert from 'node:assert/strict';
import { createSharedStormState, evolveSharedStormState, SHARED_STORM_KERNEL_VERSION } from '../js/storms/SharedStormEvolutionKernel.js';
import { buildForecastStormProjection } from '../js/forecast/ForecastStormProjectionEngine.js';

const state=createSharedStormState({mode:'discrete supercell',motion:{east:2,north:1},remainingLifetimeHours:4});
const next=evolveSharedStormState(state,{cape:2600,bulkShear:48,forcing:.45,openWarmSectorSupport:.8,discreteFraction:.75,boundaryStrength:.6,boundaryPropagation:{east:.4,north:.1}},1,{mode:'forecast'});
assert.equal(next.version,SHARED_STORM_KERNEL_VERSION);
assert.ok(Number.isFinite(next.motion.east));
assert.ok(next.ageHours>state.ageHours);

const width=5,height=5;
const grid=Array.from({length:25},(_,i)=>({peakInitiation:i===12?0.8:0,projectedStormOccupancy:i===12?0.8:0,hazardOverlapScore:i===12?0.8:0,confidence:80,tornadoProbability:i===12?10:0,hailProbability:i===12?15:0,windProbability:i===12?5:0,conditionalTornadoIntensity:.7,conditionalHailIntensity:.7,conditionalWindIntensity:.3,trajectory:{dxCells:2,dyCells:-1,mode:'discrete'},projectedEnvironment:{cape:2500,bulkShear:45,forcing:.4,openWarmSectorSupport:.7,discreteFraction:.8,linearFraction:.1,lcl:900}}));
const p=buildForecastStormProjection(grid,width,height,{key:'day1',maxCandidates:2});
assert.equal(p.kernelVersion,SHARED_STORM_KERNEL_VERSION);
assert.ok(p.candidates[0].stateHistory.length>=2);
assert.equal(p.candidates[0].kernelVersion,SHARED_STORM_KERNEL_VERSION);
console.log('2.62.0 forecast/reality convergence: PASS');
