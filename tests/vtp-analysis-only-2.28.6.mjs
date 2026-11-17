import assert from 'node:assert/strict';
import fs from 'node:fs';
import { diagnoseViolentTornadoParameter } from '../js/sounding.js';
const tornadoSource=fs.readFileSync(new URL('../js/storms/TornadoEngine.js',import.meta.url),'utf8');
assert.doesNotMatch(tornadoSource,/vtpSupport/);
assert.doesNotMatch(tornadoSource,/else if \(vtp\s*</);
assert.doesNotMatch(tornadoSource,/\+\s*vtp\s*\*/);
// The violent tornado parameter is a display diagnostic: the tornado model does not read it at all.
assert.doesNotMatch(tornadoSource,/vtp/i);
const strong=diagnoseViolentTornadoParameter({stp:6,cape03:150,lapseRate03km:8});
assert.ok(strong>10,`a violent-tornado sounding (STP 6, 3CAPE 150, 8 C/km) should read well above 1, got ${strong}`);
const zero=diagnoseViolentTornadoParameter({stp:0,cape03:200,lapseRate03km:9});
assert.equal(zero,0);
console.log('VTP analysis-only 2.28.6 passed');
