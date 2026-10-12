import assert from 'node:assert/strict';
import { diagnoseStormMotion } from '../js/storms/environmentSampling.js';
import { Storm } from '../js/storms/Storm.js';
const env={wind850:{eastKt:20,northKt:8},wind500:{eastKt:45,northKt:18},surfaceWind:{eastKt:8,northKt:2},bulkShear:42,linearFraction:.75,coldPoolPropagation:{east:18,north:3}};
const discrete=diagnoseStormMotion(env,{rotating:1,linear:0}), qlcs=diagnoseStormMotion(env,{rotating:0,linear:1});
assert.ok(qlcs.east>discrete.east);
const storm=new Storm({id:'S0001',xKm:50,yKm:50,velocityEastKph:30,velocityNorthKph:10,sourceCell:{x:5,y:5},createdHourUtc:0,modeHint:'discrete supercell'});
assert.equal(storm.coldPoolTemperatureDeficitF,0);
console.log('2.25.2 coupling unit checks passed');
