import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scoreOutlook, summarizeScores, issueOf } from '../js/verification/outlookScore.js';
import { OutlookScoreboard } from '../server/OutlookScoreboard.js';
import { WORLD_RISK_ORDER, WORLD_HAZARDS } from '../js/forecast/worldRiskCategories.js';

const width = 20, height = 20, n = width * height, map = { width, height, cellSizeKm: 16 };
const filled = (value, inside = () => true) => Array.from({ length: n }, (_, i) => (inside(i) ? value : 0));
const west = i => i % width < 10;

// --- One outlook scored against a made-up day: Slight over the western half with a 15% wind area there; the wind came
// near in the western half and the day verified Slight there.
const outlook = {
  day: 'day1', issuedHourUtc: 12, validFromHourUtc: 12, validToHourUtc: 36, hazards: WORLD_HAZARDS,
  category: filled('SLGT', west).map(c => c || 'TSTM'),
  level: { tornado: Uint8Array.from(filled(0)), wind: Uint8Array.from(filled(15, west)), hail: Uint8Array.from(filled(0)) },
  chance: { tornado: Uint8Array.from(filled(0)), wind: Uint8Array.from(filled(20, west)), hail: Uint8Array.from(filled(0)) }
};
const truth = { worldRisk: filled('SLGT', west).map(c => c || 'TSTM'), tornado: Uint8Array.from(filled(0)), wind: Uint8Array.from(filled(1, i => west(i) && i % 2 === 0)), hail: Uint8Array.from(filled(0)), storm: Uint8Array.from(filled(1)) };
const score = scoreOutlook(outlook, truth, map);
assert.equal(score.forecast, 'SLGT'); assert.equal(score.verified, 'SLGT'); assert.equal(score.sameCell, 1);
const slight = score.categories[WORLD_RISK_ORDER.indexOf('SLGT') - 2];
assert.deepEqual(slight, { hits: n / 2, misses: 0, falseAlarms: 0 });
const wind = score.hazards.wind;
assert.equal(wind.cells, n); assert.equal(wind.events, n / 4);
assert.equal(wind.levels[2].cells, n / 2); assert.equal(wind.levels[2].hits, n / 4, 'half the 15% area had the wind near');
// Brier of the issued level: inside the area (0.15 - o)^2, outside 0.
assert.ok(Math.abs(wind.issued - (n / 4) * (0.85 ** 2 + 0.15 ** 2)) < 1e-6);
const [summary] = summarizeScores([score, { ...score, forecast: 'ENH' }]);
assert.equal(summary.issue, 'day1 1200Z'); assert.equal(summary.outlooks, 2); assert.equal(summary.right, 0.5); assert.equal(summary.tooHigh, 0.5); assert.equal(summary.tooLow, 0);
assert.ok(summary.hazards.wind.brierSkillIssued > 0, 'a 15% area where half the places get the wind beats the base rate');
assert.equal(summary.hazards.wind.reliability.find(r => r.level === 15).verified, 0.5);
assert.equal(issueOf({ day: 'day1', issuedHourUtc: 16.5 }), 'day1 1630Z'); assert.equal(issueOf({ day: 'day2', issuedHourUtc: 17.5 }), 'day2');

// --- Day 3: one chance, of any severe weather, verified from the reports of any kind.
{
  const three = { ...outlook, day: 'day3', hazards: ['severe'], level: { severe: Uint8Array.from(filled(5, west)) }, chance: { severe: Uint8Array.from(filled(6, west)) }, category: filled('MRGN', west).map(c => c || 'TSTM') };
  const exact = name => Uint8Array.from(filled(name === 'windExact' ? 1 : 0, i => i === 25));
  const day3Truth = { ...truth, wind: Uint8Array.from(filled(1, i => i < 60)), ...Object.fromEntries(['tornadoExact', 'windExact', 'hailExact', 'tornadoSigExact', 'windSigExact', 'hailSigExact', 'tornadoExtremeExact', 'windExtremeExact', 'hailExtremeExact'].map(k => [k, exact(k)])) };
  const s = scoreOutlook(three, day3Truth, map);
  assert.deepEqual(Object.keys(s.hazards), ['severe']); assert.equal(s.hazards.severe.events, 60);
}

// --- The live scoreboard: outlooks kept until their day ends, the day captured step by step, each scored from its start.
const world = { width, height, cellSizeKm: 16, cellSizeMiles: 10, validHourUtc: 12, storms: [] };
const runtime = { worldId: 'w1', engine: { world }, places: null };
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scores-')), 'outlook-scores.bin');
const board = new OutlookScoreboard({ runtime, file });
const quiet = (day, issuedHourUtc, validFromHourUtc, validToHourUtc, category = 'NONE') => ({
  day, issuedHourUtc, validFromHourUtc, validToHourUtc, hazards: WORLD_HAZARDS, highest: category, width, height,
  category: filled(category), level: { tornado: filled(0), wind: filled(category === 'NONE' ? 0 : 5), hail: filled(0) }, chance: { tornado: filled(0), wind: filled(category === 'NONE' ? 0 : 6), hail: filled(0) }
});
board.afterStep(world);   // the capture starts at 12Z
board.issued(quiet('day1', 6, 6, 36));                 // the 06Z Day 1, valid from its issue: starts with the day
board.issued(quiet('day1', 20, 20, 36, 'MRGN'));       // the 20Z update, from 20Z
board.issued(quiet('day2', 17.5, 36, 60));             // tomorrow's
for (let step = 0; step < 48; step++) { world.validHourUtc += 0.5; board.afterStep(world); }
let report = board.report();
assert.equal(report.outlooks, 2, 'both of the day\'s outlooks scored, tomorrow\'s still waiting'); assert.equal(report.pending.length, 1); assert.equal(report.pending[0].day, 'day2');
const byIssue = Object.fromEntries(report.summary.map(s => [s.issue, s]));
assert.equal(byIssue['day1 0600Z'].right, 1, 'a quiet forecast of a quiet day'); assert.equal(byIssue['day1 2000Z'].tooHigh, 1, 'a Marginal over a quiet day');
assert.equal(report.capturingFromHourUtc, 36, 'the next day is captured from its start');

// --- Saved and put back after a restart; a day whose capture began late is not scored for outlooks before it.
await board.flush();
const again = new OutlookScoreboard({ runtime, file });
assert.equal(again.report().outlooks, 2); assert.equal(again.report().pending.length, 1);
world.validHourUtc = 40;   // came up at 16Z, four hours into Day 2's day
again.afterStep(world);
for (let step = 0; step < 40; step++) { world.validHourUtc += 0.5; again.afterStep(world); }
assert.equal(again.report().outlooks, 2, 'the day captured from 16Z does not score an outlook valid from 12Z'); assert.equal(again.report().pending.length, 0);

// --- A new world starts a new record.
runtime.worldId = 'w2';
assert.equal(again.report().outlooks, 0); assert.equal(again.report().worldId, 'w2');
console.log('outlook scoreboard ok');
