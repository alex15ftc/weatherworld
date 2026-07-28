import assert from 'node:assert/strict';
import { hydrateStormInternalField, isStormInternalFieldValid, serializeStormInternalField } from '../js/storms/StormInternalField.js?v=2.20.0';
const names=['rain','graupel','hail','ice','updraft','downdraft','windU','windV','vorticity','temperature','moisture','debris'];
const length=32*32, raw={version:1,width:32,height:32,resolutionKm:2.5};
for(const name of names){raw[name]={};for(let i=0;i<length;i++)raw[name][i]=name==='rain'&&i===500?1.2:0;}
const hydrated=hydrateStormInternalField(raw);
assert.ok(isStormInternalFieldValid(hydrated));
assert.equal(hydrated.rain.length,length);
assert.ok(hydrated.rain[500]>1);
const restored=hydrateStormInternalField(serializeStormInternalField(hydrated));
assert.ok(isStormInternalFieldValid(restored));
assert.ok(restored.rain[500]>1);
console.log('storm field recovery passed');
