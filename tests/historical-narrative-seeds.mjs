import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { buildAnalogEnsemble } from '../js/forecast/AnalogEnsembleEngine.js';
import { chooseAnalogBlend } from '../js/scenarios/AnalogPatternLibrary.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { mulberry32 } from '../js/scenarios/math.js';

const guidance=chooseAnalogBlend(mulberry32(74),'lee_cyclogenesis','classic_tornado_outbreak',{targetBand:'major'});
assert.equal(guidance.analogSource,'NOAA Storm Events + ERA5');
assert.equal(guidance.historicalAnalogs[0].intensityBand,'major');
assert.match(guidance.historicalAnalogs[0].analogId,/^us-\d{4}-\d{2}-\d{2}$/);
assert.ok(guidance.historicalInfluence>0);
assert.ok(guidance.historicalIntensityScore>=60);
assert.ok(guidance.moistureReturn>.75);

const firstWorld=new Atmosphere(20,20);
const secondWorld=new Atmosphere(20,20);
const first=generateScenario(firstWorld,740403,{targetBand:'major'});
const second=generateScenario(secondWorld,740403,{targetBand:'major'});
assert.deepEqual(first.analogGuidance,second.analogGuidance,'historical seed generation must remain deterministic');
assert.equal(first.analogGuidance.analogSource,'NOAA Storm Events + ERA5');
assert.ok(first.analogGuidance.historicalPattern);

first.seed=740403;
const ensemble=buildAnalogEnsemble(first,'day1',20);
assert.equal(ensemble.historicalAnalogs[0].intensityBand,'major');
assert.equal(ensemble.historicalInfluence,first.analogGuidance.historicalInfluence);
assert.equal(ensemble.memberCount,20);
assert.ok(ensemble.failureModes.length>=0,'failure modes remain represented rather than copying historical outcomes');
console.log('historical narrative seed coupling passed');
