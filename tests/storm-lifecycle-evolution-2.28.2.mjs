import assert from 'node:assert/strict';
import { Storm } from '../js/storms/Storm.js';
const storm = new Storm({ id:'T1', xKm:0, yKm:0, velocityEastKph:35, velocityNorthKph:12, sourceCell:{x:0,y:0}, createdHourUtc:12, modeHint:'discrete supercell' });
assert.equal(storm.lifecycle.phase, 'tower');
assert.equal(storm.hazardMemory.tornado, 0);
assert.ok('cyclePhase' in storm.lifecycle);
assert.ok('occlusion' in storm.mesocycloneCycle);
assert.ok('inflowCompetition' in storm.interactions);
console.log('2.28.2 lifecycle state schema regression passed');
