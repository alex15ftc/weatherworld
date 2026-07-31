import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateFeatures, validateFeatures } from '../scripts/training-features.mjs';

const index = generateFeatures();
assert.ok(index.recordCount >= 39, 'expected all ERA5 records to become feature records');
assert.equal(index.eventRecordCount, 39, 'all current cases should be event-corpus usable');
assert.equal(index.forecastRecordCount, 9, 'nine modern cases should include forecast labels');
assert.ok(index.featureCount >= 30, 'feature vector should include atmospheric and spatial-proxy dimensions');

const validation = validateFeatures();
assert.equal(validation.valid, true, validation.errors.join('\n'));
assert.equal(validation.recordCount, index.recordCount);

const sample = JSON.parse(fs.readFileSync(path.resolve('training/features/records/2024-05-06.json'), 'utf8'));
assert.ok(sample.inputs.raw.thermodynamics.capeMaxJkg > 0);
assert.ok(Number.isFinite(sample.inputs.normalized.windProfile.shear850To500Ms));
assert.ok(sample.labels.outcomes.tornadoReports >= 0);
assert.ok(sample.labels.forecast, 'forecast labels should be attached after atmospheric feature extraction');
assert.equal(sample.inputs.labels, undefined, 'labels must not leak into analog inputs');
assert.ok(sample.quality.score >= 0 && sample.quality.score <= 1);
console.log('2.39.0 analog feature dataset regression: PASS');
