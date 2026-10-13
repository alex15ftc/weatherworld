import assert from 'node:assert/strict';
import { WORLD_RISK_ORDER, WORLD_HAZARDS, WORLD_MAX_CIG, WORLD_CATEGORY_TABLES, PROBABILITY_LEVELS, worldCategory, worldCategoryFromHazard, drawnCig, highestCigAt, leadingHazard, conditionalCig, contourCig, CIG_SHARE } from '../js/forecast/worldRiskCategories.js';
import { CATEGORY_TABLES, categoryFromHazard } from '../js/forecast/spcOutlookRules.js';
import { aggregateTruth, practicallyPerfectChance, TRUTH_FIELDS, CHANCE_FIELDS } from '../js/verification/truth.js';

const rank = category => WORLD_RISK_ORDER.indexOf(category);
const quiet = { tornado: { percent: 0, cig: 0 }, wind: { percent: 0, cig: 0 }, hail: { percent: 0, cig: 0 } };

// --- The contour levels are the Storm Prediction Center's, and only those.
assert.deepEqual(PROBABILITY_LEVELS.tornado, [2, 5, 10, 15, 30, 45, 60]);
assert.deepEqual(PROBABILITY_LEVELS.wind, [5, 15, 30, 45, 60, 75, 90]);
assert.deepEqual(PROBABILITY_LEVELS.hail, [5, 15, 30, 45, 60]);
assert.deepEqual(WORLD_MAX_CIG, { tornado: 3, wind: 3, hail: 2, severe: 2 });
assert.equal(WORLD_CATEGORY_TABLES, CATEGORY_TABLES, 'the tables are the Storm Prediction Center\'s own');
for (const hazard of WORLD_HAZARDS) assert.deepEqual(Object.keys(WORLD_CATEGORY_TABLES[hazard]).map(Number), PROBABILITY_LEVELS[hazard], `${hazard}: a row for every contour level`);

// --- A chance between two contours reads as the lower one: 26% is inside the 15% contour, no more.
assert.equal(worldCategoryFromHazard('tornado', 26, 0), worldCategoryFromHazard('tornado', 15, 0));
assert.equal(worldCategoryFromHazard('tornado', 29.9, 2), worldCategoryFromHazard('tornado', 15, 2));
assert.equal(worldCategoryFromHazard('tornado', 1.9, 0), null, 'below the lowest contour there is no severe category');
assert.equal(worldCategoryFromHazard('hail', 4, 2), null);

// --- More chance or a higher intensity group never gives a lower category.
for (const hazard of WORLD_HAZARDS) {
  for (let cig = 0; cig <= WORLD_MAX_CIG[hazard]; cig++) { let last = 0; for (const level of PROBABILITY_LEVELS[hazard]) { const now = rank(worldCategoryFromHazard(hazard, level, cig)); assert.ok(now >= last, `${hazard} ${level}% CIG${cig}`); last = now; } }
  for (const level of PROBABILITY_LEVELS[hazard]) { let last = 0; for (let cig = 0; cig <= WORLD_MAX_CIG[hazard]; cig++) { const now = rank(worldCategoryFromHazard(hazard, level, cig)); assert.ok(now >= last, `${hazard} ${level}% up to CIG${cig}`); last = now; } }
}
// A high intensity group is not drawn inside a very low chance: it is held to what the contour allows.
assert.equal(highestCigAt('tornado', 2), 1); assert.equal(drawnCig('tornado', 3, 3), 1); assert.equal(drawnCig('tornado', 31, 3), 3); assert.equal(drawnCig('hail', 50, 3), 2);
assert.equal(drawnCig('wind', 1, 3), 0, 'no group outside every contour');

// --- The top and bottom of the scale.
assert.equal(worldCategory(quiet), 'NONE'); assert.equal(worldCategory(quiet, { thunder: true }), 'TSTM');
assert.equal(worldCategory({ ...quiet, tornado: { percent: 2, cig: 0 } }), 'MRGN');
// As in the real outlooks: a 30% tornado area with intense tornadoes, or a 45% wind area with
// 96 mph gusts, is High; hail alone never is.
assert.equal(worldCategory({ ...quiet, tornado: { percent: 30, cig: 2 } }), 'HIGH');
assert.equal(worldCategory({ ...quiet, tornado: { percent: 60, cig: 0 } }), 'ENH');
assert.equal(worldCategory({ ...quiet, wind: { percent: 45, cig: 3 } }), 'HIGH');
assert.equal(worldCategory({ ...quiet, wind: { percent: 90, cig: 1 } }), 'MDT');
assert.equal(worldCategory({ ...quiet, hail: { percent: 100, cig: 2 } }), 'MDT');
for (const hazard of WORLD_HAZARDS) for (const level of PROBABILITY_LEVELS[hazard]) for (let cig = 0; cig <= WORLD_MAX_CIG[hazard]; cig++) assert.equal(worldCategoryFromHazard(hazard, level, cig), CATEGORY_TABLES[hazard][level].slice(0, cig + 1).filter(Boolean).at(-1), `${hazard} ${level}% CIG${cig}`);
// Day 3 has one chance, of any severe weather, and stops at Moderate.
assert.equal(worldCategory({ severe: { percent: 60, cig: 2 } }), 'MDT'); assert.equal(worldCategory({ severe: { percent: 16, cig: 0 } }), 'SLGT');
// The category is the highest any hazard gives; the hazard that gives it is named.
const mixed = { tornado: { percent: 16, cig: 2 }, wind: { percent: 50, cig: 0 }, hail: { percent: 20, cig: 0 } };
assert.equal(worldCategory(mixed), 'MDT'); assert.equal(leadingHazard(mixed, 'MDT'), 'tornado'); assert.equal(leadingHazard(quiet, 'SLGT'), null);

// --- Conditional intensity: a group needs its share of the severe weather to reach the tier.
assert.equal(CIG_SHARE, 0.3);
assert.equal(conditionalCig(40, [20, 13, 2]), 2, 'half EF2+, a third EF3+: CIG2');
assert.equal(conditionalCig(40, [11, 3, 1]), 0, 'a quarter EF2+: no group');
assert.equal(conditionalCig(40, [12, 12, 12]), 3); assert.equal(conditionalCig(0, [0, 0, 0]), 0);
// Each separate area inside a contour is judged as a whole; a cell takes the group of the highest contour it is in.
{
  const w = 20, h = 10, hail = new Float32Array(w * h), big = new Float32Array(w * h), giant = new Float32Array(w * h), at = (x, y) => y * w + x;
  for (let y = 2; y < 8; y++) { for (let x = 1; x < 8; x++) { hail[at(x, y)] = 20; big[at(x, y)] = x === 1 ? 20 : 0; } for (let x = 12; x < 19; x++) { hail[at(x, y)] = 20; big[at(x, y)] = 10; } }
  for (let y = 4; y < 6; y++) for (let x = 14; x < 17; x++) { hail[at(x, y)] = 50; big[at(x, y)] = 5; }
  const groups = contourCig('hail', hail, hail, [big, giant], w, h);
  assert.equal(groups[at(4, 4)], 0, 'a seventh of the western area\'s hail is big: no group, even right beside it'); assert.equal(groups[at(1, 4)], 0);
  assert.equal(groups[at(12, 4)], 1, 'well over 30% of the eastern area\'s hail is big: CIG1 over all of it');
  assert.equal(groups[at(15, 4)], 0, 'but only a tenth of the hail in its 45% core is: the core has no group'); assert.equal(groups[at(10, 4)], 0);
}

// --- From reports on the map: contour levels and intensity groups, and the category from them.
const width = 50, height = 50, cellMiles = 10, n = width * height;
const frame = { hourUtc: 21, activeStorms: 1, tornadoes: 0, tornadoTrackPoints: [] };
for (const field of TRUTH_FIELDS) frame[field] = new Uint8Array(n);
const cell = (x, y) => y * width + x;
// A cluster of tornadoes in the middle of the map (the western ones EF3+), with storms about,
// and a wide swath of wind in the south-east with a single 96 mph gust in it.
for (let x = 14; x < 36; x++) for (let y = 14; y < 36; y++) { frame.tornado[cell(x, y)] = 1; frame.storm[cell(x, y)] = 1; if (x < 25) { frame.tornadoSig[cell(x, y)] = 1; frame.tornadoExtreme[cell(x, y)] = 1; } }
frame.storm[cell(2, 2)] = 1;
for (let x = 38; x < 50; x++) for (let y = 38; y < 50; y++) frame.wind[cell(x, y)] = 1;
frame.windSig[cell(45, 45)] = 1; frame.windExtreme[cell(45, 45)] = 1; frame.windViolent[cell(45, 45)] = 1;
const truth = aggregateTruth([frame], [], width, height, 25 / cellMiles, cellMiles);
assert.ok(PROBABILITY_LEVELS.tornado.includes(truth.observedProbability.tornado[cell(25, 25)]), 'the verified chance is a contour level');
assert.ok(truth.observedProbability.tornado.every(v => v === 0 || PROBABILITY_LEVELS.tornado.includes(v)), 'everywhere');
assert.equal(truth.observedCig.tornado[cell(17, 25)], 2, 'half the tornadoes in the area EF3+: CIG2'); assert.equal(truth.observedCig.tornado[cell(34, 25)], 2, 'the area is judged as a whole');
assert.equal(truth.observedCig.tornado[cell(49, 2)], 0, 'no group outside every contour');
assert.equal(truth.observedCig.wind[cell(45, 45)], 0, 'one 96 mph gust in a wide swath of wind does not make a group');
for (let i = 0; i < n; i++) assert.equal(truth.worldRisk[i] === 'NONE' || truth.worldRisk[i] === 'TSTM' ? null : truth.worldRisk[i], ['tornado', 'wind', 'hail'].map(h => (truth.observedProbability[h][i] ? categoryFromHazard(h, truth.observedProbability[h][i], truth.observedCig[h][i]) : null)).filter(Boolean).sort((a, b) => rank(b) - rank(a))[0] ?? null);
assert.ok(rank(truth.worldRisk[cell(22, 25)]) >= rank('ENH'), `Enhanced or more at the heart of it (${truth.worldRisk[cell(22, 25)]})`);
assert.ok(rank(truth.worldRisk[cell(22, 25)]) >= rank(truth.worldRisk[cell(44, 25)]) && rank(truth.worldRisk[cell(44, 25)]) >= rank(truth.worldRisk[cell(49, 2)]), 'and the category steps down outward');
assert.ok(['TSTM', 'MRGN', 'SLGT'].includes(truth.worldRisk[cell(2, 2)]), 'a storm far from the severe weather is at most a low category');
assert.equal(truth.risk.length, n, 'the real-world categories are still given beside them');
// The unrounded chances (used to draw smooth contours) cover every hazard and tier.
for (const field of CHANCE_FIELDS) assert.ok(truth.chance[field].length === n && truth.chance[field].every(v => v >= 0 && v <= 100), field);
assert.ok(practicallyPerfectChance(new Uint8Array(n), width, height, 16).every(v => v === 0));
console.log(`world risk categories passed (heart ${truth.worldRisk[cell(22, 25)]}, edge ${truth.worldRisk[cell(44, 25)]}, corner ${truth.worldRisk[cell(49, 2)]})`);
