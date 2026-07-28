import assert from 'node:assert/strict';
import { diagnoseStormMotion } from '../js/storms/environmentSampling.js';
import { Storm } from '../js/storms/Storm.js';
const env={wind850:{eastKt:20,northKt:8},wind500:{eastKt:45,northKt:18},surfaceWind:{eastKt:8,northKt:2},bulkShear:42,linearFraction:.75,coldPoolPropagation:{east:18,north:3},boundaryPropagation:{east:5,north:-2}};
const discrete=diagnoseStormMotion(env,'discrete supercell'), qlcs=diagnoseStormMotion(env,'QLCS');
assert.ok(qlcs.east>discrete.east);
const storm=new Storm({id:'S0001',xKm:50,yKm:50,velocityEastKph:30,velocityNorthKph:10,sourceCell:{x:5,y:5},createdHourUtc:0,modeHint:'discrete supercell'});
assert.equal(storm.coldPoolTemperatureDeficitF,0); assert.equal(storm.boundaryInteractionCount,0);
console.log('2.25.2 coupling unit checks passed');
