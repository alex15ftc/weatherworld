import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { diagnoseStormMotion } from '../js/storms/environmentSampling.js';
import { Storm } from '../js/storms/Storm.js';
import { resolveRuntimeProfile } from '../js/runtime/RuntimeProfile.js';

const initiationSource = await readFile(new URL('../js/storms/InitiationEngine.js', import.meta.url), 'utf8');
const couplingSource = await readFile(new URL('../js/coupling/CoupledAtmosphereEngine.js', import.meta.url), 'utf8');
const trackingSource = await readFile(new URL('../js/storms/StormTrackIntelligence.js', import.meta.url), 'utf8');
assert.doesNotMatch(initiationSource, /cell\.forecast/, 'realized initiation must not consume forecast products');
assert.doesNotMatch(couplingSource, /cell\.surface\.(temperature|dewpoint)\s*[+-]=/, 'coupling records memory; the energy budget owns tendencies');
assert.doesNotMatch(trackingSource, /storm\.velocityKph\.(east|north)\s*=/, 'track intelligence must not overwrite realized motion');
assert.equal(resolveRuntimeProfile('gameplay').fullThermodynamicsCadenceHours, 1);

const environment = {
  wind850: { eastKt: 22, northKt: 8 },
  wind500: { eastKt: 48, northKt: 20 },
  surfaceWind: { eastKt: 12, northKt: 3 },
  meanWind: { u: 33, v: 13 },
  stormMotion: { right: { u: 40, v: 5 }, left: { u: 26, v: 21 } },
  bulkShear: 48, linearFraction: 0.8
};
const right = diagnoseStormMotion(environment, 'discrete supercell');
const left = diagnoseStormMotion(environment, 'left-moving supercell');
const line = diagnoseStormMotion(environment, 'QLCS');
assert.notDeepEqual(right, left, 'Bunkers right and left movers must remain distinct');
assert.notDeepEqual(right, line, 'linear propagation must be distinct from supercell motion');

const storm = new Storm({ id: 'T1', xKm: 0, yKm: 0, velocityEastKph: 30, velocityNorthKph: 10, sourceCell: { x: 0, y: 0 }, createdHourUtc: 18, modeHint: 'multicell' });
assert.deepEqual(storm.modeHistory, [{ hourUtc: 18, mode: 'multicell', reason: 'initiation' }]);
console.log('2.73.0 atmospheric causality and ownership checks passed');
