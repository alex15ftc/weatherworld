import assert from 'node:assert/strict';
import { initializeOutlookCycle, updatePredictiveOutlooks } from '../js/forecast/OutlookCycleEngine.js';
import { WorldStateStore } from '../js/world/WorldStateStore.js';

class MemoryStorage { constructor(){this.values=new Map()} getItem(k){return this.values.get(k)??null} setItem(k,v){this.values.set(k,String(v))} removeItem(k){this.values.delete(k)} }
const width=4,height=4;
const cells=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>({x,y,levels:{500:{windDirection:240,windSpeed:40}},forecast:{stormCoverage:.5},dynamics:{forcingScore:.7,convectiveReadiness:.75},derived:{hazards:{tornadoProbability:x>1?10:2,hailProbability:x>1?30:5,windProbability:x>1?30:5}}})));
const world={width,height,cellSizeKm:10,validHourUtc:12,forecastContext:{worldRevision:7,systemNumber:3,currentSeed:12345},cells,getCell(x,y){return x<0||y<0||x>=width||y>=height?null:cells[y][x]}};
initializeOutlookCycle(world);
const first=structuredClone(world.outlookCycle.products.day1);
assert.match(first.cycleId,/^day1-s3-i2-r7-seed-/);
assert.equal(first.sourceWorldRevision,7);
assert.equal(first.sourceSystemNumber,3);
assert.equal(first.currentSeed,12345);
assert.equal(first.frozen,true);
world.validHourUtc=18;
world.forecastContext.worldRevision=9;
updatePredictiveOutlooks(world);
const second=world.outlookCycle.products.day1;
assert.notEqual(second.cycleId,first.cycleId);
assert.equal(world.outlookCycle.archive.day1.at(-1).cycleId,first.cycleId);

const storage=new MemoryStorage();
const store=new WorldStateStore(storage,{now:()=>1000});
const saved=store.save({currentSeed:12345,validHourUtc:18,systemStartHour:12,systemNumber:3,authorityRealTimestamp:1000,productArchive:world.outlookCycle.archive,forecastProducts:world.outlookCycle.products},{writerId:'authority',expectedRevision:0});
assert.equal(saved.ok,true);
const loaded=store.load();
assert.equal(loaded.schemaVersion,6);
assert.equal(loaded.forecastProducts.day1.cycleId,second.cycleId);
assert.equal(loaded.productArchive.day1[0].cycleId,first.cycleId);
assert.equal(loaded.forecastProducts.day1.currentSeed,12345);
console.log('forecast cycle identity and persistence passed');
