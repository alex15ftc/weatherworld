import assert from 'node:assert/strict';
import { applyFinalCategoricalTopology } from '../js/forecast/RegionalOutlookTopologyEngine.js';

const risks=['TSTM','MRGN','SLGT','ENH','MDT','HIGH'];
const w=9,h=9;
const grid=Array.from({length:w*h},()=>({
  risk:'TSTM',
  forecastConfidence:{
    tornado:{overallConfidence:0.7,corridorConfidence:0.7,memberAgreement:0.7},
    hail:{overallConfidence:0.7,corridorConfidence:0.7,memberAgreement:0.7},
    wind:{overallConfidence:0.7,corridorConfidence:0.7,memberAgreement:0.7}
  }
}));
const at=(x,y)=>y*w+x;
// A compact ENH core surrounded by TSTM intentionally violates two tiers.
for(const [x,y] of [[4,4],[4,3],[3,4],[5,4],[4,5]]) grid[at(x,y)].risk='ENH';
const d=applyFinalCategoricalTopology(grid,w,h,{key:'day1'});
assert.equal(d.unresolvedTransitions,0,'all hierarchy jumps should be repaired');
assert.ok(d.invalidTransitionsFound>0,'test must detect invalid transitions');
assert.ok(d.parentCellsAdded>0,'missing parent shells should be added');
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const a=risks.indexOf(grid[at(x,y)].risk);
  for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){
    const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
    const b=risks.indexOf(grid[at(nx,ny)].risk);
    assert.ok(Math.abs(a-b)<=1,`invalid transition ${grid[at(x,y)].risk} -> ${grid[at(nx,ny)].risk}`);
  }
}
// At least one SLGT and MRGN parent cell must surround ENH.
assert.ok(grid.some(c=>c.risk==='SLGT'),'ENH should receive a SLGT parent shell');
assert.ok(grid.some(c=>c.risk==='MRGN'),'SLGT should receive a MRGN parent shell');
console.log('2.66.2 hierarchical risk nesting regression: PASS');
