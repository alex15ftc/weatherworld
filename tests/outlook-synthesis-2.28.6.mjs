import assert from 'node:assert/strict';
import { initializeOutlookCycle } from '../js/forecast/OutlookCycleEngine.js?v=2.28.6';

const width=12,height=12;
const cells=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>{
  const core=x>=3&&x<=8&&y>=3&&y<=8;
  return {x,y,levels:{500:{windDirection:240,windSpeed:50},850:{windSpeed:38}},surface:{dewpoint:core?69:54},
    forecast:{stormCoverage:core?.9:.12,initiationProbability:core?.86:.1,conditionalTornadoIntensity:core?1.08:.2,conditionalHailIntensity:core?.8:.1,conditionalWindIntensity:core?.8:.1,discreteFraction:core?.88:.3,linearFraction:core?.2:.5,projectedStormTrackSupport:core?.9:.08,openWarmSectorSupport:core?.9:.1},
    dynamics:{forcingScore:core?.82:.14,convectiveReadiness:core?.9:.18},features:{synopticCoherence:core?.9:.35,warmSector:core},
    derived:{cape:core?3600:400,cin:core?20:180,srh:core?420:40,bulkShear:core?62:20,lcl:core?750:2000,hazards:{tornadoProbability:core?30:0,hailProbability:core?30:0,windProbability:core?30:0},risk:core?'HIGH':'TSTM'}};
}));
const world={width,height,cellSizeKm:10,validHourUtc:12,cells,getCell(x,y){return x<0||y<0||x>=width||y>=height?null:cells[y][x]}};
initializeOutlookCycle(world);
const product=world.outlookCycle.products.day1;
assert.equal(product.productSchemaVersion,4);
assert.equal(product.synthesis.method,'authoritative-spc-probability-cig');
assert.equal(product.synthesis.consistencyViolations.total,0);
for(const f of product.grid){
  const ranks=['TSTM','MRGN','SLGT','ENH','MDT','HIGH'];
  const required=Math.max(ranks.indexOf(f.categories?.tornado??'TSTM'),ranks.indexOf(f.categories?.hail??'TSTM'),ranks.indexOf(f.categories?.wind??'TSTM'));
  assert.equal(ranks.indexOf(f.risk),required,'overall category must equal highest mapped hazard category');
}
console.log('outlook synthesis 2.28.6 passed');
