import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';
import { nextSystemSeed } from '../js/world/systemBuilder.js';

// --- A restarted authority resumes the saved system and then evolves exactly as the original.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-authority-'));
const statePath = path.join(dir, 'state.bin');
const fingerprint = runtime => {
  let sum = 0;
  runtime.atmosphere.forEachCell(cell => { sum += cell.surface.temperature + cell.surface.dewpoint + (cell.derived.cape ?? 0) + cell.levels[500].windSpeed; });
  return { hour: runtime.atmosphere.validHourUtc, seed: runtime.seed, sum: Math.round(sum * 1000), storms: runtime.atmosphere.storms.map(s => [s.id, Math.round(s.positionKm.x * 100), Math.round(s.positionKm.y * 100), s.mode]) };
};
const first = new WeatherAuthorityRuntime({ seed: 4242, statePath, outlookWorkers: 0 });
first.advance(3);
await first.savingState;
assert.ok(fs.existsSync(statePath), 'state is saved');
const resumed = new WeatherAuthorityRuntime({ statePath, outlookWorkers: 0 });
assert.deepEqual(fingerprint(resumed), fingerprint(first), 'resumed state matches the saved one');
assert.equal(resumed.revision, first.revision);
first.statePath = null;   // only the resumed authority keeps writing the file
first.advance(2); resumed.advance(2);
assert.deepEqual(fingerprint(resumed), fingerprint(first), 'the resumed world evolves identically');
await Promise.all([first.savingState, resumed.savingState]);

// An explicit seed starts that system instead of resuming.
const fresh = new WeatherAuthorityRuntime({ seed: 99, statePath: path.join(dir, 'other.bin'), outlookWorkers: 0 });
assert.equal(fresh.seed, 99);
assert.equal(fresh.atmosphere.validHourUtc, 12);

// --- At the end of a system the authority moves to the seed that follows it.
const seedBefore = resumed.seed;
resumed.atmosphere.evolution.elapsedHours = 72;
assert.equal(resumed.maybeStartNextSystem(), true);
assert.equal(resumed.seed, nextSystemSeed(seedBefore));
assert.equal(resumed.systemNumber, 2);
assert.equal(resumed.atmosphere.validHourUtc, 12);
assert.equal(resumed.outlookStatus().nextSystemSeed, nextSystemSeed(resumed.seed));
await Promise.all([resumed.savingState, fresh.savingState]);
console.log(`authority continuity passed (seed ${seedBefore} -> ${resumed.seed})`);
