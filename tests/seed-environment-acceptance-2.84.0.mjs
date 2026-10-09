import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario, scoreSeedEnvironment } from '../js/scenarios/scenarioGenerator.js';

const byRegime = new Map();
let retried = 0;
for (let seed = 1; seed <= 100; seed++) {
  const config = generateScenario(new Atmosphere(2, 2), seed);
  const acceptance = config.seedAcceptance;
  assert.equal(acceptance.version, '2.84.0');
  assert.equal(acceptance.source, 'historical-sounding-and-atmosphere-preflight');
  assert.equal(config.analogGuidance.historicalAtmosphereSequence.length, 5);
  assert.deepEqual(config.soundingAnchors.anchors.map(anchor => anchor.hourUtc), [12, 18, 24]);
  assert.ok(acceptance.score >= 0 && acceptance.score <= 1);
  assert.ok(acceptance.candidatesEvaluated >= 1 && acceptance.candidatesEvaluated <= 10);
  assert.deepEqual(generateScenario(new Atmosphere(2, 2), seed).seedAcceptance, acceptance);
  const rescored = scoreSeedEnvironment(config, acceptance.regime);
  assert.equal(Number(rescored.score.toFixed(12)), Number(acceptance.score.toFixed(12)));
  if (acceptance.selectedAttempt > 0) retried++;
  const row = byRegime.get(acceptance.regime) ?? { count: 0, accepted: 0, score: 0 };
  row.count++;
  row.accepted += Number(acceptance.accepted);
  row.score += acceptance.score;
  byRegime.set(acceptance.regime, row);
}

const summary = Object.fromEntries([...byRegime].map(([regime, row]) => [regime, {
  count: row.count,
  accepted: row.accepted,
  meanScore: Number((row.score / row.count).toFixed(3))
}]));
assert.ok(retried >= 5);
assert.ok(summary['outbreak-favorable'].accepted >= summary['outbreak-favorable'].count - 1);
assert.ok(summary['severe-favorable'].accepted >= summary['severe-favorable'].count * 0.9);
assert.ok(summary['outbreak-favorable'].meanScore >= summary['severe-favorable'].meanScore);
console.log({ retried, summary });
