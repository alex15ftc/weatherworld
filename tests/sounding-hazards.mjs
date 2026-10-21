// The hazard outlook shown with a sounding runs the storm engine's own functions on the air
// at a point. These check that it responds to the air the way storms do.
import assert from 'node:assert/strict';
import { runLoneStorm } from '../js/storms/SoundingHazards.js';
import { hailSizeInches, gustMph, GUST, HAIL } from '../js/storms/StormHazards.js';

const wind = (eastKt, northKt) => ({ eastKt, northKt });
const air = overrides => ({
  cape: 3000, cin: 20, mostUnstableCape: 3000, mostUnstableCin: 20, srh: 300, bulkShear: 55, lcl: 800, dcape: 900,
  lapseRate700500: 7.8, readiness: 0.6, forcing: 0.4, warmSector: 1, openWarmSectorSupport: 1, stormCoverage: 0, processedAir: 0,
  linearFraction: 0.1, boundaryInfluence: 0.1, surfaceWind: wind(-8, 14), wind850: wind(10, 32), wind500: wind(48, 20), ...overrides
});

const strong = runLoneStorm({}, air({}));
assert.ok(strong.storm.lasting, 'a storm lasts in strong instability and shear');
assert.ok(strong.storm.rotating >= 0.5, 'and it rotates');
assert.match(strong.storm.type, /supercell/);
assert.ok(strong.tornado.chance > 0.2, `tornado chance ${strong.tornado.chance}`);
assert.ok(strong.hail.maxInches >= 1, `hail ${strong.hail.maxInches}`);

// Weak shear, little turning: the same instability gives a storm that does not rotate and
// rains into itself.
const weakShear = runLoneStorm({}, air({ srh: 30, bulkShear: 12, wind850: wind(4, 12), wind500: wind(10, 12) }));
assert.ok(weakShear.storm.rotating < 0.5, 'no rotation in weak shear');
assert.ok(weakShear.tornado.chance < 0.02, `tornado chance ${weakShear.tornado.chance}`);
assert.ok(weakShear.storm.peakUpdraughtMs < strong.storm.peakUpdraughtMs, 'rain loading holds the updraught down');
assert.ok(weakShear.hail.maxInches < strong.hail.maxInches);

// A cap no storm can draw air through: nothing lasts, and no hazard is claimed.
const capped = runLoneStorm({}, air({ cin: 220, mostUnstableCin: 220 }));
assert.equal(capped.storm.lasting, false);
assert.equal(capped.tornado.chance, 0);
assert.equal(capped.hail.maxInches, 0);

// High cloud bases cut the tornado chance, not the hail.
const highBase = runLoneStorm({}, air({ lcl: 1900 }));
assert.ok(highBase.tornado.chance < 0.5 * strong.tornado.chance);
assert.ok(highBase.hail.maxInches > 0.5 * strong.hail.maxInches);

// Drier air aloft (more energy for downdraughts) gives stronger gusts.
assert.ok(runLoneStorm({}, air({ dcape: 1500 })).wind.maxGustMph > runLoneStorm({}, air({ dcape: 300 })).wind.maxGustMph);

// The shared functions themselves, at known inputs.
const storm = { updraughtMs: HAIL.referenceUpdraftMs, mesocycloneStrength: 0.4, precipitation: 1 };
const neutral = HAIL.lapseRange[0] + 0.35 * (HAIL.lapseRange[1] - HAIL.lapseRange[0]);
assert.ok(Math.abs(hailSizeInches(storm, { lapseRate700500: neutral, wetBulbZeroAglM: 0 }) - HAIL.scaleInches) < 1e-9, 'reference updraught, full rotation, neutral lapse rate, no melting = the scale size');
// Melting: a deeper warm layer takes more off, and a small stone loses a larger share of itself than a big one.
const small = { updraughtMs: 40, mesocycloneStrength: 0.4 }, sizeAt = (s, m) => hailSizeInches(s, { lapseRate700500: neutral, wetBulbZeroAglM: m });
assert.ok(sizeAt(storm, 4000) < sizeAt(storm, 2000), 'more melting under a higher wet-bulb zero');
assert.ok(1 - sizeAt(small, 3000) / sizeAt(small, 0) > 1 - sizeAt(storm, 3000) / sizeAt(storm, 0), 'small stones lose a larger share');
assert.ok(Math.abs(gustMph(storm, { dcape: 800 }, 0) - Math.sqrt(1600) * GUST.downdraughtShare * 2.23694) < 1e-9);

console.log('sounding hazards: ok');
