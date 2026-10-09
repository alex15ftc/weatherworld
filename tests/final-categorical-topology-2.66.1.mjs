import assert from 'node:assert/strict';
import { applyFinalCategoricalTopology } from '../js/forecast/RegionalOutlookTopologyEngine.js';
const W=9,H=9;
const ranks=[
0,0,0,0,0,0,0,0,0,
0,2,2,2,2,2,0,0,0,
0,2,3,3,3,2,0,2,0,
0,2,3,2,3,2,0,0,0,
0,2,3,3,3,2,0,0,0,
0,2,2,2,2,2,0,0,0,
0,0,0,0,0,0,0,0,0,
0,0,0,0,0,0,0,0,0,
0,0,0,0,0,0,0,0,0];
const R=['TSTM','MRGN','SLGT','ENH','MDT','HIGH'];
const grid=ranks.map((r,i)=>({risk:R[r],forecastConfidence:{tornado:(i===2*W+7||i===2*W+6)?{overallConfidence:.1,corridorConfidence:.1,memberAgreement:.1}:{overallConfidence:.7,corridorConfidence:.7,memberAgreement:.7},hail:{},wind:{}}}));
const d=applyFinalCategoricalTopology(grid,W,H);
assert.equal(grid[3*W+3].risk,'ENH','enclosed lower-risk hole should fill');
assert.notEqual(grid[2*W+7].risk,'SLGT','unsupported detached island should be removed');
assert.ok(grid.every(c=>c.rawRisk&&c.issuedRisk));
console.log('2.66.1 final categorical topology repair: PASS');
