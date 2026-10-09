import assert from 'node:assert/strict';
import { boundaryAwareStpFactor } from '../js/synoptic/BoundaryAirMassEngine.js';

assert.ok(boundaryAwareStpFactor({airMass:{sector:'dry-sector'},features:{boundaryRelative:{type:'dryline',side:'behind'}},surface:{temperature:92,dewpoint:48}})<0.3);
assert.ok(boundaryAwareStpFactor({airMass:{sector:'post-cold-front'},surface:{temperature:65,dewpoint:50}})<=0.12);
assert.equal(boundaryAwareStpFactor({airMass:{sector:'warm-sector'},surface:{temperature:82,dewpoint:70}}),1);
console.log('2.67.0 air-mass and boundary dynamics: PASS');
