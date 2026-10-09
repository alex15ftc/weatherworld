import assert from 'node:assert/strict';
import fs from 'node:fs';

const corpus = JSON.parse(fs.readFileSync(new URL('../calibration/cases/starter-corpus.json', import.meta.url), 'utf8'));
const weights = JSON.parse(fs.readFileSync(new URL('../calibration/config/weights.json', import.meta.url), 'utf8'));
assert.equal(corpus.schemaVersion, 1);
assert.ok(corpus.cases.length >= 4);
assert.deepEqual(new Set(corpus.cases.map(item => item.split)), new Set(['calibration', 'validation', 'holdout']));
assert.ok(corpus.cases.some(item => item.classification.tags.includes('negative-control')));
assert.ok(corpus.cases.some(item => item.classification.tags.includes('bust')));
const totalWeight = Object.values(weights.weights).reduce((sum, value) => sum + value, 0);
assert.ok(Math.abs(totalWeight - 1) < 1e-9);
console.log('2.43.0 benchmark and calibration framework regression: PASS');
