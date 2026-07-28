import assert from 'node:assert/strict';
import { diagnoseProjectedStormOccupancy, relocateHazardGuidanceCores } from '../js/forecast/OutlookCycleEngine.js';

const corridor=diagnoseProjectedStormOccupancy(
  {initiation:.8,coverage:.82,track:.9,organization:.78},
  {initiation:.1,coverage:.2,track:.2,organization:.4},
  .82,.86,0
);
const sparse=diagnoseProjectedStormOccupancy(
  {initiation:.1,coverage:.2,track:.2,organization:.4},
  {initiation:.8,coverage:.82,track:.9,organization:.78},
  .82,.86,0
);
assert.ok(corridor>sparse);

const grid=[
  {tornadoProbability:15,tornadoCig:2,hailProbability:30,hailCig:1,windProbability:30,windCig:1,projectedStormOccupancy:.1,conditionalTornadoIntensity:.8,conditionalHailIntensity:.8,conditionalWindIntensity:.8},
  {tornadoProbability:10,tornadoCig:1,hailProbability:15,hailCig:1,windProbability:15,windCig:1,projectedStormOccupancy:.4,conditionalTornadoIntensity:.8,conditionalHailIntensity:.8,conditionalWindIntensity:.8},
  {tornadoProbability:5,tornadoCig:1,hailProbability:5,hailCig:0,windProbability:5,windCig:0,projectedStormOccupancy:.9,conditionalTornadoIntensity:.9,conditionalHailIntensity:.9,conditionalWindIntensity:.9}
];
const tornadoPairs=grid.map(row=>`${row.tornadoProbability}/${row.tornadoCig}`).sort();
relocateHazardGuidanceCores(grid);
assert.equal(grid[2].tornadoProbability,15);
assert.equal(grid[2].tornadoCig,2);
assert.deepEqual(grid.map(row=>`${row.tornadoProbability}/${row.tornadoCig}`).sort(),tornadoPairs);
assert.equal(grid[2].corridorRelocation.tornado.method,'hazard-specific-initiation-to-maturity-ranking');

console.log('2.32.6 projected storm corridor regression passed');
