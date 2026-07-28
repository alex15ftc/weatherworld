import assert from 'node:assert/strict';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';
const runtime=new WeatherAuthorityRuntime({seed:20270503,checkpointPath:'/tmp/wx-tile-test.json'});
for(const spec of [
 {scope:'live',product:'temperature'},
 {scope:'outlook',day:'day1',product:'risk'},
 {scope:'radar',product:'reflectivity',station:'composite'}
]){
 const manifest=runtime.mapManifest(spec);assert.equal(manifest.tileSize,256);assert.equal(manifest.maxZoom,3);
 const tile=await runtime.productTile({...spec,z:0,x:0,y:0});assert.ok(Buffer.isBuffer(tile));assert.equal(tile.subarray(1,4).toString(),'PNG');assert.ok(tile.length<50000);
}
const sounding=runtime.sounding(25,25);assert.ok(sounding);
console.log('Tile service, radar tiles, outlook tiles, and on-demand sounding passed.');
