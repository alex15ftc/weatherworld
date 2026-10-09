import assert from 'node:assert/strict';
import { applyEnsembleForecast } from '../js/forecast/EnsembleForecastEngine.js';
const width=20,height=12;
const makeGrid=()=>Array.from({length:width*height},(_,i)=>({
 peakInitiation:.02,projectedStormOccupancy:.03,hazardOverlapScore:.02,confidence:80,leadTimeConfidence:.8,persistenceSignal:70,
 conditionalTornadoIntensity:.04,conditionalHailIntensity:.06,conditionalWindIntensity:.05,
 tornadoProbability:2,hailProbability:5,windProbability:5,trajectory:{dxCells:4,dyCells:1,mode:'discrete'},
 hazardTrajectories:{tornado:{dxCells:4,dyCells:1},hail:{dxCells:4,dyCells:1},wind:{dxCells:5,dyCells:1}}
}));
const a=makeGrid(),b=makeGrid();
for(const g of [a,b]) Object.assign(g[5*width+4],{peakInitiation:.86,projectedStormOccupancy:.82,hazardOverlapScore:.75,conditionalTornadoIntensity:.9,conditionalHailIntensity:.8,conditionalWindIntensity:.3,tornadoProbability:15,hailProbability:30,windProbability:15});
const ea=applyEnsembleForecast(a,width,height,{key:'day1',seed:1234,issueHour:12,members:12});
const eb=applyEnsembleForecast(b,width,height,{key:'day1',seed:1234,issueHour:12,members:12});
assert.equal(ea.memberCount,12);
assert.deepEqual(ea.clusters,eb.clusters,'ensemble is deterministic');
assert.deepEqual(a.map(c=>c.tornadoProbability),b.map(c=>c.tornadoProbability),'probability field is reproducible');
assert.ok(ea.clusters.length>=1,'creates scenario clusters');
assert.ok(a.some(c=>c.ensembleForecast?.tornado?.memberFrequency>0),'stores member frequencies');
assert.ok(Math.max(...a.map(c=>c.tornadoProbability))<=15,'cannot exceed supported source tier');
console.log('2.58.0 ensemble probabilistic outlook regression: PASS');
