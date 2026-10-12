// The possible hazard type shown with a sounding (PDS TOR, TOR, MRGL TOR, SVR, MRGL SVR, NONE)
// is read off the sounding's own indices. These walk down the ladder one rung at a time.
import assert from 'node:assert/strict';
import { diagnoseSoundingDisplay } from '../js/sounding.js';

const ELEVATION = 300;
// A profile with strong, steadily veering flow: about 48 kt of shear over the lowest 8 km.
const profile = [];
for (let p = 950; p >= 100; p -= 50) {
  const heightM = ELEVATION + 8000 * Math.log(950 / p), km = (heightM - ELEVATION) / 1000, t = 28 - 6.5 * km;
  profile.push({ p, heightM, t, td: t - 5, rh: 70, u: 5 + 6 * km, v: 20 - km });
}
const parcel = profile.map(row => ({ p: row.p, heightM: row.heightM, t: row.t + 3, td: row.t + 3 }));
const sounding = overrides => ({
  profile, parcel,
  params: {
    stp: 5, scp: 12, srh01: 300, srh03: 350, shear06: 55, lclAglM: 700, lapseRate01km: 7, lapseRate03km: 7.5, lapseRate700500: 7.5,
    mlcape: 3000, mlcin: -10, sbcape: 3000, sbcin: -10, mucape: 3500, mucin: -10, dcape: 900, muMixingRatioGkg: 14,
    freezingM: 4300, wetBulbZeroM: 3500, stormMotion: { right: { u: 20, v: 5 }, left: { u: 30, v: 25 } }, meanWind: { u: 23, v: 17 }, ...overrides
  }
});
const type = overrides => diagnoseSoundingDisplay(sounding(overrides), ELEVATION).hazardType;

assert.equal(type({}), 'PDS TOR');
assert.equal(type({ lclAglM: 1300 }), 'TOR', 'a high cloud base takes the "particularly dangerous" off');
assert.equal(type({ stp: 1.5 }), 'TOR');
assert.equal(type({ stp: 1.2, mlcin: -100 }), 'MRGL TOR', 'inhibition makes a tornado sounding marginal');
assert.equal(type({ stp: 0.6, srh01: 180 }), 'MRGL TOR');
assert.equal(type({ stp: 0.2, srh01: 60, scp: 5 }), 'SVR');
assert.equal(type({ stp: 3, sbcape: 0, scp: 5 }), 'SVR', 'no tornado type without surface-based inflow');
assert.equal(type({ stp: 0, srh01: 40, scp: 0.8, dcape: 300, mucape: 600, mlcape: 500 }), 'MRGL SVR');
assert.equal(type({ stp: 0, scp: 0, srh01: 20, mucape: 0, mlcape: 0, mucin: -200 }), 'NONE');

const display = diagnoseSoundingDisplay(sounding({}), ELEVATION);
assert.ok(display.shear08 > 45 && display.shear08 < 52, `0-8 km shear ${display.shear08}`);
assert.ok(display.ship > 1, `significant hail parameter ${display.ship}`);
assert.ok(display.cape03 > 0 && Number.isFinite(display.srw46) && Math.abs(display.lowRh - 70) < 1e-9);

console.log('sounding hazard type: ok');
