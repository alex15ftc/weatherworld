import assert from 'node:assert/strict';
import { applyEnsembleForecast } from '../js/forecast/EnsembleForecastEngine.js';

const width=20,height=12;
const base=Array.from({length:width*height},(_,i)=>{
  const x=i%width,y=Math.floor(i/width);
  const core=Math.exp(-(((x-6)**2)/16+((y-6)**2)/9));
  return {
    tornadoProbability: core>0.5?15:core>0.16?5:2,
    hailProbability: core>0.45?30:core>0.12?15:5,
    windProbability: core>0.5?15:core>0.14?5:0,
    peakInitiation:core, projectedStormOccupancy:core,
    hazardOverlapScore:core, boundaryRelativePlacement:core,
    conditionalTornadoIntensity:core, conditionalHailIntensity:core,
    conditionalWindIntensity:core, trajectory:{dxCells:4,dyCells:-1},
    hazardCorridors:{}, peakHourUtc:21
  };
});
const a=structuredClone(base),b=structuredClone(base);
const metaA=applyEnsembleForecast(a,width,height,{seed:101,issueHour:12,key:'day1',members:8});
const metaB=applyEnsembleForecast(b,width,height,{seed:101,issueHour:12,key:'day1',members:8});
assert.equal(metaA.version,'2.59.0');
assert.deepEqual(a.map(c=>c.tornadoProbability),b.map(c=>c.tornadoProbability),'deterministic ensemble calibration');
assert.ok(a.some(c=>c.ensembleForecast?.tornado?.weightedMemberFrequency>0),'weighted frequencies stored');
assert.ok(a.some(c=>['core','envelope','outlier'].includes(c.ensembleForecast?.hail?.region)),'core/envelope classification stored');
assert.ok(a.every(c=>c.tornadoProbability<=15&&c.hailProbability<=30&&c.windProbability<=15),'does not exceed atmospheric ceiling');
assert.ok(metaA.diagnostics.tornado.effectiveMemberCount>0,'effective member count reported');
assert.equal(metaA.diagnostics.hail.calibration,'weighted-occurrence-x-conditional-severity-with-core-envelope-gates');
console.log('2.59.0 probability calibration and spatial optimization: PASS');
