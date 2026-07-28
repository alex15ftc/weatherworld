import assert from 'node:assert/strict';
import { boundaryRelativeHazardSupport } from '../js/forecast/OutlookCycleEngine.js';

const boundaryCore={
  features:{explicitBoundaryInfluence:1,warmSector:false},
  forecast:{openWarmSectorSupport:.08,prefrontalSupercellSupport:.05,linearFraction:.85}
};
const downstream={
  features:{explicitBoundaryInfluence:.28,warmSector:true},
  forecast:{openWarmSectorSupport:.88,prefrontalSupercellSupport:.9,linearFraction:.35}
};

assert.ok(boundaryRelativeHazardSupport(downstream,'tornado')>boundaryRelativeHazardSupport(boundaryCore,'tornado'));
assert.ok(boundaryRelativeHazardSupport(downstream,'hail')>boundaryRelativeHazardSupport(boundaryCore,'hail'));
assert.ok(boundaryRelativeHazardSupport(boundaryCore,'wind')>=.98,
  'linear wind guidance should remain attached to a frontal lifting corridor');
assert.ok(boundaryRelativeHazardSupport(boundaryCore,'tornado')<.75,
  'a boundary centerline without warm-sector support should not win a tornado bullseye');

console.log('2.33.5 boundary-relative hazard placement regression passed');
