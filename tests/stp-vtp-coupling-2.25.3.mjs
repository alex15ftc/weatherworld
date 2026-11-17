import assert from 'node:assert/strict';
import { diagnoseViolentTornadoParameter as vtp } from '../js/sounding.js';

// The violent tornado parameter is STP times 3CAPE/50 (capped at 2) times the 0-3 km lapse rate/6.5 (Hampshire et al.
// 2018; SPC mesoanalysis), so it is zero wherever STP is, whatever the low-level instability.
assert.equal(vtp({ stp: 0, cape03: 250, lapseRate03km: 9 }), 0, 'no STP, no VTP');
assert.equal(vtp({ stp: 2, cape03: 50, lapseRate03km: 6.5 }), 2, 'at both breakpoints VTP equals STP');
assert.equal(vtp({ stp: 2, cape03: 100, lapseRate03km: 6.5 }), 4, '3CAPE term reaches 2 at 100 J/kg');
assert.equal(vtp({ stp: 2, cape03: 400, lapseRate03km: 6.5 }), 4, '3CAPE term capped at 2');
assert.ok(Math.abs(vtp({ stp: 2, cape03: 25, lapseRate03km: 8.125 }) - 1.25) < 1e-9, 'terms scale continuously');
assert.equal(vtp({ stp: 3, cape03: 0, lapseRate03km: 9 }), 0, 'no low-level CAPE, no VTP');
assert.equal(vtp({ stp: 3, cape03: 80, lapseRate03km: -2 }), 0, 'an inversion does not make VTP negative');
console.log('STP/VTP coupling regression: ok');
