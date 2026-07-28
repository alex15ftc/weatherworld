import assert from 'node:assert/strict';
import { runSeedVerification } from '../js/verification/ForecastVerificationEngine.js';
const report = runSeedVerification(72776780, { hours: 3 });
assert.equal(report.seed, 72776780);
assert.equal(report.verifierVersion, '2.26.0');
assert.ok(report.forecast.productsScored >= 1);
assert.ok(report.event.stormsCreated >= 0);
assert.ok(report.products.every(p => Number.isFinite(p.score)));
for (const product of report.products) {
  assert.ok(product.categorical.withinOneAccuracy >= 0 && product.categorical.withinOneAccuracy <= 1);
  for (const hazard of ['tornado','hail','wind']) assert.ok(product.hazards[hazard].brierScore >= 0 && product.hazards[hazard].brierScore <= 1);
}
console.log('forecast verification 2.26.0 passed');
