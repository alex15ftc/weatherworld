import assert from 'node:assert/strict';
import { initializeOutlookCycle } from '../js/forecast/OutlookCycleEngine.js?v=2.28.5';

const width=12,height=12;
const cells=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>{
  const core=x>=4&&x<=7&&y>=3&&y<=8;
  return {
    x,y,levels:{500:{windDirection:240,windSpeed:45},850:{windSpeed:35}},
    surface:{dewpoint:core?66:55},
    forecast:{stormCoverage:core?.72:.18,initiationProbability:core?.68:.12,conditionalTornadoIntensity:core?.82:.32,discreteFraction:core?.75:.4,linearFraction:core?.25:.6},
    dynamics:{forcingScore:core?.7:.18,convectiveReadiness:core?.78:.22},
    derived:{cape:core?2200:500,cin:core?45:160,srh:core?230:60,bulkShear:core?48:22,lcl:core?1050:1900,hazards:{tornadoProbability:core?15:2,hailProbability:core?15:5,windProbability:core?15:5},risk:core?'MDT':'MRGN'}
  };
}));
const world={width,height,cellSizeKm:10,validHourUtc:12,cells,getCell(x,y){return x<0||y<0||x>=width||y>=height?null:cells[y][x]}};
initializeOutlookCycle(world);
const product=world.outlookCycle.products.day1;
assert.equal(product.productSchemaVersion,3);
assert.equal(product.synthesis.method,'coverage-continuity-overlap-confidence');
assert.ok(product.synthesis.finalCounts.TSTM>0,'weak 2% background should not become categorical risk everywhere');
assert.ok(product.synthesis.rawCounts.MRGN>=product.synthesis.finalCounts.MRGN);
assert.ok(product.grid.some(cell=>cell.risk==='TSTM'));
console.log('outlook synthesis 2.28.5 passed');
