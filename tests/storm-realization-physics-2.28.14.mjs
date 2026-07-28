import assert from 'node:assert/strict';
import { diagnoseStormRealizationPhysics, diagnoseOutlookRealizationChain } from '../js/storms/StormRealizationPhysics.js?v=2.28.14';
import { diagnosePreferredMode } from '../js/storms/StormModeEngine.js?v=2.28.14';

const weak = diagnoseStormRealizationPhysics({cape:250,cin:190,bulkShear:45,srh:250,lcl:1800,forcing:0.12,stormCoverage:0.2,discreteFraction:0.8});
const strong = diagnoseStormRealizationPhysics({cape:2600,cin:25,bulkShear:48,srh:260,lcl:850,forcing:0.65,stormCoverage:0.55,discreteFraction:0.75,boundaryInfluence:0.45});
assert.ok(strong.realizedUpdraftMs > weak.realizedUpdraftMs);
assert.ok(strong.initiationProbability > weak.initiationProbability);
assert.ok(strong.organizationProbability > weak.organizationProbability);
assert.ok(weak.supercellProbability < 0.25, 'strong shear alone must not create a realized supercell');
const mode = diagnosePreferredMode({cape:250,cin:190,bulkShear:45,srh:250,lcl:1800,forcing:0.12,stormCoverage:0.2,discreteFraction:0.8,linearFraction:0.2});
assert.notEqual(mode.mode, 'discrete supercell');
const cell={derived:{diagnostics:{forcing:0.65,boundaryInfluence:0.4}},forecast:{stormCoverage:0.55,discreteFraction:0.7,linearFraction:0.3}};
const chain=diagnoseOutlookRealizationChain(cell,{cape:2500,cin:30,srh:250,shear:48,lcl:850,capErosion:0.8,moistureTransport:0.7,initiationProbability:0.75});
assert.ok(chain.atLeastOneOrganizedStorm > 0);
assert.ok(chain.opportunityLambda <= 3.5);
console.log('2.28.14 storm realization physics tests passed');
