import assert from 'node:assert/strict';
import { encodeCellKeyframe, encodeCellDelta, decodeCellRecord, estimateCellRecordBytes } from '../js/timeline/CompactTimelineCells.js';

const first=rows(4,3,0);
const second=structuredClone(first);
second[1][2].surface.temperature+=1.75;
second[1][2].surface.dewpoint+=.5;
second[1][2].surface.wind.direction=205;
second[1][2].derived.cape+=325;
second[1][2].derived.stp+=.8;
delete second[1][2].derived.rawStp;
second[1][2].features.boundaryRelative={frontId:'dry',side:'ahead'};

const keyframe=encodeCellKeyframe(first);
const restoredFirst=decodeCellRecord(keyframe);
equivalent(restoredFirst,first);
const delta=encodeCellDelta(restoredFirst,second);
assert.equal(delta.type,'delta');
assert.ok(delta.skeletonPatches.length>=1);
const restoredSecond=decodeCellRecord(delta,restoredFirst);
equivalent(restoredSecond,second);
assert.equal('rawStp' in restoredSecond[1][2].derived,false,'missing numeric fields must remain absent');
assert.ok(estimateCellRecordBytes(keyframe)>0);
assert.ok(estimateCellRecordBytes(delta)>0);

const workerSource=await import('node:fs').then(fs=>fs.readFileSync(new URL('../js/worker/timelinePrecompute.worker.js',import.meta.url),'utf8'));
assert.match(workerSource,/step % 6 === 0/);
assert.match(workerSource,/decodeCellRecord/);
assert.match(workerSource,/retainedCellBytes/);
console.log('2.72.1 compact typed timeline keyframes and deltas: PASS');

function rows(width,height,offset){
  return Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>({
    id:`${x},${y}`,surface:{temperature:70+x+y+offset,dewpoint:58+x*.2,pressure:995+x,seaLevelPressure:1005+x,wind:{speed:15+y,direction:180+x}},
    derived:{cape:1200+x*100,cin:45,stp:1.5,rawStp:2,srh:160,bulkShear:42,lcl:1100},
    features:{warmSector:true},thermodynamics:{profile:null}
  })));
}
function equivalent(actual,expected){
  assert.equal(actual.length,expected.length);
  for(let y=0;y<expected.length;y++)for(let x=0;x<expected[y].length;x++){
    assert.equal(actual[y][x].id,expected[y][x].id);
    assert.deepEqual(actual[y][x].features,expected[y][x].features);
    for(const path of [['surface','temperature'],['surface','dewpoint'],['surface','wind','direction'],['derived','cape'],['derived','stp']]){
      assert.ok(Math.abs(get(actual[y][x],path)-get(expected[y][x],path))<1e-3,`${x},${y} ${path.join('.')}`);
    }
  }
}
function get(value,path){for(const key of path)value=value[key];return value;}
