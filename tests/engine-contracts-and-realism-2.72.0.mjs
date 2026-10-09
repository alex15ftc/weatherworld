import assert from 'node:assert/strict';
import { MODEL_METADATA } from '../js/modelMetadata.js';
import { KNOWN_STORM_MODES, isKnownStormMode } from '../js/storms/StormModes.js';
import { diagnosePreferredMode } from '../js/storms/StormModeEngine.js';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';

assert.equal(MODEL_METADATA.applicationVersion, '2.72.0');
assert.equal(new Set(KNOWN_STORM_MODES).size, KNOWN_STORM_MODES.length);

const regimes = {
  plainsDryline: [env({cape:2800,cin:55,bulkShear:48,srh:230,lcl:1050,forcing:.46,discreteFraction:.8,linearFraction:.2,stormCoverage:.3}),'dryline_cyclone'],
  dixieHighShearLowCape: [env({cape:900,cin:25,bulkShear:58,srh:360,lcl:750,forcing:.72,discreteFraction:.58,linearFraction:.48,stormCoverage:.55}),'shortwave_ejection'],
  progressiveQlcs: [env({cape:1700,cin:35,bulkShear:38,srh:150,lcl:1250,forcing:.9,discreteFraction:.2,linearFraction:.9,stormCoverage:.82}),'progressive_cold_front'],
  elevatedNocturnal: [env({cape:1300,cin:150,bulkShear:42,srh:120,lcl:2100,forcing:.82,discreteFraction:.18,linearFraction:.74,stormCoverage:.78}),'elevated_mcs'],
  pulseConvection: [env({cape:2200,cin:20,bulkShear:12,srh:35,lcl:1400,forcing:.25,discreteFraction:.28,linearFraction:.2,stormCoverage:.22}),'pulse_convection']
};

for (const [name, [environment, setup]] of Object.entries(regimes)) {
  const result = diagnosePreferredMode(environment, setup);
  assert.ok(isKnownStormMode(result.mode), `${name}: unknown mode ${result.mode}`);
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
  for (const [mode, score] of Object.entries(result.scores)) {
    assert.ok(isKnownStormMode(mode), `${name}: unknown scored mode ${mode}`);
    assert.ok(Number.isFinite(score) && score >= 0);
  }
  for (const key of ['initiationProbability','supercellProbability','linearProbability']) {
    assert.ok(result.physics[key] >= 0 && result.physics[key] <= 1, `${name}: invalid ${key}`);
  }
}

const linear = diagnosePreferredMode(...regimes.progressiveQlcs).physics.linearProbability;
const pulse = diagnosePreferredMode(...regimes.pulseConvection).physics.linearProbability;
assert.ok(linear > pulse, 'strongly forced linear regime should exceed pulse linear support');

const world = new Atmosphere(20,20);
initializeEvolution(world, generateScenario(world,17));
advanceAtmosphere(world,1);
assert.equal(world.runtime.revisions.atmosphere,2);
assert.equal(world.evolution.performance.phaseRuns.meteorologicalIntegrity,2);
assert.equal(world.evolution.performance.phaseSkips.meteorologicalIntegrity??0,0);
assert.equal(world.evolution.performance.phaseRuns.analogScenario,1);
assert.equal(world.evolution.performance.phaseSkips.analogScenario,1);
assert.equal(world.evolution.performance.phaseWorkUnits.meteorologicalIntegrity,800);
assert.equal(world.evolution.performance.phaseWorkUnits.analogScenario,400);
assert.equal(world.meteorologicalIntegrity.correctionTelemetry.owner,'MeteorologicalIntegrityEngine');
assert.equal(Object.values(world.meteorologicalIntegrity.correctionTelemetry.causes).reduce((a,b)=>a+b,0),world.meteorologicalIntegrity.correctionTelemetry.count);

console.log('2.72.0 engine contracts, diagnostic cadence, and multi-regime realism foundations: PASS');

function env(overrides){return{cape:1000,cin:50,bulkShear:30,srh:100,lcl:1300,forcing:.5,convergence:.5,moistureConvergence:.5,capErosion:.5,effectiveInflow:.65,stormCoverage:.4,discreteFraction:.5,linearFraction:.5,midlevelLapseRate:7,...overrides};}
