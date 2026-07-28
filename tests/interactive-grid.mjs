import assert from 'node:assert/strict';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';
const runtime=new WeatherAuthorityRuntime({seed:20270503,checkpointPath:'/tmp/wx-grid-test.json'});
const cell=runtime.cellSummary(10,12,'day1');
assert.equal(cell.row,10);assert.equal(cell.column,12);assert.ok(Number.isFinite(cell.surface.temperatureF));assert.ok(cell.instability);assert.ok(runtime.sounding(10,12)?.profile?.length>5);
const manifest=runtime.mapManifest({scope:'live',product:'temperature'});assert.equal(manifest.width,50);assert.equal(manifest.height,50);assert.equal(manifest.version,'2.20.5');
console.log('interactive grid regression passed');
