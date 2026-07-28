import assert from 'node:assert/strict';
import { diagnoseCellEnvironment } from '../js/diagnostics/riskDiagnosis.js';

function cell(overrides={}) {
  return {
    surface:{dewpoint:62,seaLevelPressure:1005},
    features:{front:'none',dryline:false,outflowBoundary:false},
    levels:{500:{windSpeed:50},700:{temperatureC:0},850:{temperatureC:10}},
    dynamics:{convectiveReadiness:.7,triggerStrength:.7,initiationPotential:.7},
    forecast:{stormCoverage:.85,discreteFraction:.9,linearFraction:.1,conditionalTornadoIntensity:.95},
    derived:{cape:1200,cin:80,bulkShear:40,srh:130,lcl:1650,stp:.8,scp:4,...overrides}
  };
}
const marginal=cell();
diagnoseCellEnvironment(marginal);
assert.ok(marginal.derived.hazards.tornadoProbability <= 5, 'marginal TOR sounding must not receive 10-15% tornado probability');
assert.equal(marginal.derived.hazards.tornadoCig,0,'marginal TOR sounding must not receive CIG');
assert.equal(marginal.derived.diagnostics.tornadoEnvironmentTier,1);

const strong=cell({cape:2400,bulkShear:48,srh:290,lcl:1050,stp:5.5,cin:55});
diagnoseCellEnvironment(strong);
assert.ok(strong.derived.hazards.tornadoProbability >= 10,'strong TOR sounding should retain elevated tornado probability');
assert.ok(strong.derived.hazards.tornadoCig >= 1,'strong TOR sounding may receive CIG');
console.log('tornado-sounding-coherence: ok');
