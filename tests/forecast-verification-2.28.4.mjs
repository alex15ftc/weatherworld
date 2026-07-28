import assert from 'node:assert/strict';
import { collectTornadoTruthPoints, runSeedVerification } from '../js/verification/ForecastVerificationEngine.js';

const staleStorm = {
  positionKm: { x: 90, y: 90 },
  eventTags: ['tornado'],
  tornado: { onGround: false, positionKm: { x: 90, y: 90 }, trackPoints: [] },
  tornadoHistory: [{ trackPoints: [{ x: 10, y: 10, hourUtc: 4 }] }]
};
assert.deepEqual(collectTornadoTruthPoints(staleStorm, 5, 6), [], 'stale history and event tags must not follow the parent storm');

const endedBetweenFrames = {
  tornado: { onGround: false, trackPoints: [] },
  tornadoHistory: [{ trackPoints: [
    { x: 20, y: 30, hourUtc: 5.25 },
    { x: 25, y: 35, hourUtc: 5.5 }
  ] }]
};
assert.equal(collectTornadoTruthPoints(endedBetweenFrames, 5, 5.5).length, 2, 'track points produced inside the sample interval must verify');
assert.equal(collectTornadoTruthPoints(endedBetweenFrames, 5.5, 6).length, 0, 'track points must not be counted again later');

const activeWithoutTrack = {
  tornado: { onGround: true, positionKm: { x: 42, y: 18 }, trackPoints: [] },
  tornadoHistory: []
};
assert.deepEqual(collectTornadoTruthPoints(activeWithoutTrack, 5, 5.5).map(({x,y})=>({x,y})), [{ x: 42, y: 18 }]);

const report = runSeedVerification(63869760, { hours: 1 });
assert.equal(report.verifierVersion, '2.32.6');
assert.equal(report.schemaVersion, 8);
assert.ok(report.performance.totalMs > 0);
assert.equal(report.products.some(p => p.validEndHour > report.simulation.endHourUtc), false);
assert.ok(report.incompleteProducts.every(p => p.status === 'UNVERIFIED_INCOMPLETE_TRUTH_WINDOW'));
const scored = report.products[0];
if (scored) {
  assert.ok(scored.hazards.tornado.thresholdDiagnostics['2pct']);
  assert.ok(scored.hazards.tornado.thresholdDiagnostics['15pct']);
  assert.ok(scored.hazards.tornado.exactTrackDiagnostics['5pct']);
  assert.ok(scored.truthSummary.tornadoNeighborhoodCells >= scored.truthSummary.tornadoExactTrackCells);
  assert.ok(scored.forecastReasoning?.narrative);
  assert.ok(Array.isArray(scored.forecastReasoning?.supportingFactors));
  assert.ok(Array.isArray(scored.forecastReasoning?.limitingFactors));
  assert.ok(scored.decisionTree?.hazardBranches?.tornado);
  assert.ok(Array.isArray(scored.environmentalEvolution));
  assert.ok(Array.isArray(scored.bustContributors));
}
console.log('2.28.4 tornado calibration diagnostics checks passed');
