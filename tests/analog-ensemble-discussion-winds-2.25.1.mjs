import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../js/evolution.js';
import { buildOutlookDiscussion } from '../js/forecast/OutlookDiscussionEngine.js';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';

const world=new Atmosphere(20,20);const config=generateScenario(world,20270503);initializeEvolution(world,config);
const discussion=buildOutlookDiscussion(world,config,'day1');
assert.ok(discussion.pattern.length>3);assert.ok(discussion.discussion.length>120);assert.equal(discussion.ensemble.memberCount,30);assert.ok(discussion.supportingFactors.length>0);
const runtime=new WeatherAuthorityRuntime({seed:20270503,width:20,height:20,checkpointPath:'/tmp/weather-2251-test.json'});
const manifest=runtime.mapManifest({scope:'live',product:'wind500',day:'day1'});
assert.equal(manifest.version,'2.25.1');assert.ok(manifest.forecastDiagnosis?.discussion);
const field=runtime.liveField('wind500');assert.ok(field.max>0,'500 mb wind field must not be all zero');
const field250=runtime.liveField('wind250');assert.ok(field250.max>0,'250 mb wind field must not be all zero');
const field800=runtime.liveField('wind800');assert.ok(field800.max>0,'800 mb interpolated wind field must not be all zero');
console.log('2.25.1 analog ensemble, discussion, and upper-air wind regression passed');
