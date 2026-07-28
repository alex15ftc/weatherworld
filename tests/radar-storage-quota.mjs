import assert from 'node:assert/strict';
import { WorldStateStore, WORLD_STATE_STORAGE_KEY } from '../js/world/WorldStateStore.js?v=2.20.0';
import { createStormInternalField, evolveStormInternalField, serializeStormInternalField } from '../js/storms/StormInternalField.js?v=2.20.0';
class QuotaStorage {
  constructor(limit=1_500_000){this.limit=limit;this.map=new Map();}
  getItem(k){return this.map.get(k)??null;}
  removeItem(k){this.map.delete(k);}
  setItem(k,v){const next=new Map(this.map);next.set(k,String(v));let n=0;for(const [a,b] of next)n+=a.length+b.length;if(n>this.limit){const e=new Error('quota');e.name='QuotaExceededError';throw e;}this.map=next;}
}
const storage=new QuotaStorage();
const storms=[];
for(let n=0;n<12;n++){
  const storm={id:`S${n}`,positionKm:{x:100+n*12,y:200},velocityKph:{east:45,north:20},orientationDeg:25,organization:.9,intensity:.9,ageHours:2,coldPoolStrength:.5,lifecycleState:'mature'};
  const env={cape:3300,bulkShear:55,srh:320,dewpoint:69,lcl:700,forcing:.8,effectiveInflow:.9,readiness:.9};
  createStormInternalField(storm,env,100+n);for(let i=0;i<8;i++)evolveStormInternalField(storm,env,1/12);
  storms.push({id:storm.id,positionKm:storm.positionKm,velocityKph:storm.velocityKph,intensity:.9,organization:.9,internalField:serializeStormInternalField(storm.internalField)});
}
const state={currentSeed:1,validHourUtc:18,systemStartHour:0,systemNumber:1,authorityRealTimestamp:Date.now(),productArchive:{day1:[],day2:[],day3:[]},forecastProducts:{},radarSnapshot:{domainWidthKm:500,domainHeightKm:500,validHourUtc:18,storms,radarNetwork:{stations:[]}}};
const store=new WorldStateStore(storage);const saved=store.save(state,{writerId:'test'});assert.equal(saved.ok,true);assert.ok(storage.getItem(WORLD_STATE_STORAGE_KEY));
const bytes=[...storage.map].reduce((n,[k,v])=>n+k.length+v.length,0);assert.ok(bytes<1_500_000);assert.equal(store.load().radarSnapshot.storms[0].internalField.encoding,'u8-base64');
console.log('radar storage quota passed', {bytes,storms:storms.length});
