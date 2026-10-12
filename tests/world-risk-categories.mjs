import assert from 'node:assert/strict';
import { WORLD_RISK_ORDER, WORLD_RISK_HAZARDS, WORLD_RISK_THRESHOLDS, worldCategory, leadingHazard } from '../js/forecast/worldRiskCategories.js';
import { aggregateTruth, practicallyPerfectChance, TRUTH_FIELDS } from '../js/verification/truth.js';

const none = Object.fromEntries(WORLD_RISK_HAZARDS.map(h => [h, 0]));
const rank = category => WORLD_RISK_ORDER.indexOf(category);

// --- Nothing severe: thunderstorms or nothing.
assert.equal(worldCategory(none), 'NONE');
assert.equal(worldCategory(none, { thunder: true }), 'TSTM');

// --- A higher category never asks for less than the one below it, hazard by hazard.
const ladder = ['MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
for (const hazard of WORLD_RISK_HAZARDS) {
  let last = 0;
  for (const category of ladder) { const limit = WORLD_RISK_THRESHOLDS[category][hazard]; if (limit === null) continue; assert.ok(limit >= last, `${hazard}: ${category} is not below the category under it`); last = limit; }
}

// --- More chance, never a lower category.
for (const hazard of WORLD_RISK_HAZARDS) {
  let last = 0;
  for (let chance = 0; chance <= 100; chance += 1) { const now = rank(worldCategory({ ...none, [hazard]: chance })); assert.ok(now >= last, `${hazard} at ${chance}%`); last = now; }
}

// --- Any tornado near a place is at least a Slight risk there; a high chance of one is a High risk.
assert.equal(worldCategory({ ...none, tornado: 2 }), 'SLGT');
assert.equal(worldCategory({ ...none, tornado: 95 }), 'HIGH');
assert.equal(worldCategory({ ...none, tornado: 45 }), 'ENH');
// A significant tornado counts for more than the same chance of any tornado.
assert.ok(rank(worldCategory({ ...none, tornadoSig: 40 })) > rank(worldCategory({ ...none, tornado: 40 })));
// Hail alone never makes a High day; nor does 58 mph wind go past Enhanced on its own.
assert.equal(worldCategory({ ...none, hail: 100, hailSig: 100 }), 'MDT');
assert.equal(worldCategory({ ...none, wind: 100 }), 'ENH');
assert.equal(worldCategory({ ...none, wind: 100, windSig: 98 }), 'HIGH');
// The hazard that carries the category is named.
assert.equal(leadingHazard({ ...none, wind: 100, tornadoSig: 70 }, 'HIGH'), 'tornadoSig');
assert.equal(leadingHazard(none, 'SLGT'), null);

// --- From reports on the map: the chance falls away from the reports, and the category with it.
const width = 50, height = 50, cellMiles = 10, n = width * height;
const frame = { hourUtc: 21, activeStorms: 1, tornadoes: 0, tornadoTrackPoints: [] };
for (const field of TRUTH_FIELDS) frame[field] = new Uint8Array(n);
const cell = (x, y) => y * width + x;
// A cluster of tornadoes (some significant) in the middle of the map, with storms about.
for (let x = 14; x < 36; x++) for (let y = 14; y < 36; y++) { frame.tornado[cell(x, y)] = 1; frame.storm[cell(x, y)] = 1; if (x < 25) frame.tornadoSig[cell(x, y)] = 1; }
frame.storm[cell(2, 2)] = 1;
const truth = aggregateTruth([frame], [], width, height, 25 / cellMiles, cellMiles);
assert.ok(truth.chance.tornado[cell(25, 25)] > truth.chance.tornado[cell(40, 25)] && truth.chance.tornado[cell(40, 25)] > truth.chance.tornado[cell(49, 49)], 'the chance of a tornado falls away from where they were');
assert.ok(rank(truth.worldRisk[cell(25, 25)]) >= rank('ENH'), `Enhanced or more at the heart of it (${truth.worldRisk[cell(25, 25)]})`);
assert.ok(rank(truth.worldRisk[cell(25, 25)]) >= rank(truth.worldRisk[cell(40, 25)]) && rank(truth.worldRisk[cell(40, 25)]) >= rank(truth.worldRisk[cell(49, 2)]), 'and the category steps down outward');
assert.equal(truth.worldRisk[cell(2, 2)], truth.chance.tornado[cell(2, 2)] >= 0.5 ? 'SLGT' : 'TSTM', 'a storm with no severe weather near it is a thunderstorm area');
assert.ok(truth.risk.length === n, 'the real-world categories are still given beside them');
// The unrounded chance is between 0 and 100 and zero with no reports.
assert.ok(practicallyPerfectChance(new Uint8Array(n), width, height, 16).every(v => v === 0));
assert.ok(truth.chance.tornado.every(v => v >= 0 && v <= 100));
console.log(`world risk categories passed (centre ${truth.worldRisk[cell(25, 25)]}, 150 miles off ${truth.worldRisk[cell(40, 25)]}, corner ${truth.worldRisk[cell(49, 2)]})`);
