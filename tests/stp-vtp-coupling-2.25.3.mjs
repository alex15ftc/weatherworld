import assert from 'node:assert/strict';
import { diagnoseViolentTornadoParameter } from '../js/sounding.js';

const zero=diagnoseViolentTornadoParameter({stp:0,rawStp:0,synopticSupport:1,cape:3000,srh:350,shear:55,lcl:800,cin:25,criticalAngle:90});
assert.equal(zero,0,'Synoptic support must not manufacture VTP in zero-STP air');
const strongLocalWeakSynoptic=diagnoseViolentTornadoParameter({stp:4.2,rawStp:6.1,synopticSupport:.15,cape:2800,srh:340,shear:55,lcl:850,cin:35,criticalAngle:85});
const weakLocalStrongSynoptic=diagnoseViolentTornadoParameter({stp:.15,rawStp:.2,synopticSupport:.95,cape:900,srh:95,shear:32,lcl:1450,cin:100,criticalAngle:40});
assert.ok(strongLocalWeakSynoptic>weakLocalStrongSynoptic*4,'Strong local tornado ingredients should dominate broad synoptic support');
assert.ok(strongLocalWeakSynoptic>.35);
console.log('STP/VTP coupling regression: ok');
