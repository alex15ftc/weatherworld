import assert from 'node:assert/strict';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';

const a=new WeatherAuthorityRuntime({seed:111,checkpointPath:'/tmp/wx-cache-a.json'});
const b=new WeatherAuthorityRuntime({seed:111,checkpointPath:'/tmp/wx-cache-b.json'});
const m1=a.mapManifest({scope:'outlook',product:'tornadoRisk',day:'day1'});
const m2=b.mapManifest({scope:'outlook',product:'tornadoRisk',day:'day1'});
assert.notEqual(m1.authorityInstance,m2.authorityInstance,'server restarts need unique tile cache namespaces');
assert.notEqual(m1.tileUrl,m2.tileUrl,'immutable tile URLs must differ between authority instances');
assert.match(m1.tileUrl,/style=spc-probability-v5/);
const before=m1.tileUrl;
const result=a.reset(87654321);
assert.equal(result.seed,87654321);
const after=a.mapManifest({scope:'outlook',product:'tornadoRisk',day:'day1'});
assert.notEqual(after.tileUrl,before,'seed reset must change tile URL revision');
assert.equal(after.seed,87654321);
assert.deepEqual(after.legend.slice(0,4),[['2%','#79ba7a'],['5%','#bd998a'],['10%','#ffe481'],['15%','#ff8080']]);
console.log('cache epoch and controls regression passed');
