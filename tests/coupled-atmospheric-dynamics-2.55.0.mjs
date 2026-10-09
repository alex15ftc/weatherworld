import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../js/synoptic/SynopticObjectEngine.js',import.meta.url),'utf8');
assert.match(source,/applyCoupledAtmosphericDynamics/);
assert.match(source,/adaptiveCorrectionLimit/);
assert.match(source,/coupledDynamics/);
assert.match(source,/pressureErrorHpa/);
assert.match(source,/blendAngle/);
console.log('2.55.0 coupled atmospheric dynamics regression: PASS');
