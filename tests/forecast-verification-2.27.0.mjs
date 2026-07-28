import assert from 'node:assert/strict';
import { runSeedVerification } from '../js/verification/ForecastVerificationEngine.js';
const report = runSeedVerification(63869760, { hours: 1 });
assert.equal(report.verifierVersion, '2.27.0');
assert.ok(report.performance.totalMs > 0);
assert.ok(Number.isFinite(report.performance.simulatedHoursPerSecond));
assert.equal(report.products.some(p => p.validEndHour > report.simulation.endHourUtc), false);
assert.ok(report.incompleteProducts.every(p => p.status === 'UNVERIFIED_INCOMPLETE_TRUTH_WINDOW'));
console.log('2.27 verification performance and truth-window checks passed');
