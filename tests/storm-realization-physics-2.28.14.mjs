import assert from 'node:assert/strict';
import { diagnoseStormRealizationPhysics } from '../js/storms/StormRealizationPhysics.js';
import { describeStormMode } from '../js/storms/StormModeEngine.js';

const weak = diagnoseStormRealizationPhysics({cape:250,cin:190,bulkShear:45,srh:250,lcl:1800,forcing:0.12,stormCoverage:0.2,discreteFraction:0.8});
const strong = diagnoseStormRealizationPhysics({cape:2600,cin:25,bulkShear:48,srh:260,lcl:850,forcing:0.65,stormCoverage:0.55,discreteFraction:0.75,boundaryInfluence:0.45});
assert.ok(strong.realizedUpdraftMs > weak.realizedUpdraftMs);
assert.ok(strong.initiationProbability > weak.initiationProbability);
assert.ok(strong.organizationProbability > weak.organizationProbability);
assert.ok(weak.supercellProbability < 0.25, 'strong shear alone must not create a realized supercell');
// A storm without rotation is not described as a supercell, whatever the shear.
const mode = describeStormMode({ mesocycloneStrength: 0.05, lineOrganization: 0.1 }, {cape:250,cin:190,bulkShear:45,srh:250,lcl:1800,forcing:0.12,stormCoverage:0.2});
assert.ok(!mode.includes('supercell'), mode);
console.log('2.28.14 storm realization physics tests passed');
