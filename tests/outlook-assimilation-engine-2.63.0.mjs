import assert from 'node:assert/strict';
import { assimilateOutlookFromStormHistories } from '../js/forecast/OutlookAssimilationEngine.js';

const width=20,height=20;
const grid=Array.from({length:width*height},()=>({tornadoProbability:10,hailProbability:15,windProbability:15}));
const candidate=(index,y,mode='discrete supercell')=>({index,mode,confidence:.8,track:Array.from({length:8},(_,i)=>({x:3+i,y:y+i*.15})),stateHistory:Array.from({length:8},()=>({mode,confidence:.8,intensity:.75,organization:.8,inflowQuality:.8,coldPoolStrength:mode.includes('linear')?.7:.15,motion:{east:1,north:.15}}))});
const members=Array.from({length:8},(_,m)=>({clusterKey:m<6?'dryline-discrete':'northern-outlier',projection:{candidates:[candidate(m,m<6?8:16,m<6?'discrete supercell':'linear') ]}}));
const result=assimilateOutlookFromStormHistories(grid,width,height,members,{key:'day1',maximumPublished:{tornado:10,hail:15,wind:15}});
assert.equal(result.version,'2.63.0');
assert.ok(result.diagnostics.tornado.corridorCount>=2);
assert.ok(result.diagnostics.tornado.uniqueStormFamilies===8);
const core=grid.filter(c=>c.outlookAssimilation?.tornado?.region==='core').length;
const outlierHigh=grid.filter(c=>c.outlookAssimilation?.tornado?.region==='outlier'&&c.tornadoProbability>2).length;
assert.ok(core>0,'expected a supported tornado core');
assert.equal(outlierHigh,0,'outliers must not create high tiers');
assert.ok(result.diagnostics.tornado.unsupportedContourFraction<=0.2);
console.log('2.63.0 outlook assimilation engine: PASS');
