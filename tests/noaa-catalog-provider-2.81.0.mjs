import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { historicalCatalog, isValidatedNoaaCatalog } from '../js/analogs/HistoricalCatalogProvider.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';

assert.equal(isValidatedNoaaCatalog([]), false);
const complete = Array.from({ length:25 }, (_, index) => ({
  provenance:{ environment:'NOAA NCEI NARR', soundings:'NOAA NCEI IGRA 2 / NARR hybrid' },
  soundingSequence:[12,18,24].map(hourUtc => ({ hourUtc }))
}));
assert.equal(isValidatedNoaaCatalog(complete), true);

const source = historicalCatalog();
assert.ok(source.records.length >= 25);
assert.equal(source.providerId, 'noaa-narr-igra', 'validated NOAA catalog is preferred');
assert.equal(source.legacyFallback, false);

const config = generateScenario(new Atmosphere(4,4), 4);
assert.equal(config.analogGuidance.analogProviderId, 'noaa-narr-igra');
assert.equal(config.analogGuidance.legacyAnalogFallback, false);
assert.match(config.analogGuidance.analogSource, /NOAA NCEI NARR/);
assert.equal(config.analogGuidance.historicalSoundingSequence.length, 3);
assert.ok(config.analogGuidance.historicalSoundingSequence.every(item=>item.levels.length>=5));
assert.equal(config.analogGuidance.analogModel.version, '2.81.0');
console.log({ provider:source.providerId, records:source.records.length, noaaActive:true });
